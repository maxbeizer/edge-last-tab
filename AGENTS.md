# Coding agent instructions

## Purpose and invariants

This repository is a small Manifest V3 Microsoft Edge extension that toggles to the previously active tab in the current window.

- Preserve privacy and least privilege. The extension must not inspect or retain page contents, URLs, titles, browsing history, or other browsing metadata.
- Keep manifest permissions minimal. Currently only `storage` is required; do not add host permissions, content scripts, telemetry, network access, or dependencies without an explicit product requirement.
- Persist only numeric tab/window IDs, and only in `chrome.storage.session`.
- Keep the extension focused on its single last-tab toggle command.

## Architecture and storage

There is no build step or runtime dependency:

- `manifest.json` defines the MV3 service worker, permissions, and commands.
- `service-worker.js` contains all runtime behavior.
- `test.mjs` executes the worker in a mocked `chrome` environment using Node's test runner.
- `README.md` is the user-facing installation, behavior, privacy, shortcut, and development documentation.

`tabHistoryByWindow` is a session-storage object keyed by stringified window ID. Each value may contain numeric `current` and `previous` tab IDs. Activation updates rotate those two IDs; tab removal clears matching IDs and removes empty entries; window removal deletes the whole entry. Missing or stale state must remain a safe no-op, and a stale previous tab must be cleaned up.

All activation, removal, window-removal, and command work is serialized through the shared promise queue. Preserve this ordering so read-modify-write cycles cannot overwrite one another. Keep queue error handling resilient so one rejected task does not prevent later events from running.

## Source conventions and browser safety

- Follow the existing plain JavaScript style: `const`/`let`, semicolons, concise arrow callbacks, async Chrome APIs, and small single-purpose functions.
- Do not introduce tooling, generated output, abstractions, or dependencies unless the change requires them.
- Treat Chrome and Edge as the same Chromium extension API surface, while keeping user-facing instructions Edge-specific.
- Scope the command to the intended current window. Never activate a tab in another window because focus changed during asynchronous work.
- Carry a known `windowId` through follow-up operations and use explicit window constraints where the API supports them; do not replace scoped queries with global tab queries.
- Before activating stored history, verify that the tab still exists and belongs to the active window.
- Preserve lifecycle cleanup for removed tabs and windows.
- Unknown commands and unavailable history must be no-ops.

## Tests and validation

Add or update focused tests in `test.mjs` for every behavior change. Cover success and safe failure paths, especially serialization, stale/removed IDs, window isolation, activation toggling, and tab-ID replacement. Keep mocks faithful to the Chrome API behavior the test relies on.

Run all of these commands from the repository root before finishing:

```bash
python3 -m json.tool manifest.json >/dev/null
node --check service-worker.js
node --test test.mjs
```

For browser-facing behavior that the harness cannot represent, also load the unpacked extension in Edge and manually exercise multiple windows, tab removal, and the configured shortcut; report whether that manual check was performed.

## Scope and documentation

Make the smallest complete change and do not refactor unrelated code. Do not weaken privacy, permission, serialization, or explicit-window guarantees as a shortcut.

When behavior changes, keep `README.md` aligned with features, privacy claims, shortcut/setup steps, and development commands. Keep `manifest.json` aligned with command names/descriptions, suggested keys, permissions, worker configuration, and release version as applicable. User-visible behavior, README claims, tests, and manifest metadata should not contradict one another.
