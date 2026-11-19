# LightTable — Core Animation Workspace

**Status:** Functional alpha implementation; automated core/plugin/schema suites pass, but production/browser/hardware certification remains outstanding.  
**Audience:** Lead implementer, core application developers, SDK/plugin developers, QA  
**Scope:** React/TypeScript/Vite host, canonical document model, drawing/animation workflow, persistence, rendering, export, optional Coloring Mode integration and Plugin SDK.  
**Product rule:** Built-in drawing, animation, onion skin, persistence and baseline print/export are host capabilities. Coloring Mode remains an optional first-party plugin.

## Run locally

Requirements: Node.js 20+, npm, Python 3, and the Python packages in `tests/requirements.txt`.

```sh
npm install
python3 -m pip install -r tests/requirements.txt
npm run dev
```

The Vite development server listens on `http://localhost:5173`. For a production build, run `npm run build` and serve the generated `dist/` directory over HTTPS (or localhost during development). The Coloring Mode package is compiled before the host is started or built.

**Windows note:** run `npm install` from this project root before starting the app. The Coloring Mode build invokes the project-local TypeScript JavaScript CLI through Node, rather than trying to execute the Windows `tsc.cmd` shim directly. If the build reports that TypeScript is not installed, restore the project development dependencies with `npm install --include=dev`.

Useful verification commands:

```sh
npm run check                 # all offline type/runtime/schema suites
npm run test:host             # host document, history, input, render, ZIP and export checks
npm run test:coloring         # Coloring Mode algorithm/mock-host integration suite
npm run test:coloring:controller
npm run test:schemas
```

The checked-in package was verified in an environment without the root React/Vite dependency tree or a reachable npm registry. The dependency installation and Vite production bundle therefore still need to be run in a normal Node/npm environment; see `IMPLEMENTATION_REPORT.md` for the exact verification boundary.

## Product at a glance

LightTable is a minimalist, offline-first digital light table for traditional 2D rough animation. The host ships with pencil/graphite/non-photo-blue drawing, eraser, frame-by-frame editing, playback, basic onion skin, four cel layers, local recovery and A4/PNG export. The default workspace is intentionally simpler than the underlying extensible timeline model.

## Start here — new team members

This package is designed to onboard a developer who may have no prior context. Read in this order:

1. [`KICKSTART.md`](./KICKSTART.md) — product vision, target user, intended end result, first-release scope and architecture explained in plain language.
2. [`READ_FIRST.md`](./READ_FIRST.md) — product-owner decisions, built-in feature ownership, coloring-plugin relationship, revised implementation sequence and lead-developer deliverables.
3. [`docs/01-architecture-overview.md`](docs/01-architecture-overview.md) — reconciled system boundaries and architecture principles.
4. [`docs/02-document-model.md`](docs/02-document-model.md) — normative document, timeline, cel and layer model.
5. [`docs/03-rendering-contracts.md`](docs/03-rendering-contracts.md) — rendering, composition, overlays and export contracts.
6. [`docs/04-plugin-sdk.md`](docs/04-plugin-sdk.md) and [`docs/05-plugin-runtime-security.md`](docs/05-plugin-runtime-security.md) — plugin APIs, lifecycle and security boundaries.
7. [`docs/06-implementation-plan-and-acceptance.md`](docs/06-implementation-plan-and-acceptance.md) — revised delivery stages and acceptance criteria.
8. [`contracts/`](contracts/), [`schemas/`](schemas/), [`examples/`](examples/) and [`tests/`](tests/) — machine-readable contracts, examples and validation checks.
9. [`PLUGIN_DEVELOPER_WORK_ORDER.md`](./PLUGIN_DEVELOPER_WORK_ORDER.md) — separate optional Coloring Mode plugin assignment.

**Implementation note:** The original ZIP was an architecture and SDK-contract handoff, not an existing application. The host implementation lives alongside these contracts in `src/`; the contracts remain the normative public integration surface.

## Normative language

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** are used as requirements:

- **MUST / MUST NOT:** Required for conformance.
- **SHOULD / SHOULD NOT:** Expected unless a documented reason justifies a deviation.
- **MAY:** Optional capability.

The contract declarations and schemas are normative. Runtime enforcement lives in `src/core/`; the examples remain illustrative. Keep public SDK types, runtime validation, manifest schemas and documentation consistent.

## Important baseline constraints

- React + TypeScript + Vite remain the host application stack.
- The host owns the document, canvas lifecycle, viewport transform, timeline clock, persistence and central undo/redo history.
- Plugins contribute behavior through public APIs; they do not import private host modules.
- Timeline tracks and cel layers are distinct concepts.
- A timeline tick is a playback frame; an exposure maps a time range to a cel.
- A project can be opened and preserved when optional plugins are missing.
- Unknown plugin data and unknown node payloads must be preserved during import/save round-trips.
- Installed plugins must work offline after installation.
- Plugin API version, project schema version and plugin-owned data schema version are independent version axes.
- SDK v1 may ship with the `trusted-ui` execution profile only; `worker` manifests must be rejected until a separately specified worker RPC contract exists.
- In-process JavaScript plugins are trusted code, not security sandboxes. Permission declarations are capability/consent controls, not protection from malicious same-origin code.

## Package contents

```text
lighttable-architecture/
├── README.md
├── IMPLEMENTATION_REPORT.md
├── index.html / package.json / vite.config.ts
├── src/
│   ├── app/                # React workspace and responsive controls
│   └── core/               # document, history, input, rendering, storage, export and SDK
├── public/                 # PWA manifest, service worker and favicon
├── plugins/coloring-mode/  # optional first-party plugin source and compiled ESM
├── docs/
│   ├── 01-architecture-overview.md
│   ├── 02-document-model.md
│   ├── 03-rendering-contracts.md
│   ├── 04-plugin-sdk.md
│   ├── 05-plugin-runtime-security.md
│   └── 06-implementation-plan-and-acceptance.md
├── contracts/
│   ├── document-model.d.ts
│   └── plugin-api.d.ts
├── schemas/
│   ├── project.schema.json
│   ├── package-manifest.schema.json
│   ├── project-json-bundle.schema.json
│   └── plugin-manifest.schema.json
├── tests/
│   ├── run-host-tests.mjs
│   ├── validate-schemas.py
│   ├── sdk-readonly.contract.ts
│   └── requirements.txt
└── examples/
    ├── plugin.manifest.example.json
    ├── package.manifest.example.json
    ├── project-json-bundle.example.json
    ├── project.example.json
    ├── example-tool.ts
    └── coloring-mode-reference.md
```

## Parallel plugin-development handoff

For assigning a separate developer to build the first Coloring Mode plugin without waiting for the host runtime, see [`PLUGIN_DEVELOPER_WORK_ORDER.md`](./PLUGIN_DEVELOPER_WORK_ORDER.md). The `sdk-contract-package/` directory is a local, declarations-only `@lighttable/plugin-sdk` package for compiling that plugin independently. It is a contract artifact, not a runtime implementation or a published SDK release.

## Release boundary and known gaps

This handoff delivers the application source tree and an integrated first-party Coloring Mode bundle, intended to run after the documented dependencies are installed; it is not a certified commercial release. The optional plugin can be explicitly enabled/disabled from the workspace. A general third-party ZIP installer, plugin dependency resolver/update rollback UI, schema migration framework beyond project v1 validation, lasso/transform, advanced multi-track editing, browser automation, and physical-device validation are not part of this implementation. Plugins execute as trusted same-origin code; capability checks are not a sandbox. Fit-to-A4 export is supported; calibrated 1:1 printing is not claimed.

The exact implementation scope, test results and remaining acceptance work are documented in [`IMPLEMENTATION_REPORT.md`](./IMPLEMENTATION_REPORT.md).


## Running the host application

Run `npm install` once, then `npm run dev`. The optional Coloring Mode plugin does not need to be compiled for the host to start or pass the default host checks; its prebuilt bundle is loaded only when explicitly enabled in Workspace Settings. To rebuild plugin source, run `npm run build:coloring` as a separate task. Its separate test suite is `npm run test:plugins`.

The timeline panel has a track selector along its left edge. Use **+ Add track** to create a new independent animation track in the current project. Use the project menu's **New animation** action to create a separate animation project.
