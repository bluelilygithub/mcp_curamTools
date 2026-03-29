/**
 * MarkdownRenderer — custom zero-dependency markdown renderer.
 * Platform primitive for all LLM text output.
 * Do not use <pre> or whitespace-pre-wrap for agent or chat output.
 *
 * Supported: #/##/### headings, **bold**, *italic*, bullet lists,
 * ordered lists, --- horizontal rules, paragraphs, markdown tables,
 * fenced code blocks (``` ... ```).
 *
 * Infinite loop guard: paragraph branch always increments i.
 */

function parseTableRow(row) {
  return row.split('|').slice(1, -1).map((c) => c.trim());
}

function isTableSeparator(row) {
  return parseTableRow(row).every((c) => /^[\s:-]+$/.test(c));
}

function parseInline(text) {
  // Bold: **text**
  // Italic: *text*
  const parts = [];
  let remaining = text;
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(remaining)) !== null) {
    if (m.index > last) parts.push(remaining.slice(last, m.index));
    if (m[0].startsWith('**')) {
      parts.push(<strong key={m.index}>{m[2]}</strong>);
    } else {
      parts.push(<em key={m.index}>{m[3]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < remaining.length) parts.push(remaining.slice(last));
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

function renderLines(lines) {
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      elements.push(
        <pre
          key={`code-${i}`}
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '12px 16px',
            overflowX: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--color-text)',
            margin: '12px 0',
          }}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />
      );
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 6px', color: 'var(--color-text)' }}>
          {parseInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} style={{ fontSize: 17, fontWeight: 600, margin: '20px 0 8px', color: 'var(--color-text)' }}>
          {parseInline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} style={{ fontSize: 20, fontWeight: 700, margin: '24px 0 10px', color: 'var(--color-text)' }}>
          {parseInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // Bullet list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i}>{parseInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: 20, margin: '8px 0', listStyleType: 'disc', color: 'var(--color-text)' }}>
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\d+\.\s/, '');
        items.push(<li key={i}>{parseInline(text)}</li>);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: '8px 0', listStyleType: 'decimal', color: 'var(--color-text)' }}>
          {items}
        </ol>
      );
      continue;
    }

    // Table — consecutive | prefixed lines
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // First line is header; find separator
      const sepIdx = tableLines.findIndex(isTableSeparator);
      const headers = sepIdx > 0 ? parseTableRow(tableLines[0]) : parseTableRow(tableLines[0]);
      const bodyLines = sepIdx >= 0 ? tableLines.slice(sepIdx + 1) : tableLines.slice(1);

      elements.push(
        <div key={`tbl-${i}`} style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    style={{
                      padding: '6px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid var(--color-border)',
                      color: 'var(--color-muted)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyLines.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {parseTableRow(row).map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ padding: '8px 12px', color: 'var(--color-text)' }}
                    >
                      {parseInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Empty line — paragraph break
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — infinite loop guard: always increment i
    elements.push(
      <p key={`p-${i}`} style={{ margin: '6px 0', color: 'var(--color-text)', lineHeight: 1.6 }}>
        {parseInline(line)}
      </p>
    );
    i++;
  }

  return elements;
}

export default function MarkdownRenderer({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return <div style={{ fontSize: 14 }}>{renderLines(lines)}</div>;
}
