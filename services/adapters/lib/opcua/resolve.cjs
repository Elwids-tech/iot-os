// Finding a point map's nodes on a server: the stored node id when it still names the
// same node, otherwise the path of names through TranslateBrowsePathsToNodeIds
// (spec 038, research R7). Namespaces are URIs; indexes are looked up per session.
const { AttributeIds } = require("node-opcua-client");
const { OBJECTS, batches, relativePath, toNodeId } = require("./nodes.cjs");

/**
 * Translate paths of names. Each request is { start: NodeId | null (Objects folder),
 * path: [{ namespace_uri, name }] }. Returns a NodeId or null for each.
 */
async function translate(connection, requests) {
  const { session, namespaces, limits } = connection;
  const out = [];
  for (const batch of batches(requests, limits?.MaxNodesPerTranslateBrowsePathsToNodeIds)) {
    const results = await session.translateBrowsePath(
      batch.map((r) => ({ startingNode: r.start || OBJECTS, relativePath: relativePath(r.path, namespaces) })),
    );
    for (const result of results)
      out.push(result.statusCode.isGood() && result.targets?.length ? result.targets[0].targetId : null);
  }
  return out;
}

// Stored node ids that still name a node with the expected browse name.
async function confirm(connection, items) {
  const { session, namespaces, limits } = connection;
  const nodeIds = items.map((item) => toNodeId(item.address, namespaces));
  const asked = nodeIds.map((id, i) => ({ id, i })).filter((x) => x.id);
  const names = new Array(items.length).fill(null);
  for (const batch of batches(asked, limits?.MaxNodesPerRead)) {
    const values = await session.read(batch.map(({ id }) => ({ nodeId: id, attributeId: AttributeIds.BrowseName })));
    batch.forEach(({ i }, k) => {
      if (values[k].statusCode.isGood()) names[i] = values[k].value.value?.name ?? null;
    });
  }
  return items.map((item, i) => (names[i] !== null && names[i] === item.expect ? nodeIds[i] : null));
}

// The equipment of a map: node id first, path second. Flat equipment has no node of
// its own (its path ends with a tag prefix), so it resolves to its folder.
async function resolveEquipment(connection, equipment) {
  const items = equipment.map((e) => ({ address: e.address, expect: e.address.path?.at(-1)?.name }));
  const confirmed = await confirm(connection, items.map((item, i) => (equipment[i].address.node_id ? item : { address: null })));
  const missing = confirmed.map((id, i) => ({ id, i })).filter((x) => !x.id);
  const translated = await translate(connection, missing.map(({ i }) => ({ start: null, path: equipment[i].address.path || [] })));
  missing.forEach(({ i }, k) => (confirmed[i] = translated[k]));
  return confirmed;
}

/**
 * Resolve every point of a map.
 * Returns [{ source_id, node, points: { key: NodeId | null }, problems: [{ key, problem }] }].
 */
async function resolveMap(connection, map) {
  const flat = map.readings.some((r) => r.address?.relative_path?.some((s) => s.pattern));
  const equipmentNodes = flat ? map.equipment.map(() => null) : await resolveEquipment(connection, map.equipment);
  const requests = [];
  const overrides = [];
  const result = map.equipment.map((equipment, e) => {
    const entry = { source_id: equipment.source_id, node: equipmentNodes[e], points: {}, problems: [] };
    if (!flat && !entry.node) entry.problems.push({ key: null, problem: "The equipment was not found on the server" });
    for (const reading of map.readings) {
      if ((equipment.missing || []).includes(reading.key)) continue;
      entry.points[reading.key] = null;
      const override = equipment.overrides?.[reading.key];
      if (override) {
        overrides.push({ e, key: reading.key, address: override });
        continue;
      }
      const segments = reading.address.relative_path;
      if (flat) {
        const folder = (equipment.address.path || []).slice(0, -1);
        const prefix = equipment.address.path?.at(-1)?.name;
        const tags = segments.map((s) => ({ namespace_uri: s.namespace_uri || equipment.address.namespace_uri, name: (s.pattern || s.name).replace("{equipment}", prefix) }));
        requests.push({ e, key: reading.key, start: null, path: [...folder, ...tags] });
      } else if (entry.node) {
        requests.push({ e, key: reading.key, start: entry.node, path: segments });
      }
    }
    return entry;
  });
  const translated = await translate(connection, requests);
  requests.forEach((r, k) => (result[r.e].points[r.key] = translated[k]));
  if (overrides.length) {
    const nodes = await confirm(connection, overrides.map((o) => ({ address: o.address, expect: o.address.path?.at(-1)?.name ?? null })));
    const unconfirmed = overrides.map((o, k) => ({ o, k })).filter(({ o, k }) => !nodes[k] && o.address.path?.length);
    const viaPath = await translate(connection, unconfirmed.map(({ o }) => ({ start: null, path: o.address.path })));
    unconfirmed.forEach(({ k }, j) => (nodes[k] = viaPath[j]));
    // An override without a path is trusted on its node id alone once it reads.
    for (const [k, o] of overrides.entries()) {
      if (!nodes[k] && !o.address.path?.length) {
        const id = toNodeId(o.address, connection.namespaces);
        if (id) {
          const [value] = await connection.session.read([{ nodeId: id, attributeId: AttributeIds.NodeClass }]);
          if (value.statusCode.isGood()) nodes[k] = id;
        }
      }
      result[o.e].points[o.key] = nodes[k];
    }
  }
  for (const entry of result)
    for (const [key, node] of Object.entries(entry.points))
      if (!node) entry.problems.push({ key, problem: "The point was not found on this equipment" });
  return result;
}

module.exports = { resolveEquipment, resolveMap, translate };
