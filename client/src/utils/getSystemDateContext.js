/**
 * getSystemDateContext — returns a date/timezone context string for system prompt injection.
 * Returns: "Today is [day], [date]. User timezone: [tz]."
 *
 * Inject as the last (uncached) block of any system prompt.
 */
export function getSystemDateContext() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const day = now.toLocaleDateString('en-AU', { weekday: 'long', timeZone: tz });
  const date = now.toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  });
  return `Today is ${day}, ${date}. User timezone: ${tz}.`;
}
