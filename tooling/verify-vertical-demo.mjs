// A temporary real-API fixture must already be waiting. Only this verifier gets
// a human token, to issue/revoke the application's scoped machine credential.
import {readFile,writeFile,mkdtemp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {get} from 'node:http';
const require=createRequire(new URL('../apps/portal/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const f=JSON.parse(await readFile('/tmp/iot-sdk-fixture.json','utf8'));
const origin='http://localhost:8001', demo='http://localhost:5180';
const base=origin+'/api/v1/organizations/'+f.organization;
const headers={Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+f.adminToken};
async function post(path,body={}) {const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});assert.ok(r.ok,`fixture management ${r.status}`);return (await r.json()).data;}
const application=await post('/applications',{name:'Independent field application verifier',abilities:['telemetry:read','alerts:read'],device_uuids:[f.devices[0]]});
const issued=await post('/applications/'+application.uuid+'/token',{revision:application.revision,abilities:['telemetry:read','alerts:read'],expires_in_days:1});
const directory=await mkdtemp(join(tmpdir(),'iot-vertical-'));
await chmod(directory,0o755);
const name='iot-vertical-verification-'+process.pid;
const docker=(...args)=>execFileSync('rtk',['proxy','docker',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
// Test-only loopback relay reaches the local API on the existing private Docker
// network. The shipped app still requires HTTPS except explicit loopback HTTP.
await writeFile(join(directory,'relay.mjs'),`import net from 'node:net';
await new Promise(resolve=>net.createServer(socket=>{const upstream=net.connect(8000,'api');socket.pipe(upstream).pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());}).listen(8001,'127.0.0.1',resolve));
await import('/app/server.js');\n`);
let running=false;
async function start(event,device=f.devices[0]) {
 if(running){docker('rm','-f',name);running=false;}
 const env={IOT_API_ORIGIN:'http://127.0.0.1:8001',IOT_ALLOW_LOCAL_HTTP:'1',IOT_ORGANIZATION_UUID:f.organization,IOT_APPLICATION_TOKEN:issued.token,IOT_DEVICE_UUID:device,IOT_EVENT_UUID:event,IOT_VERSION_UUID:f.telemetry.version,IOT_ALERT_UUID:f.alert,PUBLIC_ORIGIN:demo};
 await writeFile(join(directory,'private.env'),Object.entries(env).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
 docker('run','-d','--name',name,'--network','iot-os-dev_internal','-p','127.0.0.1:5180:5180','-p','[::1]:5180:5180','--env-file',join(directory,'private.env'),'-v',directory+':/verification:ro','iot-os-vertical-demo','node','/verification/relay.mjs');running=true;
 await expect.poll(async()=>{try{return (await fetch(demo+'/health')).status}catch{return 0}},{timeout:15000}).toBe(200);
}
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requested=[];page.on('request',r=>requested.push(r.url()));
try {
 await start(f.telemetry.events[0]);
 await page.goto(demo);
 await expect(page.getByText('Stored coordinates',{exact:true})).toBeVisible();
 await expect(page.getByText('51.500000',{exact:true})).toBeVisible();
 await expect(page.getByText('1 active',{exact:true})).toBeVisible();
 const html=await page.content();assert.ok(!html.includes(issued.token));assert.ok(!html.includes(f.adminToken));
 assert.equal((await fetch(demo+'/?device=other')).status,404);
 assert.equal((await fetch(demo,{method:'POST'})).status,405);
 assert.equal(await new Promise((resolve,reject)=>get(demo,{headers:{Host:'untrusted.test'}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)),403);
 await post('/alerts/'+f.alert+'/acknowledge');
 await page.getByRole('button',{name:'Refresh evidence'}).click();
 await expect(page.getByText('0 active, unacknowledged',{exact:true})).toBeVisible();
 await expect(page.getByText('1 active',{exact:true})).toBeVisible();
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(audit.violations.map(v=>v.id),[]);
 await page.screenshot({path:'/tmp/iot-vertical-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:'/tmp/iot-vertical-mobile.png',fullPage:true});
 assert.ok(requested.every(url=>url.startsWith(demo)), 'Browser must only request its own application origin');
 await start(f.telemetry.events[2]);await page.goto(demo);
 await expect(page.getByText('Unknown location',{exact:true})).toBeVisible();
 await expect(page.getByText('51.500000',{exact:true})).toHaveCount(0);
 await expect(page.getByText('1 active',{exact:true})).toBeVisible();
 await start(f.telemetry.events[0],f.devices[2]);await page.goto(demo);
 await expect(page.getByText('Location unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('Alert unavailable',{exact:true})).toBeVisible();
 await start(f.telemetry.events[0]);
 await post('/applications/'+application.uuid+'/revoke',{revision:issued.application.revision});
 await page.goto(demo);
 await expect(page.getByText('Location unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('Alert unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('1 active',{exact:true})).toHaveCount(0);
 assert.deepEqual(errors,[]);
 console.log('PASS independent container: real scoped SDK reads, selected valid/incomplete fixes, acknowledged active alert, device association/grants, revocation, token isolation, origin restrictions, mobile layout and accessibility.');
} catch(error) { console.log(await page.locator('body').innerText());throw error; } finally {
 await context.close();await browser.close();if(running)docker('rm','-f',name);await rm(directory,{recursive:true,force:true});
}
