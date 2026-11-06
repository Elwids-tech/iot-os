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
  board.position.set(-3.0, -0.1, -0.6)
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
  starter.group.position.set(-3.0, 2.4, -0.6)
  scene.add(starter.group)

  // The alarm: a dome beacon on the floor at the front, opposite the phone and clear
  // of the board, which the automation switches on. The dome's only drawn edge is its
  // rim; the fill gives it its shape. Its pulse rings spread over the floor.
  const alarm = new Group()
  alarm.position.set(-2.6, -0.135, 1.9)
  const alarmPlate = solid(new CylinderGeometry(0.34, 0.38, 0.06, 20))
  alarmPlate.group.position.y = 0.03
  const alarmDome = solid(new SphereGeometry(0.28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0.9, 40)
  alarmDome.group.position.y = 0.06
  const alarmGlow = solid(new TorusGeometry(0.36, 0.015, 8, 40), 0)
  alarmGlow.group.rotation.x = Math.PI / 2
  alarmGlow.group.position.y = 0.06
  alarm.add(alarmPlate.group, alarmDome.group, alarmGlow.group)
  scene.add(alarm)

  // ---------- The platform: a small server rack ----------
  const platform = new Group()
  platform.position.set(0, -0.135, -0.3)
  platform.rotation.y = 0.45
  // The cabinet is glass: it never hides the units inside and is drawn over them.
  const cabinet = solid(new BoxGeometry(1.0, 1.75, 0.9), 0.3)
  cabinet.group.position.y = 0.875
  cabinet.fill.depthWrite = false
  for (const child of cabinet.group.children) child.renderOrder = 2
  platform.add(cabinet.group)
  const units = [0.25, 0.55, 0.85, 1.15, 1.45].map((y) => {
    const unit = solid(new BoxGeometry(0.88, 0.2, 0.8))
    unit.group.position.y = y
    platform.add(unit.group)
    return unit
  })
  // Two small lights on each unit's front, which blink as it works.
  const lights = units.flatMap((unit, index) =>
    [0, 1].map((slot) => {
      const light = solid(new BoxGeometry(0.06, 0.06, 0.03), 0.95)
      light.group.position.set(-0.34 + slot * 0.1, unit.group.position.y, 0.41)
      platform.add(light.group)
      return { light, phase: index * 1.7 + slot * 0.9 }
    }),
  )
  const pulseRing = solid(new TorusGeometry(1, 0.02, 8, 48), 0)
  pulseRing.group.rotation.x = Math.PI / 2
  pulseRing.group.position.y = 0.02
  platform.add(pulseRing.group)
  // The automation, once activated: a ring that turns around the rack.
  const rule = solid(new TorusGeometry(1.3, 0.022, 8, 64), 0)
  rule.group.rotation.x = Math.PI / 2
  rule.group.position.y = 0.04
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
  phone.position.set(0.3, -0.45, 1.7)
  phone.rotation.y = -0.15
  phone.visible = false
  const phoneBody = solid(new BoxGeometry(0.62, 1.24, 0.07))
  const screen = new Mesh(new PlaneGeometry(0.54, 1.12), new MeshBasicMaterial({ map: phoneTexture }))
  screen.position.z = 0.036
  phone.add(phoneBody.group, screen)
  scene.add(phone)

  // ---------- The inbox ----------
  // A quiet panel at the back, beside the dashboard, where the alert email lands.
  const mailCanvas = document.createElement('canvas')
  mailCanvas.width = 416
  mailCanvas.height = 262
  const mailContext = mailCanvas.getContext('2d')
  const mailTexture = new CanvasTexture(mailCanvas)
  const mail = new Group()
  mail.position.set(2.6, -0.3, 1.6)
  mail.rotation.y = -0.35
  mail.visible = false
  const mailPanel = new Mesh(new PlaneGeometry(1.3, 0.82), new MeshBasicMaterial({ map: mailTexture, transparent: true }))
  const mailEdge = new LineBasicMaterial({ transparent: true, opacity: 0.9 })
  mail.add(mailPanel, new LineSegments(new EdgesGeometry(mailPanel.geometry), mailEdge))
  scene.add(mail)

  // ---------- The flows ----------
  const flowSpecs = [
    { from: [-2.25, 0.0, -0.6], via: [-1.5, 1.3, -0.5], to: [-0.6, 0.6, -0.3], start: moments.connected, tone: 'brand' },
    { from: [0.55, 1.0, -0.3], via: [1.6, 1.8, -0.5], to: [1.85, 1.0, -0.55], start: moments.panelAdded, tone: 'brand' },
    // The automation's command to the alarm, then the text and the email.
    { from: [-0.4, 0.2, 0.1], via: [-1.5, 0.9, 1.2], to: [-2.6, 0.3, 1.9], start: moments.alarm, tone: 'warning' },
    { from: [0.2, 0.3, 0.2], via: [0.5, -0.3, 1.0], to: [0.3, -0.1, 1.4], start: moments.phoneIn, tone: 'warning' },
    { from: [0.5, 0.4, 0.1], via: [1.7, 0.5, 1.0], to: [2.4, 0.0, 1.5], start: moments.mailIn, tone: 'warning' },
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
    for (const part of [base, antenna, starter, phoneBody, alarmPlate, alarmDome]) {
      tint(part.fill, palette.fill)
      tint(part.edge, palette.mid)
    }
    tint(starter.edge, palette.to)
    for (const pin of pins.children) {
      const [mesh, edges] = pin.children as [Mesh<BoxGeometry, MeshBasicMaterial>, LineSegments<BufferGeometry, LineBasicMaterial>]
      tint(mesh.material, palette.fill)
      tint(edges.material, palette.mid)
    }
    tint(cabinet.fill, palette.fill)
    tint(cabinet.edge, palette.mid)
    units.forEach((unit, index) => {
      const tone = [palette.from, palette.mid, palette.to][index % 3]
      tint(unit.fill, mix(palette.fill, tone, 0.18))
      tint(unit.edge, tone)
    })
    for (const { light } of lights) tint(light.edge, palette.to)
    tint(pulseRing.edge, palette.to)
    tint(panelEdge, palette.mid)
    tint(mailEdge, palette.mid)
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
    // A messages screen; the text arrives shortly after the phone does.
    const smsAt = moments.phoneIn + 450
    if (time < smsAt) {
      context.font = `300 52px ${fonts.display}`
      context.fillStyle = css(textOn, 0.7)
      context.fillText('14:02', W / 2, 200)
    } else {
      context.fillStyle = css(textOn)
      context.font = `600 14px ${fonts.display}`
      context.fillText('Alerts', W / 2, 58)
      const slide = easeOutCubic(ramp(time, smsAt, 450))
      const y = 96 + 30 * (1 - slide)
      roundRect(context, 14, y, W - 52, 108, 18)
      context.fillStyle = css(mix(screenInk, textOn, 0.16), slide)
      context.fill()
      context.textAlign = 'left'
      context.fillStyle = css(textOn, slide)
      context.font = `600 14px ${fonts.display}`
      context.fillText('Cold room too warm:', 28, y + 30)
      context.font = `14px ${fonts.body}`
      context.fillText('8.6 °C for 5 minutes.', 28, y + 54)
      context.fillStyle = css(mutedOn, slide)
      context.font = `12px ${fonts.mono}`
      context.fillText('cold-room-1', 28, y + 82)
      context.fillText('now', 28, y + 126)
    }
    phoneTexture.needsUpdate = true
  }

  const drawMail = (time: number) => {
    const context = mailContext
    if (!context) return
    const W = mailCanvas.width
    const H = mailCanvas.height
    context.fillStyle = css(palette.surface)
    context.fillRect(0, 0, W, H)
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'
    context.fillStyle = css(palette.text)
    context.font = `600 17px ${fonts.display}`
    context.fillText('Inbox', 18, 32)
    context.strokeStyle = css(palette.muted, 0.28)
    context.lineWidth = 1
    const rows = [
      { title: 'Alert: Cold room too warm', meta: 'cold-room-1 · 8.6 °C for 5 min · now', fresh: time >= moments.mailIn + 150 },
      { title: 'cold-room-1 is online', meta: 'earlier today', fresh: false },
      { title: 'Weekly device report', meta: 'yesterday', fresh: false },
    ]
    rows.forEach((row, index) => {
      const y = 48 + index * 68
      if (row.fresh) {
        context.fillStyle = css(mix(palette.surface, palette.warning, 0.1))
        context.fillRect(0, y, W, 68)
        context.fillStyle = css(palette.warning)
        context.beginPath()
        context.arc(22, y + 30, 5, 0, Math.PI * 2)
        context.fill()
      }
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(W, y)
      context.stroke()
      context.fillStyle = css(row.fresh ? palette.text : palette.muted)
      context.font = `${row.fresh ? 600 : 500} 14px ${fonts.display}`
      context.fillText(row.title, 38, y + 28)
      context.fillStyle = css(palette.muted)
      context.font = `12px ${fonts.body}`
      context.fillText(row.meta, 38, y + 50)
    })
    mailTexture.needsUpdate = true
  }

  // ---------- Labels ----------
  const anchors: Record<string, Vector3> = {
    device: new Vector3(-3.0, 0.55, -0.6),
    platform: new Vector3(0, 1.95, -0.3),
    dashboard: new Vector3(3.0, 2.05, -0.6),
    alarm: new Vector3(-2.6, -0.5, 2.35),
    phone: new Vector3(0.3, 0.5, 1.7),
    mail: new Vector3(2.6, 0.45, 1.6),
  }
  // The text message bubble sits to the phone's left, over the floor between the alarm
  // and the phone, its tail at the phone.
  const bubble = host.querySelector<HTMLElement>('[data-bubble]')
  const bubbleAnchor = new Vector3(-0.08, -0.5, 1.7)
  const labelState = (time: number): Record<string, { state: string; shown: boolean }> => ({
    device: { state: time < moments.connected ? '' : time < moments.online ? 'active' : 'success', shown: true },
    platform: { state: time >= moments.alarm ? 'warning' : time >= moments.connected ? 'active' : '', shown: true },
    dashboard: {
      state: time >= moments.alarm ? 'warning' : time >= moments.panelAdded + 1400 ? 'success' : '',
      shown: time >= moments.panelAdded,
    },
    alarm: { state: time >= moments.alarm ? 'warning' : '', shown: true },
    phone: { state: 'warning', shown: time >= moments.phoneIn + 300 },
    mail: { state: 'warning', shown: time >= moments.mailIn + 200 },
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
    if (bubble) {
      point.copy(bubbleAnchor).project(camera)
      // Its right edge sits at the anchor, unless that would push it off the left edge.
      const x = Math.max(bubble.offsetWidth + 8, Math.min(width - 8, ((point.x + 1) / 2) * width))
      const y = ((1 - point.y) / 2) * height
      bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-100%, -50%)`
      bubble.toggleAttribute('data-shown', time >= moments.phoneIn + 700)
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
    distance = 10.2 * Math.max(1, 1.7 / camera.aspect)
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
    camera.lookAt(0.05, -0.25, 0)

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

    // The rack's lights blink as it works, and it rings out at each event.
    for (const { light, phase } of lights) {
      const on = Math.sin(time / 380 + phase) > 0.3
      tint(light.fill, on ? palette.to : palette.fill)
    }
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

    // The phone comes in with the text message, then the inbox shows the email.
    const phoneIn = easeOutCubic(ramp(time, moments.phoneIn, 600))
    phone.visible = phoneIn > 0
    phone.scale.setScalar(Math.max(0.001, phoneIn))
    phone.position.y = -0.85 + 0.4 * phoneIn
    if (phone.visible) drawPhone(time)
    const mailIn = easeOutCubic(ramp(time, moments.mailIn, 500))
    mail.visible = mailIn > 0
    mail.scale.setScalar(0.8 + 0.2 * mailIn)
    mailPanel.material.opacity = mailIn
    mailEdge.opacity = 0.9 * mailIn
    if (mail.visible) drawMail(time)

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
