# Alfred Music Companion — MCP integration (draft)

This public repository is a **GPL-3.0 fork** of
[Martin Beneš's Companion for YouTube Music](https://github.com/benesmartin/youtube-music-companion).
The upstream music player, search, queues, playlists, history, lyrics and
popup UI remain in place. The new code adds a small, private-by-default bridge
for the owner's Alfred assistant to control the **same signed-in Chrome tab**.

The Chrome extension is named **Alfred Music Companion** and uses its own
teal-A icons so it is not mistaken for the official upstream release.
All upstream copyright notices and the `LICENSE` file remain applicable.
Please distribute modified builds under GPL-3.0 with source availability.

## Added files and integration points

- `manifest.json`: adds `nativeMessaging` and distinct fork name/icons.
- `background.js`: imports `alfred-native.js` in the Manifest V3 worker.
- `alfred-native.js`: fixed-command, typed Native Messaging client.
- `content/content.js`: adds an internal request/response adapter that
  **reuses the existing Companion commands and page bridge**.
- `tests/alfred-native.test.mjs`: validates the messages, tab scoping,
  search and queue dispatch without opening the browser.
- `.github/workflows/alfred-native-check.yml`: runs source checks/tests.

The extension alone does **not** expose an MCP endpoint. A native messaging
host and local MCP bridge are maintained privately in
`Dmitry-dev-pet/infra-mcp-gateway`, draft PR #55 (directory `companion_mcp`).
These components will need a separate macOS security review and test.

## Chrome unpacked installation diagnostics (18 November 2026)

The first actual owner-Mac **Load unpacked** produced:

- `'background.scripts' requires manifest version of 2 or lower`.
  Upstream ships a cross-browser MV3 declaration containing both Firefox
  `background.scripts` and Chrome `background.service_worker`.
  The **Chrome-only fork now removes `background.scripts`**, retaining
  `background.service_worker: "background.js"`.
- `Specified native messaging host not found`.
  This is expected before a **separate** owner-user native host has been
  registered. The exact unpacked extension ID observed in the owner's
  Chrome is `bmipocaonoinmcgconkicgaakggbhhpo`. No host is installed
  merely by loading the extension. The private installer in PR #55
  registers this precise ID; never grant wildcard origins.
- `Unsafe attempt to load URL chrome-extension://.../content/bridge.js`.
  The `content/bridge.js` resource exists and is explicitly listed as
  web-accessible for `https://music.youtube.com/*` in `manifest.json`.
  This error was seen while the old, invalid manifest was loaded, so its
  cause is **not yet established**. Refresh the extension **and** the
  `music.youtube.com` tab after loading the fixed version, then check
  for *new* errors. If it persists, inspect the loaded extension ID and
  page-bridge injection separately; do not disable Chrome security.

On the owner's Mac (using the existing paths from the pilot):

```sh
git -C "$HOME/alfred-companion-pilot/extension" pull --ff-only
git -C "$HOME/alfred-companion-pilot/infra" pull --ff-only
node "$HOME/alfred-companion-pilot/infra/companion_mcp/scripts/install-native-host.mjs" bmipocaonoinmcgconkicgaakggbhhpo
```

Then **Reload** the existing unpacked `Alfred Music Companion` on
`chrome://extensions`, and refresh the existing YouTube Music tab.
The native host is launched by Chrome, not by a separate terminal
daemon. No new ChatGPT tunnel is created by this command.

The `background.scripts` regression now has a source test.
The native worker also consumes `chrome.runtime.lastError` on
native-port disconnection, so DevTools shows a clear host error rather
than an unchecked warning. Neither change alone proves the complete
MCP connection works.

## Security constraints

- Only `https://music.youtube.com/*` music tabs are targeted, with
  one-tab-only enforcement for native operations.
- No arbitrary JavaScript, AppleScript, shell command, target URL, cookie,
  browser history or unbounded network request is exposed as an MCP tool.
- Commands are typed and allowlisted in the extension service worker and
  content script, as well as in the local MCP.
- Browser-side search session IDs expire; the private music IDs are not
  returned as search results through MCP.
- Existing upstream Companion may use YouTube Music's internal page APIs
  and session data; the added MCP adapter never exposes direct access.
- Chrome Native Messaging's host manifest must bind to **this exact installed
  fork extension ID**, not an arbitrary browser extension.
- Native host registration will be owner-only; no TCP server is needed.

## Verify source without installation

With Node.js 22:

```sh
node --check alfred-native.js
node --check background.js
node --check content/content.js
node --test tests/alfred-native.test.mjs
```

These are isolated unit tests, **not** proof that real YouTube Music search,
queue or playback work over the complete Chrome Native Messaging path.

## Testing in Chrome on Mac

**Not installed or deployed as of 18 November 2026.**

When source checks pass and the local native host is reviewed:

1. In the existing macOS owner's Chrome profile, visit
   `chrome://extensions` and enable Developer mode.
2. Disable the original Companion (if installed), then choose
   **Load unpacked** and select this fork's local directory.
   Running both music extensions may interfere with the same page.
3. Record the extension's ID from Chrome. Register the local Native Messaging
   host for that **exact** ID with the installer in private PR #55.
4. Reload the extension to connect it to the native host. Check the socket and
   local MCP status, pause/resume, search/play, queue next/end and Up Next
   readback, in that order.
5. Create a separate authenticated ChatGPT MCP tunnel **only after** the
   local end-to-end integration passes and is reviewed.

Existing Bluetooth playback, Alfred Station, the browser MCP and Mac ADB MCP
should not be changed. Previous AppleScript prototype lives in a separate
draft PR #53 and remains a temporary fallback.

## Upstream and attribution

Please see the [original Companion repository](https://github.com/benesmartin/youtube-music-companion)
for original installation, features, issues and release information.
This is an independent personal fork, not endorsed by Martin Beneš,
Google or YouTube.
