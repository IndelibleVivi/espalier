# Security policy

[简体中文](SECURITY.zh-CN.md) · English

## Supported boundary

The current Espalier developer preview is designed for one trusted user on one local machine:

- the executable binds only to `127.0.0.1`, `::1`, or `localhost` and rejects other hosts;
- API requests validate loopback Host and same-origin boundaries;
- mutation and restore endpoints require JSON plus a per-process local token;
- runtime state is stored in the user application-data directory, not the repository;
- one Project has one writable canonical service.

This reduces accidental network exposure and browser-CSRF risk. It is not multi-principal authentication. HTTP actor fields are self-asserted and must not be treated as proof of identity.

## Unsupported deployments

Do not expose the current service through a LAN address, tailnet, tunnel, container ingress, reverse proxy, public hostname, or shared workstation account. Do not file-sync a writable SQLite database between hosts. A remote deployment needs a separate authenticated adapter that derives actor identity and effective capabilities server-side, plus transport security and an explicit operating model.

The current local token is available to the local Web client. It is a containment mechanism for the trusted local boundary, not a reusable API credential or remote bearer-auth design.

## Data handling

Default data paths are documented in [Getting started](docs/getting-started.md). Keep databases, WAL files, registries, raw logs, exports, and private handoffs out of Git. Use OS-level disk/account protection appropriate to the sensitivity of the enrolled project.

Portable exports contain accepted project history and current graph state. Treat them as potentially sensitive project data even though they do not include arbitrary repository files or full chats.

## Reporting a vulnerability

Do not open a public issue containing exploit details, secrets, private project data, or a database export. Use the repository's private GitHub Security Advisory reporting path once it is enabled. Until a public reporting channel is explicitly published, contact the repository owner through an already-established private channel.

Include the affected commit/version, local deployment shape, reproduction steps, expected/observed boundary, and the smallest redacted evidence needed to verify the issue.

## Security status

No production support window or security-release SLA is claimed during developer preview. A green test or CI run is engineering evidence, not a statement that an unsupported remote deployment is safe.
