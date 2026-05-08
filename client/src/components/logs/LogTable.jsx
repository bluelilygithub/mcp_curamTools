/**
 * LogTable — shared table component for both Transaction Log and Agent Event Log.
 * Matches the presentation style of the existing DecisionLogPage.
 *
 * Features:
 *   - Sortable columns
 *   - Filter bar
 *   - Pagination
 *   - Export button
 *   - Expandable rows for detail
 *   - Badge rendering for status/type columns
 *
 * Usage:
 *   <LogTable
 *     columns={[
 *       { key: 'agent_slug', label: 'Agent', type: 'text' },
 *       { key: 'status',     label: 'Status', type: 'badge', options: ['started','completed','failed','skipped'] },
 *       { key: 'created_at', label: 'Date',   type: 'date' },
 *     ]}
 *     rows={transactions}
 *     loading={loading}
 *     onExport={handleExport}
 *     renderDetail={(row) => <MyDetailComponent row={row} />}
 *   />
 */
import { useState, useMemo } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Button from '../ui/Button';

const fmtTs = (s) => {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
};

const BADGE_COLORS = {
  completed: { bg: '#dcfce7', color: '#166534' },
  complete:  { bg: '#dcfce7', color: '#166534' },
  failed:    { bg: '#fee2e2', color: '#991b1b' },
  error:     { bg: '#fee2e2', color: '#991b1b' },
  started:   { bg: '#fef3c7', color: '#92400e' },
  running:   { bg: '#fef3c7', color: '#92400e' },
  skipped:   { bg: '#e0e7ff', color: '#3730a3' },
};

function getBadgeStyle(value) {
  return BADGE_COLORS[value?.toLowerCase()] ?? { bg: 'var(--color-bg)', color: 'var(--color-muted)' };
}

function CellValue({ value, type, options }) {
  if (value == null || value === '') return <span style={{ color: 'var(--color-muted)' }}>—</span>;

  if (type === 'badge') {
    const s = getBadgeStyle(value);
    return (
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full inline-block"
        style={{ background: s.bg, color: s.color }}
      >
        {value}
      </span>
    );
  }

  if (type === 'date') {
    return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmtTs(value)}</span>;
  }

  if (type === 'number') {
    return <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{Number(value).toLocaleString('en-AU')}</span>;
  }

  if (type === 'cost') {
    return <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
      ${Number(value).toLocaleString('en-AU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
    </span>;
  }

  // Default: text
  return <span className="text-xs" style={{ color: 'var(--color-text)' }}>{String(value)}</span>;
}

export default function LogTable({ columns, rows, loading, onExport, renderDetail, emptyMessage = 'No records found.' }) {
  const getIcon = useIcon();
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Filter
  const filtered = useMemo(() => {
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) =>
      columns.some((col) => {
        const v = r[col.key];
        return v != null && String(v).toLowerCase().includes(q);
      })
    );
  }, [rows, filter, columns]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8" style={{ color: 'var(--color-muted)' }}>
        {getIcon('loader', { size: 16 })}
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search filter */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
            {getIcon('search', { size: 12 })}
          </span>
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(0); }}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: 'var(--color-border)',
            }}
          />
        </div>

        {onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('download', { size: 12 })}
            Export
          </button>
        )}

        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {sorted.length} result{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {paged.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{emptyMessage}</p>
        </div>
      ) : (
        <div
          className="rounded-xl"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {renderDetail && <th style={{ width: 32 }} />}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-xs font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none hover:opacity-70"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && (
                        <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => {
                const isExpanded = expandedRow === row.id;
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: isExpanded ? 'none' : '1px solid var(--color-border)',
                      background: isExpanded ? 'rgba(var(--color-primary-rgb), 0.03)' : undefined,
                    }}
                    className="hover:opacity-80 transition-opacity"
                  >
                    {renderDetail && (
                      <td className="px-1 py-2">
                        <button
                          onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                          className="flex items-center justify-center bg-transparent border-none cursor-pointer"
                          style={{ color: 'var(--color-muted)', width: 24, height: 24 }}
                        >
                          {getIcon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 12 })}
                        </button>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        <CellValue value={row[col.key]} type={col.type} options={col.options} />
                      </td>
                    ))}
                  </tr>
                );
                })}
              {/* Expanded detail row inside tbody */}
              {expandedRow && renderDetail && (() => {
                const row = paged.find((r) => r.id === expandedRow);
                if (!row) return null;
                return (
                  <tr key={`detail-${expandedRow}`}>
                    <td colSpan={columns.length + 1} style={{ padding: 0, borderBottom: '1px solid var(--color-border)' }}>
                      {renderDetail(row)}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1 rounded-lg text-xs border disabled:opacity-30 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Previous
          </button>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="px-3 py-1 rounded-lg text-xs border disabled:opacity-30 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
