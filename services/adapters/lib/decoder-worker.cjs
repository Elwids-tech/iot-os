const { parentPort, workerData } = require("node:worker_threads");
const { getQuickJS } = require("quickjs-emscripten");

const EXECUTION_BUDGET_MS = 100;

// CPU time of this worker thread. Wall time would also count the time a busy
// host spends running other work, which interrupted trivial decoders in CI.
function cpuMs() {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
}

function unwrap(context, evaluated) {
  if (evaluated.error) {
    const error = context.dump(evaluated.error);
    evaluated.error.dispose();
    throw Error(error.message || "Decoder failed");
  }
  return evaluated.value;
}

(async () => {
  const engine = await getQuickJS();
  parentPort.postMessage({ ready: true });
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const context = runtime.newContext();
  try {
    // Creating the context, the helpers and the input is platform work, so it
    // runs before the budget starts. Parsing a 1 MiB input takes most of it.
    const inputJson = context.newString(JSON.stringify(workerData.input));
    context.setProp(context.global, "inputJson", inputJson);
    inputJson.dispose();
    const helpers = `Object.freeze({
      uint16BE(bytes, offset = 0) { if(offset < 0 || offset + 2 > bytes.length) throw Error('Invalid byte offset'); return bytes[offset] * 256 + bytes[offset + 1]; },
      uint32BE(bytes, offset = 0) { if(offset < 0 || offset + 4 > bytes.length) throw Error('Invalid byte offset'); return bytes[offset] * 16777216 + bytes[offset+1] * 65536 + bytes[offset+2] * 256 + bytes[offset+3]; }
    })`;
    unwrap(
      context,
      context.evalCode(
        `'use strict'; const helpers = ${helpers}; const input = JSON.parse(inputJson); delete globalThis.inputJson;`,
        "decoder-setup.js",
      ),
    ).dispose();
    // Everything from here runs tenant code, including code that escapes the
    // decode expression, so all of it is interrupted once the budget is spent.
    const started = cpuMs();
    // decoder.cjs measures its worker deadline from the same point.
    parentPort.postMessage({ decoderStarted: started });
    runtime.setInterruptHandler(() => cpuMs() - started > EXECUTION_BUDGET_MS);
    const code = `'use strict'; const decode = (${workerData.code}); const result = decode(input, helpers); if(result && typeof result.then === 'function') throw Error('Decoder must be synchronous'); JSON.stringify(result);`;
    const evaluated = unwrap(
      context,
      context.evalCode(code, "device-decoder.js"),
    );
    const serialized = context.dump(evaluated);
    evaluated.dispose();
    if (typeof serialized !== "string" || serialized.length > 1024 * 1024)
      throw Error("Decoder must return a bounded object");
    parentPort.postMessage({ ok: true, result: JSON.parse(serialized) });
  } finally {
    context.dispose();
    runtime.dispose();
  }
})().catch((error) =>
  parentPort.postMessage({
    ok: false,
    error: String(error.message).slice(0, 300),
  }),
);
