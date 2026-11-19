# Testing and Acceptance Criteria

## Automated tests

Run:

```sh
npm test
```

The suite uses Node's built-in test runner and requires no package installation beyond Node.js. It covers:

- Draft entry hides surfaces before disabling color rendering.
- Draft exit re-enables rendering before revealing surfaces.
- Independent buffer enable/disable behavior.
- Preservation of each layer's enabled preference across Draft transitions.
- Registration while already in Draft mode.
- Unregister/destroy lifecycle and adapter disposal.
- Immutable state snapshots and event notifications.
- Invalid/duplicate registration handling.
- Error collection while other adapters still receive transition calls.
- DOM adapter visibility restoration and browser host-adapter behavior.

## Manual frontend checks

Run `npm run demo` and open the local URL.

1. Confirm the preview is rendered in color.
2. Enable Draft. Both color canvas surfaces should disappear immediately.
3. Confirm the outline frame counter continues increasing and the host FPS display continues updating.
4. Confirm the color draw counter stops increasing while Draft is active.
5. Disable Draft. Color surfaces and color draw calls should resume.
6. Disable Base fill or Detail fill individually. The other color surface should remain active.
7. Enable Draft while one layer is disabled, then disable Draft. The previously disabled layer should remain disabled.

## Acceptance statement

The proof of concept passes the intended functional contract when Draft switching changes color-buffer visibility and color-render gates synchronously, while the independent outline renderer continues to be called by the host's normal frame loop. Actual refresh rate is device/browser dependent and should be measured on target hardware; the module must not impose a separate frame cap or scheduler.
