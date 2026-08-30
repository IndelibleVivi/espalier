/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular-package-dependencies",
      severity: "error",
      comment: "The Espalier package graph must remain acyclic.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable-imports",
      severity: "error",
      comment: "Every production and test import must resolve from the locked graph.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "protocol-has-no-upward-dependencies",
      severity: "error",
      comment: "Protocol owns the lowest canonical vocabulary layer.",
      from: { path: "^packages/protocol/" },
      to: { path: "^(?:packages|apps)/", pathNot: "^packages/protocol/" },
    },
    {
      name: "sqlite-only-through-store",
      severity: "error",
      comment: "Production SQLite access belongs only to the canonical Store.",
      from: { path: "^(?:packages|apps|local-dogfood)/", pathNot: "(?:packages/core/src/store[.]ts|[.](?:test|spec)[.]tsx?$)" },
      to: { path: "^(?:node:)?sqlite$", dependencyTypes: ["core"] },
    },
    {
      name: "formal-code-does-not-depend-on-local-dogfood",
      severity: "error",
      comment: "Private project dogfood may consume formal contracts, but formal apps and packages never depend on it.",
      from: { path: "^(?:packages|apps)/" },
      to: { path: "^local-dogfood/" },
    },
    {
      name: "web-cannot-import-canonical-writer-or-node",
      severity: "error",
      comment: "The Web is a client projection and never a canonical writer or Node runtime.",
      from: { path: "^apps/web/src/" },
      to: { path: ["^packages/core/", "^node:"] },
    },
    {
      name: "deterministic-packages-do-not-depend-on-runtime-apps",
      severity: "error",
      comment: "Context Compiler and projections cannot depend on Server or Web runtime layers.",
      from: { path: "^packages/(?:context-compiler|projections)/" },
      to: { path: "^apps/(?:server|web)/" },
    },
    {
      name: "context-compiler-has-no-external-or-node-runtime-dependency",
      severity: "error",
      comment: "Context selection stays deterministic and has no hidden model, network, or host dependency.",
      from: { path: "^packages/context-compiler/src/", pathNot: "[.](?:test|spec)[.]tsx?$" },
      to: { dependencyTypes: ["core", "npm", "npm-dev", "npm-no-pkg", "npm-optional", "npm-peer", "npm-unknown"] },
    },
    {
      name: "no-relative-cross-workspace-imports",
      severity: "error",
      comment: "Production and ordinary tests cross workspace boundaries only through declared package exports.",
      from: { path: "^(packages|apps)/([^/]+)/", pathNot: "^apps/cli/src/cli[.]test[.]ts$" },
      to: {
        path: "^(?:packages|apps)/",
        pathNot: "^$1/$2/",
        dependencyTypes: ["local"],
        dependencyTypesNot: ["aliased", "aliased-tsconfig", "aliased-tsconfig-base-url", "aliased-tsconfig-paths", "aliased-workspace"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["types", "import", "node", "default"] },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
