# Getting started

[简体中文](zh-CN/getting-started.md) · English

This guide takes a technically capable first-time user from a source checkout to one enrolled repository, one explicit Work item, and one clean handoff. It does not assume that the Web surface is the product's authority or that every project needs Espalier.

## 1. Install and start the local service

Requirements: Node.js 24.0.0+, npm 11.19.1+ (the repository pins npm 11.19.1), macOS or Linux.

```bash
git clone https://github.com/IndelibleVivi/espalier.git
cd espalier
npm ci
npm run build
npm run seed
npm run service:start
npm run service:status
```

`service:start` runs the canonical service as an inspectable detached local process. Closing the terminal does not stop it. Its PID, status record, and logs live under the provider-neutral application-data directory, never in the repository. It does not install a login item or promise automatic restart after reboot.

The default endpoint is <http://127.0.0.1:4317/>. Open it to inspect the neutral Orchard Project in the canonical live Canvas. `seed` is explicit and synthetic; it does not import a real repository. `service:status` reports the managed-process record (`schema_version: 1` is the service-record format); `espalier doctor --compact` reports the service contract and should contain `health.ok: true`, `health.schema_version: 4`, and `health.protocol_version: "0.2"`.

Use these commands for the ordinary lifecycle:

```bash
npm run service:status
npm run service:restart
npm run service:stop
```

For foreground debugging, use `npm run dev:server` instead. Do not run a foreground and managed service on the same port.

## 2. Install the Codex harness

From the Espalier checkout:

```bash
npm run install:codex -- --dry-run
npm run install:codex
```

This source-linked developer installer does two coordinated things: it links the `espalier` CLI and installs the canonical Skill under the current Codex home. It preserves the previous Skill copy in a local backup and writes a digest manifest. The launcher resolves the installed source tree independently of the caller repository's TypeScript path aliases. Open a fresh Codex task after installation so Skill discovery reloads.

Verify the CLI before enrolling real work:

```bash
espalier --help
espalier doctor --compact
```

An unenrolled `doctor` may still report the healthy service with `enrollment: null`. That is expected; service availability and project enrollment are separate facts.

## 3. Enroll a repository

Choose a repository whose long-running coordination state is worth preserving. From any directory:

```bash
espalier link /path/to/orchard \
  --project orchard \
  --name "Orchard" \
  --purpose "Ship the approved programme without losing owner decisions" \
  --principal owner-name
```

If the Project does not exist, `link --purpose` creates only a thin explicit seed:

- one Project and owner policy;
- one approved Goal revision;
- one active initial Epoch.

It does not inspect or import Git history, invent Work, copy project documents, or mark anything complete. Enrollment is kept in the user application-data registry rather than a repo marker.

Now enter the enrolled repository and verify the mapping:

```bash
cd /path/to/orchard
espalier doctor --compact
espalier join --budget 900 --compact
```

Reload <http://127.0.0.1:4317/> to read the enrolled Project in the same Canvas. The app auto-selects the sole Project owned by a service; if the service owns several, open `http://127.0.0.1:4317/?project=orchard`. `EN / 中文` changes interface vocabulary only, not Project-authored titles or scope text.

## 4. Create the first explicit Work item

The initial Epoch id created by `link` is `epoch-1`. An owner or in-scope worker can create one bounded Work item through the canonical command path:

```bash
espalier emit --json '{
  "type": "work.create",
  "payload": {
    "id": "public-onboarding",
    "epoch_id": "epoch-1",
    "kind": "task",
    "title": "Make first-project onboarding truthful",
    "scope": "Verify the public setup and agent handoff path",
    "semantic_surfaces": ["docs:onboarding"],
    "repo_surfaces": ["README.md", "docs/"],
    "authority_state": "within_scope",
    "goal_integrity": "advances"
  }
}'
```

`emit` wraps the partial command with the current project revision and runtime identity. A stale or invalid command is rejected; it is not silently merged.

Read and claim that exact Work before publishing versioned semantic changes:

```bash
espalier brief public-onboarding --budget 1400
espalier claim public-onboarding --lease 900
```

Claiming is about semantic write coordination. It does not reserve Git files or replace normal branch/worktree discipline.

## 5. Publish only durable evidence

Do the repository work normally. Reads, edits, shell commands, model activity, and repeated progress reports do not become Espalier events.

After a meaningful observed boundary—for example, the exact public onboarding test passed—attach evidence with a stable provenance reference:

```bash
espalier emit --json '{
  "type": "evidence.attach",
  "payload": {
    "id": "public-onboarding-test",
    "target_refs": ["esp:orchard/work/public-onboarding"],
    "kind": "test",
    "origin": "observed",
    "ref": "command:npm-test@git-commit",
    "summary": "The documented first-project path passed in an isolated data directory",
    "verification_state": "verified"
  }
}'
```

Evidence says what was observed. It does not automatically change Work verification, integration, owner acceptance, legal clearance, or publication authority.

## 6. Hand off and leave the semantic surface cleanly

If another session must resume:

```bash
espalier handoff public-onboarding \
  --state "Setup and first Work path are verified" \
  --next "Run the same path from a fresh session" \
  --completed "service lifecycle,CLI onboarding" \
  --evidence "esp:orchard/evidence/public-onboarding-test" \
  --narrative "Do not treat the synthetic Web fixture as imported project truth"

espalier release public-onboarding
```

The next session starts with `doctor`, `join`, and the exact Work brief. It should not need the previous full chat.

## Data and reset boundaries

Default runtime locations:

- macOS: `~/Library/Application Support/Espalier/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/espalier/`

Supported overrides are `ESPALIER_DATA_DIR`, `ESPALIER_DATABASE`, `ESPALIER_HOST`, and `ESPALIER_PORT`. The executable refuses non-loopback hosts.

Do not delete a database to “reset” a real enrolled project. Export, backup, restore, migration, and intentional retirement are separate semantic/operational actions. For disposable experiments, set `ESPALIER_DATA_DIR` to an isolated temporary directory before starting the service.

## Troubleshooting

- **`espalier: command not found`:** run `npm run install:codex -- --dry-run`, then install; check that npm's global bin is on `PATH`.
- **Service healthy but no enrollment:** run `espalier link`; do not create a `.espalier` marker by hand.
- **Enrollment exists but Project is absent:** the registry points at a service/database that does not own that Project. Correct the enrollment or service; do not copy a writable database between hosts.
- **Port is already served by an unmanaged process:** `service:start` refuses to adopt or kill it. Inspect the process explicitly or choose an isolated port.
- **Capability mismatch:** update the installed harness from the matching repository source. Do not suppress fail-closed negotiation.
- **Claim conflict or stale revision:** refresh the exact Work, split scope, hand off, or ask the owner/coordinator. Do not retry as last-write-wins.
