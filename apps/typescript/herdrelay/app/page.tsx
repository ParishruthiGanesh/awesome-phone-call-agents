import { Console } from "./components/Console";

// The mode is read per request, so the console cannot render a stale badge
// after a deployment changes HERDRELAY_MODE.
export const dynamic = "force-dynamic";

export default function Page() {
  return <Console />;
}
