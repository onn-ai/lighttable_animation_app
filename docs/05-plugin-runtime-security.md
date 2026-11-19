# 5. Plugin Runtime, Packaging, Lifecycle and Security

## 5.1 Runtime profiles

The plugin runtime must distinguish UI-capable plugins from processing plugins. Do not imply that a single JavaScript loading mechanism provides a security sandbox. For SDK v1, ship `trusted-ui` only. The v1 public type and manifest schema reject `worker` outright until a separately reviewed worker RPC protocol has been implemented and tested. A future schema may add the worker profile; a current host MUST NOT silently load it as trusted UI. The `LightTablePlugin` in-process activation contract is not a worker protocol. Worker support can be added as a compatible runtime capability after its message protocol and tests are complete.

### Profile A — `trusted-ui`

Use for plugins that contribute React UI, tools, modes, commands and in-process canvas renderers.

- Runs as same-origin JavaScript in the application realm.
- Can use the public SDK and host React runtime.
- Can register React panels and tool handlers.
- May receive a Canvas 2D context through the renderer API.
- Must declare permissions and follow host API checks.
- Must be treated as trusted executable code with privileges comparable to the host page.

This is appropriate for first-party plugins and manually installed plugins the user explicitly trusts. It is not safe for arbitrary untrusted marketplace code merely because a manifest lists permissions.

### Deferred profile B — `worker`

Not implemented in SDK v1. The following is a future design target only:

- Runs in a dedicated Worker where possible.
- Receives structured-clone-safe requests and immutable input data.
- Returns validated JSON, typed arrays, OffscreenCanvas output or ImageBitmap according to a documented protocol.
- Cannot directly register React UI or access the main document store.
- Requests document changes as validated operations for the host to commit.
- Uses termination and message timeouts for cancellation/failure containment.

A worker plugin cannot receive a live host `CanvasRenderingContext2D`; it must return a renderable result or precomputed asset. The host validates messages and owns final compositing.

### Deferred profile C — `sandboxed-ui` (future)

A sandboxed iframe may be used for third-party UI that needs DOM rendering but must be isolated from the host origin. This requires a carefully designed `postMessage` RPC bridge, strict origin/source checks, schema validation and a capability protocol. It is not required for SDK v1, but the architecture should not make it impossible.

## 5.2 Security model and honest limitations

A browser module imported into the application's same-origin realm can generally access ambient page capabilities. TypeScript interfaces, manifest permissions and API wrappers do not prevent that code from reaching `window`, `document`, storage or network APIs if the runtime allows it.

Therefore:

- The plugin manager must clearly distinguish trusted plugins from sandboxed plugins.
- Permission dialogs are user-consent and API-policy controls for trusted plugins, not a security sandbox.
- The host should default to least privilege and avoid granting network permission by default.
- Plugins from an eventual public repository should have provenance/integrity metadata and a review/signing process, but signatures establish publisher/integrity, not harmlessness.
- A worker/iframe boundary and narrow message bridge are required for stronger isolation.
- The host must never execute plugin source while merely parsing a package or previewing its manifest.

## 5.3 Local plugin installation and offline module loading

The PWA must support installing a plugin from a local ZIP and using it offline after installation.

Recommended implementation approach for the browser PWA:

1. User selects a plugin ZIP.
2. The installer reads and validates the archive without executing code.
3. It normalizes every path and rejects traversal, absolute paths, duplicate normalized paths and unsupported symlinks.
4. It validates `manifest.json`, declared entry point, version compatibility, dependencies and requested permissions.
5. It enforces compressed/uncompressed package-size limits and file-count limits.
6. It computes file/package hashes and stores extracted files under a versioned virtual path.
7. It commits plugin installation metadata only after all files have been stored and validated.
8. Plugin activation dynamically imports its entry point from a same-origin virtual URL.

A practical offline loading design is a Service Worker route for versioned plugin URLs backed by Cache Storage or IndexedDB. Example URL:

`/__lighttable_plugins__/<encoded-plugin-id>/<version>/<file-path>`

The service worker serves the installed file bytes from the plugin package store. Relative ESM imports then resolve under the same versioned path. The URL must include plugin version or package hash so updates do not reuse stale module URLs. The host must retain the previous version until the new version has installed and passed validation, enabling rollback.

The exact storage implementation may vary, but the developer must prove that:

- ESM entry points and relative chunks load offline;
- the app shell and plugin files are cached independently from user projects;
- disabling/uninstalling a plugin does not remove project data;
- updating a plugin cannot leave a mixed set of old/new chunks;
- the service worker does not cache unbounded project/export blobs.

Do not use `eval()` or `new Function()` as a plugin loader. Do not execute source text read from a ZIP through an ad-hoc evaluator.

## 5.4 Plugin manifest baseline

See `examples/plugin.manifest.example.json`. Key fields:

```json
{
  "manifestVersion": 1,
  "id": "com.example.sample-tool",
  "name": "Sample Tool",
  "version": "1.0.0",
  "apiVersionRange": "^1.0.0",
  "hostVersionRange": ">=1.0.0 <2.0.0",
  "execution": "trusted-ui",
  "entry": "dist/index.js",
  "permissions": ["document.read", "document.write", "canvas.input", "canvas.render"],
  "dependencies": [],
  "contributes": { "tools": ["sample-tool"] }
}
```

The final manifest schema must be machine validated. Unknown required manifest fields should cause a compatibility error; unknown optional metadata fields should be ignored/preserved as appropriate.

Plugin IDs use reverse-DNS syntax, for example `org.example.plugin-name`. IDs are case-normalized and immutable. Versions use semver.

## 5.5 Dependency resolution

- Dependencies declare plugin ID, semver range and `optional` flag.
- Resolve dependencies before activation.
- Reject dependency cycles with a readable diagnostic.
- Activate dependencies before dependents; deactivate dependents before dependencies.
- An optional missing dependency must not prevent activation if the plugin supports degraded operation.
- A required missing/incompatible dependency blocks activation but does not block project opening.
- The host must not silently install a dependency from a network source. Installation requires explicit user action or an explicit trusted managed-install policy.
- A plugin should communicate with other plugins via declared SDK service contracts/events, not import another plugin's private source modules.

## 5.6 Activation transaction and registry

Registrations should be staged during `activate()`:

1. Create an activation context and disposable scope.
2. Check requested permissions/capabilities.
3. Import entry module.
4. Call `activate(api)`.
5. Validate all registrations for duplicate IDs, invalid references and incompatible contributions.
6. Atomically publish staged registrations to the runtime registry.
7. Mark plugin active.

If any step fails, dispose staged resources, remove staged registrations, terminate workers and mark plugin as failed. A broken plugin must not leave half a toolbar or dangling event subscriptions.

Registry keys must include plugin identity and contribution identity. Two plugins cannot claim the same fully qualified contribution ID.

## 5.7 Disable, update and uninstall behavior

**Disable:**

- Cancel active gestures owned by the plugin.
- Remove its tools, modes, panels, commands, event listeners and renderers.
- Clear transient overlays/previews.
- Dispose timers/workers/object URLs.
- Preserve plugin preferences and all project extension data.
- If a required renderer is removed, report affected projects/content.

**Update:**

- Install the new package in a separate versioned location.
- Validate compatibility and package integrity before switching.
- Deactivate old version, activate new version and run plugin data migrations if applicable.
- If activation/migration fails, restore previous version and preserve project data.
- Do not hot-replace a module while it has an active gesture or render callback.

**Uninstall:**

- Require deactivation first.
- Remove executable package files and plugin-local caches/preferences according to the user confirmation policy.
- Do not delete project extension data or plugin-authored nodes from user projects.
- Warn that such content may not be editable/renderable until the plugin is reinstalled.

## 5.8 Failure isolation

- Catch activation, command, event handler, renderer and panel errors at plugin boundaries.
- Log plugin ID, version, contribution ID, project ID (where relevant), operation and stack details in developer diagnostics.
- Do not leak private project data into telemetry or remote error reporting by default.
- A plugin failure should disable only the failing contribution or plugin where possible.
- Repeated renderer failures may quarantine the renderer to keep the rest of the canvas usable.
- Worker timeout/crash must terminate the worker and reject pending requests.
- Deactivation must be attempted even after a plugin enters a failed state.

## 5.9 Network and privacy

The initial plugin ecosystem should not require network access. Local installation, plugin assets, plugin settings and project storage must work offline.

If a later plugin requires network access:

- declare a `network` permission;
- provide an origin allowlist in the manifest/permission grant;
- explain the purpose to the user;
- do not expose project data automatically;
- require explicit user action for uploads or external sharing;
- never include project content in crash telemetry by default.

## 5.10 Version compatibility

Keep these versions separate:

| Version | Controls |
|---|---|
| Host application version | Installed LightTable release |
| Plugin API version | Public SDK surface and behavior |
| Project schema version | Serialized document structure |
| Plugin package version | Executable plugin release |
| Plugin data schema version | Plugin-owned content/settings format |
| Node `typeVersion` | Payload schema for a specific node type |

A plugin may support several host/API versions if declared. The host rejects unsupported API ranges before activation. Unknown data remains preserved even if no plugin version capable of migrating it is installed.
