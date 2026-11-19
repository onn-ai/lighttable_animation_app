# Contract verification

These checks validate the architecture artifacts only. They do not claim that a LightTable host, renderer, storage adapter or plugin runtime has been implemented.

## TypeScript SDK/example type check

From the package root, with TypeScript 5.4 or newer installed:

```sh
tsc -p tests/contract-tsconfig.json
```

The compile also checks that plugin-facing document payloads are recursively readonly. The tiny React declaration under `tests/stubs` is only a compile-time stand-in so this architecture package can be checked without installing the host application. The real SDK package must declare React as a peer dependency for `trusted-ui` panel components and compile against the host's supported React types.

## JSON Schema and example checks

```sh
python -m pip install -r tests/requirements.txt
python tests/validate-schemas.py
```

The script validates all included examples, resolves the project-bundle reference using local schema resources (no network access), and verifies rejection of several important invalid inputs.

## What these checks do not cover

Runtime document invariants such as unique IDs, track clip non-overlap, clip-to-cel references, finite affine matrices, project duration consistency, asset hashes, transaction atomicity, renderer determinism, plugin capability checks, package path normalization and offline module loading must be implemented and tested by the host project as defined in `docs/02-document-model.md`, `docs/03-rendering-contracts.md`, `docs/05-plugin-runtime-security.md` and `docs/06-implementation-plan-and-acceptance.md`.
