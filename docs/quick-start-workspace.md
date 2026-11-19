# LightTable quick start

## Drawing stays on the paper

Start a pencil or eraser gesture inside the white page. Gestures that start on the dark workspace are ignored. If the pointer leaves the page during a captured gesture, the stroke is clipped at the paper edge.

## Undo and redo

A completed pencil or eraser gesture is one undoable operation. Use `Ctrl+Z` to undo and `Ctrl+Shift+Z` or `Ctrl+Y` to redo. Cancelling a gesture or invoking undo/redo during a gesture clears the preview and does not commit a partial stroke.

## Frames, tracks and animations

- **Frame**: one position on the project's time ruler. Use `+ Blank frame`, `Duplicate` or `Delete` in the timeline footer to edit frames.
- **Track**: a parallel drawing lane inside the same animation. Track tabs appear on the left side of the filmstrip. Select a tab to draw on that track; select **+ Add track** to create another lane with an independent blank cel at every existing frame.
- **New animation**: a separate project/sequence. Open the project menu in the top bar and select **New animation**.

The current workspace supports adding and switching tracks. Reordering, deleting and simultaneous multi-row track editing are not yet implemented.

## Optional Coloring Mode

The host's pencil, eraser, frame timeline, onion skin, save/recovery and export work without Coloring Mode. Coloring Mode is an optional extension exposed under the **Optional extensions** section in Workspace Settings. It is not built as part of the normal `npm run dev` startup.
