import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEvidence} from '../src/adapter.mjs';
const selection={device:'device',event:'event',version:'version',alert:'alert'};
const episode={device_uuid:'device',condition:'active',acknowledged_at:'now',workflow_name:'Boundary'};
test('acknowledged active episode stays active and is explicitly a selected subset',async()=>{
 const data=await loadEvidence({locationFix:async()=>({status:'unknown',point:null}),alert:async()=>episode},selection);
 assert.equal(data.alert.active,1);assert.equal(data.alert.unacknowledged_active,0);assert.equal(data.alert.total,1);
 assert.match(data.alert.workflow_name,/Selected episode/);assert.equal(data.location.point,null);
});
test('location failure preserves independent alert evidence',async()=>{
 const data=await loadEvidence({locationFix:async()=>{throw Error('private');},alert:async()=>episode},selection);
 assert.equal(data.location,null);assert.equal(data.alert.active,1);assert.ok(!JSON.stringify(data).includes('private'));
});
test('revocation removes both results and mismatched device cannot be associated',async()=>{
 const data=await loadEvidence({locationFix:async()=>null,alert:async()=>({...episode,device_uuid:'foreign'})},selection);
 assert.equal(data.alert,null);
 const denied=await loadEvidence({locationFix:async()=>{throw Error('401')},alert:async()=>{throw Error('401')}},selection);
 assert.deepEqual(denied,{location:null,alert:null});
});
