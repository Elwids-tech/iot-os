/** Saves bytes as a file through a temporary link. */
export function downloadFile(name: string, bytes: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Saves an archive the API returned as base64 (firmware starters, settings and kits).
 * Keep the response in component state only: settings and kits hold credentials.
 */
export function saveArchive(archive: { filename: string; archive_base64: string }) {
  const binary = atob(archive.archive_base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  downloadFile(archive.filename, bytes, "application/zip")
}
