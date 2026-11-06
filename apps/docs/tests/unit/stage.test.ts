import { describe, expect, it } from 'vitest'
import { beatAt, beats, duration, lines, moments, temperature } from '../../src/scripts/stage/timeline'

// The stage's script is one timeline shared by the transcript and the scene: what the
// transcript says must be what the scene shows, at the same moment.
describe('the stage script', () => {
  it('runs in order and fits in the loop', () => {
    const times = lines.map((line) => line.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times.at(-1)).toBeLessThan(duration - 2000)
    for (const moment of Object.values(moments)) expect(moment).toBeLessThan(duration)
    expect(beats.map((beat) => beat.start)).toEqual([...beats].map((beat) => beat.start).sort((a, b) => a - b))
  })

  it('tells the alert after the automation is active, and the chart agrees', () => {
    expect(moments.activated).toBeLessThan(moments.rise)
    expect(moments.rise).toBeLessThan(moments.alert)
    for (let time = moments.panelAdded; time < moments.rise; time += 100) expect(temperature(time)).toBeLessThan(8)
    expect(temperature(moments.alert)).toBeGreaterThan(8)
    expect(temperature(duration)).toBeCloseTo(8.6, 0)
  })

  it('names the step for any moment', () => {
    expect(beatAt(0).id).toBe('firmware')
    expect(beatAt(moments.connected).id).toBe('connect')
    expect(beatAt(moments.panelAdded).id).toBe('watch')
    expect(beatAt(moments.alert).id).toBe('alert')
  })

  it('names no outcome figures', () => {
    for (const line of lines) expect(`${line.text} ${line.meta ?? ''}`).not.toMatch(/\d+(\.\d+)?\s?%|\b\d+x\b/)
  })
})
