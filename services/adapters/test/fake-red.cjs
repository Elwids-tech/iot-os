// A fake Node-RED: it records the node types the adapter module registers.
module.exports = function nodes() {
  const types = {};
  const RED = {
    nodes: {
      createNode(node, config) {
        node.handlers = {};
        node.sent = [];
        node.send = (message) => node.sent.push(message);
        node.receive = (message) => node.handlers.input?.(message, () => {}, () => {});
        node.credentials = config.credentials_for_test || {};
        node.on = (event, handler) => (node.handlers[event] = handler);
        node.status = () => {};
        node.warn = () => {};
      },
      registerType(name, constructor) {
        types[name] = constructor;
      },
    },
  };
  require("../nodes/adapter.js")(RED);
  return types;
};
