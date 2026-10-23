// Reads the brand colours from CSS custom properties. They are written in oklch,
// which THREE.Color can't parse, so each one is drawn into a 1×1 canvas and read
// back as sRGB.
const probe = document.createElement('canvas')
probe.width = 1
probe.height = 1
const context = probe.getContext('2d', { willReadFrequently: true })

export type RGB = [number, number, number]

export function cssColor(element: Element, property: string, fallback: RGB): RGB {
  const value = getComputedStyle(element).getPropertyValue(property).trim()
  if (!context || !value) return fallback
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = '#000'
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return [red / 255, green / 255, blue / 255]
}

/** The logo gradient: deep blue (from) through azure (mid) to cyan (to). */
export interface Palette {
  dark: boolean
  from: RGB
  mid: RGB
  to: RGB
}

export function readPalette(element: Element): Palette {
  return {
    dark: document.documentElement.classList.contains('dark'),
    from: cssColor(element, '--brand-from', [0.04, 0.37, 0.69]),
    mid: cssColor(element, '--brand-mid', [0.0, 0.47, 0.71]),
    to: cssColor(element, '--brand-to', [0.0, 0.57, 0.8]),
  }
}

/** Interpolates from → mid → to for a position from 0 to 1. */
export function gradient(palette: Palette, position: number): RGB {
  const mix = (from: RGB, to: RGB, amount: number): RGB => [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
  return position < 0.5
    ? mix(palette.from, palette.mid, position * 2)
    : mix(palette.mid, palette.to, (position - 0.5) * 2)
}
