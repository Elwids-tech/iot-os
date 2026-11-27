// Node addresses as the point map stores them: a node id written without its
// namespace index ("s=L03-VAV-2", "i=2258") plus the namespace URI, because indexes can
// change when a server restarts (spec 038, research R7).
const { NodeClass, NodeId, resolveNodeId } = require("node-opcua-client");

const OBJECTS = resolveNodeId("ObjectsFolder");
const HIERARCHICAL = resolveNodeId("HierarchicalReferences");
const HAS_PROPERTY = resolveNodeId("HasProperty");
const FOLDER_TYPE = 61; // FolderType in the standard namespace
const STANDARD = "http://opcfoundation.org/UA/";

// A node id from an address, or null when its namespace is not on this server.
function toNodeId(address, namespaces) {
  if (!address) return null;
  const index = namespaces.indexOf(address.namespace_uri || STANDARD);
  if (index < 0) return null;
  try {
    return resolveNodeId(`ns=${index};${address.node_id}`);
  } catch {
    return null;
  }
}

function fromNodeId(nodeId, namespaces) {
  const id = nodeId instanceof NodeId ? nodeId : resolveNodeId(nodeId);
  const text = id.toString().replace(/^ns=\d+;/, "");
  return { node_id: text, namespace_uri: namespaces[id.namespace] ?? null };
}

function sameNode(a, b) {
  return a && b && a.node_id === b.node_id && a.namespace_uri === b.namespace_uri;
}

// A browse path of names, as the map stores it, as the server's relative path.
function relativePath(segments, namespaces) {
  return {
    elements: segments.map((segment) => {
      const index = namespaces.indexOf(segment.namespace_uri || STANDARD);
      return {
        referenceTypeId: HIERARCHICAL,
        isInverse: false,
        includeSubtypes: true,
        targetName: { namespaceIndex: index < 0 ? 0xffff : index, name: segment.name },
      };
    }),
  };
}

// The path a person reads: names joined with "/".
function pathText(segments) {
  return segments.map((s) => s.name).join("/");
}

function kindOf(reference) {
  if (reference.nodeClass === NodeClass.Variable) return "point";
  const type = reference.typeDefinition;
  if (type && type.namespace === 0 && type.value === FOLDER_TYPE) return "folder";
  return "object";
}

// Split a list into batches no larger than the server's limit for an operation.
function batches(items, limit, fallback = 1000) {
  const size = Math.max(1, Math.min(limit || fallback, fallback));
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

module.exports = {
  HAS_PROPERTY,
  HIERARCHICAL,
  OBJECTS,
  STANDARD,
  batches,
  fromNodeId,
  kindOf,
  pathText,
  relativePath,
  sameNode,
  toNodeId,
};
