# 4. Plugin SDK and Public API

## 4.1 SDK purpose

The Plugin SDK is the only supported integration surface for third-party and first-party plugins. It must be independently versioned, documented and published as a package such as `@lighttable/plugin-sdk`.

A plugin developer must not need to import private LightTable source files, internal React components, Zustand/Redux stores, internal canvas refs or undocumented services.

The SDK should provide:

- manifest and plugin entry-point types;
- plugin lifecycle and disposable registration;
- document read and transaction APIs;
- timeline query/mutation APIs;
- tool and mode registration;
- panel, toolbar and settings extension points;
- event subscriptions;
- command and shortcut registration;
- node renderer and editor overlay registration;
- asset and namespaced plugin storage APIs;
- frame render/export access;
- diagnostics and logging.

The initial TypeScript draft is in [`../contracts/plugin-api.d.ts`](../contracts/plugin-api.d.ts). Treat it as the starting contract and reconcile it with the implementation before shipping SDK v1.

## 4.2 Plugin package shape

A plugin package contains at minimum:

```text
my-plugin.zip
├── manifest.json
├── dist/
│   ├── index.js
│   ├── chunks/                 # optional relative ESM chunks
│   └── styles.css              # optional
├── assets/                     # optional plugin-owned static assets
└── README.md                   # optional documentation
```

The package manager must reject path traversal, duplicate normalized paths, unsupported executable formats and packages that exceed configured size limits.

The host should support bundled ESM. React and the LightTable SDK must be peer/external dependencies resolved to the host's single React instance and SDK runtime. Do not bundle a second React copy into a trusted UI plugin.

## 4.3 Manifest

Use a versioned JSON manifest. The example is in `examples/plugin.manifest.example.json`.

Required fields:

- `manifestVersion`;
- reverse-DNS `id`;
- `name`, `version`, `description`, `author`;
- `apiVersionRange`;
- `hostVersionRange`;
- `entry` module path;
- `execution` profile;
- `contributes` declarations;
- `permissions` list;
- `dependencies` list.

Optional fields include icon, homepage, license, keywords, integrity/signature metadata, localization, settings schema and worker entry.

The host must validate the manifest before downloading/loading executable code. Plugin ID is immutable after publication/installation; a plugin changing ID is treated as a different plugin.

## 4.4 Plugin entry point and lifecycle

A plugin exports a single default object implementing `LightTablePlugin`. The package `manifest.json` is authoritative for identity, version, compatibility, permissions and contributions. The in-module `plugin.manifest` is a minimal runtime identity assertion (`id`, `version`, `apiVersionRange`) that the loader must compare to the package manifest before activation:

```ts
const plugin: LightTablePlugin = {
  manifest,
  activate(api) {
    // Register features and keep returned disposables.
  },
  deactivate(reason) {
    // Stop timers/workers, cancel gestures, release resources.
  }
};
export default plugin;
```

Lifecycle requirements:

- `activate()` is called only after validation and dependency resolution.
- Registrations made during activation are staged; they become visible only if activation completes successfully.
- If activation fails, all staged registrations are rolled back.
- `deactivate()` is idempotent and must release listeners, subscriptions, workers, timers, object URLs, overlays and transient previews.
- The host forcibly disposes all registered handles if a plugin fails to clean up.
- A plugin must not assume activation occurs only once during the lifetime of the browser tab.
- Re-enable must either re-activate cleanly or ask for a page reload if the runtime cannot safely reinitialize a module.

Every registration method returns a `Disposable` or `RegistrationHandle`. Plugins should collect handles in a `DisposableStore` and dispose them on deactivation. Contribution IDs are local to a plugin; the runtime registry key is the pair `(pluginId, contributionId)`, preventing collisions without requiring plugin authors to repeat their reverse-DNS ID in every tool or panel ID.

## 4.5 Permissions and capabilities

The host must enforce capabilities at the API boundary. The following mapping is normative for SDK v1:

| Operation | Required permission |
|---|---|
| Read project/document metadata, tracks, clips, cels, layers, nodes and extensions | `document.read` |
| Commit node/layer/cel/track metadata or extension changes | `document.write` |
| Read playhead, playback state, frame rate and exposure resolution | `timeline.read` |
| Insert/update/move/delete clips or reorder timeline tracks | `timeline.write` and `document.write` |
| Receive normalized canvas pointer samples or start a tool gesture | `canvas.input` |
| Register node renderers/overlays or call render service | `canvas.render` |
| Read or change ephemeral selection | `selection.read` / `selection.write` respectively |
| Register panels, toolbar entries, menus or modes | `ui.panels`, `ui.toolbar` or `ui.modes` as applicable |
| Register undoable commands that mutate the document | `history.commands` and the relevant document/timeline write permission |
| Register importers/exporters | `project.import` / `project.export` |
| Read or write binary assets | `assets.read` / `assets.write` |
| Read/write plugin preferences and plugin settings | `storage.plugin` |
| Make outbound network requests through a host broker | `network` plus an approved manifest origin |

The host may apply a stricter permission policy, but MUST NOT silently allow an operation that lacks its required capability. Registration itself is checked; permissions are also checked again when an operation executes. A plugin may request only permissions declared in its package manifest. A plugin's code must not infer permission from the visibility of a button or panel.


The host must show a clear, plain-language explanation for sensitive permissions during installation or first activation. `network` should be denied by default, and its allowlist must be enforced by a host network broker for APIs the host controls. A trusted in-process plugin can still use ambient browser networking directly; the manifest allowlist is not a sandbox. This is why arbitrary untrusted marketplace code must not run as `trusted-ui`.

**Security qualification:** in-process browser JavaScript has access to the same origin's ambient capabilities. Permission checks are an API policy/consent layer; they do not sandbox malicious code. Do not claim otherwise in UI or documentation. Strong isolation requires worker/iframe execution and a narrow message bridge.

## 4.6 Document API

Plugins receive readonly document snapshots and query methods. They do not receive mutable internal stores.

Read API should support:

- current project/document metadata;
- current revision;
- lookup by project/track/clip/cel/layer/node ID;
- read-only selectors for timeline resolution at a tick;
- read access to plugin extension data;
- read-only asset descriptors.

Write API is transaction-only. A transaction supports adding/updating/removing nodes, adding/updating/removing layers, changing clip placement/duration, creating/deleting cels, setting plugin extension data and referencing assets.

A transaction must validate atomically, be associated with one plugin ID and produce one central history entry. It must not allow direct mutable object references to escape.

## 4.7 Timeline API

Expose stable selectors and semantic operations:

- `resolveTick(tick)` returns the resolved clip/cel per track.
- `getExposureAt(trackId, tick)` returns the exposure covering that tick, if any.
- `getCel(celId)` returns readonly cel data.
- `getCurrentTick()` and playhead/playback events are read-only state queries.
- mutation methods use transactions and make collision/ripple/linking semantics explicit.

Plugins may query neighboring ticks for onion-skin or temporal workflows. `getNeighborTicks()` returns available ticks in ascending chronological order, excludes the requested tick and clamps at the start/end of the document. The host should not require plugins to manually search every clip array.

## 4.8 Tool API

The host owns the built-in pencil, graphite/non-photo-blue presets and eraser. These may share internal abstractions with SDK tools but are not registered through the external plugin lifecycle and remain available when every plugin is disabled.



Tools are registered by stable ID and can expose icon, label, tooltip, shortcut, settings panel and activation/deactivation callbacks.

The host owns pointer listeners and dispatch. Plugins receive immutable normalized pointer samples, not raw DOM PointerEvents. A tool can request an interaction session and transient preview. On completion, `ToolGesture.commit()` performs exactly one atomic host transaction and creates exactly one undo entry. It is the transaction boundary for that gesture: the handler MUST NOT also call `DocumentApi.transact()` for the same completed gesture. `DocumentApi.transact()` remains available for non-gesture commands and operations. Cancellation discards preview and releases pointer capture through the host.

A tool must support `cancel(reason)` for pointercancel, lost capture, mode change, plugin disable, project close and app suspension. The tool context must expose the current active edit target (tick, track, clip, cel and layer) so the tool does not inspect private workspace state.

Do not put `setPointerCapture()` responsibility in every plugin. The Input Service owns pointer capture and provides a handle/session interface.

## 4.9 Mode API

A mode is a registered workspace profile. In SDK v1, its `toolIds` and `panelIds` refer to contributions registered by the same plugin. A mode may contribute:

- tools;
- panels;
- toolbar items;
- contextual settings;
- keyboard shortcuts;
- overlay renderers;
- optional timeline extension UI;
- activation/deactivation hooks.

The host controls the overall workspace shell and panel docking. A mode may request which registered panels/tools are visible, but it may not destroy core navigation or change the canonical document schema without registering a supported node/data type. The SDK also exposes an ephemeral selection API (`getSelection`, `setSelection`, `clear`, `onChanged`) so lasso/transform plugins can select node references without storing selection state in the project. Selection references are validated against the current document revision; deleted/moved nodes are removed or reconciled by the host.

Switching modes must not close the project, reset the playhead, lose unsaved edits or destroy another plugin's stored data.

Coloring Mode is the reference optional first-party mode plugin. It owns the palette, fill bucket, color picker, region detection, gap closing, coloring-specific panels and coloring node payloads. The host provides the main canvas, pointer routing, document, timeline, core path rendering, render service, assets and transaction/history services. The plugin does not make the core animation workflow optional or take ownership of host services.

## 4.10 UI extension API

Use controlled extension points, not arbitrary insertion into private component trees.

Initial extension points:

- `toolbar.top`;
- `toolbar.left`;
- `dock.right`;
- `timeline.footer`;
- `menu.project`;
- `menu.context`;
- `settings.plugins`;
- `workspace.modeSelector` (populated automatically from mode registrations).

The SDK contract includes `api.menus.register()` for `menu.project` and `menu.context` items. Mode selector entries are not manually inserted; registering a mode adds it to the host-owned selector. Settings pages are generated from `api.settings.register()` and rendered by the host settings shell.

A panel registration has a unique ID, title, icon, preferred dock slot, min size, default visibility and React component. The panel host handles mounting/unmounting, collapse, drag/dock, safe areas and responsive layout.

For trusted UI plugins, React is a peer dependency and must resolve to the host React runtime. The host should expose a supported extension root/portal API so a plugin can render a component without importing the internal workspace tree.

Do not let plugin CSS globally style host selectors. Require CSS modules, namespaced selectors or shadow-root isolation for styles.

## 4.11 Event API

The event bus is typed, namespaced and disposable. Core event names and payloads are declared in `LightTableEventMap` in the SDK contract. Event payloads are immutable snapshots or IDs plus query methods; avoid emitting mutable document objects.

Core event families:

- `project.opened`, `project.closing`, `project.saved`, `project.closed`;
- `document.changed`, `document.revisionChanged`;
- `track.created`, `track.updated`, `track.deleted`;
- `clip.created`, `clip.updated`, `clip.deleted`;
- `cel.created`, `cel.updated`, `cel.deleted`;
- `layer.created`, `layer.updated`, `layer.deleted`;
- `node.created`, `node.updated`, `node.deleted`;
- `playback.started`, `playback.stopped`, `playback.tick`;
- `selection.changed`, `playhead.changed`;
- `mode.activated`, `mode.deactivated`;
- `plugin.activated`, `plugin.deactivated`, `plugin.error`.

Events are notifications, not mutation requests. To change the document, use the transaction API. Avoid a synchronous event subscriber mutating state while a transaction is committing.

## 4.12 Commands and keyboard shortcuts

A plugin can register named commands. A command has an ID, title, optional enabled/visible predicate, handler and optional shortcut. Commands are invoked from buttons, menus, command palette, shortcuts or another authorized plugin.

Document-affecting command handlers must use transactions. Shortcuts must be collision-checked. The host owns global shortcuts (save, undo/redo, playback, frame stepping) and exposes a conflict policy; a plugin cannot silently shadow a core shortcut.

## 4.13 Importer and exporter registrations

Plugins may register importers and exporters through `api.importers.register()` and `api.exporters.register()`.

- An importer receives a user-selected `File`, returns a canonical project JSON value plus binary asset records, and never writes directly to the active project. The host validates the result and asks the user whether to open it as a new project or merge it where supported.
- An exporter receives a revision-pinned, read-only `ExportDocumentSnapshot`, a render service bound to the same immutable snapshot, an abort signal and a progress callback. The export surface exposes no transaction/write methods. It returns a `Blob`, filename and MIME type.
- Exporters must use `renderFrames()`/`renderCel()` and must not read the active canvas element or screenshot the application UI.
- Importers/exporters must support cancellation and report meaningful errors. Large transformations should use a worker where practical.
- Project-package import/export remains a core responsibility because it is needed to preserve the complete canonical project, including unknown plugin data.

## 4.14 Plugin-owned settings and storage

Separate three kinds of data:

1. **Project extension data:** travels with a project and affects its content/rendering.
2. **Plugin preferences:** local installation/user preference, not part of the project (e.g. palette panel width).
3. **Ephemeral runtime state:** current drag, hover, selection preview, cache; never persisted as project content.

Plugin preference storage is namespaced by plugin ID and subject to quotas. The host should offer typed settings definitions for UI generation and validation. Sensitive data such as credentials should not be stored as ordinary project extension data.

## 4.15 Renderer gates and read-only preparation

`api.renderers.registerNodeRenderGate(nodeType, gate)` registers a disposable, plugin-scoped gate for a node type that the same plugin owns. The gate has synchronous `setVisible(boolean)` and `setRenderingEnabled(boolean)` methods. Both flags must be true for the coordinator to prepare or render that node family. The coordinator checks gates before preparation and before rendering for editor, thumbnail, export and onion intents. A gate never affects other plugins, core path/outline renderers or render scheduling. Gate changes are ephemeral renderer state, not document transactions.

`NodePrepareContext.assets` is `AssetReadApi` (descriptor lookup and blob reads only). Writable `AssetApi.put()` remains available to authorized plugin tools/commands, not renderer preparation.

## 4.16 SDK versioning and support policy

- Package the SDK separately, e.g. `@lighttable/plugin-sdk`.
- Use semantic versioning.
- `1.x` may add backward-compatible optional APIs but must not silently break existing signatures/semantics.
- Breaking changes require a new major API version and migration guide.
- Plugins declare an API semver range and host-version range.
- Plugins must use capability feature detection for optional APIs rather than inspect host internals.
- The host maintains a compatibility test suite against at least the latest SDK major and supported previous minor releases.
- A plugin's own data schema version is independent from SDK version.

## 4.17 Developer experience and sample plugins

Before production tools are written, implement three small contract-validation plugins in separate folders/packages:

1. **Example Tool:** receives normalized pointer input, displays a preview overlay and commits a generic node in one transaction.
2. **Example Mode:** registers one tool, one panel, one shortcut and mode lifecycle callbacks; switching away and back must preserve document state.
3. **Example Exporter:** iterates deterministic rendered ticks and produces a simple test output; it must not read the active canvas DOM node.

The sample plugins should be built separately from the host to prove the SDK boundary is real. At least one should be installed from a ZIP package through the plugin manager implementation.
