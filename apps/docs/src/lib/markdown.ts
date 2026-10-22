// Renders the small Markdown subset the contract's descriptions use (paragraphs,
// bold and inline code) to HTML, escaping everything else.
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Escapes text and lets long snake_case names break after underscores on phones (<wbr> isn't copied). */
export function breakable(text: string): string {
  return escape(text).replaceAll('_', '_<wbr>')
}

export function inlineMarkdown(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, (_, code: string) => `<code>${code.replaceAll('_', '_<wbr>')}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function markdown(text: string | undefined): string {
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${inlineMarkdown(paragraph.trim())}</p>`)
    .join('')
}
