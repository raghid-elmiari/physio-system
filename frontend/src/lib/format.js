// Display helpers. Backend LocalDateTime values have no zone and are interpreted as local time.

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value) {
  const d = parseDate(value);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function formatDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

export function formatDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function relativeDay(value) {
  const d = parseDate(value);
  if (!d) return "never";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Share of counted reps performed correctly, or null when the session has no on-device evaluation. */
export function sessionAccuracy(s) {
  if (s?.correctReps == null) return null;
  return s.roundsCompleted ? (100 * s.correctReps) / s.roundsCompleted : 0;
}

/** yyyy-mm-dd in local time, the format the API expects for dates. */
export function toIsoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

/** Dates without a time ("2026-10-30") are calendar days; show them without timezone shifts. */
export function formatCalendarDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return formatDate(value);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age;
}

/** { from, to } covering the last `days` calendar days, today included. */
export function lastDaysRange(days) {
  return { from: isoDateDaysAgo(days - 1), to: toIsoDate(new Date()) };
}
