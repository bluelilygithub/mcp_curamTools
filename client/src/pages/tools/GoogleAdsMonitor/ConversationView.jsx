/**
 * ConversationView — persistent multi-turn AI conversation.
 *
 * Optional props:
 *   reportText  — when provided, a collapsible report panel appears above the thread
 *   reportTitle — label for the report panel toggle (default "Report")
 *
 * Left: conversation list + New button.
 * Right: collapsible report panel → chat thread → action bar → input bar.
 *
 * Each turn streams via SSE. Conversation history is persisted server-side
 * so threads can be resumed across sessions.
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import { exportPdf, exportText, chatMessagesToHtml, chatMessagesToText } from '../../../utils/exportService';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import Button from '../../../components/ui/Button';
import MicButton from '../../../components/ui/MicButton';
import ReadAloudButton from '../../../components/ui/ReadAloudButton';
import { stripForSpeech } from '../../../utils/stripForSpeech';

const fmtDate = (s) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('en-AU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

const fmtCost   = (n) => n != null ? `A$${Number(n).toFixed(4)}` : null;
const fmtTokens = (n) => n != null ? Number(n).toLocaleString() : null;

const SUGGESTED_QUESTIONS = [
  'Which campaigns are wasting budget right now?',
  'Where are we losing impression share and why?',
  'Which search terms should become negative keywords?',
  'What changed in the last 30 days and did it help?',
  'Which landing pages are failing paid traffic?',
];

// ── Inline styles ─────────────────────────────────────────────────────────────

const sidebarStyle = {
  width: 220, flexShrink: 0,
  borderRight: '1px solid var(--color-border)',
  display: 'flex', flexDirection: 'column',
  background: 'var(--color-surface)',
};

const chatAreaStyle = {
  flex: 1, display: 'flex', flexDirection: 'column',
  minWidth: 0, background: 'var(--color-bg)',
};

const threadStyle = {
  flex: 1, overflowY: 'auto', padding: '20px 24px',
  display: 'flex', flexDirection: 'column', gap: 16,
};

const inputBarStyle = {
  borderTop: '1px solid var(--color-border)',
  padding: '12px 16px',
  display: 'flex', gap: 8, alignItems: 'flex-end',
  background: 'var(--color-surface)',
};

// ── Image resize helper ───────────────────────────────────────────────────────

const MAX_IMAGE_PX = 1024;
const JPEG_QUALITY = 0.82;

function resizeImageFile(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ── Bubble ────────────────────────────────────────────────────────────────────

function Bubble({ role, content, costAud, tokensUsed }) {
  const isUser = role === 'user';

  const textContent = Array.isArray(content)
    ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    : content;
  const imageDataUrl = Array.isArray(content)
    ? content.find((b) => b.type === 'image_preview')?.dataUrl ?? null
    : null;

  let costLine = null;
  if (!isUser && costAud != null) {
    const parts = [];
    if (tokensUsed?.input  != null) parts.push(`↑ ${fmtTokens(tokensUsed.input)} in`);
    if (tokensUsed?.output != null) parts.push(`↓ ${fmtTokens(tokensUsed.output)} out`);
    parts.push(fmtCost(costAud));
    costLine = parts.join('  ·  ');
  }

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '82%' }}>
        <div style={{
          padding: isUser ? '10px 14px' : '12px 16px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? 'var(--color-primary)' : 'var(--color-surface)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
          color: isUser ? '#fff' : 'var(--color-text)',
          fontSize: 14, lineHeight: 1.6, fontFamily: 'inherit',
        }}>
          {imageDataUrl && (
            <img
              src={imageDataUrl}
              alt="attached screenshot"
              style={{ display: 'block', maxWidth: '100%', borderRadius: 6, marginBottom: textContent ? 8 : 0 }}
            />
          )}
          {textContent && (isUser
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
            : <MarkdownRenderer text={textContent} />
          )}
        </div>
        {!isUser && (
          <div style={{ marginTop: 4, marginLeft: 4 }}>
            <ReadAloudButton text={stripForSpeech(textContent)} size={14} />
          </div>
        )}
        {costLine && (
          <p style={{ fontSize: 10, color: 'var(--color-muted)', margin: '3px 4px 0', fontFamily: 'monospace' }}>
            {costLine}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator({ text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <style>{`@keyframes _conv_dot{0%,80%,100%{opacity:0.3}40%{opacity:1}}`}</style>
        {['', '', ''].map((_, i) => (
          <span key={i} style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: 'var(--color-primary)',
            animation: `_conv_dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
        {text && <span style={{ marginLeft: 4 }}>{text}</span>}
      </div>
    </div>
  );
}

// ── Report panel ──────────────────────────────────────────────────────────────

function ReportPanel({ reportText, reportTitle, visible, onToggle }) {
  return (
    <div style={{
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      flexShrink: 0,
    }}>
      {/* Toggle bar */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
          {reportTitle}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {visible ? 'Hide report' : 'Show report'}
          <span style={{ fontSize: 10 }}>{visible ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* Collapsible content */}
      {visible && (
        <div style={{
          maxHeight: 280, overflowY: 'auto',
          padding: '0 16px 12px',
          borderTop: '1px solid var(--color-border)',
        }}>
          <MarkdownRenderer text={reportText} />
        </div>
      )}
    </div>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────
// Delegated to exportService — no inline implementation here.

// ── Main component ────────────────────────────────────────────────────────────

export default function ConversationView({
  startDate,
  endDate,
  seedText       = '',
  onSeedConsumed,
  reportText     = '',
  reportTitle    = 'Report',
}) {
  const [conversations, setConversations] = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [draft,         setDraft]         = useState('');
  const [pastedImage,   setPastedImage]   = useState(null);
  const [sending,       setSending]       = useState(false);
  const [progressText,  setProgressText]  = useState('');
  const [error,         setError]         = useState('');
  const [editingTitle,  setEditingTitle]  = useState(null);
  const [titleDraft,    setTitleDraft]    = useState('');
  const [reportVisible, setReportVisible] = useState(!!reportText);
  const [exporting,     setExporting]     = useState(false);
  const [exportErr,     setExportErr]     = useState('');

  const threadRef = useRef(null);
  const inputRef  = useRef(null);
  const seedUsed  = useRef(false);

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (seedText && !seedUsed.current) {
      seedUsed.current = true;
      setDraft(seedText);
      if (typeof onSeedConsumed === 'function') onSeedConsumed();
      handleNewConversation(seedText);
    }
  }, [seedText]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Update reportVisible when reportText first arrives
  useEffect(() => {
    if (reportText) setReportVisible(true);
  }, [reportText]);

  async function loadConversations() {
    try {
      const rows = await api.get('/conversation');
      setConversations(rows);
      if (!activeId && rows.length > 0) {
        selectConversation(rows[0].id);
      }
    } catch { /* non-fatal */ }
  }

  async function selectConversation(id) {
    setActiveId(id);
    setError('');
    try {
      const conv = await api.get(`/conversation/${id}`);
      setMessages(conv.messages ?? []);
    } catch {
      setMessages([]);
    }
  }

  async function handleNewConversation(initialDraft = '') {
    try {
      const conv = await api.post('/conversation', { title: 'New conversation' });
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setMessages([]);
      setError('');
      if (initialDraft) setDraft(initialDraft);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch {
      setError('Failed to create conversation.');
    }
  }

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const dataUrl = await resizeImageFile(file);
    if (dataUrl) setPastedImage({ dataUrl });
  }

  async function dispatchMessage(userText, snapshot) {
    if ((!userText && !snapshot) || !activeId || sending) return;

    setSending(true);
    setProgressText('');
    setError('');

    const optimisticContent = snapshot
      ? [
          { type: 'image_preview', dataUrl: snapshot.dataUrl },
          ...(userText ? [{ type: 'text', text: userText }] : []),
        ]
      : userText;
    setMessages((prev) => [...prev, { role: 'user', content: optimisticContent }]);

    const body = snapshot
      ? {
          messageContent: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: snapshot.dataUrl.split(',')[1] } },
            ...(userText ? [{ type: 'text', text: userText }] : []),
          ],
          startDate,
          endDate,
        }
      : { message: userText, startDate, endDate };

    try {
      const res     = await api.stream(`/conversation/${activeId}/message`, body);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop();

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setSending(false); setProgressText(''); return; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setProgressText(msg.text);
            } else if (msg.type === 'result') {
              setMessages((prev) => [...prev, {
                role: 'assistant', content: msg.message,
                costAud: msg.costAud ?? null,
                tokensUsed: msg.tokensUsed ?? null,
              }]);
              setProgressText('');
              if (msg.title) {
                setConversations((prev) =>
                  prev.map((c) => c.id === activeId ? { ...c, title: msg.title } : c)
                );
              }
            } else if (msg.type === 'error') {
              setError(msg.error);
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      setProgressText('');
    }
  }

  async function handleSend() {
    const userText = draft.trim();
    const snapshot = pastedImage;
    if (!userText && !snapshot) return;
    setDraft('');
    setPastedImage(null);
    await dispatchMessage(userText, snapshot);
  }

  async function handleSummarise() {
    const prompt = 'Please provide a complete summary of our entire discussion — covering the key data points, insights explored, conclusions reached, and any recommended actions.';
    await dispatchMessage(prompt, null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleDeleteConversation(id) {
    try {
      await api.delete(`/conversation/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        const remaining = conversations.filter((c) => c.id !== id);
        if (remaining.length > 0) selectConversation(remaining[0].id);
      }
    } catch { /* non-fatal */ }
  }

  async function handleRenameSubmit(id) {
    if (!titleDraft.trim()) { setEditingTitle(null); return; }
    try {
      await api.put(`/conversation/${id}/title`, { title: titleDraft.trim() });
      setConversations((prev) =>
        prev.map((c) => c.id === id ? { ...c, title: titleDraft.trim() } : c)
      );
    } catch { /* non-fatal */ }
    setEditingTitle(null);
  }

  const inputStyle = {
    flex: 1, padding: '10px 12px', borderRadius: 10,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text)',
    fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5,
    resize: 'none', outline: 'none', minHeight: 42, maxHeight: 160,
  };

  const hasMessages = messages.length > 0;

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 200px)',
      minHeight: 520,
      borderRadius: 16,
      border: '1px solid var(--color-border)',
      overflow: 'hidden',
      fontFamily: 'inherit',
    }}>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div style={sidebarStyle}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--color-border)' }}>
          <button
            onClick={() => handleNewConversation()}
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)', color: 'var(--color-text)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            + New conversation
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {conversations.length === 0 && (
            <p style={{ padding: '16px 12px', fontSize: 12, color: 'var(--color-muted)', fontFamily: 'inherit' }}>
              No conversations yet.
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              style={{
                padding: '8px 12px', cursor: 'pointer',
                background: activeId === conv.id ? 'var(--color-primary)10' : 'transparent',
                borderLeft: activeId === conv.id ? '3px solid var(--color-primary)' : '3px solid transparent',
              }}
              onClick={() => selectConversation(conv.id)}
            >
              {editingTitle === conv.id ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => handleRenameSubmit(conv.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(conv.id); if (e.key === 'Escape') setEditingTitle(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%', fontSize: 12, padding: '2px 4px',
                    border: '1px solid var(--color-primary)', borderRadius: 4,
                    background: 'var(--color-bg)', color: 'var(--color-text)',
                    fontFamily: 'inherit', outline: 'none',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                  <p style={{
                    fontSize: 12, margin: 0, lineHeight: 1.4,
                    color: activeId === conv.id ? 'var(--color-primary)' : 'var(--color-text)',
                    fontFamily: 'inherit', fontWeight: activeId === conv.id ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {conv.title || 'Untitled'}
                  </p>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      title="Rename"
                      onClick={() => { setEditingTitle(conv.id); setTitleDraft(conv.title || ''); }}
                      style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: '0 2px', lineHeight: 1 }}
                    >✎</button>
                    <button
                      title="Delete"
                      onClick={() => handleDeleteConversation(conv.id)}
                      style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: '0 2px', lineHeight: 1 }}
                    >✕</button>
                  </div>
                </div>
              )}
              <p style={{ fontSize: 10, color: 'var(--color-muted)', margin: '2px 0 0', fontFamily: 'inherit' }}>
                {conv.message_count ?? 0} messages · {fmtDate(conv.updated_at)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <div style={chatAreaStyle}>
        {!activeId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
            <p style={{ fontSize: 14, color: 'var(--color-muted)', fontFamily: 'inherit', textAlign: 'center' }}>
              Start a new conversation or select one from the left.
            </p>
            <Button variant="primary" onClick={() => handleNewConversation()}>New conversation</Button>
          </div>
        ) : (
          <>
            {/* Report panel — always visible at top, never scrolls away */}
            {reportText && (
              <ReportPanel
                reportText={reportText}
                reportTitle={reportTitle}
                visible={reportVisible}
                onToggle={() => setReportVisible((v) => !v)}
              />
            )}

            {/* Thread */}
            <div ref={threadRef} style={threadStyle}>
              {messages.length === 0 && !sending && (
                <div style={{ padding: '24px 0' }}>
                  <p style={{ fontSize: 13, color: 'var(--color-muted)', fontFamily: 'inherit', marginBottom: 16 }}>
                    Ask anything about your Google Ads account. Data is fetched live.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => { setDraft(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                        style={{
                          textAlign: 'left', padding: '9px 14px', borderRadius: 10,
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-surface)', color: 'var(--color-text)',
                          fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                          lineHeight: 1.4,
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 16, fontFamily: 'inherit' }}>
                    Shift+Enter for new line · Enter to send
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} content={m.content} costAud={m.costAud} tokensUsed={m.tokensUsed} />
              ))}
              {sending && <TypingIndicator text={progressText} />}
              {/* Thread cost total */}
              {(() => {
                const turns = messages.filter((m) => m.role === 'assistant' && m.costAud != null);
                if (turns.length === 0) return null;
                const total = turns.reduce((sum, m) => sum + (m.costAud ?? 0), 0);
                return (
                  <p style={{ fontSize: 10, color: 'var(--color-muted)', textAlign: 'center', fontFamily: 'monospace', paddingTop: 4 }}>
                    Thread total: {fmtCost(total)} ({turns.length} turn{turns.length !== 1 ? 's' : ''})
                  </p>
                );
              })()}
            </div>

            {/* Error */}
            {error && (
              <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca' }}>
                <p style={{ fontSize: 12, color: '#dc2626', fontFamily: 'inherit', margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Action bar — summarise + export, visible once messages exist */}
            {hasMessages && (
              <div style={{
                borderTop: '1px solid var(--color-border)',
                padding: '8px 16px',
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                background: 'var(--color-surface)',
              }}>
                <button
                  onClick={handleSummarise}
                  disabled={sending}
                  title="Ask the AI to summarise the full discussion"
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-text)',
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  Summarise discussion
                </button>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Export:</span>
                <button
                  onClick={() => {
                    setExportErr('');
                    exportText({
                      content:  chatMessagesToText(messages),
                      filename: `discussion-${new Date().toISOString().slice(0, 10)}.txt`,
                    });
                  }}
                  title="Download discussion as plain text"
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-text)',
                  }}
                >
                  Text
                </button>
                <button
                  onClick={async () => {
                    setExporting(true);
                    setExportErr('');
                    try {
                      await exportPdf({
                        content:     chatMessagesToHtml(messages),
                        contentType: 'html',
                        title:       `${reportTitle} — Discussion`,
                        filename:    `discussion-${new Date().toISOString().slice(0, 10)}.pdf`,
                      });
                    } catch (e) {
                      setExportErr(e.message || 'PDF export failed');
                    } finally {
                      setExporting(false);
                    }
                  }}
                  disabled={exporting}
                  title="Download discussion as PDF"
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    fontFamily: 'inherit', borderRadius: 8, cursor: exporting ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-text)',
                    opacity: exporting ? 0.5 : 1,
                  }}
                >
                  {exporting ? 'Generating…' : 'PDF'}
                </button>
                {exportErr && (
                  <span style={{ fontSize: 10, color: '#dc2626' }}>{exportErr}</span>
                )}
              </div>
            )}

            {/* Image preview */}
            {pastedImage && (
              <div style={{ padding: '6px 16px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={pastedImage.dataUrl}
                    alt="pasted screenshot"
                    style={{ maxHeight: 80, maxWidth: 160, borderRadius: 6, border: '1px solid var(--color-border)', display: 'block' }}
                  />
                  <button
                    onClick={() => setPastedImage(null)}
                    style={{
                      position: 'absolute', top: -6, right: -6,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#ef4444', color: '#fff', border: 'none',
                      cursor: 'pointer', fontSize: 10, lineHeight: '18px', textAlign: 'center', padding: 0,
                    }}
                  >✕</button>
                </div>
                <span style={{ fontSize: 11, color: 'var(--color-muted)', alignSelf: 'center' }}>
                  Screenshot attached · resized to ≤{MAX_IMAGE_PX}px
                </span>
              </div>
            )}

            {/* Input bar */}
            <div style={inputBarStyle}>
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask a question or paste a screenshot…"
                disabled={sending}
                style={{ ...inputStyle, opacity: sending ? 0.6 : 1 }}
              />
              <MicButton
                onResult={(t) => setDraft((q) => {
                  const base = q.replace(/\s*\[.*?\]$/, '').trim();
                  return base ? base + ' ' + t : t;
                })}
                onPartial={(t) => setDraft((q) => {
                  const base = q.replace(/\s*\[.*?\]$/, '').trim();
                  return base ? base + ' [' + t + ']' : '[' + t + ']';
                })}
              />
              <Button
                variant="primary"
                onClick={handleSend}
                disabled={sending || (!draft.trim() && !pastedImage)}
                style={{ flexShrink: 0, padding: '8px 18px', fontSize: 13 }}
              >
                {sending ? '…' : 'Send'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
