const JST_OFFSET = "+09:00";

/**
 * HTML datetime-local has no timezone. Treat its value as Japan Standard Time
 * so the result does not depend on the server timezone (for example, Vercel).
 */
export function jstDateTimeLocalToIso(value: string): string | null {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}:00${JST_OFFSET}`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/** Formats a timestamp using the application's fixed Japan-time display. */
export function formatJstDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
