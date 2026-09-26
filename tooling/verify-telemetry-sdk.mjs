// Local HTTP verification against a temporary isolated synthetic fixture.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const {IotClient, IotApiError}=await import(process.env.IOT_SDK_MODULE ?? '../packages/integration-sdk/dist/index.js')
const fixture=JSON.parse(await readFile('/tmp/iot-sdk-fixture.json','utf8'))
const origin='http://127.0.0.1:8001'
const base=origin+'/api/v1/organizations/'+fixture.organization+'/applications'
async function manage(path,body){
 const response=await fetch(base+path,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+fixture.adminToken},body:JSON.stringify(body)})
 assert.equal(response.status,201)
 return (await response.json()).data
}
const app=await manage('',{name:'Local telemetry verifier',abilities:['telemetry:read'],device_uuids:fixture.devices.slice(0,2)})
const issued=await manage('/'+app.uuid+'/token',{revision:app.revision,abilities:['telemetry:read'],expires_in_days:1})
const client=new IotClient({baseUrl:origin,organization:fixture.organization,token:issued.token,allowInsecureLocalhost:true})
const latest=await client.latestTelemetry(fixture.devices[0])
assert.equal(latest.configuration_uuid,fixture.telemetry.configuration)
assert.equal(latest.data[0].value,21.5)
assert.equal(latest.data[0].quality,'inactive')
assert.equal(latest.data[0].timestamp_source,'source')
assert.deepEqual((await client.latestTelemetry(fixture.devices[1])).data,[])
const options={parameterUuid:fixture.telemetry.parameter,from:fixture.telemetry.from,to:fixture.telemetry.to}
const history=await client.telemetryHistory(fixture.devices[0],options)
assert.equal(history.data[0].configuration_uuid,fixture.telemetry.configuration)
assert.equal(history.data[0].points[0].value,21.5)
assert.equal(history.data[0].points[0].count,1)
assert.deepEqual((await client.telemetryHistory(fixture.devices[1],options)).data,[])
await assert.rejects(client.latestTelemetry(fixture.devices[2]),error=>error instanceof IotApiError && error.status===404)
await assert.rejects(client.devices(),error=>error instanceof IotApiError && error.status===403)
const foreign=new IotClient({baseUrl:origin,organization:fixture.foreign,token:issued.token,allowInsecureLocalhost:true})
await assert.rejects(foreign.latestTelemetry(fixture.devices[0]),error=>error instanceof IotApiError && error.status===404)
console.log('PASS live telemetry SDK: retained latest quality, numeric history, no data, device grants, ability and tenant isolation.')
