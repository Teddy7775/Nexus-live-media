# Your own layouts

Put a layout here as `name.json` (plus its `overlay` PNG, if it uses one) and restart the booth.
It then appears in the operator panel's **Layout** list.

- A file whose `id` matches a built-in layout (`strip-2x6-x2`, `single-4x6`, `duo-4x6`) replaces that built-in.
- A layout with a mistake is skipped, and the reason is shown in the operator panel; it never stops the booth.
- `overlay` must be a PNG with **exactly** the canvas size, with transparent windows where the photos should show through.

See the "Layouts" section of the main README for a complete example.
