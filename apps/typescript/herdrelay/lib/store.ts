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

export class IncidentConflict extends Error {}

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
function destinationFile(phone: string): string {
  return path.join(dataDir(), "destinations", `${createHash("sha256").update(phone).digest("hex")}.json`);
}

/**
 * Claim a number before any network call.
 *
 * Reserved first and released only on a confirmed outcome: if the create
 * request's fate is unknown, the marker stays and every further attempt at that
 * number is refused until a human reconciles it.
 */
export async function reserveDestination(phone: string, incidentId: string): Promise<void> {
  const file = destinationFile(phone);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const holder = await readReservation(phone);
      if (holder === incidentId) return;
      throw new IncidentConflict(
        "That caretaker already has a call in flight or unresolved. Resolve it before calling again; HerdRelay will not redial.",
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ incidentId }));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readReservation(phone: string): Promise<string | null> {
  try {
    const marker = JSON.parse(await fs.readFile(destinationFile(phone), "utf8"));
    return typeof marker?.incidentId === "string" ? marker.incidentId : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function releaseDestination(phone: string, incidentId: string): Promise<void> {
  if ((await readReservation(phone)) !== incidentId) return;
  await fs.rm(destinationFile(phone), { force: true });
}

/** Wipe every incident, lock, and reservation. The demo reset button. */
export async function resetAll(): Promise<void> {
  await fs.rm(dataDir(), { recursive: true, force: true });
}
