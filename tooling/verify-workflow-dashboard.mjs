// Read-only runtime fixture plus a temporary dashboard; no hardware commands.
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {portalSession,signInBrowser} from './lib/portal-session.mjs'
const require=createRequire(new URL('../apps/portal/package.json',import.meta.url))
const {chromium,expect}=require('@playwright/test')
const f=JSON.parse(await readFile('/tmp/iot-sdk-fixture.json','utf8'))
const origin='http://localhost:8001'
const session=await portalSession(origin,f.admin)
const base=origin+'/api/v1/organizations/'+f.organization
async function get(path){const r=await session('GET',base+path);assert.equal(r.status,200);return (await r.json()).data}
const location=await get('/workflows/'+f.workflow+'/location-overview')
assert.equal(location.snapshot.fix.event_id,f.telemetry.events[2])
assert.equal(location.snapshot.fix.status,'unknown')
assert.equal(location.snapshot.fix.point,null)
assert.equal(location.snapshot.execution.enabled,false)
const alerts=await get('/workflows/'+f.workflow+'/alert-overview')
assert.equal(alerts.active,1)
const ack=await session('POST',base+'/alerts/'+f.alert+'/acknowledge',{})
assert.equal(ack.status,200)
const acknowledged=await get('/workflows/'+f.workflow+'/alert-overview')
assert.equal(acknowledged.active,1);assert.equal(acknowledged.unacknowledged_active,0)
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[]
page.on('pageerror',e=>errors.push(e.message))
await signInBrowser(context,origin,f.admin)
try {
 await page.goto('http://localhost:5173/organizations/'+f.organization+'/dashboards')
 await page.getByRole('button',{name:'New dashboard',exact:true}).first().click()
 await page.getByLabel('Dashboard name',{exact:true}).fill('Temporary workflow verification')
 await page.getByRole('dialog').getByRole('button',{name:'Create dashboard',exact:true}).click()
 // GPS map panels choose GPS devices now; only Alerts panels follow a workflow, so the
 // location overview is checked over the API above.
 for(const type of ['Alerts']){
  await page.getByRole('button',{name:'Add panel',exact:true}).first().click()
  await page.getByRole('dialog').getByRole('button',{name:type,exact:true}).click()
  await page.getByRole('combobox',{name:'Workflow',exact:true}).click()
  await page.getByRole('option',{name:'SDK fixture boundary',exact:true}).click()
  await page.getByRole('button',{name:'Apply to dashboard',exact:true}).click()
 }
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click()
 await expect(page.getByText('Unsaved changes',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'More dashboard actions',exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByText('1 active',{exact:true})).toBeVisible()
 await expect(page.getByText('0 active, unacknowledged',{exact:true})).toBeVisible()
 await page.screenshot({path:'/tmp/iot-workflow-live-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true)
 await page.screenshot({path:'/tmp/iot-workflow-live-mobile.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS live runtime latest incomplete GPS, stopped execution, acknowledgement remains active, real dashboard create/save/reload and the workflow alerts panel.')
}catch(error){ console.log(await page.locator('body').innerText()); throw error }finally{await context.close();await browser.close()}
