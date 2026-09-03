/**
 * Contract dates — settlement and expiry — always rendered in UTC, and always
 * built by hand.
 *
 * Two separate problems led here.
 *
 * The first: these appear in components rendered on both sides. ContractCard is
 * a client component and formatted in the viewer's timezone, while the market
 * page and the settlement record are server components and formatted in the
 * server's. The same settlement read "Aug 27" on the card and "Aug 28" on the
 * market page, which on an exchange is the one date that must not disagree with
 * itself. Hence UTC everywhere.
 *
 * The second: pinning the timezone was not enough. toLocaleString goes through
 * whatever ICU build the runtime carries, and Node's and the browser's do not
 * always agree on the same input — which React reports as a hydration mismatch
 * (error #418) once the production build has minified the message down to
 * nothing useful. Assembling the string from getUTC* parts is byte-identical
 * wherever it runs.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function contractDay(d: Date | string): string {
  const t = new Date(d);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

/** Wall clock only, UTC — for a message list where the day is obvious. */
export function contractTime(d: Date | string): string {
  const t = new Date(d);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** The same instant with a time, for a tape where the ordering matters. */
export function contractDateTime(d: Date | string): string {
  const t = new Date(d);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${hh}:${mm}`;
}
