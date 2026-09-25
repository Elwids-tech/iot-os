import { IotClient } from '@iot-os/integration-sdk'
const client = new IotClient({
  baseUrl: process.env.IOT_API_URL,
  organization: process.env.IOT_ORGANIZATION,
  token: process.env.IOT_APPLICATION_TOKEN,
  allowInsecureLocalhost: process.env.IOT_ALLOW_LOCAL_HTTP === '1',
})
for await (const device of client.allDevices()) console.log(device.uuid, device.name, device.presence)
for await (const alert of client.allAlerts({ condition: 'active' })) console.log(alert.uuid, alert.device_uuid, alert.condition)
