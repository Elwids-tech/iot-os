const crypto = require("node:crypto");
module.exports = {
  uiPort: 1880,
  disableEditor: true,
  nodesDir: process.env.IOT_ADAPTER_NODES_DIR || "/opt/iot-adapter/nodes",
  credentialSecret: process.env.IOT_NODE_RED_CREDENTIAL_SECRET,
  functionExternalModules: false,
  diagnostics: { enabled: false },
  runtimeState: { enabled: false },
  editorTheme: { projects: { enabled: false } },
  httpAdminMiddleware(req, res, next) {
    const expected = Buffer.from(
      "Bearer " + process.env.IOT_NODE_RED_ADMIN_TOKEN,
    );
    const received = Buffer.from(req.headers.authorization || "");
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    )
      return res.status(401).end();
    next();
  },
  logging: { console: { level: "warn", metrics: false, audit: false } },
};
