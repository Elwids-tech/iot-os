const { test } = require("node:test");
const assert = require("node:assert/strict");
const { brokerUrl, publicAddress } = require("../lib/broker.cjs");

test("literal and normalized private broker addresses cannot bypass DNS validation", () => {
  for (const host of [
    "127.0.0.1",
    "2130706433",
    "10.0.0.2",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[fc00::1]",
  ]) {
    assert.throws(() => brokerUrl("mqtt://" + host), /publicly reachable/);
    assert.doesNotThrow(() => brokerUrl("mqtt://" + host, true));
  }
  assert.equal(publicAddress("8.8.8.8"), true);
});

test("broker credentials and URL extras are kept out of connection URLs", () => {
  for (const url of [
    "http://example.com",
    "mqtt://user:pass@example.com",
    "mqtt://example.com/topic",
    "mqtt://example.com?secret=x",
  ])
    assert.throws(() => brokerUrl(url));
  assert.equal(brokerUrl("ssl://example.com:8883"), "mqtts://example.com:8883");
});
