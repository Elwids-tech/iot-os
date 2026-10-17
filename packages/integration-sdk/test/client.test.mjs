import test from 'node:test'
import assert from 'node:assert/strict'
import { IotClient, IotApiError, IotContractError, IotTransportError } from '../dist/index.js'
const id = '00000000-0000-4000-8000-000000000001'
const item = { uuid: id, code: 'tag', name: 'Tag', lifecycle: 'active', presence: 'unseen', last_seen_at: null }
const make = fetch => new IotClient({ baseUrl: 'https://iot.example.test', organization: id, token: 'secret-for-test', fetch })
test('paginates with bounded requests and omits browser credentials', async () => {
  const requests = []
  const client = make(async (url, options) => {
    requests.push({url, options})
    return Response.json({data:[item],meta:{current_page:requests.length,last_page:2,total:2}})
  })
  const result = []
  for await(const device of client.allDevices({perPage:1}))result.push(device)
  assert.equal(result.length,2)
  assert.match(requests[1].url,/page=2&per_page=1$/)
  assert.equal(requests[0].options.credentials,'omit')
  assert.equal(requests[0].options.redirect,'error')
  assert.equal(requests[0].options.headers.Authorization,'Bearer secret-for-test')
})
test('does not replay errors and exposes rate-limit delay without body secrets', async () => {
  let count=0
  const client=make(async()=>{count++;return Response.json({secret:'sensitive'},{status:429,headers:{'Retry-After':'12'}})})
  await assert.rejects(client.devices(),e=>e instanceof IotApiError && e.status===429 && e.retryAfterSeconds===12 && !e.message.includes('sensitive'))
  assert.equal(count,1)
})
test('rejects malformed data and repeated pagination', async () => {
  await assert.rejects(make(async()=>Response.json({data:[{uuid:id}],meta:{current_page:1,last_page:1,total:1}})).devices(),IotContractError)
  const client=make(async()=>Response.json({data:[item],meta:{current_page:1,last_page:2,total:2}}))
  await assert.rejects(async()=>{for await(const ignored of client.allDevices()){}},IotContractError)
})
test('rejects unsafe URLs and invalid inputs before fetch', async () => {
  for(const baseUrl of ['http://remote.test','https://user:pass@host.test','https://host.test/path','https://host.test/?q=1'])assert.throws(()=>new IotClient({baseUrl,organization:id,token:'secret'}),TypeError)
  const client=make(async()=>{throw Error('must not fetch')})
  await assert.rejects(client.device('../private'),TypeError)
  await assert.rejects(client.devices({perPage:101}),TypeError)
})
test('aborts timed-out requests and hides transport credentials', async () => {
  const client=new IotClient({baseUrl:'https://iot.example.test',organization:id,token:'secret',timeoutMs:10,fetch:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('secret'))))})
  await assert.rejects(client.devices(),e=>e instanceof IotTransportError && !e.message.includes('secret'))
})
test('validates alerts and preserves unknown timestamps', async () => {
  const alert={uuid:id,device_uuid:id,workflow_uuid:id,workflow_name:'Boundary',episode:1,condition:'active',activated_at:null,cleared_at:null,acknowledged_at:null,execution_stopped_reason:null}
  assert.equal((await make(async()=>Response.json({data:alert})).alert(id)).cleared_at,null)
  await assert.rejects(make(async()=>Response.json({data:{...alert,condition:'safe'}})).alert(id),IotContractError)
})
test('event checkpoints, opaque cursors and snapshots are validated', async()=>{
  const alert={uuid:id,device_uuid:id,workflow_uuid:id,workflow_name:'Boundary',episode:1,condition:'cleared',activated_at:null,cleared_at:'2026-09-25T00:00:00Z',acknowledged_at:null,execution_stopped_reason:null}
  let request
  const client=make(async(url)=>{request=url;return Response.json({data:[{id,schema_version:'integration-event.v1',type:'alert.activated.v1',occurred_at:'2026-09-25T00:00:00Z',recorded_at:'2026-09-25T00:00:00Z',data:alert}],next_cursor:'next',has_more:false})})
  assert.equal((await client.events({cursor:'opaque+/=',limit:1})).data[0].data.condition,'cleared')
  assert.match(request,/cursor=opaque%2B%2F%3D/)
  assert.equal(await make(async()=>Response.json({cursor:'checkpoint'})).eventCheckpoint(),'checkpoint')
  await assert.rejects(make(async()=>Response.json({data:[],next_cursor:'next',has_more:true})).events(),IotContractError)
  await assert.rejects(client.events({limit:101}),TypeError)
})
test('webhook raw-body signature rejects tampering, stale timestamps and wrong delivery identity', async()=>{
  const {createHmac}=await import('node:crypto')
  const {verifyWebhook}=await import('../dist/index.js')
  const secret='whsec_'+'s'.repeat(64), timestamp='1800000000'
  const payload={id,schema_version:'integration-event.v1',type:'alert.activated.v1',occurred_at:'2026-09-25T00:00:00Z',recorded_at:'2026-09-25T00:00:00Z',data:{uuid:id,device_uuid:id,workflow_uuid:id,workflow_name:'Boundary',episode:1,condition:'active',activated_at:null,cleared_at:null,acknowledged_at:null,execution_stopped_reason:null}}
  const body=JSON.stringify(payload)
  const signature='v1='+createHmac('sha256',secret).update(`${timestamp}.${id}.${body}`).digest('hex')
  const options={body,secret,signature,timestamp,deliveryId:id,nowSeconds:Number(timestamp)}
  assert.equal((await verifyWebhook(options)).id,id)
  await assert.rejects(verifyWebhook({...options,body:body+' '}),/Invalid webhook/)
  await assert.rejects(verifyWebhook({...options,nowSeconds:Number(timestamp)+301}),/Invalid webhook/)
  await assert.rejects(verifyWebhook({...options,deliveryId:'00000000-0000-4000-8000-000000000002'}),/Invalid webhook/)
  await assert.rejects(verifyWebhook({...options,secret:'different-secret-value'}),/Invalid webhook/)
})

test('telemetry preserves no data and validates history bounds and response identity', async () => {
  let calls = 0
  const latest = { schema_version: 'telemetry-latest.v1', device_uuid: id, configuration_uuid: null, presence: 'unknown', data: [] }
  const history = { schema_version: 'telemetry-history.v1', device_uuid: id, parameter_uuid: id, retention_days: 30, from: null, to: null, data: [] }
  const client = make(async url => { calls++; return Response.json(url.includes('/latest') ? latest : history) })
  assert.deepEqual((await client.latestTelemetry(id)).data, [])
  const options = { parameterUuid: id, from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }
  assert.deepEqual((await client.telemetryHistory(id, options)).data, [])
  await assert.rejects(client.telemetryHistory(id, { ...options, to: '2026-11-01T00:00:00Z' }), TypeError)
  await assert.rejects(client.telemetryHistory(id, { ...options, maxPoints: 1001 }), TypeError)
  assert.equal(calls, 2)
  await assert.rejects(make(async () => Response.json({ ...latest, device_uuid: 'wrong' })).latestTelemetry(id), IotContractError)
  await assert.rejects(make(async () => Response.json({ ...history, data: [{ configuration_uuid: id, unit: null, data_type: 'number', points: [{ at: options.from, value: null, count: -1 }] }] })).telemetryHistory(id, options), IotContractError)
})

test('raw records preserve provenance and reject malformed pagination', async () => {
  const options={parameterUuid:id,from:'2026-09-01T00:00:00Z',to:'2026-09-02T00:00:00Z',pageSize:1,limit:2}
  const row={event_uuid:id,configuration_uuid:id,parameter_uuid:id,received_at:options.from,observed_at:options.from,data_type:'number',unit:null,value:0,quality:'good',timestamp_source:'source',historical:true}
  const body={schema_version:'telemetry-records.v1',device_uuid:id,parameter_uuid:id,data:[row],meta:{from:options.from,to:options.to,limit:2,page_size:1,returned:1,consumed:1,next_cursor:'signed',has_more:true,limit_reached:false}}
  const client=make(async()=>Response.json(body))
  assert.equal((await client.telemetryRecords(id,options)).data[0].historical,true)
  await assert.rejects(client.telemetryRecords(id,{...options,cursor:'signed'}),IotContractError)
  await assert.rejects(client.telemetryRecords(id,{...options,limit:5001}),TypeError)
  await assert.rejects(make(async()=>Response.json({...body,meta:{...body.meta,has_more:false}})).telemetryRecords(id,options),IotContractError)
  await assert.rejects(make(async()=>Response.json({...body,data:[{...row,historical:'false'}]})).telemetryRecords(id,options),IotContractError)
})
test('location fixes preserve unknown and reject invented valid coordinates', async () => {
  const fix={schema_version:'location-fix.v1',binding_uuid:id,binding_revision:1,event_id:id,organization_uuid:id,device_uuid:id,configuration_uuid:id,generation:1,evaluated_at:'2026-09-01T00:00:00Z',observed_at:null,received_at:null,timestamp_source:'unknown',historical:false,status:'unknown',reason:'incomplete_fix',live_eligible:false,point:null}
  const client=make(async()=>Response.json({version_uuid:id,data:fix}))
  assert.equal((await client.locationFix(id,id,id)).point,null)
  for(const invalid of [{...fix,point:{latitude:0,longitude:0,accuracy_metres:null}},{...fix,status:'valid',point:{latitude:91,longitude:0,accuracy_metres:null}},{...fix,live_eligible:true}]) {
    await assert.rejects(make(async()=>Response.json({version_uuid:id,data:invalid})).locationFix(id,id,id),IotContractError)
  }
})

test('geospatial management uses bounded device queries and idempotent operation bodies', async () => {
  const requests=[]
  const fence={uuid:id,name:'North pasture',geometry:{type:'Polygon',coordinates:[[[0,0],[0.01,0],[0,0.01],[0,0]]]},revision:1,assignments:[],created_at:'2026-09-26T00:00:00Z',updated_at:'2026-09-26T00:00:00Z'}
  const activation={uuid:id,geofence_revision:1,status:'pending',items:[],created_at:'2026-09-26T00:00:00Z',updated_at:'2026-09-26T00:00:00Z'}
  const client=make(async(url,options)=>{requests.push({url,options});return Response.json(url.endsWith('/location-map/query')?{data:{schema_version:'location-map.v1',trail_window:'24h',geofence:null,devices:[]}}:{data:fence,activation})})
  await client.locationMap({deviceUuids:[id]})
  const input={operation_uuid:id,expected_revision:0,name:fence.name,geometry:fence.geometry,assignments:[{device_uuid:id,policy:{outside_for_seconds:60,max_gap_seconds:45,minimum_samples:2,uncertainty_metres:2}}]}
  assert.equal((await client.createGeofence(input)).activation.uuid,id)
  assert.deepEqual(JSON.parse(requests[0].options.body),{device_uuids:[id],trail_window:'24h',include_trails:true})
  assert.deepEqual(JSON.parse(requests[1].options.body),input)
  assert.equal(requests[1].options.method,'POST')
  await assert.rejects(client.locationMap({deviceUuids:[]}),TypeError)
  await assert.rejects(client.locationMap({deviceUuids:Array.from({length:101},()=>id)}),TypeError)
})

test('geofence events are accepted by the shared event stream contract', async()=>{
  const event={id,schema_version:'integration-event.v1',type:'geofence.exited.v1',occurred_at:'2026-09-26T00:00:00Z',recorded_at:'2026-09-26T00:00:01Z',data:{uuid:id,geofence_uuid:id,geofence_name:'North pasture',assignment_uuid:id,device_uuid:id,type:'exited',source_event_uuid:id,occurred_at:'2026-09-26T00:00:00Z'}}
  const page=await make(async()=>Response.json({data:[event],next_cursor:'next',has_more:false})).events()
  assert.equal(page.data[0].type,'geofence.exited.v1')
})

test('automation events from the contract example are accepted by the feed and webhooks', async()=>{
  const {readFile}=await import('node:fs/promises')
  const {createHmac}=await import('node:crypto')
  const {verifyWebhook}=await import('../dist/index.js')
  const contract=JSON.parse(await readFile(new URL('../../../contracts/openapi/openapi.json',import.meta.url),'utf8'))
  const example=contract.paths['/integration/v1/organizations/{organization}/events'].get.responses['200'].content['application/json'].example
  const automation=example.data.find(event=>event.type==='automation.triggered.v1')
  const page=await make(async()=>Response.json(example)).events()
  assert.deepEqual(page.data.map(event=>event.type),example.data.map(event=>event.type))
  assert.deepEqual(page.data.find(event=>event.type==='automation.triggered.v1'),automation)
  const secret='whsec_'+'s'.repeat(64), timestamp='1800000000', body=JSON.stringify(automation)
  const signature='v1='+createHmac('sha256',secret).update(`${timestamp}.${id}.${body}`).digest('hex')
  assert.deepEqual((await verifyWebhook({body,secret,signature,timestamp,deliveryId:id,nowSeconds:Number(timestamp)})).data,automation.data)
  const {node_id,...missing}=automation.data
  await assert.rejects(make(async()=>Response.json({...example,data:[{...automation,data:missing}]})).events(),IotContractError)
})
