/**
 * stripForSpeech — clean markdown/code text before passing to speechSynthesis.
 *
 * Removes: headings (#), bold/italic (*/_), code fences, inline code,
 * URLs, HTML tags, bullet/numbered list markers, horizontal rules,
 * and collapses excess whitespace.
 */
export function stripForSpeech(text) {
  if (!text) return '';

  return text
    .replace(/```[\s\S]*?```/g, 'code block.')          // fenced code blocks → spoken label
    .replace(/`[^`]+`/g, '')                             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')                     // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')             // links → keep label
    .replace(/https?:\/\/\S+/g, '')                      // bare URLs
    .replace(/^#{1,6}\s+/gm, '')                         // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')                     // bold
    .replace(/__(.+?)__/g, '$1')                         // bold (underscore)
    .replace(/\*(.+?)\*/g, '$1')                         // italic
    .replace(/_(.+?)_/g, '$1')                           // italic (underscore)
    .replace(/^[-*+]\s+/gm, '')                          // unordered list markers
    .replace(/^\d+\.\s+/gm, '')                          // ordered list markers
    .replace(/^[-_*]{3,}$/gm, '')                        // horizontal rules
    .replace(/<[^>]+>/g, '')                             // HTML tags
    .replace(/\|[^\n]+\|/g, '')                          // table rows
    .replace(/\n{3,}/g, '\n\n')                          // collapse excess newlines
    .trim();
}
