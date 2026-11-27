// One address check for every source that connects out of a tenant runtime (spec 038,
// research R10): public addresses, plus the private ranges the platform operator allows
// for an organization. A range can never open loopback, link-local or metadata
// addresses, nor the platform's own container networks, which are passed in.
const dns = require("node:dns");
const net = require("node:net");

// Never reachable, whatever ranges an organization is allowed.
const NEVER = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local, including the cloud metadata address
  "100.100.100.200/32", // a cloud metadata address outside link-local
  "224.0.0.0/3", // multicast and reserved
  "::/128",
  "::1/128",
  "fe80::/10",
  "fd00:ec2::254/128", // a cloud metadata address
  "ff00::/8",
];

class AddressNotAllowed extends Error {
  constructor(message = "The address is not allowed for this organization") {
    super(message);
    this.reason = "address_not_allowed";
  }
}

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

// An address as bytes; an IPv4-mapped IPv6 address becomes its IPv4 address.
function bytes(address) {
  const family = net.isIP(address);
  if (family === 4) return Uint8Array.from(address.split(".").map(Number));
  if (family !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return bytes(mapped[1]);
  const [head, tail = ""] = address.split("::");
  const groups = (part) => (part ? part.split(":") : []);
  const left = groups(head);
  const right = groups(tail);
  const words = address.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  const out = new Uint8Array(16);
  words.forEach((word, i) => {
    const value = parseInt(word, 16);
    out[i * 2] = value >> 8;
    out[i * 2 + 1] = value & 255;
  });
  return out;
}

function parseRange(range) {
  const [address, length] = String(range).split("/");
  const prefix = bytes(address);
  const bits = length === undefined ? prefix?.length * 8 : Number(length);
  if (!prefix || !Number.isInteger(bits) || bits < 0 || bits > prefix.length * 8)
    throw Error(`Not a network range: ${range}`);
  return { prefix, bits };
}

function inRange(address, range) {
  const value = bytes(address);
  const { prefix, bits } = typeof range === "string" ? parseRange(range) : range;
  if (!value || value.length !== prefix.length) return false;
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> i % 8;
    if ((value[i >> 3] & mask) !== (prefix[i >> 3] & mask)) return false;
  }
  return true;
}

function overlaps(a, b) {
  const x = parseRange(a);
  const y = parseRange(b);
  if (x.prefix.length !== y.prefix.length) return false;
  const bits = Math.min(x.bits, y.bits);
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> i % 8;
    if ((x.prefix[i >> 3] & mask) !== (y.prefix[i >> 3] & mask)) return false;
  }
  return true;
}

// The ranges an operator allows must stay clear of what is never reachable and of the
// platform's networks; refused here so a bad setting fails loudly, not quietly.
function checkRanges(ranges = [], platformRanges = []) {
  for (const range of ranges) {
    parseRange(range);
    for (const never of [...NEVER, ...platformRanges])
      if (overlaps(range, never))
        throw Error(`The range ${range} includes ${never}, which is never reachable`);
  }
  return ranges;
}

function allowedAddress(address, { privateRanges = [], platformRanges = [] } = {}) {
  if (!net.isIP(address)) return false;
  if ([...NEVER, ...platformRanges].some((range) => inRange(address, range))) return false;
  return publicAddress(address) || privateRanges.some((range) => inRange(address, range));
}

// Resolve a host and check every address it resolves to; connect only to the one
// returned, so a later DNS answer cannot swap in another. `allowPrivate` is the local
// development switch (IOT_ADAPTER_ALLOW_PRIVATE_BROKERS) that lets the stack reach
// its own simulators.
async function resolveAllowed(host, options = {}) {
  const name = host.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(name)
    ? [{ address: name, family: net.isIP(name) }]
    : await dns.promises.lookup(name, { all: true });
  if (!addresses.length) throw Error(`${host} does not resolve`);
  if (!options.allowPrivate && addresses.some((a) => !allowedAddress(a.address, options)))
    throw new AddressNotAllowed();
  return addresses.find((a) => a.family === 4) || addresses[0]; // IPv4 first: some clients cannot dial an IPv6 literal
}

module.exports = {
  AddressNotAllowed,
  NEVER,
  allowedAddress,
  checkRanges,
  inRange,
  publicAddress,
  resolveAllowed,
};
