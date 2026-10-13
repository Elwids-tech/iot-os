const { parentPort, workerData } = require("node:worker_threads");
const { getQuickJS } = require("quickjs-emscripten");

(async () => {
  const engine = await getQuickJS();
  parentPort.postMessage({ ready: true });
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 100;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    const helpers = `Object.freeze({
      uint16BE(bytes, offset = 0) { if(offset < 0 || offset + 2 > bytes.length) throw Error('Invalid byte offset'); return bytes[offset] * 256 + bytes[offset + 1]; },
      uint32BE(bytes, offset = 0) { if(offset < 0 || offset + 4 > bytes.length) throw Error('Invalid byte offset'); return bytes[offset] * 16777216 + bytes[offset+1] * 65536 + bytes[offset+2] * 256 + bytes[offset+3]; }
    })`;
    const code = `'use strict'; const helpers = ${helpers}; const input = JSON.parse(${JSON.stringify(JSON.stringify(workerData.input))}); const decode = (${workerData.code}); const result = decode(input, helpers); if(result && typeof result.then === 'function') throw Error('Decoder must be synchronous'); JSON.stringify(result);`;
    const evaluated = context.evalCode(code, "device-decoder.js");
    if (evaluated.error) {
      const error = context.dump(evaluated.error);
      evaluated.error.dispose();
      throw Error(error.message || "Decoder failed");
    }
    const serialized = context.dump(evaluated.value);
    evaluated.value.dispose();
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
