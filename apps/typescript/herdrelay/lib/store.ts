/**
 * Incident state on local disk.
 *
 * The simplest thing that survives a page reload and a server restart: one
 * JSON file per incident, written through a temp file and renamed, in a
 * gitignored directory. No database, no migration, no service to stand up.
 *
 * Two of the safety guarantees live here rather than in the UI, because a UI
 * guarantee is a guarantee against one browser tab:
 *
 *   - `withIncidentLock` serializes approve/start/poll for one incident.
 *   - `reserveDestination` holds a marker keyed to the number, so two
 *     incidents cannot dial the same caretaker at the same time, and an
 *     unresolved call leaves the marker in place until it is reconciled.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Incident, TimelineEntry, Env } from "./types";

export class IncidentConflict extends Error {
  /** The incident holding the thing this one wanted, when there is one. */
  constructor(message: string, public blockingIncidentId?: string) {
    super(message);
  }
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIncidentId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

export function dataDir(env: Env = process.env): string {
  return env.HERDRELAY_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

export function newIncidentId(): string {
  return randomUUID();
}

export async function saveIncident(incident: Incident): Promise<Incident> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${incident.id}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(incident, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
  return incident;
}

export async function getIncident(id: string): Promise<Incident | null> {
  if (!isIncidentId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir(), `${id}.json`), "utf8")) as Incident;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
  const incident = await getIncident(id);
  if (!incident) return null;
  return saveIncident({ ...incident, ...patch });
}

export async function appendTimeline(incident: Incident, entry: Omit<TimelineEntry, "at">): Promise<Incident> {
  const next: Incident = {
    ...incident,
    timeline: [...incident.timeline, { at: new Date().toISOString(), ...entry }],
  };
  return saveIncident(next);
}

export async function listIncidents(): Promise<Incident[]> {
  let files: string[];
  try {
    // The data directory is configurable so tests can point it somewhere
    // disposable, which the bundler cannot trace statically. It is a plain
    // server-side read of a directory this process owns.
    files = await fs.readdir(/*turbopackIgnore: true*/ dataDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const incidents: Incident[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    if (!isIncidentId(id)) continue;
    const incident = await getIncident(id);
    if (incident) incidents.push(incident);
  }
  return incidents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The one open incident for an alert, if any. Duplicate protection starts here. */
export async function findOpenIncidentForAlert(alertId: string): Promise<Incident | null> {
  const open = (await listIncidents()).filter(
    (incident) => incident.alert.id === alertId && incident.phase !== "planned",
  );
  return open[0] ?? null;
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/**
 * Serialize the mutating steps of one incident.
 *
 * A stale lock is deliberately not stolen after a timeout. The thing a stale
 * lock most often means here is a process that died between "we asked CALL-E to
 * dial" and "CALL-E answered", and breaking the lock in that state is how a
 * caretaker's phone rings twice.
 */
export async function withIncidentLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (!isIncidentId(id)) throw new IncidentConflict("Unknown incident.");
  const dir = path.join(dataDir(), "locks");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, id);
  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new IncidentConflict(
        "This incident is already being acted on, or a previous action was interrupted. Reconcile it before trying again.",
      );
    }
    throw error;
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await fs.unlink(file).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Destination reservation
// ---------------------------------------------------------------------------

/** The marker filename is a hash, so a directory listing is not a phone book. */
export function destinationKey(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

function destinationFile(key: string): string {
  return path.join(dataDir(), "destinations", `${key}.json`);
}

/**
 * Does this incident still owe us an answer about whether a phone rang?
 *
 * Only an incident in that state may hold a caretaker. An incident that
 * finished — completed, failed, unanswered, uncertain — has nothing left to
 * resolve, and a marker it left behind is debris rather than protection.
 * Anything else would mean one messy call blocks every future call to that
 * person forever, which is not caution, it is a broken rota.
 */
function stillHoldsCaretaker(incident: Incident): boolean {
  // An unknown create outcome is exactly the case the reservation exists for.
  if (incident.createState === "creating" || incident.createState === "ambiguous") return true;
  return ["calling", "in_progress"].includes(incident.phase);
}

/**
 * Claim a number before any network call.
 *
 * Reserved first and released only on a confirmed outcome: if the create
 * request's fate is unknown, the marker stays and every further attempt at that
 * number is refused until a human reconciles it.
 */
export async function reserveDestination(phone: string, incidentId: string): Promise<string> {
  const key = destinationKey(phone);
  const file = destinationFile(key);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const holderId = await readReservation(key);
    if (holderId === incidentId) return key;

    const holder = holderId ? await getIncident(holderId) : null;
    if (holder && stillHoldsCaretaker(holder)) {
      throw new IncidentConflict(
        `That caretaker has an unresolved call for animal ${holder.alert.animalId}. Resolve that incident before calling again; HerdRelay will not redial.`,
        holder.id,
      );
    }

    // The holder finished, or its record is gone. The marker is debris, and
    // debris must not stop the next animal being called about.
    await writeReservation(file, incidentId);
    return key;
  }

  try {
    await handle.writeFile(JSON.stringify({ incidentId }));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return key;
}

async function writeReservation(file: string, incidentId: string): Promise<void> {
  const handle = await fs.open(file, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ incidentId }));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readReservation(key: string): Promise<string | null> {
  try {
    const marker = JSON.parse(await fs.readFile(destinationFile(key), "utf8"));
    return typeof marker?.incidentId === "string" ? marker.incidentId : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Release by the key stored when the reservation was taken, never by
 * re-deriving it from the current configuration: a caretaker number edited
 * mid-incident would otherwise strand the marker forever.
 */
export async function releaseDestination(key: string, incidentId: string): Promise<void> {
  if ((await readReservation(key)) !== incidentId) return;
  await fs.rm(destinationFile(key), { force: true });
}

/** Wipe every incident, lock, and reservation. The demo reset button. */
export async function resetAll(): Promise<void> {
  await fs.rm(dataDir(), { recursive: true, force: true });
}
