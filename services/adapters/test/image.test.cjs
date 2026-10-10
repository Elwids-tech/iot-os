const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the tenant runtime image passes the adapter settings straight to red.js", () => {
  // nodered/node-red's entrypoint runs `red.js --userDir /data "$@"`. Any `--` in the
  // command ends red.js option parsing, so --settings would be ignored and the platform
  // adapter nodes would never load (flows then wait forever for missing types).
  const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS tenant-runtime"));
  const command = JSON.parse(runtime.match(/^CMD (\[.*\])$/m)[1]);
  assert.deepEqual(command, ["--settings", "/opt/iot-adapter/runtime-settings.cjs"]);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "runtime-settings.cjs"), "utf8"), /nodesDir/);
});
