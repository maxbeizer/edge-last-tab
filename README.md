# Edge Last Tab

A small, permission-minimal Microsoft Edge extension for toggling between the
current and previously viewed tab.

## Feature

Toggle between the current and previously viewed tab in the current window with
a shortcut configured in Edge's native extension-shortcut settings.

The extension stores only numeric tab and window IDs in session storage. It has
no access to page contents, URLs, titles, or browsing history.

## Install from source

1. Clone this repository:

   ```bash
   git clone https://github.com/maxbeizer/edge-last-tab.git
   ```

2. Open `edge://extensions` in Microsoft Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the cloned repository directory.

## Configure shortcuts

Open `edge://extensions/shortcuts` and assign any key combination Edge accepts.

The suggested shortcut for **Toggle to the previously viewed tab** is:

- macOS: `Control-T`
- Other platforms: `Control-Shift-L`

The manifest uses `MacCtrl+T` so macOS receives the Control key rather than
Command-T, Edge's New Tab shortcut. Chromium reserves some browser shortcuts and
may reject or ignore those combinations.

After installing or restarting Edge, activate two different tabs before using
the toggle command so the extension has history to switch between.

## Development

The extension uses Manifest V3 and has no build step or runtime dependencies.
Validate a change with:

```bash
python3 -m json.tool manifest.json >/dev/null
node --check service-worker.js
node --test test.mjs
```

## License

[MIT](LICENSE)
