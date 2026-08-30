# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

Espalier is still a developer preview. Read the [product guide](docs/product-guide.md), [public status](docs/status.md), and repository-local [`AGENTS.md`](AGENTS.md) before proposing source changes.

## Before contributing

- Keep the project repository authoritative for code, schema, tests, Git, and formal documents.
- Do not add canonical entities, commands, or authority semantics for renderer convenience.
- Keep geometry, camera, locale, density, and personal layout outside canonical project state.
- Do not weaken loopback, stale-write, Claim, owner-policy, Decision, budget, export/restore, or migration checks to make a demo easier.
- Do not include private project data, raw exports, local paths, credentials, private handoffs, or screenshots from non-public projects.
- Configure Git to use a GitHub-provided noreply email before committing. The public CI accepts contributor names but rejects personal, workplace, and machine-local commit email addresses.
- Do not bypass `strict-allow-scripts`, use `--force`/`--legacy-peer-deps`, or broaden `allowScripts` to make an update install. Review and pin every dependency script authorization.
- Update both English and Chinese user-facing documentation when the supported public contract changes.

## Local gate

```bash
npm ci
npm run check
npm run test:coverage
npm run smoke:process
npx playwright install chromium
npm run smoke:browser
npm run smoke:managed-service
npm run stress:scale-replay
```

Use Node.js 24.0.0 or newer and npm 11.19.1 or newer; CI installs the repository-pinned npm 11.19.1. Run the narrow relevant test while implementing, then the complete gate appropriate to the affected contract. `smoke:browser` installs no browser by itself, so install its pinned Chromium once after `npm ci`. Rendered Web changes additionally need real browser inspection at desktop and mobile widths, meaningful DOM, console health, target-flow interaction, keyboard/accessibility evidence, and non-color semantic review.

## Change shape

Prefer one bounded semantic outcome per change. When replacing behavior, update the canonical path and remove the superseded path/callers/tests/docs in the same change unless an evidenced compatibility boundary requires temporary retention.

Commit messages use concise English imperative mood. Stage explicit paths and inspect the staged diff; never use a catch-all stage that can collect local continuity or runtime data.

## Contribution and license terms

Before submitting a contribution, read the repository's exact [licensing map](LICENSING.md). You must have the right to contribute the material and must not include private project data or third-party material under incompatible terms.

You retain copyright in your contribution. By submitting it for inclusion, you agree that an accepted contribution is distributed under the license applicable to its destination path: `SUL-1.0` for functional source and `CC BY-NC-SA 4.0` for covered documentation. This is not a copyright assignment. If you cannot provide the contribution under that applicable license, do not submit it; open a redacted issue for discussion instead.
