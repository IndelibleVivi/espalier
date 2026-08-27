# Licensing map

Espalier uses a deliberate mixed-license model. This map governs the **clean public source tree** produced for `IndelibleVivi/espalier`; it does not grant public rights to private incubator history or to files excluded by the public-source exporter.

## Functional source — SUL-1.0

Project-original functional material is made available under the [Sustainable Use License v1.0](LICENSE), SPDX identifier `SUL-1.0`. This is a **source-available license with use and distribution restrictions**, not an OSI-approved open-source license.

This scope includes:

- `apps/`, `packages/`, `bin/`, and `scripts/`;
- `skills/`, including the installable Espalier agent behavior contract;
- `.github/` workflows and dependency configuration;
- build, test, lint, TypeScript, dependency-boundary, package-manifest, and lock files; and
- source-like examples or fixtures outside `docs/` unless an individual file says otherwise.

## Documentation — CC BY-NC-SA 4.0

Project-original reader- and contributor-facing documentation is licensed under [`CC BY-NC-SA 4.0`](LICENSE-DOCUMENTATION.md). This scope includes:

- `README.md` and translations;
- `CONTRIBUTING.md`, `SECURITY.md`, and translations;
- `AGENTS.md`, `PUBLIC_SOURCE.md`, and Markdown files under `docs/`; and
- original diagrams or independent documentation assets if they are added to the public tree and do not carry a different notice.

## Exclusions and third-party material

- The license texts and notices themselves remain governed by their issuers and applicable law.
- Dependencies installed by the package manager keep their own licenses. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); no dependency is relicensed by this repository.
- Product names, project identity, logos, and trademarks are not licensed except as applicable law requires.
- Private continuity, dogfood adapters and snapshots, non-public project data, experimental design evidence, and the private incubator's Git history are excluded from the clean public tree and from this public license map.
- A license applies only to material the relevant rights holder has authority to license. An individual file's explicit notice overrides this path map for that file.

## Contributions

Contributors retain copyright in their work. Accepted contributions are provided under the same license that applies to the destination path: `SUL-1.0` for functional source and `CC BY-NC-SA 4.0` for covered documentation. No copyright assignment is implied. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution gate.
