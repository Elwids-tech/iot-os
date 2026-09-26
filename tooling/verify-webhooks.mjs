// Uses only the local verification sink; never contacts an external receiver.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const {verifyWebhook}=await import(process.env.IOT_SDK_MODULE ?? '../packages/integration-sdk/dist/index.js')
const fixture=JSON.parse(await readFile('/tmp/iot-sdk-fixture.json','utf8'))
const base='http://127.0.0.1:8001/api/v1/organizations/'+fixture.organization
async function call(path,method='GET',body,expected=200){
 const response=await fetch(base+path,{method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+fixture.adminToken},body:body===undefined?undefined:JSON.stringify(body)})
 assert.equal(response.status,expected,'Local webhook verification HTTP status')
 return (await response.json()).data
}
const app=await call('/applications','POST',{name:'Local webhook verifier',abilities:['events:read','alerts:read'],device_uuids:[fixture.devices[0]]},201)
const path='/applications/'+app.uuid+'/webhook'
const config=await call(path,'PUT',{revision:0,url:'http://webhook-sink:8080/events'})
assert.ok(config.signing_secret)
assert.equal((await call(path)).signing_secret,undefined)
await call('/alerts/'+fixture.alert+'/acknowledge','POST',{})
let deliveries
const until=Date.now()+40000
while(Date.now()<until){
 deliveries=await call(path+'/deliveries')
 if(deliveries[0]?.status==='delivered')break
 await new Promise(resolve=>setTimeout(resolve,2000))
}
assert.equal(deliveries.length,1)
assert.equal(deliveries[0].status,'delivered')
assert.equal(deliveries[0].attempts,2)
assert.deepEqual(deliveries[0].history.map(a=>a.http_status),[503,204])
const id=deliveries[0].uuid
assert.match(id,/^[a-f0-9-]{36}$/)
const lines=execFileSync('rtk',['proxy','docker','exec','iot-os-dev-webhook-sink-1','cat','/tmp/webhook-'+id+'.jsonl'],{encoding:'utf8'}).trim().split('\n').map(line=>JSON.parse(line))
assert.equal(lines.length,2)
assert.equal(lines[0].body,lines[1].body)
for(const line of lines){
 const verified=await verifyWebhook({body:line.body,secret:config.signing_secret,signature:line.headers['x-iot-signature'],timestamp:line.headers['x-iot-timestamp'],deliveryId:line.headers['x-iot-delivery-id']})
 assert.equal(verified.type,'alert.acknowledged.v1')
 assert.equal(verified.data.uuid,fixture.alert)
 assert.equal(line.headers['x-iot-delivery-id'],id)
 await assert.rejects(verifyWebhook({body:line.body+' ',secret:config.signing_secret,signature:line.headers['x-iot-signature'],timestamp:line.headers['x-iot-timestamp'],deliveryId:id}))
}
await call(path+'/disable','POST',{revision:config.revision})
assert.equal((await call(path)).enabled,false)
console.log('PASS live webhook worker: 503 retry → 204 acceptance, stable delivery identity/body, PHP/Node HMAC verification, tamper rejection, private secret and disable.')
