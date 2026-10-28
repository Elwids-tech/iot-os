const { Worker } = require("node:worker_threads");
const path = require("node:path");

// QuickJS interrupts the decoder after 100 ms of CPU, but never inside a single
// built-in call such as a backtracking regular expression. This backstop is the
// worker's CPU time from the start of the decoder's code, because wall time also
// counts the time a busy host gives to other work.
const DECODE_CPU_DEADLINE_MS = 500;
const CPU_CHECK_INTERVAL_MS = 50;
// Decoder code cannot wait without the CPU, and the platform's work barely
// does, so a worker is stuck only when its CPU time stops advancing. On a busy
// host a 1 MiB input took up to 67 s of wall time to decode, so the worker is
// stopped only after 30 s without progress. Answering a read costs a blocked
// worker up to 0.5 ms of CPU, so smaller advances are not progress.
const STALL_MS = 30000;
const PROGRESS_CPU_MS = 1;
// Loading QuickJS and preparing the input are platform work on input that
// decode() bounds: up to 0.5 s of the worker's CPU on a busy host. QuickJS
// cannot interrupt it, so this cap stops a worker that spins before the
// decoder's code starts.
const SETUP_CPU_LIMIT_MS = 5000;

// One decoder input. MQTT sources pass the packet's retain flag and QoS; webhook
// deliveries add `http` and polled records add `poll` (spec 020, decoder-io.md).
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
  const received = Date.parse(metadata.receivedAt);
  return {
    payload: parsed,
    bytes: Array.from(bytes),
    payloadBase64: bytes.toString("base64"),
    topic: topic ?? "",
    receivedAt: new Date(
      Number.isFinite(received) ? received : Date.now(),
    ).toISOString(),
    retained: !!metadata.retain,
    qos: metadata.qos ?? 0,
    source: metadata.source || "mqtt",
    ...(metadata.http ? { http: metadata.http } : {}),
    ...(metadata.poll ? { poll: metadata.poll } : {}),
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
    let ready = false;
    let started; // the worker's CPU time when the decoder's code started
    let cpu = 0; // the worker's CPU time at the last read
    let cpuCheck;
    let stall;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(stall);
      clearTimeout(cpuCheck);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const restartStall = () => {
      clearTimeout(stall);
      stall = setTimeout(
        () =>
          finish(
            Error(
              ready
                ? "Decoder worker stopped answering"
                : "Decoder worker did not start",
            ),
          ),
        STALL_MS,
      );
    };
    // worker.cpuUsage() reads the worker's CPU time even while it is stuck inside
    // QuickJS. It rejects before the worker is online and after it has exited,
    // which counts as no progress. A read that never settles stops the checks,
    // and the stall timer then stops the worker.
    const checkCpu = () =>
      worker.cpuUsage().then(
        ({ user, system }) => {
          if (settled) return;
          const used = (user + system) / 1000;
          if (started !== undefined && used - started > DECODE_CPU_DEADLINE_MS)
            return finish(Error("Decoder exceeded its worker deadline"));
          if (started === undefined && used > SETUP_CPU_LIMIT_MS)
            return finish(Error("Decoder setup exceeded its CPU limit"));
          if (used - cpu >= PROGRESS_CPU_MS) restartStall();
          cpu = used;
          cpuCheck = setTimeout(checkCpu, CPU_CHECK_INTERVAL_MS);
        },
        () => {
          if (!settled) cpuCheck = setTimeout(checkCpu, CPU_CHECK_INTERVAL_MS);
        },
      );
    restartStall();
    checkCpu();
    worker.on("message", (message) => {
      if (message.ready) ready = true;
      else if (message.decoderStarted !== undefined)
        started = message.decoderStarted;
      else finish(message.ok ? null : Error(message.error), message.result);
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
// A decoder may return one result or a list of 1 to 500. Each result is validated
// alone, so one bad result never discards the others.
function validateResults(result, profile) {
  if (!Array.isArray(result))
    return { results: [validateOutput(result, profile)], failures: [] };
  if (!result.length || result.length > 500)
    throw Error("Return one result or a list of 1 to 500 results");
  const results = [];
  const failures = [];
  result.forEach((item, index) => {
    try {
      results.push(validateOutput(item, profile));
    } catch (error) {
      failures.push({ index, error: String(error.message).slice(0, 300) });
    }
  });
  return { results, failures };
}

const observed = (result) =>
  result.observedAt ? Date.parse(result.observedAt) : Infinity;

// Decodes one input or a polled page, at most `concurrency` workers at a time, and
// returns the results oldest observation first. Receipt-timed results keep their
// input order after the source-timed ones.
async function decodeBatch(code, inputs, profile, { concurrency = 2 } = {}) {
  const outcomes = new Array(inputs.length);
  let next = 0;
  async function work() {
    while (next < inputs.length) {
      const index = next++;
      let decoded;
      try {
        decoded = await decode(code, inputs[index]);
      } catch (error) {
        outcomes[index] = {
          failures: [
            { reason: "decode_failed", error: String(error.message).slice(0, 300) },
          ],
        };
        continue;
      }
      try {
        const { results, failures } = validateResults(decoded, profile);
        outcomes[index] = {
          results,
          failures: failures.map((f) => ({ ...f, reason: "validation_failed" })),
        };
      } catch (error) {
        outcomes[index] = {
          failures: [
            {
              reason: "validation_failed",
              error: String(error.message).slice(0, 300),
            },
          ],
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, work),
  );
  const results = [];
  const failures = [];
  outcomes.forEach((outcome, input) => {
    for (const result of outcome.results || []) results.push({ ...result, input });
    for (const failure of outcome.failures) failures.push({ ...failure, input });
  });
  results.sort((a, b) => observed(a) - observed(b) || a.input - b.input);
  return { results, failures };
}
module.exports = {
  decode,
  decodeBatch,
  inputFromMessage,
  validateOutput,
  validateResults,
};
