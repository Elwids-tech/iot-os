// Build a standalone server-rendered consumer. The artifact has no portal source,
// router, API singleton or credentials. Hosts inject data and their clock.
import {createRequire} from 'node:module'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const require=createRequire(new URL('../apps/portal/package.json',import.meta.url))
const viteRequire=createRequire(require.resolve('vite/package.json'))
const {build}=viteRequire('esbuild')
const directory=await mkdtemp(join(tmpdir(),'iot-workflow-components-'))
const component=fileURLToPath(new URL('../packages/ui/src/components/workflow-overview.tsx',import.meta.url))
const source=`import {createElement as h} from ${JSON.stringify(require.resolve('react'))};
import {renderToStaticMarkup} from ${JSON.stringify(require.resolve('react-dom/server'))};
import {LocationOverview,AlertOverview} from ${JSON.stringify(component)};
const html=renderToStaticMarkup(h('main',null,h('h1',null,'Independent workflow overview'),
 h(LocationOverview,{data:{workflow_name:'Field boundary',deployment_status:'inactive',snapshot:null},now:0,timezone:'utc'}),
 h(AlertOverview,{data:{workflow_name:'Field boundary',active:1,unacknowledged_active:0,total:1,checked_at:'2026-09-25T00:00:00Z',recent:[{uuid:'demo',episode:1,activated_at:'2026-09-25T00:00:00Z',acknowledged_at:'2026-09-25T00:00:00Z',cleared_at:null}]},timezone:'utc'})));
console.log('<!doctype html><html lang="en"><meta charset="utf-8"><title>Independent workflow overview</title>'+html+'</html>');`
const entry=join(directory,'host.jsx'),bundle=join(directory,'host.cjs')
await writeFile(entry,source)
const result=await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'cjs',jsx:'automatic',metafile:true})
assert.ok(!Object.keys(result.metafile.inputs).some(path=>path.includes('apps/portal/src')||path.includes('packages/api-client/src')))
const html=execFileSync(process.execPath,[bundle],{encoding:'utf8',cwd:directory})
assert.match(html,/No applied workflow/);assert.match(html,/1 active/);assert.match(html,/Acknowledged/)
await writeFile(join(directory,'index.html'),html)
console.log('PASS standalone workflow components: injectable data, no portal/router/API imports; artifact '+join(directory,'index.html'))
