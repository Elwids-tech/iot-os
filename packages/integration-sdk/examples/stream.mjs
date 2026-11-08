// Follow a plant's readings as they are committed (spec 030). Same environment as
// read.mjs: IOT_API_URL (or IOT_API_ORIGIN), IOT_ORGANIZATION, IOT_APPLICATION_TOKEN,
// IOT_ALLOW_LOCAL_HTTP=1 for a loopback http origin; IOT_DEVICES narrows the stream to
// a comma-separated list of granted device UUIDs. Stop it with Ctrl-C.
import { IotClient } from '@iot-os/integration-sdk'
const client = new IotClient({
  baseUrl: process.env.IOT_API_URL ?? process.env.IOT_API_ORIGIN,
  organization: process.env.IOT_ORGANIZATION,
  token: process.env.IOT_APPLICATION_TOKEN,
  allowInsecureLocalhost: process.env.IOT_ALLOW_LOCAL_HTTP === '1',
})
const controller = new AbortController()
process.on('SIGINT', () => controller.abort())
const devices = process.env.IOT_DEVICES ? process.env.IOT_DEVICES.split(',').map((d) => d.trim()).filter(Boolean) : undefined
for await (const event of client.telemetryStream({ devices, signal: controller.signal })) {
  switch (event.type) {
    case 'open':
      console.log('open', event.position, `${event.devices} devices`, event.openedAt)
      break
    case 'reading':
      for (const reading of event.readings) console.log('reading', event.position, event.deviceUuid, reading.key, reading.value, reading.unit ?? '', reading.quality, reading.received_at)
      break
    case 'reset':
      console.log('reset: take a new snapshot, continuing from', event.position)
      break
  }
}
