// Plays the landing stage: a clock that loops over the script in timeline.ts, the
// ribbon that shows the caption for the moment, the step buttons that seek, the pause
// button, and the Three.js scene that draws the same moment. With reduced motion the
// captions stay a complete list and the scene draws one still moment.
import { createStageScene, type StageScene } from './scene'
import { beatAt, beats, duration } from './timeline'

/** The moment shown with reduced motion: the alarm is on and the email has arrived. */
const STILL = 21500

export async function playStage(frame: HTMLElement): Promise<void> {
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const host = frame.querySelector<HTMLElement>('[data-scene-host]')
  const canvas = frame.querySelector<HTMLCanvasElement>('[data-stage-canvas]')
  const labels = Object.fromEntries(
    [...frame.querySelectorAll<HTMLElement>('[data-label]')].map((label) => [label.dataset.label, label]),
  )
  const captions = [...frame.querySelectorAll<HTMLElement>('[data-captions] > li')].map((element) => ({
    element,
    at: Number(element.dataset.at),
  }))
  const pause = frame.querySelector<HTMLButtonElement>('[data-pause]')
  const pauseLabel = frame.querySelector<HTMLElement>('[data-pause-label]')
  const buttons = [...frame.querySelectorAll<HTMLButtonElement>('[data-beat]')]

  await document.fonts.ready

  let scene: StageScene | null = null
  if (host && canvas && 'WebGLRenderingContext' in window) {
    scene = createStageScene(host, canvas, labels)
    if (scene) frame.dataset.scene = 'ready'
  }
  let elapsed = motion ? 0 : STILL

  new MutationObserver(() => {
    scene?.retint()
    scene?.render(elapsed)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  if (host) {
    new ResizeObserver(() => {
      scene?.resize()
      scene?.render(elapsed)
    }).observe(host)
  }

  if (!motion) {
    scene?.resize()
    scene?.render(elapsed)
    return
  }

  // ---------- The ribbon ----------
  frame.dataset.motion = 'playing'
  let currentCaption: HTMLElement | null = null
  const applyCaptions = (time: number) => {
    const next = captions.reduce<HTMLElement | null>((current, caption) => (time >= caption.at ? caption.element : current), null)
    if (next === currentCaption) return
    currentCaption?.removeAttribute('data-current')
    currentCaption = next
    currentCaption?.setAttribute('data-current', '')
  }

  // ---------- Steps and pause ----------
  let currentBeat: HTMLButtonElement | null = null
  const applyBeats = (time: number) => {
    const beat = beatAt(time)
    const index = beats.indexOf(beat)
    const next = beats[index + 1]?.start ?? duration
    const button = buttons[index] ?? null
    if (button !== currentBeat) {
      currentBeat?.removeAttribute('aria-current')
      currentBeat?.style.removeProperty('--progress')
      currentBeat = button
      currentBeat?.setAttribute('aria-current', 'step')
    }
    currentBeat?.style.setProperty('--progress', ((time - beat.start) / (next - beat.start)).toFixed(3))
  }

  let playing = true
  const draw = (time: number) => {
    applyCaptions(time)
    applyBeats(time)
    scene?.render(time)
  }
  const seek = (time: number) => {
    elapsed = time
    draw(elapsed)
  }
  for (const button of buttons) {
    button.disabled = false
    button.addEventListener('click', () => seek(Number(button.dataset.start) || 0))
  }
  if (pause) {
    pause.hidden = false
    pause.addEventListener('click', () => {
      playing = !playing
      pause.setAttribute('aria-pressed', String(!playing))
      if (pauseLabel) pauseLabel.textContent = playing ? 'Pause' : 'Play'
      resume()
    })
  }

  // ---------- Clock ----------
  let visible = false
  let frameId = 0
  let last = 0
  let lastDraw = 0
  const tick = (now: number) => {
    frameId = 0
    if (!visible || document.hidden) return
    const delta = Math.min(100, now - last)
    last = now
    if (playing) elapsed = (elapsed + delta) % duration
    // Thirty frames a second is enough for the chart and the particles.
    if (now - lastDraw >= 32) {
      lastDraw = now
      draw(elapsed)
    }
    frameId = requestAnimationFrame(tick)
  }
  const resume = () => {
    if (frameId || !visible || document.hidden) return
    last = performance.now()
    frameId = requestAnimationFrame(tick)
  }
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      resume()
    },
    { threshold: 0.2 },
  ).observe(frame)
  document.addEventListener('visibilitychange', resume)

  scene?.resize()
  draw(elapsed)
  resume()
}
