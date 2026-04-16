/**
 * MediaGenPage — Fal.ai image and video generation.
 *
 * Model library is loaded from the server and fully editable:
 * add, edit, delete, and test any Fal.ai model ID without a code change.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import useAuthStore from '../../stores/authStore';

// ── Constants ────────────────────────────────────────────────────────────────

const GROUP_ORDER = ['Text → Video', 'Image → Video', 'Image → Image', 'Text → Image'];
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DURATIONS     = ['5', '10'];

/** Infer type / requiresImage from model ID when not explicitly set. */
function inferMeta(id) {
  const s = (id || '').toLowerCase();
  const isVideo =
    s.includes('text-to-video') || s.includes('image-to-video') ||
    s.includes('seedance') || s.includes('kling') || s.includes('sora') ||
    s.includes('svd') || s.includes('pixverse') || s.includes('wan') ||
    s.includes('pika') || s.includes('minimax');
  return {
    type:         isVideo ? 'video' : 'image',
    requiresImage: s.includes('image-to-video') || s.includes('image-to-image'),
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const p = {
    gray:  { background: 'var(--color-surface)', color: 'var(--color-muted)',  border: '1px solid var(--color-border)' },
    green: { background: '#d1fae5',              color: '#065f46',             border: '1px solid #6ee7b7' },
    amber: { background: '#fef3c7',              color: '#92400e',             border: '1px solid #fcd34d' },
    red:   { background: '#fee2e2',              color: '#991b1b',             border: '1px solid #fca5a5' },
    blue:  { background: '#dbeafe',              color: '#1e40af',             border: '1px solid #93c5fd' },
  };
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, ...p[color] }}>
      {children}
    </span>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      style={{ animation:'spin 0.8s linear infinite', flexShrink:0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function statusBadge(s) {
  const m = { pending:{label:'Pending',color:'amber'}, completed:{label:'Completed',color:'green'}, failed:{label:'Failed',color:'red'} };
  const b = m[s] || { label:s, color:'gray' };
  return <Badge color={b.color}>{b.label}</Badge>;
}

// ── Model Management Panel ───────────────────────────────────────────────────

function ModelManager({ models, onSave, apiToken }) {
  const [list,      setList]      = useState(() => models.map((m, i) => ({ ...m, _key: i })));
  const [editIdx,   setEditIdx]   = useState(null);  // index in list being edited
  const [editDraft, setEditDraft] = useState(null);
  const [addOpen,   setAddOpen]   = useState(false);
  const [addDraft,  setAddDraft]  = useState({ id:'', label:'', group:'Text → Video', type:'video', requiresImage:false });
  const [testState, setTestState] = useState({}); // key=model.id, value={status:'testing'|'ok'|'fail', msg}
  const [saving,    setSaving]    = useState(false);

  const testModel = async (modelId) => {
    setTestState((p) => ({ ...p, [modelId]: { status:'testing' } }));
    try {
      const res = await fetch('/api/media-gen/test-model', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${apiToken}` },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestState((p) => ({ ...p, [modelId]: { status:'ok', msg:`Request ID: ${data.requestId?.slice(0,16)}…` } }));
      } else {
        setTestState((p) => ({ ...p, [modelId]: { status:'fail', msg: data.error } }));
      }
    } catch (err) {
      setTestState((p) => ({ ...p, [modelId]: { status:'fail', msg: err.message } }));
    }
  };

  const startEdit = (i) => {
    setEditIdx(i);
    setEditDraft({ ...list[i] });
  };

  const saveEdit = () => {
    if (!editDraft.id.trim()) return;
    const meta = inferMeta(editDraft.id);
    const updated = [...list];
    updated[editIdx] = { ...editDraft, type: editDraft.type || meta.type, requiresImage: editDraft.requiresImage ?? meta.requiresImage };
    setList(updated);
    setEditIdx(null);
    setEditDraft(null);
  };

  const deleteRow = (i) => {
    if (!window.confirm(`Delete "${list[i].label}"?`)) return;
    setList((p) => p.filter((_, j) => j !== i));
    if (editIdx === i) { setEditIdx(null); setEditDraft(null); }
  };

  const addModel = () => {
    if (!addDraft.id.trim() || !addDraft.label.trim()) return;
    const meta = inferMeta(addDraft.id);
    setList((p) => [...p, { ...addDraft, type: addDraft.type || meta.type, requiresImage: addDraft.requiresImage ?? meta.requiresImage, _key: Date.now() }]);
    setAddDraft({ id:'', label:'', group:'Text → Video', type:'video', requiresImage:false });
    setAddOpen(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(list.map(({ _key, ...m }) => m));
    setSaving(false);
  };

  const DraftField = ({ label, value, onChange, type='text', children }) => (
    <div style={{ flex:1, minWidth:100 }}>
      <div style={{ fontSize:10, color:'var(--color-muted)', marginBottom:2 }}>{label}</div>
      {children || (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width:'100%', padding:'5px 7px', borderRadius:4, border:'1px solid var(--color-border)',
            background:'var(--color-bg)', color:'var(--color-text)', fontSize:12, boxSizing:'border-box',
            fontFamily: type==='text' && label==='Model ID' ? 'var(--font-mono,monospace)' : 'inherit' }} />
      )}
    </div>
  );

  const SelectField = ({ label, value, onChange, options }) => (
    <DraftField label={label} value={value} onChange={onChange}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width:'100%', padding:'5px 7px', borderRadius:4, border:'1px solid var(--color-border)',
          background:'var(--color-bg)', color:'var(--color-text)', fontSize:12 }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </DraftField>
  );

  const btn = (label, onClick, color='var(--color-text)', disabled=false) => (
    <button onClick={onClick} disabled={disabled} style={{ padding:'4px 10px', borderRadius:4, border:'1px solid var(--color-border)',
      background:'transparent', color: disabled ? 'var(--color-muted)' : color, fontSize:11, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}>
      {label}
    </button>
  );

  // Group models for display
  const grouped = GROUP_ORDER.map((g) => ({ group:g, rows: list.map((m,i)=>({...m,_i:i})).filter((m) => m.group===g) }));
  const ungrouped = list.map((m,i)=>({...m,_i:i})).filter((m) => !GROUP_ORDER.includes(m.group));
  if (ungrouped.length) grouped.push({ group:'Other', rows:ungrouped });

  return (
    <div style={{ marginTop:12, background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:8, overflow:'hidden' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--color-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:600, fontSize:13, color:'var(--color-text)' }}>Model Library</span>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setAddOpen((p)=>!p)}
            style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--color-primary)', background:'transparent',
              color:'var(--color-primary)', fontSize:12, cursor:'pointer', fontWeight:600 }}>
            + Add Model
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:'5px 14px', borderRadius:5, border:'none', background: saving ? 'var(--color-border)' : 'var(--color-primary)',
              color: saving ? 'var(--color-muted)' : '#fff', fontSize:12, cursor: saving ? 'not-allowed' : 'pointer', fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
            {saving && <Spinner size={12}/>} Save
          </button>
        </div>
      </div>

      {/* Add form */}
      {addOpen && (
        <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--color-text)', marginBottom:8 }}>Add Model</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
            <DraftField label="Label" value={addDraft.label} onChange={(v) => setAddDraft((p)=>({...p, label:v}))} />
            <DraftField label="Model ID" value={addDraft.id} onChange={(v) => { const m=inferMeta(v); setAddDraft((p)=>({...p, id:v, type:m.type, requiresImage:m.requiresImage})); }} />
            <SelectField label="Group" value={addDraft.group} onChange={(v) => setAddDraft((p)=>({...p,group:v}))}
              options={GROUP_ORDER.map((g)=>({value:g,label:g}))} />
            <SelectField label="Output Type" value={addDraft.type} onChange={(v) => setAddDraft((p)=>({...p,type:v}))}
              options={[{value:'video',label:'Video'},{value:'image',label:'Image'}]} />
            <DraftField label="Requires Image">
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer', paddingTop:4 }}>
                <input type="checkbox" checked={addDraft.requiresImage} onChange={(e) => setAddDraft((p)=>({...p,requiresImage:e.target.checked}))} />
                Required
              </label>
            </DraftField>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {btn('Add', addModel, 'var(--color-primary)', !addDraft.id.trim() || !addDraft.label.trim())}
            {btn('Cancel', () => setAddOpen(false))}
          </div>
        </div>
      )}

      {/* Model table */}
      <div style={{ overflowX:'auto' }}>
        {grouped.map(({ group, rows }) => rows.length === 0 ? null : (
          <div key={group}>
            <div style={{ padding:'6px 16px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em',
              color:'var(--color-muted)', background:'var(--color-surface)', borderBottom:'1px solid var(--color-border)' }}>
              {group}
            </div>
            {rows.map((m) => (
              <div key={m._i}>
                {/* Row */}
                {editIdx !== m._i && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px',
                    borderBottom:'1px solid var(--color-border)', flexWrap:'wrap' }}>
                    <div style={{ flex:'1 1 160px', fontSize:13, color:'var(--color-text)', fontWeight:500 }}>{m.label}</div>
                    <div style={{ flex:'2 1 200px', fontSize:11, color:'var(--color-muted)', fontFamily:'var(--font-mono,monospace)' }}>{m.id}</div>
                    <div style={{ flex:'0 0 80px' }}>
                      <Badge color={m.type==='video'?'blue':'gray'}>{m.type}</Badge>
                      {m.requiresImage && <span style={{ marginLeft:4 }}><Badge color="amber">img</Badge></span>}
                    </div>

                    {/* Test result */}
                    <div style={{ flex:'1 1 180px', fontSize:11 }}>
                      {testState[m.id]?.status === 'testing' && <span style={{ color:'var(--color-muted)', display:'flex', alignItems:'center', gap:4 }}><Spinner size={11}/>Testing…</span>}
                      {testState[m.id]?.status === 'ok'      && <span style={{ color:'#065f46' }}>✓ {testState[m.id].msg}</span>}
                      {testState[m.id]?.status === 'fail'    && <span style={{ color:'#991b1b', wordBreak:'break-all' }}>✗ {testState[m.id].msg}</span>}
                    </div>

                    <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                      {btn('Test',   () => testModel(m.id),   'var(--color-primary)', testState[m.id]?.status==='testing')}
                      {btn('Edit',   () => startEdit(m._i))}
                      {btn('Delete', () => deleteRow(m._i),   'var(--color-error)')}
                    </div>
                  </div>
                )}

                {/* Inline edit form */}
                {editIdx === m._i && editDraft && (
                  <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                      <DraftField label="Label" value={editDraft.label} onChange={(v) => setEditDraft((p)=>({...p,label:v}))} />
                      <DraftField label="Model ID" value={editDraft.id}
                        onChange={(v) => { const meta=inferMeta(v); setEditDraft((p)=>({...p,id:v,type:meta.type,requiresImage:meta.requiresImage})); }} />
                      <SelectField label="Group" value={editDraft.group} onChange={(v) => setEditDraft((p)=>({...p,group:v}))}
                        options={GROUP_ORDER.map((g)=>({value:g,label:g}))} />
                      <SelectField label="Output Type" value={editDraft.type} onChange={(v) => setEditDraft((p)=>({...p,type:v}))}
                        options={[{value:'video',label:'Video'},{value:'image',label:'Image'}]} />
                      <DraftField label="Requires Image">
                        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer', paddingTop:4 }}>
                          <input type="checkbox" checked={editDraft.requiresImage}
                            onChange={(e) => setEditDraft((p)=>({...p,requiresImage:e.target.checked}))} />
                          Required
                        </label>
                      </DraftField>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      {btn('Save',   saveEdit, 'var(--color-primary)', !editDraft.id.trim() || !editDraft.label.trim())}
                      {btn('Cancel', () => { setEditIdx(null); setEditDraft(null); })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MediaGenPage() {
  const { token } = useAuthStore();

  // Model library (loaded from server)
  const [allModels,    setAllModels]    = useState([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [showManager,  setShowManager]  = useState(false);

  // Form state
  const [model,       setModel]       = useState('');
  const [customInput, setCustomInput] = useState('');
  const [prompt,      setPrompt]      = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration,    setDuration]    = useState('5');
  const [refFile,     setRefFile]     = useState(null);
  const [refPreview,  setRefPreview]  = useState(null);
  const fileInputRef = useRef(null);

  // Generation state
  const [generating,  setGenerating]  = useState(false);
  const [statusMsgs,  setStatusMsgs]  = useState([]);
  const [result,      setResult]      = useState(null);
  const [genError,    setGenError]    = useState(null);

  // History state
  const [runs,        setRuns]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [search,      setSearch]      = useState('');
  const [searchInput, setSearchInput] = useState('');
  const LIMIT = 10;

  // Derived: effective model ID and meta
  const effectiveId   = customInput.trim() || model;
  const presetMatch   = allModels.find((m) => m.id === effectiveId);
  const selectedModel = presetMatch || { id: effectiveId, ...inferMeta(effectiveId) };
  const isVideo       = selectedModel.type === 'video';

  // Group models for the selector
  const modelGroups = GROUP_ORDER
    .map((g) => ({ label: g, models: allModels.filter((m) => m.group === g) }))
    .filter((g) => g.models.length > 0);
  const otherModels = allModels.filter((m) => !GROUP_ORDER.includes(m.group));
  if (otherModels.length) modelGroups.push({ label: 'Other', models: otherModels });

  // Load model library
  useEffect(() => {
    fetch('/api/media-gen/models', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        setAllModels(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) setModel(data[0].id);
        setModelsLoaded(true);
      })
      .catch(() => setModelsLoaded(true));
  }, [token]);

  // Load history
  const loadRuns = useCallback(async (pg = 1, q = search) => {
    setLoadingRuns(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: LIMIT, search: q });
      const res = await fetch(`/api/media-gen/runs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.runs || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (err) {
      console.error('[media-gen] load runs:', err.message);
    } finally {
      setLoadingRuns(false);
    }
  }, [token, search]);

  useEffect(() => { loadRuns(1, ''); }, []);

  // Save model library
  const saveModels = async (updated) => {
    await fetch('/api/media-gen/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updated),
    });
    setAllModels(updated);
    if (updated.length > 0 && !updated.find((m) => m.id === effectiveId)) {
      setModel(updated[0].id);
      setCustomInput('');
    }
  };

  // Reference image
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setRefPreview(ev.target.result);
    reader.readAsDataURL(file);
  };
  const clearRef = () => {
    setRefFile(null);
    setRefPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Generate
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setStatusMsgs([]);
    setResult(null);
    setGenError(null);

    const form = new FormData();
    form.append('model',       effectiveId);
    form.append('prompt',      prompt.trim());
    form.append('aspectRatio', aspectRatio);
    if (isVideo) form.append('duration', duration);
    if (refFile)  form.append('referenceImage', refFile);

    try {
      const res = await fetch('/api/media-gen/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          switch (evt.type) {
            case 'status':    setStatusMsgs((p) => [...p, evt.message]); break;
            case 'submitted': setStatusMsgs((p) => [...p, `Queued (${evt.requestId?.slice(0,12)}…)`]); break;
            case 'progress':
              setStatusMsgs((p) => {
                const msg = `${evt.status}… ${evt.elapsed}s`;
                const last = p[p.length - 1] || '';
                return last.startsWith(evt.status) ? [...p.slice(0, -1), msg] : [...p, msg];
              });
              break;
            case 'complete': {
              const r = evt.result;
              const url = r?.video?.url || r?.images?.[0]?.url || null;
              setResult({ type: evt.outputType, url, runId: evt.runId, raw: r });
              setStatusMsgs((p) => [...p, 'Complete.']);
              loadRuns(1, search);
              break;
            }
            case 'error': setGenError(evt.message); break;
            default: break;
          }
        }
      }
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this run?')) return;
    await fetch(`/api/media-gen/runs/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } }).catch(()=>{});
    loadRuns(page, search);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    loadRuns(1, searchInput);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const canGenerate = !generating && !!prompt.trim() && !(selectedModel.requiresImage && !refFile);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Media Generator</h1>
        <p style={{ marginTop: 4, fontSize: 14, color: 'var(--color-muted)' }}>
          Text-to-video, image-to-video, image-to-image, and text-to-image — powered by Fal.ai.
        </p>
      </div>

      {/* Form card */}
      <div style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', borderRadius:8, padding:24, marginBottom:24 }}>

        {/* ── Model selector ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--color-text)' }}>Model</label>
            <button
              onClick={() => setShowManager((p) => !p)}
              style={{ fontSize:11, color:'var(--color-primary)', background:'none', border:'none', cursor:'pointer', padding:'2px 4px' }}
            >
              {showManager ? '▲ Hide manager' : '⚙ Manage models'}
            </button>
          </div>

          {!modelsLoaded ? (
            <div style={{ color:'var(--color-muted)', fontSize:13, display:'flex', gap:8 }}><Spinner size={14}/>Loading models…</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10, opacity: customInput.trim() ? 0.45 : 1, transition:'opacity 150ms' }}>
              {modelGroups.map((group) => (
                <div key={group.label}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--color-muted)', marginBottom:5 }}>
                    {group.label}
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {group.models.map((m) => {
                      const active = !customInput.trim() && model === m.id;
                      return (
                        <button key={m.id} onClick={() => { setModel(m.id); setCustomInput(''); }}
                          style={{ padding:'5px 12px', borderRadius:5, fontSize:12, cursor:'pointer',
                            border: active ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                            background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                            color: active ? '#fff' : 'var(--color-text)',
                            fontWeight: active ? 600 : 400, transition:'all 120ms' }}>
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Custom model input */}
          <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'center' }}>
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Or paste any Fal.ai model ID — e.g. fal-ai/wan-2.2/image-to-video"
              style={{ flex:1, padding:'7px 10px', borderRadius:6, fontSize:12,
                border: customInput.trim() ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background:'var(--color-bg)', color:'var(--color-text)', fontFamily:'var(--font-mono,monospace)' }}
            />
            {customInput.trim() && (
              <button onClick={() => setCustomInput('')}
                style={{ padding:'6px 10px', borderRadius:5, border:'1px solid var(--color-border)', background:'transparent', color:'var(--color-muted)', fontSize:12, cursor:'pointer' }}>
                ✕
              </button>
            )}
          </div>
          {customInput.trim() && (
            <div style={{ marginTop:3, fontSize:11, color:'var(--color-muted)' }}>
              Custom: <code style={{ fontFamily:'var(--font-mono,monospace)' }}>{customInput.trim()}</code>
              {' · '}{selectedModel.type}{selectedModel.requiresImage ? ' · image required' : ''}
            </div>
          )}

          {/* Model manager */}
          {showManager && (
            <ModelManager models={allModels} onSave={saveModels} apiToken={token} />
          )}
        </div>

        {/* ── Prompt ── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:6 }}>
            Prompt <span style={{ color:'var(--color-error)' }}>*</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isVideo ? 'Describe the video you want to generate…' : 'Describe the image you want to generate…'}
            rows={4} maxLength={2000}
            style={{ width:'100%', padding:'10px 12px', borderRadius:6, border:'1px solid var(--color-border)',
              background:'var(--color-bg)', color:'var(--color-text)', fontSize:14, resize:'vertical',
              boxSizing:'border-box', fontFamily:'inherit' }}
          />
          <div style={{ fontSize:11, color:'var(--color-muted)', textAlign:'right', marginTop:2 }}>{prompt.length} / 2000</div>
        </div>

        {/* ── Options ── */}
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:16 }}>
          <div>
            <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:6 }}>Aspect Ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
              style={{ padding:'7px 10px', borderRadius:6, border:'1px solid var(--color-border)', background:'var(--color-bg)', color:'var(--color-text)', fontSize:13 }}>
              {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {isVideo && (
            <div>
              <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:6 }}>Duration</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)}
                style={{ padding:'7px 10px', borderRadius:6, border:'1px solid var(--color-border)', background:'var(--color-bg)', color:'var(--color-text)', fontSize:13 }}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d} seconds</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ── Reference image ── */}
        <div style={{ marginBottom:20 }}>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:6 }}>
            Reference Image{' '}
            {selectedModel.requiresImage
              ? <span style={{ color:'var(--color-error)' }}>* required for this model</span>
              : <span style={{ fontWeight:400, color:'var(--color-muted)' }}>(optional)</span>}
          </label>
          {refPreview ? (
            <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
              <img src={refPreview} alt="Reference"
                style={{ maxWidth:180, maxHeight:120, objectFit:'cover', borderRadius:6, border:'1px solid var(--color-border)' }} />
              <div>
                <div style={{ fontSize:13, color:'var(--color-muted)', marginBottom:6 }}>{refFile?.name}</div>
                <button onClick={clearRef}
                  style={{ padding:'4px 12px', fontSize:12, borderRadius:5, border:'1px solid var(--color-border)', background:'transparent', color:'var(--color-error)', cursor:'pointer' }}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange}
                style={{ display:'none' }} id="ref-image-input" />
              <label htmlFor="ref-image-input"
                style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'8px 16px', borderRadius:6,
                  border:'1px dashed var(--color-border)', background:'var(--color-bg)', color:'var(--color-muted)',
                  fontSize:13, cursor:'pointer', userSelect:'none' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Upload reference image
              </label>
              <div style={{ marginTop:4, fontSize:11, color:'var(--color-muted)' }}>Max 20 MB.</div>
            </div>
          )}
        </div>

        {/* ── Generate button ── */}
        <button onClick={handleGenerate} disabled={!canGenerate}
          style={{ padding:'10px 24px', borderRadius:6, border:'none',
            background: canGenerate ? 'var(--color-primary)' : 'var(--color-border)',
            color: canGenerate ? '#fff' : 'var(--color-muted)',
            fontSize:14, fontWeight:600, cursor: canGenerate ? 'pointer' : 'not-allowed',
            display:'flex', alignItems:'center', gap:8, transition:'all 150ms' }}>
          {generating && <Spinner size={15}/>}
          {generating ? 'Generating…' : `Generate ${isVideo ? 'Video' : 'Image'}`}
        </button>
      </div>

      {/* ── Progress ── */}
      {(generating || statusMsgs.length > 0) && (
        <div style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', borderRadius:8, padding:16, marginBottom:24 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:8 }}>
            {generating ? 'Generating…' : 'Log'}
          </div>
          {statusMsgs.map((m, i) => (
            <div key={i} style={{ fontSize:13, color:'var(--color-muted)', paddingLeft:8, lineHeight:'1.8' }}>• {m}</div>
          ))}
          {generating && (
            <div style={{ marginTop:8, fontSize:12, color:'var(--color-muted)' }}>Video generation typically takes 30–90 seconds.</div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {genError && (
        <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, padding:16, marginBottom:24, color:'#991b1b', fontSize:13 }}>
          <strong>Generation failed:</strong> {genError}
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', borderRadius:8, padding:20, marginBottom:24 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <span style={{ fontSize:15, fontWeight:600, color:'var(--color-text)' }}>
              Result <Badge color="green">{result.type === 'video' ? 'Video' : 'Image'}</Badge>
            </span>
            {result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer" download
                style={{ padding:'6px 14px', borderRadius:6, border:'1px solid var(--color-primary)', background:'transparent', color:'var(--color-primary)', fontSize:12, fontWeight:600, textDecoration:'none' }}>
                Download
              </a>
            )}
          </div>
          {result.url && result.type === 'video' && (
            <video src={result.url} controls style={{ width:'100%', maxWidth:720, borderRadius:6, background:'#000', display:'block' }} />
          )}
          {result.url && result.type === 'image' && (
            <img src={result.url} alt="Generated" style={{ width:'100%', maxWidth:720, borderRadius:6, display:'block' }} />
          )}
          {!result.url && (
            <div style={{ color:'var(--color-muted)', fontSize:13 }}>No media URL in result. Run #{result.runId}.</div>
          )}
        </div>
      )}

      {/* ── History ── */}
      <div style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', borderRadius:8, padding:'20px 20px 0' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <span style={{ fontSize:15, fontWeight:600, color:'var(--color-text)' }}>
            History <span style={{ fontSize:12, fontWeight:400, color:'var(--color-muted)' }}>({total})</span>
          </span>
          <form onSubmit={handleSearch} style={{ display:'flex', gap:8 }}>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search prompts…"
              style={{ padding:'6px 10px', borderRadius:6, border:'1px solid var(--color-border)', background:'var(--color-bg)', color:'var(--color-text)', fontSize:13, width:200 }} />
            <button type="submit"
              style={{ padding:'6px 12px', borderRadius:6, border:'1px solid var(--color-border)', background:'var(--color-bg)', color:'var(--color-text)', fontSize:12, cursor:'pointer' }}>
              Search
            </button>
          </form>
        </div>

        {loadingRuns ? (
          <div style={{ textAlign:'center', padding:24, color:'var(--color-muted)' }}><Spinner size={18}/></div>
        ) : runs.length === 0 ? (
          <div style={{ textAlign:'center', padding:32, color:'var(--color-muted)', fontSize:13 }}>No runs yet.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--color-border)' }}>
                  {['Model','Prompt','Type','Status','Created','Result',''].map((h) => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 10px', fontSize:11, fontWeight:600,
                      textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-muted)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const mediaUrl = run.video_url || run.image_url;
                  return (
                    <tr key={run.id} style={{ borderBottom:'1px solid var(--color-border)' }}>
                      <td style={{ padding:'10px 10px', maxWidth:160 }}>
                        <span style={{ fontSize:11, color:'var(--color-muted)' }}>{run.model.replace('fal-ai/','')}</span>
                      </td>
                      <td style={{ padding:'10px 10px', maxWidth:280 }}>
                        <span title={run.prompt} style={{ display:'block', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--color-text)' }}>
                          {run.prompt}
                        </span>
                      </td>
                      <td style={{ padding:'10px 10px', whiteSpace:'nowrap' }}>
                        <Badge color={run.output_type==='video'?'blue':'gray'}>{run.output_type}</Badge>
                      </td>
                      <td style={{ padding:'10px 10px', whiteSpace:'nowrap' }}>{statusBadge(run.status)}</td>
                      <td style={{ padding:'10px 10px', whiteSpace:'nowrap', color:'var(--color-muted)' }}>{fmtDate(run.created_at)}</td>
                      <td style={{ padding:'10px 10px' }}>
                        {mediaUrl
                          ? <a href={mediaUrl} target="_blank" rel="noopener noreferrer" style={{ color:'var(--color-primary)', fontSize:12 }}>
                              {run.output_type==='video'?'Video':'Image'}
                            </a>
                          : run.error
                            ? <span title={run.error} style={{ color:'var(--color-error)', fontSize:12, cursor:'help' }}>Error ⓘ</span>
                            : <span style={{ color:'var(--color-muted)', fontSize:12 }}>—</span>}
                      </td>
                      <td style={{ padding:'10px 10px' }}>
                        <button onClick={() => handleDelete(run.id)}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--color-muted)', padding:'2px 6px', borderRadius:4 }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:8, padding:'14px 0', borderTop:'1px solid var(--color-border)', marginTop:4 }}>
            <button onClick={() => loadRuns(page-1,search)} disabled={page<=1}
              style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--color-border)', background:'transparent',
                color: page<=1 ? 'var(--color-muted)' : 'var(--color-text)', cursor: page<=1 ? 'not-allowed' : 'pointer', fontSize:12 }}>
              ← Prev
            </button>
            <span style={{ fontSize:12, color:'var(--color-muted)' }}>Page {page} of {totalPages}</span>
            <button onClick={() => loadRuns(page+1,search)} disabled={page>=totalPages}
              style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--color-border)', background:'transparent',
                color: page>=totalPages ? 'var(--color-muted)' : 'var(--color-text)', cursor: page>=totalPages ? 'not-allowed' : 'pointer', fontSize:12 }}>
              Next →
            </button>
          </div>
        )}
        {!loadingRuns && runs.length > 0 && totalPages <= 1 && <div style={{ height:16 }}/>}
      </div>
    </div>
  );
}
