/**
 * Contract dates — settlement and expiry — always rendered in UTC.
 *
 * These appear in two places rendered by two kinds of component: ContractCard is
 * a client component and formatted in the viewer's timezone, while the market
 * page and the settlement record are server components and formatted in the
 * server's. The same settlement read "Aug 27" on the card and "Aug 28" on the
 * market page, which on an exchange is the one date that must not disagree with
 * itself.
 *
 * A settlement date is not a local wall-clock time, so it gets one zone and
 * keeps it wherever it is drawn.
 */
export function contractDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The same instant with a time, for a tape where the ordering matters. */
export function contractDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}
