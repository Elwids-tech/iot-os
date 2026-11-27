// A small checker for contracts/adapters/v1, shared by the contract tests and the
// OPC UA route tests: closed objects, so every key a producer emits must be declared
// and every required key present.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIRECTORY = path.resolve(__dirname, "../../../contracts/adapters/v1");
const ID_BASE = "https://iot-os.local/contracts/adapters/v1/";

const documents = new Map();
function document(stem) {
  if (!documents.has(stem)) {
    documents.set(stem, JSON.parse(fs.readFileSync(path.join(DIRECTORY, `${stem}.schema.json`), "utf8")));
  }
  return documents.get(stem);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIRECTORY, name), "utf8"));
const contract = (stem) => ({
  schema: document(stem),
  fixture: read(`${stem}.fixture.json`),
  cases: read(`${stem}.cases.json`),
});
const caseData = (stem, description) => {
  const found = contract(stem).cases.find((c) => c.description === description);
  assert.ok(found, `${stem} has no case "${description}"`);
  return found.data;
};

// A small recursive checker, not a general validator: $ref, type, const, enum,
// required, properties, patternProperties, additionalProperties, items, the size
// limits, pattern, allOf, oneOf, anyOf, not and if/then/else. Formats are limited
// to uuid and date-time. It returns the problems it finds.
const jsonType = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isType = (v, t) => (t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" : jsonType(v) === t);
const FORMATS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
};

function follow(ref, ctx) {
  const [file, fragment = ""] = ref.split("#");
  const doc = file ? document(path.basename(file, ".schema.json")) : ctx.doc;
  let node = doc;
  for (const part of fragment.split("/").filter(Boolean)) node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  return { schema: node, ctx: { doc } };
}

function conform(schema, value, ctx, at = "") {
  if (schema.$ref) {
    const target = follow(schema.$ref, ctx);
    return conform(target.schema, value, target.ctx, at);
  }
  const problems = [];
  const fail = (message) => problems.push(`${at || "/"}: ${message}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (schema.type && ![].concat(schema.type).some((t) => isType(value, t))) return [`${at || "/"}: expected ${[].concat(schema.type).join("|")}, got ${jsonType(value)}`];
  if ("const" in schema && !same(schema.const, value)) fail(`not the constant ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) fail("not one of the allowed values");
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail("too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
    if (FORMATS[schema.format] && !FORMATS[schema.format].test(value)) fail(`not a ${schema.format}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...conform(schema.items, item, ctx, `${at}/${i}`)));
  }
  if (jsonType(value) === "object") {
    const keys = Object.keys(value);
    for (const name of schema.required || []) if (!(name in value)) fail(`missing required ${name}`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail(`more than ${schema.maxProperties} properties`);
    for (const key of keys) {
      const own = schema.properties && key in schema.properties;
      const patterns = Object.entries(schema.patternProperties || {}).filter(([pattern]) => new RegExp(pattern).test(key));
      if (own) problems.push(...conform(schema.properties[key], value[key], ctx, `${at}/${key}`));
      for (const [, sub] of patterns) problems.push(...conform(sub, value[key], ctx, `${at}/${key}`));
      if (!own && !patterns.length) {
        if (schema.additionalProperties === false) fail(`undeclared key ${key}`);
        else if (schema.additionalProperties) problems.push(...conform(schema.additionalProperties, value[key], ctx, `${at}/${key}`));
      }
    }
  }
  for (const sub of schema.allOf || []) problems.push(...conform(sub, value, ctx, at));
  if (schema.anyOf && !schema.anyOf.some((sub) => !conform(sub, value, ctx, at).length)) fail("matches none of anyOf");
  if (schema.oneOf) {
    const matching = schema.oneOf.filter((sub) => !conform(sub, value, ctx, at).length).length;
    if (matching !== 1) {
      const closest = schema.oneOf.map((sub) => conform(sub, value, ctx, at)).sort((a, b) => a.length - b.length)[0];
      fail(`matches ${matching} of oneOf; closest: ${closest.slice(0, 3).join("; ")}`);
    }
  }
  if (schema.not && !conform(schema.not, value, ctx, at).length) fail("matches a `not` schema");
  if (schema.if) {
    const branch = !conform(schema.if, value, ctx, at).length ? schema.then : schema.else;
    if (branch) problems.push(...conform(branch, value, ctx, at));
  }
  return problems;
}

const check = (stem, value) => {
  const { schema } = contract(stem);
  return conform(schema, value, { doc: schema });
};
const assertConforms = (stem, value) => assert.deepEqual(check(stem, value), [], `${stem}`);

module.exports = { DIRECTORY, assertConforms, caseData, check, contract, document };
