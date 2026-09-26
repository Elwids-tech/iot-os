import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { project } from '../examples/project.mjs'
test('projection resumes atomically and failed fetch preserves durable state', async()=>{
 const directory=await mkdtemp(join(tmpdir(),'iot-projection-'))
 const filename=join(directory,'state.json')
 let fail=false, phase=0, bootstrap=0
 const client={
  async eventCheckpoint(){bootstrap++;return 'start'},
  async *allAlerts(){yield {uuid:'legacy',condition:'active'}},
  async events({cursor}){
   if(fail)throw Error('interrupted')
   if(phase===0){assert.equal(cursor,'start');return {data:[{data:{uuid:'new',condition:'active'}}],next_cursor:'one',has_more:false}}
   assert.equal(cursor,'one');return {data:[{data:{uuid:'new',condition:'cleared'}}],next_cursor:'two',has_more:false}
  }
 }
 try {
  await project(client,filename)
  const saved=await readFile(filename,'utf8'); fail=true
  await assert.rejects(project(client,filename),/interrupted/)
  assert.equal(await readFile(filename,'utf8'),saved)
  fail=false;phase=1;await project(client,filename)
  const state=JSON.parse(await readFile(filename,'utf8'))
  assert.equal(state.cursor,'two');assert.equal(state.alerts.new.condition,'cleared');assert.equal(state.alerts.legacy.condition,'active');assert.equal(bootstrap,1)
 } finally {await rm(directory,{recursive:true,force:true})}
})
