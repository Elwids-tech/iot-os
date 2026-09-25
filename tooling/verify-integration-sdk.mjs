// Run against the fixture created by verify-integration-sdk.php.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { IotClient, IotApiError } = await import(process.env.IOT_SDK_MODULE ?? '../packages/integration-sdk/dist/index.js')
const fixture = JSON.parse(await readFile('/tmp/iot-sdk-fixture.json', 'utf8'))
const baseUrl = 'http://127.0.0.1:8001'
const manage = `${baseUrl}/api/v1/organizations/${fixture.organization}/applications`
async function control(url, body, method='POST', expected=201) {
  const response=await fetch(url,{method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${fixture.adminToken}`},body:JSON.stringify(body),redirect:'error'})
  assert.equal(response.status,expected,'Management HTTP status')
  return (await response.json()).data
}
const application=await control(manage,{name:'Independent Node client',abilities:['devices:read','alerts:read'],device_uuids:fixture.devices.slice(0,2)})
const issue = (app,abilities=['devices:read','alerts:read'])=>control(`${manage}/${app.uuid}/token`,{revision:app.revision,abilities,expires_in_days:1})
const first=await issue(application)
const clientFor=(token,organization=fixture.organization)=>new IotClient({baseUrl,organization,token,allowInsecureLocalhost:true})
const client=clientFor(first.token)
const devices=[]
for await(const device of client.allDevices({perPage:1}))devices.push(device)
assert.equal(devices[0].presence,'unknown')
assert.deepEqual(devices.map(d=>d.uuid),fixture.devices.slice(0,2))
assert.equal((await client.device(fixture.devices[0])).uuid,fixture.devices[0])
const alerts=[]
for await(const alert of client.allAlerts({perPage:1}))alerts.push(alert)
assert.equal(alerts.length,1)
assert.equal(alerts[0].uuid,fixture.alert)
assert.equal((await client.alert(fixture.alert)).condition,'active')
const denied = (status)=>e=>e instanceof IotApiError && e.status===status
await assert.rejects(client.device(fixture.devices[2]),denied(404))
await assert.rejects(clientFor(first.token,fixture.foreign).devices(),denied(404))
const portal=await fetch(`${baseUrl}/api/v1/me`,{headers:{Accept:'application/json',Authorization:`Bearer ${first.token}`}})
assert.equal(portal.status,401)
const next=await issue(first.application,['devices:read'])
await assert.rejects(client.devices(),denied(401))
await assert.rejects(clientFor(next.token).alerts(),denied(403))
assert.equal((await clientFor(next.token).devices()).meta.total,2)
await control(`${manage}/${application.uuid}/revoke`,{revision:next.application.revision},'POST',200)
await assert.rejects(clientFor(next.token).devices(),denied(401))
console.log('PASS packaged Node SDK: devices, alerts, pagination, device/tenant isolation, portal separation, rotation, ability checks and revocation.')
