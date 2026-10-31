/**
 * The address (slug) suggested for a name: lower case, accents folded (é becomes e),
 * every other run of characters outside a-z and 0-9 becomes one dash, and leading
 * and trailing dashes go. The server transliterates more (ß, æ, other scripts), so
 * its own slug for the same name can still differ; this is a suggestion people edit.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
