/**
 * ConversationView — persistent multi-turn AI conversation for Google Ads.
 *
 * Left: conversation list + New button.
 * Right: chat thread + input.
 *
 * Each turn streams via SSE. Conversation history is persisted server-side
 * so threads can be resumed across sessions.
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import MarkdownRenderer from '../../../components/ui/MarkdownRenderer';
import Button from '../../../components/ui/Button';

const fmtDate = (s) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('en-AU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

const fmtAud    = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCost   = (n) => n != null ? `$${Number(n).toFixed(3)}` : null;

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

// ── Bubble ────────────────────────────────────────────────────────────────────

function Bubble({ role, content, costAud }) {
  const isUser = role === 'user';
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
          {isUser
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
            : <MarkdownRenderer text={content} />
          }
        </div>
        {!isUser && costAud != null && (
          <p style={{ fontSize: 10, color: 'var(--color-muted)', margin: '3px 4px 0', fontFamily: 'inherit' }}>
            {fmtCost(costAud)}
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

// ── Main component ────────────────────────────────────────────────────────────

export default function ConversationView({ startDate, endDate, seedText = '', onSeedConsumed }) {
  const [conversations, setConversations] = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [draft,         setDraft]         = useState('');
  const [sending,       setSending]       = useState(false);
  const [progressText,  setProgressText]  = useState('');
  const [error,         setError]         = useState('');
  const [editingTitle,  setEditingTitle]  = useState(null); // conversation id being renamed
  const [titleDraft,    setTitleDraft]    = useState('');

  const threadRef = useRef(null);
  const inputRef  = useRef(null);
  const seedUsed  = useRef(false);

  useEffect(() => { loadConversations(); }, []);

  // Seed from StrategicReviewCard "Continue in Conversation"
  useEffect(() => {
    if (seedText && !seedUsed.current) {
      seedUsed.current = true;
      setDraft(seedText);
      if (typeof onSeedConsumed === 'function') onSeedConsumed();
      // Auto-create a new conversation and focus input
      handleNewConversation(seedText);
    }
  }, [seedText]);

  useEffect(() => {
    // Scroll to bottom when messages update
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function loadConversations() {
    try {
      const rows = await api.get('/conversation');
      setConversations(rows);
      // Auto-select most recent if none active
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
      if (initialDraft) {
        setDraft(initialDraft);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setError('Failed to create conversation.');
    }
  }

  async function handleSend() {
    if (!draft.trim() || !activeId || sending) return;

    const userText = draft.trim();
    setDraft('');
    setSending(true);
    setProgressText('');
    setError('');

    // Optimistically add user bubble
    setMessages((prev) => [...prev, { role: 'user', content: userText }]);

    try {
      const res = await api.stream(`/conversation/${activeId}/message`, {
        message: userText, startDate, endDate,
      });
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
              setMessages((prev) => [...prev, { role: 'assistant', content: msg.message, costAud: msg.costAud ?? null }]);
              setProgressText('');
              // Update conversation title in sidebar if auto-titled
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

  return (
    <div style={{
      display: 'flex', height: 560,
      borderRadius: 16, border: '1px solid var(--color-border)',
      overflow: 'hidden', fontFamily: 'inherit',
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
                <Bubble key={i} role={m.role} content={m.content} costAud={m.costAud} />
              ))}
              {sending && <TypingIndicator text={progressText} />}
            </div>

            {/* Error */}
            {error && (
              <div style={{ padding: '6px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca' }}>
                <p style={{ fontSize: 12, color: '#dc2626', fontFamily: 'inherit', margin: 0 }}>{error}</p>
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
                placeholder="Ask a question or enter observations to validate…"
                disabled={sending}
                style={{
                  ...inputStyle,
                  opacity: sending ? 0.6 : 1,
                }}
              />
              <Button
                variant="primary"
                onClick={handleSend}
                disabled={sending || !draft.trim()}
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
