/**
 * exportService — platform-wide export utility.
 *
 * Provides exportPdf() and exportText() for any tool in the platform.
 * PDF generation is server-side (Puppeteer + Chromium) for consistent,
 * fully-formatted output with selectable text.
 *
 * Usage:
 *   import { exportPdf, exportText, chatMessagesToHtml } from '../../utils/exportService';
 *
 *   // Report (markdown):
 *   await exportPdf({ content: markdownString, title: 'My Report', filename: 'report.pdf' });
 *
 *   // Conversation (chat messages array):
 *   const html = chatMessagesToHtml(messages);
 *   await exportPdf({ content: html, contentType: 'html', title: 'Discussion', filename: 'discussion.pdf' });
 *
 *   // Plain text fallback:
 *   exportText({ content: 'some text', filename: 'export.txt' });
 */

import { useAuthStore } from '../stores/authStore';

// ── PDF — server-side via Puppeteer ──────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}  opts.content      — markdown string or HTML string
 * @param {string} [opts.contentType] — 'markdown' (default) | 'html'
 * @param {string} [opts.title]       — document title shown in header
 * @param {string} [opts.filename]    — downloaded filename (e.g. 'report.pdf')
 * @param {string} [opts.extraStyles] — additional CSS injected into the PDF shell
 * @returns {Promise<void>}
 */
export async function exportPdf({ content, contentType = 'markdown', title = 'Export', filename = 'export.pdf', extraStyles = '' }) {
  // api.stream is for SSE — use a raw fetch for binary responses
  const token = useAuthStore.getState().token ?? '';

  const res = await fetch('/api/export/pdf', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ content, contentType, title, filename, extraStyles }),
  });

  if (!res.ok) {
    let msg = 'PDF export failed';
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Text — client-side, no server needed ─────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}  opts.content  — plain text string
 * @param {string} [opts.filename]
 */
export function exportText({ content, filename = 'export.txt' }) {
  const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Helpers — build exportable content from platform data structures ──────────

/**
 * Convert a chat messages array (ConversationView format) to styled HTML
 * suitable for passing to exportPdf with contentType: 'html'.
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {string} HTML string
 */
export function chatMessagesToHtml(messages) {
  return messages.map((m, i) => {
    const isUser = m.role === 'user';
    const text   = Array.isArray(m.content)
      ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      : (m.content ?? '');
    const escaped = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      ${i > 0 ? '<hr class="chat-divider">' : ''}
      <div class="chat-turn">
        <div class="chat-role">${isUser ? 'You' : 'Assistant'}</div>
        <div class="chat-bubble ${isUser ? 'user' : 'assistant'}">${escaped}</div>
      </div>`;
  }).join('\n');
}

/**
 * Convert a chat messages array to plain text (for exportText).
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {string}
 */
export function chatMessagesToText(messages) {
  return messages.map((m) => {
    const role = m.role === 'user' ? 'You' : 'Assistant';
    const text = Array.isArray(m.content)
      ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      : (m.content ?? '');
    return `${role}:\n${text}`;
  }).join('\n\n---\n\n');
}
