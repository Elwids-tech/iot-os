// The stage's illustration: an ESP32 board on the left, the platform's layers in the
// middle, a dashboard panel and a phone on the right, with readings flowing between
// them as particles. Everything is a function of the script's time (timeline.ts), so a
// frame can be drawn for any moment: the loop just asks for the next one, reduced
// motion asks for one. Colours come from the page's tokens, so a theme switch retints.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ColorManagement,
  CylinderGeometry,
  EdgesGeometry,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  QuadraticBezierCurve3,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { cssColor, readPalette, type Palette, type RGB } from '../hero/colors'
import { duration, moments, temperature } from './timeline'

// Colours come straight from CSS in sRGB; draw them as they are.
ColorManagement.enabled = false

const VERTEX = /* glsl */ `
  attribute vec3 tint;
  attribute float size;
  attribute float alpha;
  uniform float pixelRatio;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vTint = tint;
    vAlpha = alpha;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (9.0 / -view.z);
    gl_Position = projectionMatrix * view;
  }
`
const FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float distance = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.1, distance) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vTint, alpha);
  }
`

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const ramp = (time: number, start: number, length: number) => clamp01((time - start) / length)
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const mix = (from: RGB, to: RGB, amount: number): RGB => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
]
const css = ([red, green, blue]: RGB, alpha = 1) =>
  `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`

interface StagePalette extends Palette {
  surface: RGB
  ink: RGB
  text: RGB
  muted: RGB
  success: RGB
  warning: RGB
  fill: RGB
}

function readStagePalette(element: Element): StagePalette {
  const palette = readPalette(element)
  const surface = cssColor(element, '--brand-surface', palette.dark ? [0.1, 0.12, 0.18] : [1, 1, 1])
  return {
    ...palette,
    surface,
    ink: cssColor(element, '--brand-ink', palette.dark ? [0.07, 0.09, 0.14] : [0.98, 0.98, 0.99]),
    text: cssColor(element, '--foreground', palette.dark ? [0.93, 0.94, 0.96] : [0.1, 0.12, 0.16]),
    muted: cssColor(element, '--muted-foreground', [0.55, 0.58, 0.64]),
    success: cssColor(element, '--success', [0.17, 0.75, 0.42]),
    warning: cssColor(element, '--warning', [0.98, 0.69, 0.13]),
    // Solid fills: the surface, tinted towards the brand.
    fill: mix(surface, palette.from, palette.dark ? 0.32 : 0.12),
  }
}

/** A repeatable random sequence, so the still frame is the same on every load. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

interface Solid {
  group: Group
  fill: MeshBasicMaterial
  edge: LineBasicMaterial
}

/** A mesh with a translucent fill and drawn edges, the stage's house style. */
function solid(
  geometry: BoxGeometry | CylinderGeometry | PlaneGeometry | SphereGeometry | TorusGeometry,
  opacity = 0.92,
  edgeAngle = 12,
): Solid {
  const fill = new MeshBasicMaterial({
    transparent: true,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const edge = new LineBasicMaterial({ transparent: true, opacity: 0.9 })
  const group = new Group()
  group.add(new Mesh(geometry, fill))
  group.add(new LineSegments(new EdgesGeometry(geometry, edgeAngle), edge))
  return { group, fill, edge }
}

interface Flow {
  curve: QuadraticBezierCurve3
  start: number
  line: Line
  material: LineBasicMaterial
  phases: number[]
  tone: 'brand' | 'warning'
}

export interface StageScene {
  render(time: number): void
  resize(): void
  retint(): void
  dispose(): void
}

export function createStageScene(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  labels: Record<string, HTMLElement | undefined>,
): StageScene | null {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.outputColorSpace = LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 60)
  let palette = readStagePalette(host)
  let width = 1
  let height = 1
  const fonts = {
    display: getComputedStyle(host).getPropertyValue('--font-display').trim() || 'sans-serif',
    body: getComputedStyle(document.body).fontFamily || 'sans-serif',
    mono: getComputedStyle(host).getPropertyValue('--font-mono').trim() || 'monospace',
  }

  // ---------- The floor ----------
  const grid = new GridHelper(16, 32)
  grid.position.y = -1.4
  const gridMaterial = grid.material as LineBasicMaterial
  gridMaterial.transparent = true
  gridMaterial.vertexColors = false
  scene.add(grid)

  // ---------- The board ----------
  const board = new Group()
  board.position.set(-3.1, -0.1, 0.5)
  const base = solid(new BoxGeometry(1.5, 0.07, 1.0))
  const chip = solid(new BoxGeometry(0.42, 0.1, 0.42))
  chip.group.position.y = 0.085
  const antenna = solid(new BoxGeometry(0.3, 0.06, 0.2))
  antenna.group.position.set(0.58, 0.065, -0.36)
  const pins = new Group()
  for (let index = 0; index < 8; index += 1) {
    const pin = solid(new BoxGeometry(0.06, 0.05, 0.06), 0.9)
    pin.group.position.set(-0.6 + index * 0.17, 0.06, 0.42)
    pins.add(pin.group)
  }
  board.add(base.group, chip.group, antenna.group, pins)
  scene.add(board)

  // The firmware starter: a small package that lands on the board and is flashed in.
  const starter = solid(new BoxGeometry(0.3, 0.3, 0.3), 0.8)
  starter.group.position.set(-3.1, 2.4, 0.5)
  scene.add(starter.group)

  // The alarm: a dome beacon on the cold room's back wall, away from the board, which
  // the automation switches on. The dome's only drawn edge is its rim; the fill gives
  // it its shape.
  const alarm = new Group()
  alarm.position.set(-1.7, 0.315, -1.2)
  alarm.rotation.y = 0.2
  const alarmWall = solid(new BoxGeometry(0.8, 0.9, 0.06))
  const alarmPlate = solid(new CylinderGeometry(0.24, 0.24, 0.05, 16))
  alarmPlate.group.rotation.x = Math.PI / 2
  alarmPlate.group.position.set(0, 0.1, 0.055)
  const alarmDome = solid(new SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0.9, 40)
  alarmDome.group.rotation.x = Math.PI / 2
  alarmDome.group.position.set(0, 0.1, 0.08)
  const alarmGlow = solid(new TorusGeometry(0.26, 0.015, 8, 40), 0)
  alarmGlow.group.position.set(0, 0.1, 0.1)
  alarm.add(alarmWall.group, alarmPlate.group, alarmDome.group, alarmGlow.group)
  scene.add(alarm)

  // ---------- The platform ----------
  const platform = new Group()
  platform.position.set(0, 0.1, 0)
  const layers = [-0.3, 0.05, 0.4].map((y, index) => {
    const layer = solid(new CylinderGeometry(0.95 - index * 0.08, 0.95 - index * 0.08, 0.16, 6))
    layer.group.position.y = y
    layer.group.rotation.y = Math.PI / 6
    platform.add(layer.group)
    return layer
  })
  const pulseRing = solid(new TorusGeometry(1, 0.02, 8, 48), 0)
  pulseRing.group.rotation.x = Math.PI / 2
  pulseRing.group.position.y = -0.3
  platform.add(pulseRing.group)
  // The automation, once activated: a ring that turns around the platform.
  const rule = solid(new TorusGeometry(1.3, 0.022, 8, 64), 0)
  rule.group.rotation.x = Math.PI / 2
  rule.group.position.y = 0.05
  platform.add(rule.group)
  scene.add(platform)

  // ---------- The dashboard ----------
  const chartCanvas = document.createElement('canvas')
  chartCanvas.width = 512
  chartCanvas.height = 320
  const chartContext = chartCanvas.getContext('2d')
  const chartTexture = new CanvasTexture(chartCanvas)
  const dashboard = new Group()
  dashboard.position.set(3.0, 1.0, -0.6)
  dashboard.rotation.y = -0.28
  const panel = new Mesh(new PlaneGeometry(2.6, 1.62), new MeshBasicMaterial({ map: chartTexture, transparent: true }))
  const panelEdge = new LineBasicMaterial({ transparent: true, opacity: 0.9 })
  dashboard.add(panel, new LineSegments(new EdgesGeometry(panel.geometry), panelEdge))
  scene.add(dashboard)

  // ---------- The phone ----------
  const phoneCanvas = document.createElement('canvas')
  phoneCanvas.width = 220
  phoneCanvas.height = 440
  const phoneContext = phoneCanvas.getContext('2d')
  const phoneTexture = new CanvasTexture(phoneCanvas)
  const phone = new Group()
  phone.position.set(2.9, -0.7, 1.3)
  phone.rotation.y = -0.4
  phone.visible = false
  const phoneBody = solid(new BoxGeometry(0.62, 1.24, 0.07))
  const screen = new Mesh(new PlaneGeometry(0.54, 1.12), new MeshBasicMaterial({ map: phoneTexture }))
  screen.position.z = 0.036
  phone.add(phoneBody.group, screen)
  scene.add(phone)

  // ---------- The flows ----------
  const flowSpecs = [
    { from: [-2.35, 0.0, 0.5], via: [-1.6, 1.25, 0.3], to: [-0.85, 0.35, 0.15], start: moments.connected, tone: 'brand' },
    { from: [0.85, 0.35, -0.15], via: [1.5, 1.5, -0.4], to: [1.85, 1.0, -0.55], start: moments.panelAdded, tone: 'brand' },
    // The automation's command to the alarm, then the email.
    { from: [-0.6, 0.0, -0.5], via: [-1.1, 1.1, -0.9], to: [-1.65, 0.45, -1.0], start: moments.alarm, tone: 'warning' },
    { from: [0.6, -0.15, 0.55], via: [1.7, -1.0, 1.1], to: [2.6, -0.65, 1.25], start: moments.phoneIn, tone: 'warning' },
  ] as const
  const PER_FLOW = 26
  const random = seeded(7)
  const flows: Flow[] = flowSpecs.map((spec) => {
    const curve = new QuadraticBezierCurve3(new Vector3(...spec.from), new Vector3(...spec.via), new Vector3(...spec.to))
    const material = new LineBasicMaterial({ transparent: true, opacity: 0 })
    const line = new Line(new BufferGeometry().setFromPoints(curve.getPoints(40)), material)
    scene.add(line)
    return { curve, start: spec.start, line, material, phases: Array.from({ length: PER_FLOW }, random), tone: spec.tone }
  })
  const particleCount = flows.length * PER_FLOW
  const particleGeometry = new BufferGeometry()
  const particlePositions = new Float32Array(particleCount * 3)
  const particleTints = new Float32Array(particleCount * 3)
  const particleSizes = new Float32Array(particleCount)
  const particleAlphas = new Float32Array(particleCount)
  particleGeometry.setAttribute('position', new BufferAttribute(particlePositions, 3))
  particleGeometry.setAttribute('tint', new BufferAttribute(particleTints, 3))
  particleGeometry.setAttribute('size', new BufferAttribute(particleSizes, 1))
  particleGeometry.setAttribute('alpha', new BufferAttribute(particleAlphas, 1))
  const particleMaterial = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { pixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
  })
  const particles = new Points(particleGeometry, particleMaterial)
  particles.frustumCulled = false
  scene.add(particles)
  const point = new Vector3()

  // ---------- Colours ----------
  const tint = (material: MeshBasicMaterial | LineBasicMaterial, rgb: RGB) => material.color.setRGB(...rgb)
  const retint = () => {
    palette = readStagePalette(host)
    particleMaterial.blending = palette.dark ? AdditiveBlending : NormalBlending
    particleMaterial.needsUpdate = true
    tint(gridMaterial, palette.mid)
    gridMaterial.opacity = palette.dark ? 0.16 : 0.14
    for (const part of [base, antenna, starter, phoneBody, alarmWall, alarmPlate, alarmDome]) {
      tint(part.fill, palette.fill)
      tint(part.edge, palette.mid)
    }
    tint(starter.edge, palette.to)
    for (const pin of pins.children) {
      const [mesh, edges] = pin.children as [Mesh<BoxGeometry, MeshBasicMaterial>, LineSegments<BufferGeometry, LineBasicMaterial>]
      tint(mesh.material, palette.fill)
      tint(edges.material, palette.mid)
    }
    layers.forEach((layer, index) => {
      tint(layer.fill, mix(palette.fill, [palette.from, palette.mid, palette.to][index], 0.18))
      tint(layer.edge, [palette.from, palette.mid, palette.to][index])
    })
    tint(pulseRing.edge, palette.to)
    tint(panelEdge, palette.mid)
    for (const flow of flows) tint(flow.material, flow.tone === 'warning' ? palette.warning : palette.mid)
    flows.forEach((flow, flowIndex) => {
      const colour = flow.tone === 'warning' ? palette.warning : flowIndex === 0 ? palette.to : palette.mid
      for (let index = 0; index < PER_FLOW; index += 1) {
        particleTints.set(colour, (flowIndex * PER_FLOW + index) * 3)
        particleSizes[flowIndex * PER_FLOW + index] = 2.6 + flow.phases[index] * 2.2
      }
    })
    particleGeometry.attributes.tint.needsUpdate = true
    particleGeometry.attributes.size.needsUpdate = true
  }
  retint()

  // ---------- The chart and the phone screen ----------
  const roundRect = (context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath()
    context.moveTo(x + r, y)
    context.arcTo(x + w, y, x + w, y + h, r)
    context.arcTo(x + w, y + h, x, y + h, r)
    context.arcTo(x, y + h, x, y, r)
    context.arcTo(x, y, x + w, y, r)
    context.closePath()
  }

  const drawChart = (time: number) => {
    const context = chartContext
    if (!context) return
    const W = chartCanvas.width
    const H = chartCanvas.height
    context.fillStyle = css(palette.surface)
    context.fillRect(0, 0, W, H)
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'
    context.fillStyle = css(palette.text)
    context.font = `600 21px ${fonts.display}`
    context.fillText('Temperature', 24, 40)
    context.fillStyle = css(palette.muted)
    context.font = `15px ${fonts.mono}`
    context.fillText('cold-room-1', 24, 62)

    const x0 = 58
    const y0 = 88
    const x1 = W - 26
    const y1 = H - 34
    const yOf = (value: number) => y1 - (value / 12) * (y1 - y0)
    const xOf = (moment: number) => x0 + ((moment - moments.panelAdded) / (duration - moments.panelAdded)) * (x1 - x0)

    context.strokeStyle = css(palette.muted, 0.28)
    context.lineWidth = 1
    context.font = `12px ${fonts.mono}`
    context.fillStyle = css(palette.muted)
    context.textAlign = 'right'
    for (const value of [0, 4, 8, 12]) {
      context.beginPath()
      context.moveTo(x0, yOf(value))
      context.lineTo(x1, yOf(value))
      context.stroke()
      context.fillText(`${value}`, x0 - 10, yOf(value) + 4)
    }
    context.textAlign = 'left'
    context.fillText('°C', 24, y0 - 12)

    if (time < moments.panelAdded + 300) {
      chartTexture.needsUpdate = true
      return
    }

    // The band above the threshold, once the room is too warm.
    const bandStart = moments.rise + 1700
    if (time > bandStart) {
      context.fillStyle = css(palette.warning, 0.12)
      context.fillRect(xOf(bandStart), y0, xOf(time) - xOf(bandStart), yOf(8) - y0)
    }

    // The series, segment by segment so the part above 8 °C turns warning.
    context.lineWidth = 2.5
    context.lineJoin = 'round'
    context.lineCap = 'round'
    let previous: [number, number] | null = null
    for (let moment = moments.panelAdded + 300; moment <= time; moment += 150) {
      const value = temperature(moment)
      const current: [number, number] = [xOf(moment), yOf(value)]
      if (previous) {
        context.strokeStyle = css(value > 8 ? palette.warning : palette.to)
        context.beginPath()
        context.moveTo(previous[0], previous[1])
        context.lineTo(current[0], current[1])
        context.stroke()
      }
      previous = current
    }
    const value = temperature(time)
    const end: [number, number] = [xOf(time), yOf(value)]
    const warm = value > 8

    // The threshold line, once the automation is active.
    if (time >= moments.activated) {
      const alpha = ramp(time, moments.activated, 400)
      context.save()
      context.setLineDash([6, 5])
      context.strokeStyle = css(palette.warning, 0.9 * alpha)
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(x0, yOf(8))
      context.lineTo(x1, yOf(8))
      context.stroke()
      context.restore()
      context.fillStyle = css(palette.warning, alpha)
      context.font = `600 12px ${fonts.mono}`
      context.textAlign = 'right'
      context.fillText('above 8 °C for 5 min', x1, yOf(8) - 7)
      context.textAlign = 'left'
    }

    // The current reading: a pulsing dot (fresh) and the value in the corner.
    context.fillStyle = css(warm ? palette.warning : palette.to, 0.25)
    context.beginPath()
    context.arc(end[0], end[1], 7 + 3 * Math.sin(time / 180), 0, Math.PI * 2)
    context.fill()
    context.fillStyle = css(warm ? palette.warning : palette.to)
    context.beginPath()
    context.arc(end[0], end[1], 4, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = css(warm ? palette.warning : palette.text)
    context.font = `600 24px ${fonts.display}`
    context.textAlign = 'right'
    context.fillText(`${value.toFixed(1)} °C`, W - 24, 44)
    context.fillStyle = css(warm ? palette.warning : palette.success)
    context.font = `12px ${fonts.mono}`
    context.fillText(warm ? 'too warm' : 'fresh', W - 24, 64)
    context.textAlign = 'left'
    chartTexture.needsUpdate = true
  }

  const drawPhone = (time: number) => {
    const context = phoneContext
    if (!context) return
    const W = phoneCanvas.width
    const H = phoneCanvas.height
    // A phone screen is dark in both themes, so it keeps its own colours.
    const screenInk: RGB = [0.07, 0.09, 0.15]
    const textOn: RGB = [0.94, 0.95, 0.97]
    const mutedOn = mix(textOn, screenInk, 0.4)
    context.fillStyle = css(screenInk)
    context.fillRect(0, 0, W, H)
    context.textBaseline = 'alphabetic'
    context.fillStyle = css(mutedOn)
    context.font = `12px ${fonts.mono}`
    context.textAlign = 'center'
    context.fillText('14:02', W / 2, 26)
    context.font = `300 52px ${fonts.display}`
    const mailAt = moments.phoneIn + 350
    context.fillStyle = css(textOn, time >= mailAt ? 0.25 : 0.7)
    context.fillText('14:02', W / 2, 200)
    if (time >= mailAt) {
      const slide = easeOutCubic(ramp(time, mailAt, 500))
      const y = -130 + 182 * slide
      roundRect(context, 12, y, W - 24, 112, 16)
      context.fillStyle = css(mix(screenInk, textOn, 0.14))
      context.fill()
      context.fillStyle = css(palette.warning)
      context.beginPath()
      context.arc(32, y + 26, 6, 0, Math.PI * 2)
      context.fill()
      context.textAlign = 'left'
      context.fillStyle = css(mutedOn)
      context.font = `11px ${fonts.mono}`
      context.fillText('Alert · now', 46, y + 30)
      context.fillStyle = css(textOn)
      context.font = `600 16px ${fonts.display}`
      context.fillText('Cold room too warm', 24, y + 60)
      context.fillStyle = css(mutedOn)
      context.font = `13px ${fonts.body}`
      context.fillText('cold-room-1 · 8.6 °C for 5 min', 24, y + 84)
    }
    phoneTexture.needsUpdate = true
  }

  // ---------- Labels ----------
  const anchors: Record<string, Vector3> = {
    device: new Vector3(-3.1, 0.6, 0.5),
    platform: new Vector3(0, 1.1, 0),
    dashboard: new Vector3(3.0, 2.05, -0.6),
    alarm: new Vector3(-1.7, 1.1, -1.2),
    phone: new Vector3(2.9, -1.4, 1.3),
  }
  const labelState = (time: number): Record<string, { state: string; shown: boolean }> => ({
    device: { state: time < moments.connected ? '' : time < moments.online ? 'active' : 'success', shown: true },
    platform: { state: time >= moments.alarm ? 'warning' : time >= moments.connected ? 'active' : '', shown: true },
    dashboard: {
      state: time >= moments.alarm ? 'warning' : time >= moments.panelAdded + 1400 ? 'success' : '',
      shown: time >= moments.panelAdded,
    },
    alarm: { state: time >= moments.alarm ? 'warning' : '', shown: true },
    phone: { state: 'warning', shown: time >= moments.phoneIn + 300 },
  })
  const placeLabels = (time: number) => {
    const states = labelState(time)
    for (const [name, label] of Object.entries(labels)) {
      const anchor = anchors[name]
      if (!label || !anchor) continue
      point.copy(anchor).project(camera)
      // Kept inside the picture, so a label near an edge is never cut off on a phone.
      const half = label.offsetWidth / 2 + 6
      const x = Math.min(width - half, Math.max(half, ((point.x + 1) / 2) * width))
      const y = ((1 - point.y) / 2) * height
      label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`
      const { state, shown } = states[name]
      if (label.dataset.state !== state) label.dataset.state = state
      label.style.opacity = shown ? '1' : '0'
    }
  }

  // ---------- Camera ----------
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  host.addEventListener(
    'pointermove',
    (event) => {
      const rect = host.getBoundingClientRect()
      pointer.targetX = (event.clientX - rect.left) / rect.width - 0.5
      pointer.targetY = (event.clientY - rect.top) / rect.height - 0.5
    },
    { passive: true },
  )
  host.addEventListener('pointerleave', () => {
    pointer.targetX = 0
    pointer.targetY = 0
  })
  let distance = 9.8
  const resize = () => {
    const rect = host.getBoundingClientRect()
    width = Math.max(1, rect.width)
    height = Math.max(1, rect.height)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    particleMaterial.uniforms.pixelRatio.value = pixelRatio
    camera.aspect = width / height
    // A narrower frame backs the camera off so the whole bench stays in view.
    distance = 9.4 * Math.max(1, 1.7 / camera.aspect)
    camera.updateProjectionMatrix()
  }

  // ---------- A frame ----------
  const pulses = [moments.connected, moments.online, moments.activated, moments.alarm]
  const render = (time: number) => {
    pointer.x += (pointer.targetX - pointer.x) * 0.08
    pointer.y += (pointer.targetY - pointer.y) * 0.08
    camera.position.set(
      0.3 * Math.sin(time / 6000) + pointer.x * 0.9,
      2.7 + 0.15 * Math.cos(time / 5000) - pointer.y * 0.5,
      distance,
    )
    // Aimed a little below the bench, so the picture sits high and leaves the ribbon room.
    camera.lookAt(0.05, -0.4, 0)

    // Fade the whole picture out and in around the loop.
    const fade = Math.min(ramp(time, 0, 400), ramp(duration - time, 0, 500))
    canvas.style.opacity = fade.toFixed(3)

    // The starter drops onto the board and is flashed into the chip.
    const drop = easeOutCubic(ramp(time, moments.starterDrop, moments.flashStart - moments.starterDrop))
    const flashing = ramp(time, moments.flashStart, moments.flashEnd - moments.flashStart)
    starter.group.visible = time >= moments.starterDrop && time < moments.flashEnd
    starter.group.position.y = 2.4 - 2.03 * drop
    starter.group.rotation.y = time / 900
    starter.group.scale.setScalar(Math.max(0.001, 1 - flashing))
    const glow = time < moments.flashStart ? 0 : time < moments.flashEnd ? 0.5 + 0.5 * Math.sin(time / 28) : 1
    tint(chip.fill, mix(palette.fill, palette.to, glow * 0.8))
    tint(chip.edge, mix(palette.mid, palette.to, glow))
    chip.fill.opacity = 0.92

    // The platform breathes, and rings out at each event.
    platform.rotation.y = time / 14000
    layers.forEach((layer, index) => {
      layer.group.position.y = [-0.3, 0.05, 0.4][index] + 0.02 * Math.sin(time / 1100 + index)
    })
    const pulseAt = pulses.filter((moment) => time >= moment && time < moment + 900).at(-1)
    if (pulseAt !== undefined) {
      const progress = ramp(time, pulseAt, 900)
      pulseRing.group.visible = true
      pulseRing.group.scale.setScalar(1 + 1.4 * easeOutCubic(progress))
      pulseRing.edge.opacity = (1 - progress) * 0.9
      tint(pulseRing.edge, pulseAt === moments.alarm ? palette.warning : palette.to)
    } else {
      pulseRing.group.visible = false
    }
    const ruleIn = ramp(time, moments.activated, 500)
    rule.group.visible = ruleIn > 0
    rule.group.rotation.z = time / 2600
    rule.edge.opacity = 0.9 * ruleIn
    rule.group.scale.setScalar(0.7 + 0.3 * easeOutCubic(ruleIn))
    tint(rule.edge, time >= moments.alarm ? palette.warning : palette.to)

    // The dashboard panel appears when its panel is added.
    const panelIn = easeOutCubic(ramp(time, moments.panelAdded, 500))
    dashboard.visible = panelIn > 0
    dashboard.scale.setScalar(0.7 + 0.3 * panelIn)
    panel.material.opacity = panelIn
    panelEdge.opacity = 0.9 * panelIn
    if (dashboard.visible) drawChart(time)

    // The alarm: off until the automation switches it on, then flashing, with rings.
    const on = time >= moments.alarm
    const flash = on ? 0.7 + 0.3 * Math.sin(time / 85) : 0
    tint(alarmDome.fill, on ? mix(palette.warning, [1, 1, 1], 0.25 * (1 - flash)) : palette.fill)
    alarmDome.fill.opacity = on ? 0.97 : 0.9
    tint(alarmDome.edge, on ? palette.warning : palette.mid)
    alarmGlow.group.visible = on
    if (on) {
      const ring = ((time - moments.alarm) % 900) / 900
      alarmGlow.group.scale.setScalar(1 + 3 * ring)
      alarmGlow.edge.opacity = (1 - ring) * 0.9
      tint(alarmGlow.edge, palette.warning)
    }

    // The phone comes in with the email.
    const phoneIn = easeOutCubic(ramp(time, moments.phoneIn, 600))
    phone.visible = phoneIn > 0
    phone.scale.setScalar(Math.max(0.001, phoneIn))
    phone.position.y = -1.1 + 0.6 * phoneIn
    if (phone.visible) drawPhone(time)

    // Readings flow along each link once it is live.
    flows.forEach((flow, flowIndex) => {
      const live = ramp(time, flow.start, 500)
      flow.material.opacity = (palette.dark ? 0.35 : 0.3) * live
      for (let index = 0; index < PER_FLOW; index += 1) {
        const slot = flowIndex * PER_FLOW + index
        const progress = live > 0 ? ((time - flow.start) / 1500 + flow.phases[index]) % 1 : 0
        flow.curve.getPoint(progress, point)
        particlePositions.set([point.x, point.y, point.z], slot * 3)
        particleAlphas[slot] = live * (0.25 + 0.75 * Math.sin(progress * Math.PI))
      }
    })
    particleGeometry.attributes.position.needsUpdate = true
    particleGeometry.attributes.alpha.needsUpdate = true

    renderer.render(scene, camera)
    placeLabels(time)
  }

  return {
    render,
    resize,
    retint,
    dispose() {
      renderer.dispose()
      chartTexture.dispose()
      phoneTexture.dispose()
    },
  }
}
