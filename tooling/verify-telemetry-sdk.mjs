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

const rawOptions={...options,parameterUuid:fixture.telemetry.latitude,pageSize:1,limit:3}
const events=[]
let cursor
for(let page=0;page<3;page++){
 const result=await client.telemetryRecords(fixture.devices[0],{...rawOptions,...(cursor?{cursor}:{})})
 assert.equal(result.data.length,1)
 assert.equal(result.data[0].timestamp_source,'source')
 assert.equal(result.data[0].historical,false)
 events.push(result.data[0].event_uuid)
 cursor=result.meta.next_cursor
}
assert.equal(cursor,null)
assert.equal(new Set(events).size,3)
assert.deepEqual([...events].sort(),[...fixture.telemetry.events].sort())
const limited=await client.telemetryRecords(fixture.devices[0],{...rawOptions,limit:1})
assert.equal(limited.meta.limit_reached,true)
assert.equal(limited.meta.next_cursor,null)
const first=await client.telemetryRecords(fixture.devices[0],rawOptions)
await assert.rejects(client.telemetryRecords(fixture.devices[0],{...rawOptions,cursor:first.meta.next_cursor+'tampered'}),e=>e instanceof IotApiError && e.status===422)
await assert.rejects(client.telemetryRecords(fixture.devices[1],{...rawOptions,cursor:first.meta.next_cursor}),e=>e instanceof IotApiError && e.status===422)
const bindings=await client.locationBindings(fixture.devices[0])
assert.equal(bindings.data[0].version_uuid,fixture.telemetry.version)
const fix=await client.locationFix(fixture.devices[0],fixture.telemetry.events[0],fixture.telemetry.version)
assert.equal(fix.status,'valid')
assert.equal(fix.point.latitude,51.5)
assert.equal(fix.point.longitude,-114.1)
assert.equal(fix.point.accuracy_metres,null)
const incomplete=await client.locationFix(fixture.devices[0],fixture.telemetry.events[2],fixture.telemetry.version)
assert.equal(incomplete.status,'unknown')
assert.equal(incomplete.reason,'incomplete_fix')
assert.equal(incomplete.point,null)
await assert.rejects(client.locationFix(fixture.devices[1],fixture.telemetry.events[0],fixture.telemetry.version),e=>e instanceof IotApiError && e.status===404)
console.log('PASS raw/location SDK: stable pagination, explicit cap, signed cursor scope, trusted paired fix, incomplete fix unknown and binding isolation.')
