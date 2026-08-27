# Espalier repository contract

## Product and source authority

- `packages/protocol/src/index.ts` owns protocol names, canonical entities, command envelopes, receipts, and revision vocabulary.
- `packages/core/src/` is the only canonical mutation path. Clients, adapters, renderers, projections, and scripts must not write SQLite tables directly.
- `packages/context-compiler/src/` owns deterministic bounded brief selection. Do not add a hidden model dependency.
- `packages/projections/src/` owns renderer-neutral Human Surface, Live/Focus/Decisions/Atlas/Portfolio, accepted-event replay, scale summaries, Relation bundles, and semantic fixtures.
- `apps/web/src/` is the canonical replaceable local live Canvas renderer. It reads public projection/client contracts only; it must not add project-specific imports, infer semantic state from geometry, or translate source-authored Project content when UI locale changes.
- `skills/espalier/SKILL.md` is the canonical installable agent behavior contract. Do not hot-edit an installed user-level copy.
- Project repositories remain authoritative for their code, schema, tests, Git history, and formal documents. Espalier stores coordination state and provenance refs, not duplicate source truth.

## Hard boundaries

- Semantic state is canonical; geometry and personal Web view state are not.
- Owner-approved goals, programme order, binding constraints, trust boundaries, and binding owner actions change only through exact owner-authorized commands.
- Evidence attachment does not imply Work verification, integration, owner acceptance, rights clearance, or publication approval.
- Ordinary `work.create` starts with no Evidence and isolated integration. Lifecycle changes use their canonical commands.
- Commands fail closed on stale revisions, mismatched idempotent envelopes, stable-ID collisions, Claim conflicts, insufficient context/response budgets, or missing authority.
- One Project has one writable canonical service. Do not sync writable SQLite databases between hosts.
- Runtime databases, WAL files, enrollment registries, logs, exports, and private handoffs stay in the user application-data directory and out of Git.
- Human Surface commands are derived from complete Core preflight payloads. Renderers must not invent missing values or present incomplete templates as executable.
- Canvas / Map projections share one stable identity space. Geometry, theme, camera, density, locale, collapse, and layout remain `PersonalViewState`.
- UI locale changes renderer chrome. Source-authored project content remains in its original language.
- Brainstorming, routine shell/tool activity, token usage, transcripts, and repeated progress do not become canonical events without a deliberate durable promotion boundary.

## Runtime boundary

- Default service: `127.0.0.1:4317`.
- Default macOS data: `~/Library/Application Support/Espalier/`.
- Default Linux data: `${XDG_DATA_HOME:-~/.local/share}/espalier/`.
- Supported overrides: `ESPALIER_DATA_DIR`, `ESPALIER_DATABASE`, `ESPALIER_HOST`, and `ESPALIER_PORT`.
- The executable rejects non-loopback binding. Host/Origin checks, JSON-only writes, and the local mutation token provide localhost containment, not multi-principal authentication.
- Remote or mutually untrusted-principal access requires a separate authenticated adapter that derives identity and effective capabilities server-side.

## Verification

Use the narrow relevant test during implementation, then run the blast-radius-appropriate gate:

```bash
npm run check
npm run test:coverage
npm run smoke:process
npm run stress:scale-replay
```

Rendered Web changes additionally require a real browser pass: page identity, meaningful DOM, no framework overlay, console health, target-flow interaction, desktop/mobile behavior, keyboard/accessibility evidence, and non-color semantic review.

## Documentation and publication

- Update `README.md` and `README.zh-CN.md` when supported setup, user-visible behavior, security/privacy boundaries, or limitations change.
- Update `docs/status.md` and `docs/zh-CN/status.md` when candidate/live/open-gate facts change.
- Keep English and Chinese user guides semantically equivalent without mechanically translating canonical names.
- Before a release or visibility change, run `npm run check:public-ready` plus an independent privacy, secret, rights, and staged-diff review on the exact commit that would be published.
- Never stage or publish private continuity, private project fixtures/evidence, local paths, databases, raw exports, logs, or screenshots from non-public projects.
