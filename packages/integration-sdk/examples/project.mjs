// Single-writer reference consumer; owns its projection, uses only public APIs.
import { open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { IotClient } from '@iot-os/integration-sdk'

export async function project(client, filename, { rebuild = false } = {}) {
  // Fail rather than let two consumers overwrite the same checkpoint.
  const lock = await open(filename + '.lock', 'wx', 0o600)
  const temporary = filename + '.' + process.pid + '.tmp'
  try {
    let state
    if (!rebuild) {
      try { state = JSON.parse(await readFile(filename, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (state && (state.version !== 1 || typeof state.cursor !== 'string' || !state.alerts || Array.isArray(state.alerts))) throw Error('Invalid projection. Rebuild explicitly.')
    }
    if (!state) {
      // Capture the boundary BEFORE listing current state. Replay closes races
      // with state changing while pages are being read, including old episodes.
      const cursor = await client.eventCheckpoint()
      const alerts = {}
      for await (const alert of client.allAlerts()) alerts[alert.uuid] = alert
      state = { version: 1, cursor, alerts }
    }
    let processed = 0
    // Bound a single run; the next run resumes the saved cursor.
    for (let page = 0; page < 100; page++) {
      const batch = await client.events({ cursor: state.cursor })
      for (const event of batch.data) {
        // Full authoritative snapshot: late activation cannot undo a clear.
        state.alerts[event.data.uuid] = event.data
        processed++
      }
      state.cursor = batch.next_cursor
      if (!batch.has_more) break
    }
    // The projection and checkpoint are one atomic replacement. No email or
    // business side effects are performed by this reference consumer.
    const file = await open(temporary, 'w', 0o600)
    try { await file.writeFile(JSON.stringify(state)); await file.sync() }
    finally { await file.close() }
    await rename(temporary, filename)
    return { processed, alerts: Object.keys(state.alerts).length }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    await lock.close()
    await unlink(filename + '.lock')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  const client = new IotClient({ baseUrl: process.env.IOT_API_URL, organization: process.env.IOT_ORGANIZATION, token: process.env.IOT_APPLICATION_TOKEN, allowInsecureLocalhost: process.env.IOT_ALLOW_LOCAL_HTTP === '1' })
  const filename = process.argv[2]
  if (!filename || filename.startsWith('--')) throw Error('Provide a projection file path.')
  console.log(await project(client, filename, { rebuild: process.argv.includes('--rebuild') }))
}
