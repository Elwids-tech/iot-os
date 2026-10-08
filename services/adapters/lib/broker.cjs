const dns = require("node:dns");
const net = require("node:net");

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    net.isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(db8|0|2|10|20):/i.test(address) &&
    !/^2002:/i.test(address)
  );
}

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
