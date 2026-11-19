# @lighttable/plugin-sdk — architecture contract package

This is a local, declarations-only package copied from `contracts/plugin-api.d.ts` so a plugin can compile independently of the LightTable host repository.

- It contains TypeScript contracts only; it does not contain a runtime implementation.
- It is not published to npm and is not a promise that the host has implemented every API.
- `1.0.0-architecture.2` identifies this handoff snapshot. The target plugin API major is `1`.
- React is a peer dependency because the trusted-UI plugin contract allows React panel components.
- Keep this file byte-for-byte aligned with `../contracts/plugin-api.d.ts`. If a contract change is approved, update both files and rerun the contract checks.

Example local dependency from a separate plugin repository:

```json
{
  "devDependencies": {
    "@lighttable/plugin-sdk": "file:../lighttable-architecture/sdk-contract-package"
  }
}
```

A plugin should declare `apiVersionRange: "^1.0.0"` in its LightTable manifest. The prerelease package version above is only the local type package version; it is not the host's runtime API version.
