/**
 * Shared date formatting — always dd/mm/yyyy regardless of browser locale.
 */

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-GB'); }
  catch { return String(s); }
}

export function fmtDateTime(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-GB', {
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch { return String(s); }
}
