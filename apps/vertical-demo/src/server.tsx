import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { IotClient } from "@iot-os/integration-sdk";
import { AlertOverview } from "@iot-os/ui/components/workflow-overview";
import { StoredLocation } from "@iot-os/ui/components/stored-location";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@iot-os/ui/components/card";
import { Alert, AlertTitle, AlertDescription } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { loadEvidence } from "./adapter.mjs";
import "./styles.css";

const env = process.env;
function required(name: string) {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} in the server environment.`);
  return value;
}
const client = new IotClient({ baseUrl: required("IOT_API_ORIGIN"), organization: required("IOT_ORGANIZATION_UUID"), token: required("IOT_APPLICATION_TOKEN"), allowInsecureLocalhost: env.IOT_ALLOW_LOCAL_HTTP === "1", timeoutMs: 8000 });
const selection = { device: required("IOT_DEVICE_UUID"), event: required("IOT_EVENT_UUID"), version: required("IOT_VERSION_UUID"), alert: required("IOT_ALERT_UUID") };
for (const value of Object.values(selection)) if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) throw new Error("Evidence selections must be UUIDs.");
const port = Number(env.PORT ?? 5180);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
const origin = new URL(env.PUBLIC_ORIGIN ?? `http://localhost:${port}`);
const css = readFileSync(new URL("./style.css", import.meta.url));
function Unavailable({ name }: { name: string }) {
  return <Alert><AlertTitle>{name} unavailable</AlertTitle><AlertDescription>Check the application grant and selected evidence, then refresh. No prior result is retained.</AlertDescription></Alert>;
}
let busy = 0;
createServer(async (request, response) => {
  // Local demonstration only. Fixed origin prevents DNS rebinding; production
  // hosts must supply their own user authentication and tenant authorization.
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (request.headers.host !== origin.host) { response.writeHead(403).end(); return; }
  if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }).end(); return; }
  if (request.url === "/style.css") { response.writeHead(200, { "Content-Type": "text/css" }).end(css); return; }
  if (request.url === "/health") { response.writeHead(200).end("ready"); return; }
  if (request.url !== "/" && request.url !== "/?") { response.writeHead(404).end(); return; }
  if (busy >= 4) { response.writeHead(503, { "Retry-After": "2" }).end("Busy; retry shortly."); return; }
  busy++;
  try {
    const data = await loadEvidence(client, selection);
    const html = renderToStaticMarkup(<html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Field application · evidence</title><link rel="stylesheet" href="/style.css" /></head><body>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Field application</h1><p className="text-muted-foreground">Selected device evidence</p></div><form action="/" method="get"><Button type="submit">Refresh evidence</Button></form></header>
        <p>This application owns its device and evidence selections. Results below are read from the core with a scoped application credential.</p>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <Card><CardHeader><CardTitle>Stored GPS fix</CardTitle><CardDescription>A specific event and approved binding version, evaluated when this page was requested.</CardDescription></CardHeader><CardContent>{data.location ? <StoredLocation data={data.location} /> : <Unavailable name="Location" />}</CardContent></Card>
          <Card><CardHeader><CardTitle>Selected alert</CardTitle><CardDescription>Only this episode is counted. These are not workflow-wide totals.</CardDescription></CardHeader><CardContent>{data.alert ? <AlertOverview data={data.alert} timezone="utc" /> : <Unavailable name="Alert" />}</CardContent></Card>
        </div>
        <p className="text-sm text-muted-foreground">Point-in-time evidence. Refresh to recheck permissions and freshness. Current rule execution and workflow geometry are not exposed by this sample.</p>
      </main></body></html>);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<!doctype html>" + html);
  } catch { response.writeHead(503).end("Evidence unavailable. Retry shortly."); }
  finally { busy--; }
}).listen(port, env.IOT_BIND_ADDRESS ?? "127.0.0.1", () => console.log(`Field application listening on ${port}`));
