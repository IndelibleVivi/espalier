# Third-party notices

The clean source tree does not commit `node_modules`, generated Web bundles, or font binaries. `npm ci` retrieves third-party packages under their own licenses; those licenses are not replaced by Espalier's project-original license map.

The direct dependency set recorded by the first public source release includes:

| Packages | License |
| --- | --- |
| `@fontsource/cormorant-garamond`, `@fontsource/ibm-plex-mono`, `@fontsource/inter` | SIL Open Font License 1.1 (`OFL-1.1`) |
| `d3-selection`, `d3-zoom` | ISC |
| `typescript` | Apache License 2.0 |
| `@eslint/js`, `@types/d3-selection`, `@types/d3-zoom`, `@types/node`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `@vitest/coverage-v8`, `dependency-cruiser`, `eslint`, `react`, `react-dom`, `tsx`, `typescript-eslint`, `vite`, `vitest` | MIT |

Exact resolved versions and transitive packages are recorded in `package-lock.json`. Installed packages carry their complete license and notice files under `node_modules`; distributable builds must preserve every notice required by their resolved dependency set. This file is an inventory aid, not a substitute for those terms.
