// Samples the pixels of text as a cloud of points, aligned with the DOM element that
// shows the same text, so particles can form the words the page displays.

export interface Point {
  x: number
  y: number
}

const canvas = document.createElement('canvas')
const context = canvas.getContext('2d', { willReadFrequently: true })

/**
 * Returns points (in pixels relative to `origin`) covering the glyphs of `element`'s
 * text, one per `step` pixels. Uses the element's computed font so the samples sit
 * exactly on the rendered text.
 */
export function sampleElement(element: HTMLElement, origin: DOMRect, step: number): Point[] {
  if (!context) return []
  const rect = element.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (width < 1 || height < 1) return []

  const style = getComputedStyle(element)
  canvas.width = width
  canvas.height = height
  context.clearRect(0, 0, width, height)
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'
  context.fillStyle = '#000'
  const text = element.textContent ?? ''
  const metrics = context.measureText(text)
  const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent
  // The inline box centres the font's content area in the line, so the baseline sits
  // half the leading below the top plus the ascent.
  const baseline = (height - (ascent + descent)) / 2 + ascent
  context.fillText(text, 0, baseline)

  const pixels = context.getImageData(0, 0, width, height).data
  const points: Point[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (pixels[(y * width + x) * 4 + 3] > 140) {
        points.push({ x: rect.left - origin.left + x, y: rect.top - origin.top + y })
      }
    }
  }
  return points
}

/** Returns `count` points drawn from `points`, cycling through a shuffled copy. */
export function pick(points: Point[], count: number, random: () => number): Point[] {
  if (!points.length) return []
  const shuffled = [...points]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
  }
  return Array.from({ length: count }, (_, index) => shuffled[index % shuffled.length])
}
