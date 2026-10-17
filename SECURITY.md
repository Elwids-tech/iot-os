# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub:
[Security → Report a vulnerability](https://github.com/Elwids-tech/iot-os/security/advisories/new).
Don't open a public issue, pull request or discussion for a vulnerability.

Include:

- the affected component (portal, admin, API, runtime, adapters, release tooling);
- the commit or release you tested;
- steps to reproduce, and what an attacker gains.

We reply in the advisory, keep you updated there while we fix it, and credit you
when we publish it unless you ask us not to.

## Supported versions

Only the latest commit on `main` is supported. Fixes land on `main` and ship in the
next release; we don't backport.

## Testing

Test against your own stack (see the [quickstart](README.md#quickstart-about-10-minutes)).
Don't probe installations you don't operate: they hold other people's data.

Out of scope:

- deployments run by other operators;
- attacks that need physical access to a device or gateway;
- social engineering;
- denial of service by traffic volume.
