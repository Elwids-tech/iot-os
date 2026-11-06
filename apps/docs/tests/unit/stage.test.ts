import { describe, expect, it } from 'vitest'
import { beatAt, beats, captionAt, captions, duration, moments, temperature } from '../../src/scripts/stage/timeline'

// The stage's script is one timeline shared by the ribbon and the scene: what the
// caption says must be what the scene shows, at the same moment.
describe('the stage script', () => {
  it('runs in order and fits in the loop', () => {
    const times = captions.map((caption) => caption.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times.at(-1)).toBeLessThan(duration - 3000)
    for (const moment of Object.values(moments)) expect(moment).toBeLessThan(duration)
    expect(beats.map((beat) => beat.start)).toEqual([...beats].map((beat) => beat.start).sort((a, b) => a - b))
  })

  it('turns the alarm on after the automation is active, and the chart agrees', () => {
    expect(moments.activated).toBeLessThan(moments.rise)
    expect(moments.rise).toBeLessThan(moments.alarm)
    expect(moments.alarm).toBeLessThan(moments.phoneIn)
    expect(moments.phoneIn).toBeLessThan(moments.mailIn)
    for (let time = moments.panelAdded; time < moments.rise; time += 100) expect(temperature(time)).toBeLessThan(8)
    expect(temperature(moments.alarm)).toBeGreaterThan(8)
    expect(temperature(duration)).toBeCloseTo(8.6, 0)
  })

  it('names the step and the caption for any moment', () => {
    expect(beatAt(0).id).toBe('firmware')
    expect(beatAt(moments.connected).id).toBe('connect')
    expect(beatAt(moments.panelAdded).id).toBe('watch')
    expect(beatAt(moments.activated).id).toBe('automate')
    expect(captionAt(moments.alarm).text).toMatch(/alarm/)
    expect(captionAt(moments.connected).text).toMatch(/Sparkplug B/)
  })

  it('names no outcome figures', () => {
    for (const caption of captions) expect(caption.text).not.toMatch(/\d+(\.\d+)?\s?%|\b\d+x\b/)
  })
})
