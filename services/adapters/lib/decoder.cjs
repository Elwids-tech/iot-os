const { Worker } = require("node:worker_threads");
const path = require("node:path");

// QuickJS interrupts the decoder after 100 ms of CPU, but never inside a single
// built-in call such as a backtracking regular expression. This backstop is the
// worker's CPU time from the start of the decoder's code, because wall time also
// counts the time a busy host gives to other work.
const DECODE_CPU_DEADLINE_MS = 500;
const CPU_CHECK_INTERVAL_MS = 50;
// Decoder code cannot wait without using the CPU, so this only stops a worker
// that has stopped answering for some other reason. Loading QuickJS gets the
// same time: on a busy host it took up to 7.7 s of wall time for at most 190 ms
// of the worker's CPU, and none of the decoder's code runs before it is ready.
const ANSWER_DEADLINE_MS = 30000;

function inputFromMessage(payload, topic, metadata = {}) {
  const bytes = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      );
  if (bytes.length > 1024 * 1024) throw Error("Payload exceeds 1 MiB");
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {}
  return {
    payload: parsed,
    bytes: Array.from(bytes),
    payloadBase64: bytes.toString("base64"),
    topic,
    receivedAt: new Date().toISOString(),
    retained: !!metadata.retain,
    qos: metadata.qos ?? 0,
  };
}

function decode(code, input) {
  if (typeof code !== "string" || code.length > 64000)
    return Promise.reject(Error("Decoder exceeds 64,000 characters"));
  if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
    return Promise.reject(Error("Decoder input is too large"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "decoder-worker.cjs"), {
      workerData: { code, input },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 2,
      },
    });
    let settled = false;
    let cpuCheck;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cpuCheck);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    let timer = setTimeout(
      () => finish(Error("Decoder worker did not start")),
      ANSWER_DEADLINE_MS,
    );
    // worker.cpuUsage() reads the worker's CPU time even while it is stuck inside
    // QuickJS. It rejects once the worker has exited, and the exit handler settles.
    const checkCpu = (started) =>
      worker.cpuUsage().then(
        ({ user, system }) => {
          if (settled) return;
          if ((user + system) / 1000 - started > DECODE_CPU_DEADLINE_MS)
            finish(Error("Decoder exceeded its worker deadline"));
          else cpuCheck = setTimeout(checkCpu, CPU_CHECK_INTERVAL_MS, started);
        },
        () => {},
      );
    worker.on("message", (message) => {
      if (message.ready) {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(Error("Decoder worker stopped answering")),
          ANSWER_DEADLINE_MS,
        );
        return;
      }
      if (message.decoderStarted !== undefined)
        return checkCpu(message.decoderStarted);
      finish(message.ok ? null : Error(message.error), message.result);
    });
    worker.once("error", (error) =>
      finish(
        Error(
          error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "Decoder memory limit exceeded"
            : "Decoder worker failed",
        ),
      ),
    );
    worker.once("exit", () => {
      if (!settled) finish(Error("Decoder worker ended without output"));
    });
  });
}

function validateOutput(result, profile) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw Error("Return an object with sourceDeviceId and metrics");
  if (
    typeof result.sourceDeviceId !== "string" ||
    !result.sourceDeviceId.trim() ||
    result.sourceDeviceId.length > 128
  )
    throw Error("A manufacturer sourceDeviceId is required");
  if (
    !Array.isArray(result.metrics) ||
    !result.metrics.length ||
    result.metrics.length > 2000
  )
    throw Error("Return between 1 and 2000 metrics");
  const parameters = new Map(
    (profile.parameters || [])
      .filter((p) => p.reports_state !== false && p.kind !== "derived")
      .map((p) => [p.key, p]),
  );
  const seen = new Set();
  const metrics = result.metrics.map((metric) => {
    const parameter = parameters.get(metric?.name);
    if (!parameter || seen.has(metric.name))
      throw Error("Unknown or duplicate profile metric");
    seen.add(metric.name);
    const numeric = ["number", "integer"].includes(parameter.data_type);
    if (
      metric.value == null ||
      (numeric &&
        (typeof metric.value !== "number" || !Number.isFinite(metric.value))) ||
      (parameter.data_type === "integer" &&
        !Number.isSafeInteger(metric.value)) ||
      (parameter.data_type === "boolean" &&
        typeof metric.value !== "boolean") ||
      (parameter.data_type === "string" &&
        (typeof metric.value !== "string" || metric.value.length > 16384))
    )
      throw Error(`Invalid value for ${metric.name}`);
    if (
      !["number", "integer", "boolean", "string"].includes(parameter.data_type)
    )
      throw Error("Unsupported profile metric type");
    if (metric.unit !== undefined && metric.unit !== parameter.unit)
      throw Error(`Unit must match the profile for ${metric.name}`);
    return {
      name: metric.name,
      value: metric.value,
      datatype: {
        number: "Double",
        integer: "Int64",
        boolean: "Boolean",
        string: "String",
      }[parameter.data_type],
      parameter_uuid: parameter.uuid,
      unit: parameter.unit ?? null,
    };
  });
  let observedAt;
  if (result.observedAt !== undefined) {
    const timestamp = Date.parse(result.observedAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000)
      throw Error("Invalid or future observation timestamp");
    observedAt = new Date(timestamp).toISOString();
  }
  const messageId =
    result.messageId === undefined ? undefined : String(result.messageId);
  if (messageId && messageId.length > 128)
    throw Error("Message identifier is too long");
  return {
    sourceDeviceId: result.sourceDeviceId.trim(),
    metrics,
    ...(observedAt ? { observedAt } : {}),
    ...(messageId ? { messageId } : {}),
  };
}
module.exports = { decode, inputFromMessage, validateOutput };
