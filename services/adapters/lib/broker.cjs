const dns = require("node:dns");
const net = require("node:net");
// The shared address check (spec 038, research R10).
const { publicAddress } = require("./opcua/address.cjs");

function brokerUrl(url, allowPrivate = false) {
  const parsed = new URL(url.replace(/^ssl:/, "mqtts:"));
  if (
    !["mqtt:", "mqtts:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw Error("Use a plain MQTT broker URL without embedded credentials");
  }
  // HTTP URL normalization also handles decimal, octal and hexadecimal IPv4 hosts.
  const host = new URL("http://" + parsed.host).hostname.replace(
    /^\[|\]$/g,
    "",
  );
  if (!allowPrivate && net.isIP(host) && !publicAddress(host))
    throw Error("Vendor broker must be publicly reachable");
  return parsed.toString();
}

function secureLookup(host, options, callback) {
  dns.lookup(host, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      return callback(Error("Vendor broker must be publicly reachable"));
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}
module.exports = { publicAddress, brokerUrl, secureLookup };
