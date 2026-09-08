# Edge Last Tab

A small, permission-minimal Microsoft Edge extension for walking backward
through recently viewed tabs.

## Feature

Press the configured shortcut repeatedly to walk backward through recently
viewed tabs in the current window. After reaching the oldest retained tab, the
shortcut cycles back to the tab where you started.

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

The suggested shortcut for **Go back through recently viewed tabs** is:

- macOS: `Control-T`
- Other platforms: `Control-Shift-L`

The manifest uses `MacCtrl+T` so macOS receives the Control key rather than
Command-T, Edge's New Tab shortcut. Chromium reserves some browser shortcuts and
may reject or ignore those combinations.

After installing or restarting Edge, activate tabs normally to build the
session history used by the command.

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
