/**
 * The address (slug) suggested for a name: lower case, every run of characters
 * other than a-z and 0-9 becomes one dash, and leading and trailing dashes go.
 * Accented letters drop out rather than fold, so the server's own slug for the
 * same name may differ; it is only a suggestion people can edit.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
