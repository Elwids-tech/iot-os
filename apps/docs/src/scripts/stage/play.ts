// Plays the landing stage: a clock that loops over the script in timeline.ts, the
// transcript that types and scrolls to it, the step buttons that seek, the pause
// button, and the Three.js scene that draws the same moment. With reduced motion the
// transcript stays complete and the scene draws its final moment once.
import { createStageScene, type StageScene } from './scene'
import { beatAt, beats, duration } from './timeline'

/** Milliseconds per typed character. */
const TYPE_MS = 16
/** The moment shown with reduced motion: the alert has arrived. */
const STILL = 21500

interface TranscriptLine {
  element: HTMLElement
  at: number
  text: HTMLElement | null
  full: string
  typed: boolean
  shown: boolean
  chars: number
}

export async function playStage(frame: HTMLElement): Promise<void> {
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const host = frame.querySelector<HTMLElement>('[data-scene-host]')
  const canvas = frame.querySelector<HTMLCanvasElement>('[data-stage-canvas]')
  const labels = Object.fromEntries(
    [...frame.querySelectorAll<HTMLElement>('[data-label]')].map((label) => [label.dataset.label, label]),
  )
  const transcript = frame.querySelector<HTMLElement>('[data-transcript]')
  const list = frame.querySelector<HTMLElement>('[data-lines]')
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

  if (!motion || !transcript || !list) {
    scene?.resize()
    scene?.render(elapsed)
    return
  }

  // ---------- Transcript ----------
  const lines: TranscriptLine[] = [...list.querySelectorAll<HTMLElement>(':scope > li')].map((element) => {
    const text = element.querySelector<HTMLElement>('[data-text]')
    const typed = text?.classList.contains('typed') ?? false
    return { element, at: Number(element.dataset.at), text, full: text?.textContent ?? '', typed, shown: true, chars: -1 }
  })
  frame.dataset.motion = 'playing'

  const follow = () => {
    const last = lines.filter((line) => line.shown).at(-1)
    if (!last) {
      list.style.transform = ''
      return
    }
    const bottom = last.element.offsetTop + last.element.offsetHeight
    const limit = transcript.clientHeight - 18
    list.style.transform = bottom > limit ? `translateY(${limit - bottom}px)` : ''
  }

  const applyTranscript = (time: number) => {
    let changed = false
    for (const line of lines) {
      const shown = time >= line.at
      if (shown !== line.shown) {
        line.shown = shown
        line.element.toggleAttribute('data-shown', shown)
        changed = true
      }
      if (!line.typed || !line.text) continue
      const chars = shown ? Math.min(line.full.length, Math.floor((time - line.at) / TYPE_MS)) : 0
      if (chars === line.chars) continue
      line.chars = chars
      line.text.textContent = line.full.slice(0, chars)
      line.text.toggleAttribute('data-typing', shown && chars < line.full.length)
      changed = true
    }
    if (changed) follow()
  }

  // ---------- Steps and pause ----------
  let current: HTMLButtonElement | null = null
  const applyBeats = (time: number) => {
    const beat = beatAt(time)
    const index = beats.indexOf(beat)
    const next = beats[index + 1]?.start ?? duration
    const button = buttons[index]
    if (button !== current) {
      current?.removeAttribute('aria-current')
      current?.style.removeProperty('--progress')
      current = button ?? null
      current?.setAttribute('aria-current', 'step')
    }
    current?.style.setProperty('--progress', ((time - beat.start) / (next - beat.start)).toFixed(3))
  }

  let playing = true
  const draw = (time: number) => {
    applyTranscript(time)
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
    // Thirty frames a second is enough for the typing, the chart and the particles.
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
