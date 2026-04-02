'use strict';
import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/ui/Toast';

const ACCEPTED = '.pdf,.docx,.txt,.md';

function formatBytes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function DocRow({ doc, onDelete }) {
  const { id, source_id, metadata, created_at } = doc;
  const m = metadata ?? {};
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${m.title ?? source_id}"?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/knowledge/${id}`);
      onDelete(id);
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  }

  return (
    <tr className="border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <td className="py-2 px-3">
        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{m.title ?? source_id}</div>
        {m.category && <div className="text-xs text-zinc-500">{m.category}</div>}
      </td>
      <td className="py-2 px-3 text-xs text-zinc-500 uppercase">{m.file_type ?? '—'}</td>
      <td className="py-2 px-3 text-xs text-zinc-500">{m.char_count != null ? formatBytes(m.char_count) + ' chars' : '—'}</td>
      <td className="py-2 px-3 text-xs text-zinc-500">{new Date(created_at).toLocaleDateString()}</td>
      <td className="py-2 px-3 text-right">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

export default function AdminKnowledgePage() {
  const { showToast } = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [file, setFile]               = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCat, setUploadCat]     = useState('');
  const [uploading, setUploading]     = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const fileRef = useRef();

  // Text entry state
  const [textTitle,   setTextTitle]   = useState('');
  const [textContent, setTextContent] = useState('');
  const [textCat,     setTextCat]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  useEffect(() => {
    api.get('/admin/knowledge')
      .then(setDocs)
      .catch((e) => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  function handleFileChange(f) {
    if (!f) return;
    setFile(f);
    if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileChange(f);
  }, [uploadTitle]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', uploadTitle || file.name.replace(/\.[^.]+$/, ''));
      if (uploadCat) fd.append('category', uploadCat);
      const result = await api.upload('/admin/knowledge/upload', fd);
      showToast(`Uploaded "${result.title}" (${formatBytes(result.charCount)} chars)`, 'success');
      setFile(null);
      setUploadTitle('');
      setUploadCat('');
      // Reload list
      const fresh = await api.get('/admin/knowledge');
      setDocs(fresh);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleTextSubmit(e) {
    e.preventDefault();
    if (!textTitle.trim() || !textContent.trim()) return;
    setSubmitting(true);
    try {
      const result = await api.post('/admin/knowledge/text', {
        title:    textTitle.trim(),
        content:  textContent.trim(),
        category: textCat.trim() || undefined,
      });
      showToast(`Saved "${result.title}" (${formatBytes(result.charCount)} chars)`, 'success');
      setTextTitle('');
      setTextContent('');
      setTextCat('');
      const fresh = await api.get('/admin/knowledge');
      setDocs(fresh);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteDone(id) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    showToast('Document deleted.', 'success');
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Knowledge Base</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload documents (PDF, DOCX, TXT, MD) or paste text. Content is extracted, chunked, and embedded for RAG retrieval.
        </p>
      </div>

      {/* ── File upload ── */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Upload File</h2>
        <form onSubmit={handleUpload} className="space-y-3">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
              ${dragOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500'}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{file.name}</span>
                <span className="text-zinc-500 ml-2">({formatBytes(file.size)})</span>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">
                Drag &amp; drop or click to select — PDF, DOCX, TXT, MD (max 15 MB)
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files[0])}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Title</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Document title"
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Category (optional)</label>
              <input
                type="text"
                value={uploadCat}
                onChange={(e) => setUploadCat(e.target.value)}
                placeholder="e.g. policy, pricing"
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!file || uploading}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading…' : 'Upload & Embed'}
          </button>
        </form>
      </section>

      {/* ── Text entry ── */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Paste Text</h2>
        <form onSubmit={handleTextSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Title *</label>
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                required
                placeholder="Document title"
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Category (optional)</label>
              <input
                type="text"
                value={textCat}
                onChange={(e) => setTextCat(e.target.value)}
                placeholder="e.g. policy, pricing"
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Content *</label>
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              required
              rows={6}
              placeholder="Paste document text here…"
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
          </div>
          <button
            type="submit"
            disabled={!textTitle.trim() || !textContent.trim() || submitting}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Save & Embed'}
          </button>
        </form>
      </section>

      {/* ── Document list ── */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-4">
          Stored Documents {docs.length > 0 && <span className="text-zinc-400 font-normal">({docs.length})</span>}
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-zinc-500">No documents yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="py-2 px-3 text-xs font-medium text-zinc-500 uppercase">Title</th>
                <th className="py-2 px-3 text-xs font-medium text-zinc-500 uppercase">Type</th>
                <th className="py-2 px-3 text-xs font-medium text-zinc-500 uppercase">Size</th>
                <th className="py-2 px-3 text-xs font-medium text-zinc-500 uppercase">Added</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <DocRow key={doc.id} doc={doc} onDelete={handleDeleteDone} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
