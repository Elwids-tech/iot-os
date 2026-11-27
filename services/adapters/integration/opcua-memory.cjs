// Spec 038, research R2: how much a tenant runtime holds while collecting about 5,000
// points at 10 s sampling. Run inside the tenant runtime image against the simulator at
// its large size (6,602 points), with the building's export for the maps:
//
//   python tooling/simulators/bms_server.py --size large --host 0.0.0.0 --port 4850
//   python tooling/simulators/bms_server.py --size large --export-model > large.json
//   node integration/opcua-memory.cjs opc.tcp://host:4850/ large.json [points] [minutes]
//
// It builds one point map per equipment type (as an organization would), collects them
// on one session, and prints resident memory and CPU every 10 s and a summary.
const fs = require("node:fs");
const { Collector } = require("../lib/opcua/collect.cjs");
const { resolveMap } = require("../lib/opcua/resolve.cjs");
const { open } = require("../lib/opcua/session.cjs");

const [url, exportFile, wanted = "5000", minutes = "5"] = process.argv.slice(2);
const NS = "urn:example:bms:example-tower";

function maps(model, limit) {
  const points = new Map(model.points.map((p) => [p.key, p]));
  const byType = new Map();
  for (const item of model.equipment) {
    if (!byType.has(item.type)) byType.set(item.type, []);
    byType.get(item.type).push(item);
  }
  const out = [];
  let total = 0;
  for (const [type, items] of byType) {
    const keys = items[0].points.map((key) => key.split(".")[1]);
    const readings = keys.map((key) => {
      const p = points.get(`${items[0].key}.${key}`);
      return {
        key, name: p.name, unit: p.unit, data_type: p.type,
        report: { sample_ms: 10_000, deadband: { kind: "none", value: 0 } },
        address: { relative_path: [{ namespace_uri: NS, name: key }] },
      };
    });
    const equipment = [];
    for (const item of items) {
      if (total + keys.length > limit) break;
      const path = ["Example Campus", "Example Tower", item.level, ...(item.zone ? [item.zone] : []), item.key];
      equipment.push({ source_id: path.join("/"), display_name: item.key, address: { node_id: `s=${item.key}`, namespace_uri: NS, path: path.map((name) => ({ namespace_uri: NS, name })) } });
      total += keys.length;
    }
    if (equipment.length) out.push({ type, map: { version: 1, protocol: "opcua", rhythm_seconds: 300, readings, equipment } });
  }
  return { maps: out, total };
}

function mib(bytes) {
  return Math.round((bytes / 1048576) * 10) / 10;
}

(async () => {
  const model = JSON.parse(fs.readFileSync(exportFile, "utf8"));
  const before = process.memoryUsage().rss;
  const { maps: built, total } = maps(model, Number(wanted));
  const connection = await open({ endpointUrl: url, network: { allowPrivate: true } });
  const collectors = [];
  let results = 0;
  const started = Date.now();
  for (const { map } of built) {
    const collector = new Collector(connection, map, await resolveMap(connection, map));
    collector.on("result", () => results++);
    await collector.start();
    collectors.push(collector);
  }
  const monitored = collectors.reduce((n, c) => n + c.items.length - c.refused.length, 0);
  console.log(JSON.stringify({ maps: built.length, points: total, monitored, setup_seconds: (Date.now() - started) / 1000, rss_before_mib: mib(before) }));
  const samples = [];
  let cpu = process.cpuUsage();
  let at = process.hrtime.bigint();
  const timer = setInterval(() => {
    const used = process.cpuUsage(cpu);
    const now = process.hrtime.bigint();
    const percent = ((used.user + used.system) / Number(now - at) * 1000) * 100;
    cpu = process.cpuUsage();
    at = now;
    const sample = { rss_mib: mib(process.memoryUsage().rss), heap_mib: mib(process.memoryUsage().heapUsed), cpu_percent: Math.round(percent * 10) / 10, results };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }, 10_000);
  setTimeout(async () => {
    clearInterval(timer);
    const settled = samples.slice(Math.floor(samples.length / 3));
    const summary = {
      monitored,
      peak_rss_mib: Math.max(...samples.map((s) => s.rss_mib)),
      settled_rss_mib: Math.round(settled.reduce((a, s) => a + s.rss_mib, 0) / settled.length * 10) / 10,
      mean_cpu_percent: Math.round(settled.reduce((a, s) => a + s.cpu_percent, 0) / settled.length * 10) / 10,
      results_per_minute: Math.round(results / Number(minutes)),
    };
    console.log(`SUMMARY ${JSON.stringify(summary)}`);
    for (const c of collectors) await c.stop();
    await connection.close();
    process.exit(0);
  }, Number(minutes) * 60_000);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
