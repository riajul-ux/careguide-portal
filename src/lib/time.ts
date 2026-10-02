import {
  startOfDay,
  endOfDay,
  isSameDay,
  format,
  differenceInCalendarDays,
  isValid,
  parse,
} from "date-fns";

// Business timezone. Node honors runtime changes to process.env.TZ.
if (typeof process !== "undefined" && process.env) {
  process.env.TZ = process.env.APP_TIMEZONE || process.env.TZ || "America/New_York";
}

export const BUSINESS_DAY_START_HOUR = 9;
export const BUSINESS_DAY_END_HOUR = 18; // retries after this roll to the next business day

export function now(): Date {
  return new Date();
}

export { startOfDay, endOfDay, isSameDay, differenceInCalendarDays };

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!isValid(dt)) return "—";
  return format(dt, "MM/dd/yyyy");
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!isValid(dt)) return "—";
  return format(dt, "MM/dd/yyyy h:mm a");
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isValid(dt) ? format(dt, "h:mm a") : "";
}

/** Formats a due instant, showing the time only when the task has one. */
export function fmtDue(d: Date | null | undefined, hasTime: boolean): string {
  if (!d) return "—";
  return hasTime ? fmtDateTime(d) : fmtDate(d);
}

const DATE_FORMATS = [
  "M/d/yyyy h:mm:ss a",
  "M/d/yyyy h:mm a",
  "M/d/yyyy H:mm:ss",
  "M/d/yyyy H:mm",
  "M/d/yyyy",
  "M/d/yy",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd",
];

/**
 * Parses a date string from a CSV export. Returns null for blank input and
 * "invalid" when a value is present but cannot be parsed (never guesses).
 */
export function parseFlexibleDate(raw: string | null | undefined): Date | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  for (const f of DATE_FORMATS) {
    const d = parse(s, f, new Date(2000, 0, 1));
    if (isValid(d) && d.getFullYear() > 1900 && d.getFullYear() < 2200) return d;
  }
  return "invalid";
}

/** "HH:mm" for a date */
export function toHHmm(d: Date): string {
  return format(d, "HH:mm");
}

/** Combines a yyyy-MM-dd date string with an optional HH:mm time. */
export function combineDateTime(dateStr: string, timeStr?: string | null): Date | null {
  if (!dateStr) return null;
  const d = parse(timeStr ? `${dateStr} ${timeStr}` : dateStr, timeStr ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd", new Date());
  return isValid(d) ? d : null;
}

export function toInputDate(d: Date | null | undefined): string {
  return d && isValid(d) ? format(d, "yyyy-MM-dd") : "";
}
