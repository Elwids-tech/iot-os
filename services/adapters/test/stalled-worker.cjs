// Preload (node --require) that blocks each decoder worker without using the
// CPU, as a deadlocked worker would, after telling its process on the
// "stalled-worker" channel. STALL_AT=load blocks before QuickJS loads, and
// STALL_AT=decode at the decoder's first interrupt check. Workers inherit
// preloads from their process.
const { isMainThread, BroadcastChannel } = require("node:worker_threads");

function stall() {
  const channel = new BroadcastChannel("stalled-worker");
  channel.postMessage("stalled");
  channel.close();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

if (!isMainThread && process.env.STALL_AT === "load") stall();
if (!isMainThread && process.env.STALL_AT === "decode") {
  const { QuickJSRuntime } = require("quickjs-emscripten");
  const { setInterruptHandler } = QuickJSRuntime.prototype;
  QuickJSRuntime.prototype.setInterruptHandler = function (handler) {
    return setInterruptHandler.call(this, (runtime) => {
      stall();
      return handler(runtime);
    });
  };
}
