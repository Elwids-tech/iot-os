// Preload (node --require) that makes each decoder worker lose the CPU for
// longer than the decoder's budget at its first interrupt check, as on a busy
// CI runner.
const { isMainThread } = require("node:worker_threads");

if (!isMainThread) {
  const { QuickJSRuntime } = require("quickjs-emscripten");
  const { setInterruptHandler } = QuickJSRuntime.prototype;
  QuickJSRuntime.prototype.setInterruptHandler = function (handler) {
    let paused = false;
    return setInterruptHandler.call(this, (runtime) => {
      if (!paused) {
        paused = true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      }
      return handler(runtime);
    });
  };
}
