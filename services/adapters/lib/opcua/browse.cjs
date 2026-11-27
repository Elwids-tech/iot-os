// Browsing a server: children a page at a time, what a point is, a name search in a
// branch, and equipment like a given one (spec 038, contracts/api.md, research R17).
const { AttributeIds, BrowseDirection, DataType, NodeClass, TimestampsToReturn } = require("node-opcua-client");
const { quality } = require("./quality.cjs");
const { HAS_PROPERTY, HIERARCHICAL, OBJECTS, batches, fromNodeId, kindOf, pathText, toNodeId } = require("./nodes.cjs");

const PAGE_SIZE = 200;
const SCAN_LIMIT = 20_000;
const NUMBERS = new Set([
  DataType.SByte, DataType.Byte, DataType.Int16, DataType.UInt16, DataType.Int32, DataType.UInt32,
  DataType.Int64, DataType.UInt64, DataType.Float, DataType.Double,
]);
const PROPERTIES = ["EURange", "EngineeringUnits", "EnumStrings", "EnumValues", "TrueState", "FalseState"];

function browseRequest(nodeId) {
  return {
    nodeId,
    browseDirection: BrowseDirection.Forward,
    referenceTypeId: HIERARCHICAL,
    includeSubtypes: true,
    nodeClassMask: NodeClass.Object | NodeClass.Variable,
    resultMask: 63,
  };
}

async function browsePage(session, requests, pageSize) {
  session.requestedMaxReferencesPerNode = pageSize;
  return session.browse(requests);
}

// Names of declared types, read once a session.
const typeNames = new WeakMap();
async function typeName(connection, references) {
  const cache = typeNames.get(connection.session) || new Map();
  typeNames.set(connection.session, cache);
  const missing = [...new Set(references.map((r) => r.typeDefinition?.toString()).filter((id) => id && !cache.has(id)))];
  for (const batch of batches(missing, connection.limits?.MaxNodesPerRead)) {
    const values = await connection.session.read(batch.map((nodeId) => ({ nodeId, attributeId: AttributeIds.DisplayName })));
    batch.forEach((id, i) => cache.set(id, values[i].value?.value?.text || null));
  }
  return (reference) => cache.get(reference.typeDefinition?.toString()) || null;
}

function isProperty(reference) {
  return reference.referenceTypeId.toString() === HAS_PROPERTY.toString();
}

/**
 * Children of a node (the Objects folder when `parent` is null), a page at a time.
 * Returns { items: [{ node_id, namespace_uri, name, display_name, kind, type, has_children }], cursor }.
 */
// Servers that ignore the page size (some answer every reference at once) are paged
// here: the rest waits for the session behind a local cursor.
const held = new WeakMap();
function hold(session, references) {
  const store = held.get(session) || new Map();
  held.set(session, store);
  const id = `local:${Math.random().toString(36).slice(2)}`;
  store.set(id, references);
  return id;
}

async function children(connection, parent = null, { cursor = null, pageSize = PAGE_SIZE } = {}) {
  const { session, namespaces } = connection;
  const size = Math.min(pageSize, PAGE_SIZE);
  let references;
  let next = null;
  if (cursor?.startsWith("local:")) {
    const rest = held.get(session)?.get(cursor);
    held.get(session)?.delete(cursor);
    if (!rest) return { items: [], cursor: null, problem: "The page has expired; start again" };
    references = rest;
  } else {
    let result;
    if (cursor) {
      [result] = await session.browseNext([Buffer.from(cursor, "base64")], false);
    } else {
      const nodeId = parent ? toNodeId(parent, namespaces) : OBJECTS;
      if (!nodeId) return { items: [], cursor: null, problem: "The node's namespace is not on this server" };
      [result] = await browsePage(session, [browseRequest(nodeId)], size);
    }
    if (!result.statusCode.isGood()) return { items: [], cursor: null, problem: result.statusCode.name };
    references = (result.references || []).filter((r) => !isProperty(r));
    if (result.continuationPoint?.length) next = Buffer.from(result.continuationPoint).toString("base64");
  }
  // The server's own cursor, carried behind any local pages.
  const serverNext = next || references.next || null;
  next = serverNext;
  if (references.length > size) {
    // The server sent more than a page; the rest is served from here, then its own cursor.
    const rest = references.slice(size);
    rest.next = serverNext;
    references = references.slice(0, size);
    next = hold(session, rest);
  }
  const type = await typeName(connection, references);
  const containers = references.filter((r) => r.nodeClass === NodeClass.Object);
  const childCounts = new Map();
  if (containers.length) {
    const peeks = await browsePage(session, containers.map((r) => browseRequest(r.nodeId)), 1);
    containers.forEach((r, i) => childCounts.set(r.nodeId.toString(), (peeks[i].references || []).some((x) => !isProperty(x))));
    await Promise.all(peeks.filter((p) => p.continuationPoint).map((p) => session.browseNext([p.continuationPoint], true).catch(() => {})));
  }
  return {
    items: references.map((r) => ({
      ...fromNodeId(r.nodeId, namespaces),
      name: r.browseName.name,
      display_name: r.displayName?.text || r.browseName.name,
      kind: kindOf(r),
      type: type(r),
      has_children: childCounts.get(r.nodeId.toString()) || false,
    })),
    cursor: next,
  };
}

function storableType(dataType, valueRank, states) {
  if (valueRank >= 0) return { type: null, why: "Lists of values are not stored as readings" };
  if (states) return { type: "state" };
  if (dataType === DataType.Boolean) return { type: "boolean" };
  if (NUMBERS.has(dataType)) return { type: "number" };
  if (dataType === DataType.String || dataType === DataType.LocalizedText) return { type: "text" };
  if (dataType === DataType.DateTime) return { type: null, why: "Dates are not stored as readings" };
  return { type: null, why: "This kind of value is not stored as a reading" };
}

function plain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)) return value[0] * 2 ** 32 + value[1]; // Int64 as [high, low]
  if (value?.text !== undefined) return value.text;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * What points are: value, data type, unit, range, state labels, status and quality,
 * source time, and whether it can be stored (or why not). Up to 200 points.
 */
async function read(connection, points) {
  const { session, namespaces, limits } = connection;
  const list = points.slice(0, PAGE_SIZE);
  const nodeIds = list.map((p) => toNodeId(p, namespaces));
  const known = nodeIds.map((id, i) => ({ id, i })).filter((x) => x.id);
  const attributes = [AttributeIds.Value, AttributeIds.DataType, AttributeIds.ValueRank, AttributeIds.AccessLevel];
  const requests = known.flatMap(({ id }) => attributes.map((attributeId) => ({ nodeId: id, attributeId })));
  const values = [];
  for (const batch of batches(requests, limits?.MaxNodesPerRead)) values.push(...(await session.read(batch, 0)));
  // Properties of every point: one browse, then one read of the ones that matter.
  const props = [];
  for (const batch of batches(known, limits?.MaxNodesPerBrowse)) {
    session.requestedMaxReferencesPerNode = 50;
    const results = await session.browse(batch.map(({ id }) => ({
      nodeId: id, browseDirection: BrowseDirection.Forward, referenceTypeId: HAS_PROPERTY, includeSubtypes: true,
      nodeClassMask: NodeClass.Variable, resultMask: 63,
    })));
    props.push(...results);
  }
  const wanted = [];
  props.forEach((result, k) => (result.references || []).forEach((r) => {
    if (PROPERTIES.includes(r.browseName.name)) wanted.push({ k, name: r.browseName.name, nodeId: r.nodeId });
  }));
  const propValues = [];
  for (const batch of batches(wanted, limits?.MaxNodesPerRead))
    propValues.push(...(await session.read(batch.map((w) => ({ nodeId: w.nodeId, attributeId: AttributeIds.Value })))));
  const byPoint = known.map(() => ({}));
  wanted.forEach((w, j) => (byPoint[w.k][w.name] = propValues[j].value?.value));

  const out = list.map((point) => ({ node_id: point.node_id, namespace_uri: point.namespace_uri, storable: false, not_storable: "The point was not found" }));
  known.forEach(({ i }, k) => {
    const [value, dataType, valueRank, access] = values.slice(k * 4, k * 4 + 4);
    if (!dataType.statusCode.isGood()) return;
    const p = byPoint[k];
    const enumStrings = p.EnumStrings?.map((t) => t.text) || p.EnumValues?.map((e) => e.displayName?.text);
    const booleanStates = p.TrueState || p.FalseState ? [p.FalseState?.text || "False", p.TrueState?.text || "True"] : null;
    const id = dataType.value.value;
    const dataTypeId = id?.namespace === 0 ? id.value : null;
    const { type, why } = storableType(dataTypeId, valueRank.value?.value ?? -1, enumStrings);
    const readable = (Number(access.value?.value) & 1) === 1;
    const q = quality(value.statusCode);
    out[i] = {
      node_id: list[i].node_id,
      namespace_uri: list[i].namespace_uri,
      value: q.quality === "bad" ? null : plain(value.value?.value),
      data_type: type,
      unit: p.EngineeringUnits?.displayName?.text || null,
      range: p.EURange ? [p.EURange.low, p.EURange.high] : null,
      states: type === "state" ? enumStrings : type === "boolean" ? booleanStates : null,
      status: q.code,
      quality: q.quality,
      reason: q.reason,
      source_time: value.sourceTimestamp ? value.sourceTimestamp.toISOString() : null,
      storable: Boolean(type) && readable,
      not_storable: !readable ? "The server does not let this point be read" : why || null,
    };
  });
  return out;
}

/**
 * Walk a branch breadth first, calling `visit(item, path)` for each node, stopping once
 * `limit` nodes have been seen. Returns { visited, truncated }.
 */
async function walk(connection, root, visit, { limit = SCAN_LIMIT } = {}) {
  const queue = [{ node: root, path: root?.path || [] }];
  let visited = 0;
  while (queue.length) {
    const { node, path } = queue.shift();
    let cursor = null;
    do {
      const page = await children(connection, node, { cursor });
      for (const item of page.items) {
        visited += 1;
        const itemPath = [...path, { namespace_uri: item.namespace_uri, name: item.name }];
        const deeper = visit(item, itemPath) !== false;
        if (deeper && item.kind !== "point" && item.has_children) queue.push({ node: item, path: itemPath });
        if (visited >= limit) return { visited, truncated: true };
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return { visited, truncated: false };
}

// A name search within a branch, stopping at 20,000 nodes with `truncated: true`.
async function search(connection, root, text, { limit = SCAN_LIMIT } = {}) {
  const needle = String(text).toLowerCase();
  const matches = [];
  const { visited, truncated } = await walk(connection, root, (item, path) => {
    if (item.name.toLowerCase().includes(needle) || item.display_name.toLowerCase().includes(needle))
      matches.push({ ...item, path, source_id: pathText(path) });
  }, { limit });
  return { matches, visited, truncated };
}

/**
 * Equipment like `equipment` ({ node_id, namespace_uri, path }) with the ticked points.
 *   by "type": objects of the same declared type; by "names": any object holding at
 *   least half of the points, named as `points[].name` (relative to the equipment);
 *   by "pattern": in a flat tag list, tags matching each point's `pattern`, where
 *   "{equipment}" stands for a tag prefix (equipment.path ends with the folder of the
 *   list and the prefix).
 * Returns [{ source_id, display_name, address: { node_id, namespace_uri, path }, missing }]
 * with `truncated` set when the scan stopped at its limit.
 */
async function similar(connection, equipment, points, { by = "type", root = null, limit = SCAN_LIMIT } = {}) {
  if (by === "pattern") return similarTags(connection, equipment, points, limit);
  const wantedType = by === "type" ? await declaredType(connection, equipment) : null;
  if (by === "type" && !wantedType) return Object.assign([], { truncated: false });
  const candidates = [];
  const { truncated } = await walk(connection, root, (item, path) => {
    if (item.kind === "object" && (by === "names" || item.type === wantedType)) candidates.push({ item, path });
  }, { limit });
  const found = [];
  for (const { item, path } of candidates) {
    const page = await children(connection, item);
    const present = new Set(page.items.filter((c) => c.kind === "point").map((c) => c.name));
    const has = points.filter((p) => present.has(p.name)).length;
    if (by === "names" && has < Math.max(1, Math.ceil(points.length / 2))) continue;
    found.push({
      source_id: pathText(path),
      display_name: item.display_name,
      address: { node_id: item.node_id, namespace_uri: item.namespace_uri, path },
      missing: points.filter((p) => !present.has(p.name)).map((p) => p.key),
    });
  }
  return Object.assign(found, { truncated });
}

function patternRegex(pattern) {
  if (!pattern || !pattern.includes("{equipment}")) throw Error('A tag pattern needs "{equipment}" in it');
  const [before, after] = pattern.split("{equipment}").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${before}(.+?)${after}$`);
}

async function similarTags(connection, equipment, points, limit) {
  const folderPath = equipment.path.slice(0, -1);
  const folder = await nodeAt(connection, folderPath);
  const rules = points.map((p) => ({ key: p.key, regex: patternRegex(p.pattern) }));
  const prefixes = new Map(); // tag prefix -> keys present
  let cursor = null;
  let seen = 0;
  do {
    const page = await children(connection, folder, { cursor });
    for (const item of page.items) {
      for (const rule of rules) {
        const match = rule.regex.exec(item.name);
        if (!match) continue;
        if (!prefixes.has(match[1])) prefixes.set(match[1], new Set());
        prefixes.get(match[1]).add(rule.key);
      }
      if (++seen >= limit) break;
    }
    cursor = seen >= limit ? null : page.cursor;
  } while (cursor);
  const found = [...prefixes.entries()].map(([prefix, present]) => {
    const path = [...folderPath, { namespace_uri: equipment.namespace_uri, name: prefix }];
    return {
      source_id: pathText(path),
      display_name: prefix,
      address: { node_id: null, namespace_uri: equipment.namespace_uri, path },
      missing: points.filter((p) => !present.has(p.key)).map((p) => p.key),
    };
  });
  return Object.assign(found, { truncated: seen >= limit });
}

// The display name of an object's declared type.
async function declaredType(connection, equipment) {
  const node = toNodeId(equipment, connection.namespaces) || (await nodeAt(connection, equipment.path))?.nodeId;
  if (!node) return null;
  connection.session.requestedMaxReferencesPerNode = 1;
  const [result] = await connection.session.browse([{
    nodeId: node, browseDirection: BrowseDirection.Forward, referenceTypeId: "HasTypeDefinition",
    includeSubtypes: false, nodeClassMask: 0, resultMask: 63,
  }]);
  const type = result.references?.[0]?.nodeId;
  if (!type) return null;
  const [name] = await connection.session.read([{ nodeId: type, attributeId: AttributeIds.DisplayName }]);
  return name.value?.value?.text || null;
}

// The node at a path of names from the Objects folder, as an address.
async function nodeAt(connection, path) {
  if (!path.length) return null;
  const { translate } = require("./resolve.cjs");
  const [nodeId] = await translate(connection, [{ start: null, path }]);
  return nodeId ? { ...fromNodeId(nodeId, connection.namespaces), path, nodeId } : null;
}

module.exports = { PAGE_SIZE, SCAN_LIMIT, children, read, search, similar, walk };
