// The landing hero: data particles converge into the company name, each letter then
// pours out into its word of the tagline (E → Empowering, L → Life, …), and the
// particles settle into a slowly drifting constellation of connected nodes.
//
// The DOM text is always the real content (selectable, read by screen readers, the
// page's largest paint); the canvas only decorates it. Reduced motion, no WebGL or a
// failure here leave the static text, and the inline script in Hero.astro reveals it
// after three seconds if this module never starts.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ColorManagement,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineSegments,
  NormalBlending,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'
import { gradient, readPalette, type Palette, type RGB } from './colors'
import { pick, sampleElement, type Point } from './sample'

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
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float distance = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.08, distance) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vTint, alpha);
  }
`

// Timeline, in milliseconds from the start of the intro.
const CONVERGE = 1300
const HOLD = 450
const POUR = 1250
const STAGGER = 120
const SETTLE = 900

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

interface Particle {
  start: Point
  letter: Point
  word: Point
  bend: Point
  delay: number
  pourDelay: number
  group: number
  position: number
}

interface Node {
  x: number
  y: number
  amplitude: number
  speed: number
  phase: number
  depth: number
  hue: number
}

function pointsMaterial(dark: boolean) {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { pixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: dark ? AdditiveBlending : NormalBlending,
  })
}

export async function playHero(hero: HTMLElement): Promise<void> {
  const canvas = hero.querySelector<HTMLCanvasElement>('[data-hero-canvas]')
  const wordmark = hero.querySelector<HTMLElement>('[data-wordmark]')
  const slogan = hero.querySelector<HTMLElement>('[data-slogan]')
  const letters = [...hero.querySelectorAll<HTMLElement>('[data-letter]')]
  const words = [...hero.querySelectorAll<HTMLElement>('[data-word]')]
  const finish = () => {
    hero.dataset.animate = 'done'
    for (const word of words) word.dataset.revealed = ''
  }
  if (!canvas || !wordmark) return finish()

  const intro = hero.dataset.animate === 'pending'
  if (intro) hero.dataset.animate = 'playing'
  await document.fonts.ready

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return finish()
  }
  renderer.outputColorSpace = LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new OrthographicCamera(0, 1, 0, -1, -10, 10)
  let palette: Palette = readPalette(hero)
  let width = 0
  let height = 0
  let pixelRatio = 1

  const measure = () => {
    const rect = hero.getBoundingClientRect()
    width = rect.width
    height = rect.height
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    camera.right = width
    camera.bottom = -height
    camera.updateProjectionMatrix()
  }
  measure()

  // ---------- Intro: the name forms, then pours into the tagline ----------
  const random = Math.random
  const acronym = hero.dataset.acronym === 'true' && letters.length > 0 && letters.length === words.length
  const origin = hero.getBoundingClientRect()
  const markSize = parseFloat(getComputedStyle(wordmark).fontSize) || 120
  const sloganSize = slogan ? parseFloat(getComputedStyle(slogan).fontSize) || 24 : 24
  const markStep = Math.max(2, Math.round(markSize / 38))
  const wordStep = Math.max(1, Math.round(sloganSize / 13))
  const groups = acronym
    ? letters.map((letter, index) => ({ from: [letter], to: [words[index]], position: index / Math.max(1, letters.length - 1) }))
    : [{ from: letters.length ? letters : [wordmark], to: words.length ? words : slogan ? [slogan] : [], position: 0.5 }]
  const fromPoints = groups.map((group) => group.from.flatMap((element) => sampleElement(element, origin, markStep)))
  const toPoints = groups.map((group) => group.to.flatMap((element) => sampleElement(element, origin, wordStep)))

  const budget = width < 640 ? 1300 : 2400
  const totalTo = toPoints.reduce((sum, points) => sum + points.length, 0) || 1
  const particles: Particle[] = []
  let lastPour = 0
  groups.forEach((group, index) => {
    if (!fromPoints[index].length) return
    const targets = toPoints[index].length ? toPoints[index] : fromPoints[index]
    const count = Math.round((budget / groups.length) * 0.45 + budget * 0.55 * (targets.length / totalTo))
    const sources = pick(fromPoints[index], count, random)
    const destinations = pick(targets, count, random)
    for (let item = 0; item < count; item += 1) {
      const letter = sources[item]
      const word = destinations[item]
      const pourDelay = index * STAGGER + random() * 180
      lastPour = Math.max(lastPour, pourDelay)
      particles.push({
        start: { x: random() * width, y: random() * height },
        letter,
        word,
        // A control point at the word's height, just under the letter, so particles
        // drop out of the letter and run along into their word.
        bend: { x: letter.x + (word.x - letter.x) * 0.18, y: word.y + 14 + random() * 10 },
        delay: random() * 320,
        pourDelay,
        group: index,
        position: clamp01(group.position + (random() - 0.5) * 0.12),
      })
    }
  })

  const introStart = performance.now()
  const pourStart = CONVERGE + HOLD + 320
  const settleStart = pourStart + lastPour + POUR
  const introEnd = settleStart + SETTLE
  const revealed = new Set<number>()

  const introGeometry = new BufferGeometry()
  const introPositions = new Float32Array(particles.length * 3)
  const introTints = new Float32Array(particles.length * 3)
  const introSizes = new Float32Array(particles.length)
  const introAlphas = new Float32Array(particles.length)
  introGeometry.setAttribute('position', new BufferAttribute(introPositions, 3))
  introGeometry.setAttribute('tint', new BufferAttribute(introTints, 3))
  introGeometry.setAttribute('size', new BufferAttribute(introSizes, 1))
  introGeometry.setAttribute('alpha', new BufferAttribute(introAlphas, 1))
  const introMaterial = pointsMaterial(palette.dark)
  const introPoints = new Points(introGeometry, introMaterial)
  introPoints.frustumCulled = false

  const tintIntro = () => {
    particles.forEach((particle, index) => {
      const color = gradient(palette, particle.position)
      introTints.set(color, index * 3)
      introSizes[index] = (palette.dark ? 1.7 : 1.5) + random() * (palette.dark ? 1.3 : 1)
    })
    introGeometry.attributes.tint.needsUpdate = true
    introGeometry.attributes.size.needsUpdate = true
  }
  tintIntro()

  let introRunning = intro && particles.length > 0
  if (introRunning) scene.add(introPoints)
  else finish()

  const endIntro = () => {
    if (!introRunning) return
    introRunning = false
    scene.remove(introPoints)
    introGeometry.dispose()
    introMaterial.dispose()
    finish()
  }

  const updateIntro = (now: number) => {
    const elapsed = now - introStart
    if (elapsed >= CONVERGE && hero.dataset.stage !== 'formed') hero.dataset.stage = 'formed'
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]
      let x: number
      let y: number
      let alpha: number
      const converge = clamp01((elapsed - particle.delay) / CONVERGE)
      if (elapsed < pourStart + particle.pourDelay) {
        const eased = easeOutCubic(converge)
        x = particle.start.x + (particle.letter.x - particle.start.x) * eased
        y = particle.start.y + (particle.letter.y - particle.start.y) * eased
        // A faint shimmer while the name holds.
        if (converge >= 1) {
          x += Math.sin(elapsed * 0.006 + index) * 0.6
          y += Math.cos(elapsed * 0.005 + index * 1.3) * 0.6
        }
        alpha = 0.15 + 0.8 * eased
      } else {
        const progress = clamp01((elapsed - pourStart - particle.pourDelay) / POUR)
        const t = easeInOutCubic(progress)
        const inverse = 1 - t
        x = inverse * inverse * particle.letter.x + 2 * inverse * t * particle.bend.x + t * t * particle.word.x
        y = inverse * inverse * particle.letter.y + 2 * inverse * t * particle.bend.y + t * t * particle.word.y
        alpha = 0.95
        if (progress >= 1 && !revealed.has(particle.group)) {
          revealed.add(particle.group)
          for (const word of groups[particle.group].to) word.dataset.revealed = ''
        }
      }
      if (elapsed > settleStart) alpha *= 1 - clamp01((elapsed - settleStart) / SETTLE)
      introPositions[index * 3] = x
      introPositions[index * 3 + 1] = -y
      introAlphas[index] = alpha
    }
    introGeometry.attributes.position.needsUpdate = true
    introGeometry.attributes.alpha.needsUpdate = true
    if (elapsed > settleStart && hero.dataset.animate === 'playing') finish()
    if (elapsed >= introEnd) endIntro()
  }

  // ---------- Ambient constellation ----------
  const nodeCount = () => (width < 640 ? 64 : 140)
  let nodes: Node[] = []
  const nodeGeometry = new BufferGeometry()
  const nodeMaterial = pointsMaterial(palette.dark)
  const nodePoints = new Points(nodeGeometry, nodeMaterial)
  nodePoints.frustumCulled = false
  const lineGeometry = new BufferGeometry()
  const lineMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false })
  const lines = new LineSegments(lineGeometry, lineMaterial)
  lines.frustumCulled = false
  let nodePositions = new Float32Array(0)
  let nodeTints = new Float32Array(0)
  let nodeSizes = new Float32Array(0)
  let nodeAlphas = new Float32Array(0)
  let linePositions = new Float32Array(0)
  let lineColors = new Float32Array(0)
  let textBand = { top: 0, bottom: 0 }

  const nodeColor = (hue: number): RGB => (hue < 0.35 ? palette.life : hue < 0.82 ? palette.signal : palette.energy)

  const buildNodes = () => {
    const count = nodeCount()
    nodes = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height,
      amplitude: 8 + random() * 28,
      speed: 0.00012 + random() * 0.00022,
      phase: random() * Math.PI * 2,
      depth: 0.35 + random() * 0.65,
      hue: random(),
    }))
    nodePositions = new Float32Array(count * 3)
    nodeTints = new Float32Array(count * 3)
    nodeSizes = new Float32Array(count)
    nodeAlphas = new Float32Array(count)
    nodes.forEach((node, index) => {
      nodeTints.set(nodeColor(node.hue), index * 3)
      nodeSizes[index] = (palette.dark ? 2 : 1.8) + node.depth * 2.2
    })
    nodeGeometry.setAttribute('position', new BufferAttribute(nodePositions, 3))
    nodeGeometry.setAttribute('tint', new BufferAttribute(nodeTints, 3))
    nodeGeometry.setAttribute('size', new BufferAttribute(nodeSizes, 1))
    nodeGeometry.setAttribute('alpha', new BufferAttribute(nodeAlphas, 1))
    const maxSegments = count * 4
    linePositions = new Float32Array(maxSegments * 2 * 3)
    lineColors = new Float32Array(maxSegments * 2 * 4)
    lineGeometry.setAttribute('position', new BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new BufferAttribute(lineColors, 4))
    const heroTop = hero.getBoundingClientRect().top
    // Dim the constellation behind all the hero's text: name, tagline, lead and actions.
    const textBlock = hero.querySelector<HTMLElement>('.hero-inner')
    const textRects = [textBlock ?? wordmark].map((element) => element.getBoundingClientRect())
    textBand = {
      top: Math.min(...textRects.map((rect) => rect.top)) - heroTop - 20,
      bottom: Math.max(...textRects.map((rect) => rect.bottom)) - heroTop + 20,
    }
  }
  buildNodes()
  scene.add(lines)
  scene.add(nodePoints)

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  window.addEventListener(
    'pointermove',
    (event) => {
      pointer.targetX = event.clientX / window.innerWidth - 0.5
      pointer.targetY = event.clientY / window.innerHeight - 0.5
    },
    { passive: true },
  )

  const ambientStart = intro ? introStart + settleStart - 400 : performance.now()
  const updateAmbient = (now: number) => {
    const fade = clamp01((now - ambientStart) / 1400)
    pointer.x += (pointer.targetX - pointer.x) * 0.05
    pointer.y += (pointer.targetY - pointer.y) * 0.05
    const linkDistance = Math.min(170, Math.max(110, width / 8))
    nodes.forEach((node, index) => {
      const x = node.x + Math.sin(now * node.speed + node.phase) * node.amplitude - pointer.x * 26 * node.depth
      const y = node.y + Math.cos(now * node.speed * 0.8 + node.phase) * node.amplitude - pointer.y * 18 * node.depth
      nodePositions[index * 3] = x
      nodePositions[index * 3 + 1] = -y
      const inText = y > textBand.top && y < textBand.bottom
      nodeAlphas[index] = fade * (palette.dark ? 0.75 : 0.6) * node.depth * (inText ? 0.3 : 1)
    })
    let segment = 0
    const maxSegments = linePositions.length / 6
    const [red, green, blue] = palette.signal
    for (let a = 0; a < nodes.length && segment < maxSegments; a += 1) {
      const ax = nodePositions[a * 3]
      const ay = nodePositions[a * 3 + 1]
      for (let b = a + 1; b < nodes.length && segment < maxSegments; b += 1) {
        const dx = nodePositions[b * 3] - ax
        const dy = nodePositions[b * 3 + 1] - ay
        const distance = Math.hypot(dx, dy)
        if (distance > linkDistance) continue
        const midY = -(ay + dy / 2)
        const inText = midY > textBand.top && midY < textBand.bottom
        const strength = (1 - distance / linkDistance) * fade * (palette.dark ? 0.32 : 0.26) * (inText ? 0.25 : 1)
        linePositions.set([ax, ay, 0, ax + dx, ay + dy, 0], segment * 6)
        lineColors.set([red, green, blue, strength, red, green, blue, strength], segment * 8)
        segment += 1
      }
    }
    lineGeometry.setDrawRange(0, segment * 2)
    nodeGeometry.attributes.position.needsUpdate = true
    nodeGeometry.attributes.alpha.needsUpdate = true
    lineGeometry.attributes.position.needsUpdate = true
    lineGeometry.attributes.color.needsUpdate = true
  }

  // ---------- Theme, size and visibility ----------
  const applyPalette = () => {
    palette = readPalette(hero)
    const blending = palette.dark ? AdditiveBlending : NormalBlending
    introMaterial.blending = blending
    nodeMaterial.blending = blending
    lineMaterial.blending = blending
    introMaterial.needsUpdate = true
    nodeMaterial.needsUpdate = true
    lineMaterial.needsUpdate = true
    if (introRunning) tintIntro()
    nodes.forEach((node, index) => nodeTints.set(nodeColor(node.hue), index * 3))
    if (nodeGeometry.attributes.tint) nodeGeometry.attributes.tint.needsUpdate = true
  }
  new MutationObserver(applyPalette).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  let lastWidth = width
  new ResizeObserver(() => {
    measure()
    if (Math.abs(width - lastWidth) < 1) return
    lastWidth = width
    endIntro()
    buildNodes()
  }).observe(hero)

  let visible = true
  let frame = 0
  let lastAmbientFrame = 0
  const loop = (now: number) => {
    frame = 0
    if (!visible || document.hidden) return
    if (introRunning) updateIntro(now)
    // Once the intro is over the constellation only drifts, so 30 frames a second is plenty.
    if (introRunning || now - lastAmbientFrame > 32) {
      lastAmbientFrame = now
      updateAmbient(now)
      introMaterial.uniforms.pixelRatio.value = pixelRatio
      nodeMaterial.uniforms.pixelRatio.value = pixelRatio
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(loop)
  }
  const resume = () => {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(loop)
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    resume()
  }).observe(hero)
  document.addEventListener('visibilitychange', resume)
  hero.dataset.scene = 'running'
  resume()
}
