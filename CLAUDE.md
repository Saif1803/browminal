# Browminal — desktop web browser (Electron)

A developer's browser for localhost work: terminal coding agents (Claude Code or any MCP client)
see, drive and debug the tabs the user shares with them (see **Agent bridge** below). The
user-facing guide (connecting, sharing, picks, the tool list) is [docs/agents.md](docs/agents.md):
keep it in step when tools or their rules change.

## Stack
- **electron-vite** (React + TypeScript template, `@quick-start/electron`).
- **Bun** is the package manager and script runner only. The app runs on Electron's Node:
  never use Bun-only APIs (`Bun.*`, `bun:*` imports) in `src/main`, `src/preload` or `src/renderer`.
  `bun:test` is allowed in `*.test.ts` files only.
- `package.json` has `"trustedDependencies": ["electron", "esbuild"]` so their install scripts run under Bun.
- **Rust** for main-process code where it pays (memory, hot paths): the `native/` crate
  (napi-rs → `native/browminal_native.node`, Node-API so one build serves Electron and `bun test`).
  `bun run build:native` (`scripts/build-native.ts`: `cargo build --release` + copy) runs on install,
  `dev` and `build`; it needs a Rust toolchain. Main loads it through `src/main/native.ts`
  (electron-vite copies the file into `out/main/chunks`, unpacked from the asar); a worker gets its
  path in `workerData` instead of importing `native.ts` (one copy of the file). Its JS types are
  `native/browminal_native.d.node.ts`, kept in step by hand. `bun test` can't load that import, so
  `scripts/test-preload.ts` (bunfig.toml) swaps `native.ts` for a plain `require` of the built file.
  Check Rust with `cargo clippy --release -- -D warnings` and `cargo fmt --check` in `native/`.
- **Tailwind CSS v4** via `@tailwindcss/vite` (theme tokens in `src/renderer/src/assets/main.css`).
- **Theme:** the Claude desktop app's colours, light or dark following the OS (`prefers-color-scheme`).
  Use the tokens (`strip`, `bar`, `tab`, `field`, `ink*`, `accent`, `line`), never raw colours. The internal
  pages' CSS repeats the palette, and `src/main/theme.ts` holds the few colours main paints itself
  (native window controls, window and loading backgrounds); keep all three in sync.
- **Glass:** on Windows 11 22H2+ (acrylic) and macOS (vibrancy) the window is see-through
  (`glass.ts`); main passes `--browminal-glass` to the UI, which sets `data-glass` on `<html>` and paints
  the same palette translucent (`strip` tints the window, `bar` is clear, `tab` lifts the active tab;
  `.glass-edge` gives raised surfaces a lit rim). Elsewhere the colours stay solid. The home page
  links `glass.css`, which `browminal://` serves only on a glass window (empty otherwise), and its tab
  view is clear there (`GLASS_MATERIAL` in `theme.ts`), so it sits on the same backdrop.

## Commands
```bash
bun install          # install deps (runs Electron's binary download, builds native/)
bun run build:native # rebuild the Rust module after changing native/
bun run dev          # start the app with HMR
bun run typecheck    # tsc for main/preload, renderer, and tests
bun test             # unit tests (src/**/*.test.ts)
bun run lint         # eslint
bun run build        # typecheck + production bundle into out/
bun run build:win    # package Windows installer (build:mac / build:linux likewise)
```
Run `bun run typecheck`, `bun test` and `bun run lint` before calling work done (and clippy and
rustfmt when `native/` changed).

## Architecture
- **UI** (tab strip + toolbar) is a React app in the renderer: `src/renderer/src`. It is the
  `webContents` of the main `BrowserWindow`. It measures its own height and reports it with
  `setChromeHeight(px)` (main validates 0–400); the tab-strip row is `TAB_STRIP_HEIGHT` in
  `src/shared/layout.ts`, which the native window controls match.
- **Tabs** are `WebContentsView`s owned by `TabManager` (`src/main/tab-manager.ts`). Only the active
  tab's view is attached (`window.contentView.addChildView`); all are sized below the UI with
  `setBounds`, inset `PAGE_INSET` from the sides and bottom with `PAGE_RADIUS` corners (a fullscreen
  page covers the whole window, square). The UI never sends bounds, only its height.
  `windowLayout` in `src/shared/layout.ts` (pure, used by main and the UI) places the page and,
  while it's open, the terminal panel under it or to its right (`PanelPlacement`: dock + size).
- **Terminal panel** (`src/main/terminals.ts`): an IDE-style panel docked under the page or to its
  right (header button; each dock remembers its own size; Ctrl+` toggles, Ctrl+Shift+` adds a
  terminal). Shells are `@lydell/node-pty` ptys in main (prebuilt binaries, no build tools); the UI
  draws the panel's header row (sessions, the tab it works on, folder, **Claude**, dock switch) and
  its inner edge, which resizes it (drag, arrow keys when focused, double-click for the default;
  main clamps with `clampPanelSize`), and the **terminal view**, a second `WebContentsView` with xterm
  (`src/renderer/terminal.html`, `src/renderer/src/terminal/`), shows the shell below it. Every
  session works on a tab: Claude started from its button gets an MCP config with the
  `x-browminal-terminal` header, so tools that name no tab act on that tab. Links in the output open in
  that tab (or a new one next to it). Project folders are remembered per site.
- **UI ↔ main** only through the typed API in `src/preload/index.ts`, exposed via `contextBridge`
  as `window.browser` (navigation calls act on the active tab; tab calls take a numeric tab id)
  plus push events main sends (`onState` → one `BrowserState` of tabs, downloads, bookmarks and the agent bridge, batched in
  `window.ts` to at most one per tick; `onFocusAddressBar`).
  Pure helpers both sides use live in `src/shared/` (`url.ts`, `downloads.ts`, `layout.ts`). The contract lives in `src/shared/types.ts` (`BrowserApi`, `BrowserState`,
  `IpcChannel`); change it there first.
- **Error pages:** a failed main-frame load (not `ERR_ABORTED`) loads `browminal://error/?code=…&url=…`
  (`errorPageUrl` in `src/shared/url.ts`). The address bar shows the failed URL (`displayUrl`),
  Reload retries it, and the failed entry and the error entry are removed from history.
- **Storage:** small JSON files in `userData` through `JsonStore` (`src/main/store.ts`): read once
  and checked (`parseBookmarkFile`, `parseSettings`; bad entries are dropped, a file that isn't JSON
  is kept as `*.broken`), written debounced and atomically (temp file + rename), flushed on quit.
  Files: `bookmarks.json` (`{version: 1, bookmarks}`), `settings.json` (bookmarks bar,
  `adblock: {enabled, pausedSites}`, `agent: {enabled, port, shareAll}`,
  `terminal: {dock, height, width, folders, agentCommand}`) and `agent.json` (`{version: 1, token}`, written
  `0o600`). Per-terminal MCP configs live in `agent-mcp/` (`0o600`, deleted with the terminal and
  cleared on start). Pure file formats live in their own tested modules.
  The ad blocker's engine is cached separately as `adblock-engine.bin` (adblock-rust's own checksummed
  format, not a JsonStore): the worker writes `adblock-engine.bin.tmp`, main loads it and renames
  it over the cache. Its bytes never pass through JavaScript.
- Address-bar input is resolved **in main** by `resolveInput` in `src/shared/url.ts`
  (http(s) as-is; bare domains get `https://`; localhost/IPs get `http://`; everything else,
  including other schemes, is a Google search; empty input goes home).
- **Internal pages** use the privileged `browminal://` scheme (`src/main/protocol.ts`), served only
  from `resources/pages/<page>/` via the allowlist in `src/main/internal-files.ts`. The start page
  is `browminal://home/` (`resources/pages/home`): a prompt box that opens ChatGPT or Claude with
  the question pre-filled, plus direct links. Internal pages are static HTML/CSS/JS loaded in a
  normal sandboxed tab: they get no preload and no IPC, and a strict CSP. Typing `browminal://`
  into the address bar never loads it.

### Main-process modules (`src/main`)
| File | Responsibility |
| --- | --- |
| `index.ts` | App lifecycle only; wires the modules together |
| `native.ts` | Loads the Rust module (`native/`); its path for workers |
| `window.ts` | Frameless `BrowserWindow`, relays resize and state, window title |
| `tab-manager.ts` | Tab list, active tab, closed-tab stack, layout, batched state push |
| `tab-order.ts` | Pure: where new tabs go, which tab is active after a close |
| `tabs.ts` | `Tab` class: one `WebContentsView`, its events, window.open → new tab, find, zoom, error pages |
| `scrollbars.ts` | Thin, faint page scrollbars tinted with the page's theme-color (user-origin CSS; the page's own styles win) |
| `page-veil.ts` | `PageVeil`: a script-free view over the page while a new document loads, fading in the old page's colour |
| `page-color.ts` | Pure: a page's background colour from `getComputedStyle` (checked), the veil's page and fade CSS |
| `favicons.ts` | Fetches favicons in main and returns checked `data:` URLs (`image-type.ts` sniffs) |
| `user-agent.ts` | Pure: strips `Electron/x` and the app token from the user agent |
| `navigation-policy.ts` | Pure: where pages may navigate (web yes; `mailto:`/`tel:` ask; everything else blocked) |
| `external-links.ts` | Confirm dialog, then `shell.openExternal`, for `mailto:`/`tel:` only |
| `downloads.ts` | `Downloads`: every download of the app; saves into Downloads, pause/resume/cancel/open, quit prompt |
| `download-names.ts` | Pure: safe file names and "name (1).ext" numbering |
| `downloads-menu.ts` | Native menu for the downloads button (placeholder until the design pass) |
| `store.ts` | `JsonStore`: one JSON file in userData; checked on read, debounced atomic writes |
| `settings.ts` | Pure: `settings.json` format and defaults |
| `adblock.ts` | `Adblock`: filter engine lifecycle (list download, cache, daily update), request blocking, element hiding, per-tab counts |
| `adblock-filters.ts` | adblock-rust engine wrapper (native module): load, `shouldBlock`, `cosmeticStyles` (no Electron; tested) |
| `adblock-policy.ts` | Pure: filter list URLs, sites, paused list, shield status, update timing, page-scan checks |
| `adblock-worker.ts` | Worker thread that parses the filter lists and saves the engine (keeps main responsive) |
| `adblock-menu.ts` | Native menu for the shield (placeholder until the design pass) |
| `agent.ts` | `Agent`: the bridge on/off, which tabs are shared, debugger sessions, "agent working" state |
| `agent-server.ts` | Loopback HTTP server for MCP (Streamable HTTP, stateless); checks every request first |
| `agent-auth.ts` | Pure: request checks (host, not from a browser, token), `agent.json` format |
| `agent-policy.ts` | Pure: which pages agents may touch, default tab, reply formatting, connect command |
| `agent-tools.ts` | The MCP server and tab tools (list/open/select/close tabs, navigate, screenshot, page text, evaluate) |
| `agent-page-tools.ts` | Page tools: read_page/find (refs), click, hover, type, fill, select_option, press_key, scroll, wait_for, handle_dialog |
| `agent-debug-tools.ts` | Debug tools: console_messages, network_requests/network_request, inspect, set_style/set_attribute, emulate, clear_site_data |
| `agent-picks.ts` | Picks: capturing an element pick or an errors pick, an element's source line, the `get_picks` tool |
| `agent-tool-helpers.ts` | What tools share: `AgentContext`, tabId input, inspectable check, load waiting |
| `tab-debug.ts` | `TabDebug`: the debugger on one shared tab, its console and network logs, source maps, new-errors count, emulation, pick mode |
| `console-log.ts` | Pure: console entries from CDP events (console, exceptions, browser log), ring buffer, filters, source-mapped formatting |
| `source-maps.ts` | Pure: `SourceMaps` (script → map, maps loaded once), original positions, project-relative source names, places in stack text |
| `component-source.ts` | Pure: where an element is written, from React/Vue/Svelte dev builds (the page's answer checked) |
| `picks.ts` | Pure: the picks list, how picks read to agents, the prompt typed into the terminal |
| `network-log.ts` | Pure: requests from Network events, filters, network idle, credentials redacted |
| `element-inspect.ts` | Pure: inspect's box model, computed styles and matching CSS rules with file and line (source maps, Vite's injected styles) |
| `emulation.ts` | Pure: device and network presets, emulation state, the address bar badge's label |
| `ax-tree.ts` | Pure: the accessibility tree as compact text with refs (backend DOM node ids); find |
| `cdp-keys.ts` | Pure: "Control+a" → CDP key events; refuses keys that are Browminal shortcuts |
| `agent-menu.ts` | Native menu for the agent button (placeholder until the design pass) |
| `terminals.ts` | `Terminals`: pty sessions, the terminal view, panel open/height, Claude button, links |
| `terminal-policy.ts` | Pure: default shell, quoting, agent command line, output buffer, folder keys |
| `cdp.ts` | `CdpSession`: the DevTools protocol on one tab through `webContents.debugger`: timeouts, events, open dialogs |
| `bookmark-list.ts` | Pure: `bookmarks.json` format, add/remove/find, URL and favicon checks |
| `bookmarks.ts` | `Bookmarks`: the list and the bar setting; star/Ctrl+D toggle, favicon refresh, open |
| `bookmarks-menu.ts` | Native menus: right-click on a bookmark or the bar, and the "»" overflow |
| `menu-text.ts` | Escapes `&` in native menu labels |
| `theme.ts` | Light/dark colours main paints itself; follows `nativeTheme` |
| `glass.ts` | Pure: which see-through window material this OS supports (acrylic, vibrancy, none) |
| `zoom-levels.ts` | Pure: Chrome's zoom steps |
| `permission-policy.ts` | Pure: allow / ask / deny per permission, prompt text, session memory of answers |
| `permissions.ts` | Session permission, check, screen-share and device handlers; Allow/Block dialogs |
| `ipc.ts` | `ipcMain` handlers, sender and argument validation |
| `shortcut-map.ts` | Pure: key input + platform → browser command |
| `shortcuts.ts` | Runs commands from `before-input-event` on UI and every tab; mouse back/forward, swipe |
| `context-menu.ts` | Native right-click menus for pages, and cut/copy/paste in the UI's text fields |
| `protocol.ts` | Registers and serves the `browminal://` scheme |
| `internal-files.ts` | Pure URL → file mapping for `browminal://` (allowlist, traversal guard) |

Keep new main-process code in focused modules like these rather than growing `index.ts`.

### Window chrome
`titleBarStyle: 'hidden'`: traffic lights on macOS (`trafficLightPosition`), `titleBarOverlay`
on Windows/Linux, both sized to the tab strip. The UI is `-webkit-app-region: drag` (`.app-drag`);
every interactive control must be `.app-no-drag`. `.titlebar-safe` (on the tab strip) reserves
space for the native controls.

## Security rules (non-negotiable)
- Tab views: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload**.
- Only the UI renderer gets the preload (`src/preload/index.ts`), plus the terminal view, which gets
  its own (`src/preload/terminal.ts`: terminal I/O only, no `window.browser`). Never expose
  `ipcRenderer` or generic send/invoke helpers; expose one named function per action. The two
  preloads must not import the same module (a shared chunk can't load in a sandboxed preload): the
  terminal view's contract is `src/shared/terminal-view.ts`, apart from `types.ts`.
- Validate the sender of **every** IPC message in main (`assertTrustedSender` in `ipc.ts`:
  must be the main window's UI webContents, top frame, trusted URL; `terminalSender` likewise for
  the terminal view and `terminal.html`). Validate argument types too.
- Pages never open OS windows. `window.open`/`target=_blank`/middle-click open a **new tab**
  (http(s) or blank only; everything else is denied). A `window.open` page is adopted so
  `window.opener` works, with the same forced `webPreferences` (`overrideBrowserWindowOptions`).
  `<webview>` attachment is blocked.
- Pages can't navigate any frame (or be redirected) to `browminal://`, `file:` or other apps' schemes
  (`will-frame-navigate` / `will-redirect` + `decideNavigation`). `mailto:`/`tel:` open only after
  the user confirms, and only from the active tab. Main's own `loadURL` is not affected.
- The UI renderer must not navigate away from itself or open windows.
- **Permissions** (`permissions.ts`): fullscreen and clipboard writes are allowed; camera, microphone,
  location, notifications and clipboard reads ask (Allow/Block, remembered per origin until the
  browser closes); everything else is denied, including `openExternal`. Only the active tab can
  ask; the UI and `browminal://` pages always get "no". Screen sharing asks every time (screens only,
  no audio) and needs a user gesture. USB, HID, serial and Bluetooth pickers are always cancelled.
- Only http(s) URLs are loaded into tabs from the address bar.
- **Downloads** (`downloads.ts`): only pages in tabs can download. Files go straight into the OS
  Downloads folder under a cleaned, unique name (`download-names.ts`) and are **never opened
  automatically**, only from the user's Open. Chromium adds the mark-of-the-web on Windows.
  Closing/quitting with downloads running asks first, and quitting cancels them.
- **Bookmarks:** only http(s) URLs can be bookmarked or opened from bookmarks, and
  `bookmarks.json` is re-checked on every read (never trusted, it's a file anyone can edit).
  Favicons are stored only as checked `data:image/…;base64` URLs (max 64 KB, shrunk to 32 px
  where Electron can decode them); the UI's CSP stays `img-src 'self' data:`.
- **Ad blocker** (`adblock.ts`): Brave's adblock-rust in our native module
  (`native/src/adblock.rs`), with the lists fetched by main from their publishers (`FILTER_LISTS`).
  The engine never loads resources, and its injected scripts, procedural filters and `$csp`
  directives are never used; nothing adds a preload or IPC to pages. Our own
  `webRequest.onBeforeRequest` (the session's only one) cancels matching requests from tabs; main
  frames, paused sites, the UI and main's own fetches are never blocked. Element hiding is CSS main inserts (`cssOrigin: 'user'`); the page scan for class
  names/ids runs in an isolated world and its result is checked (`parseDomTokens`). No scriptlets,
  redirect resources or `$csp` rules: nothing from the lists runs as code in pages.
- **Agent bridge** (`agent*.ts`): off until the user switches it on (agent button, or sharing a
  tab). An MCP server on **127.0.0.1 only** (port 9339, or the next free one); every request must
  be addressed to `127.0.0.1`/`localhost` on that port, carry **no** `Origin`/`Sec-Fetch-Site`
  (so no web page can reach it, not even ours) and the bearer token from `agent.json` (compared in
  constant time; "New token" replaces it). Never use `--remote-debugging-port`: it has no auth and
  exposes the UI. Agents see and act only on **shared** tabs: shared by the user (Ctrl+Shift+A),
  opened by an agent (`new_tab`), or opened by a shared tab; "Share every tab" shares all. Main
  attaches the debugger only to shared tabs, and never reads or scripts `browminal://` pages
  (`canInspect`). Agents load http(s) only, close only tabs they opened, and their actions still go
  through the usual navigation, download and permission rules. Keys an agent presses that are
  Browminal shortcuts (Ctrl+W, F5…) are refused (`browserCommandFor`), since CDP key events reach
  `before-input-event`. A page's alert/confirm/prompt shows Electron's native box as usual; the
  agent is told and may answer it (`handle_dialog`), or the user does. While an agent works the tab is
  marked, the page gets an accent ring and "Agent working · Stop"; Stop unshares the tab (and turns
  "Share every tab" off), detaching the debugger.
  Console and network logs are kept per shared tab from the moment it's shared (nothing while it
  shows a `browminal://` page); header values with credentials (Authorization, cookies, API keys) are
  shown as `REDACTED`. What an agent emulates (device, colour scheme, network) shows as a badge in
  the address bar that resets it, and ends with Stop. `clear_site_data` runs only after the user
  agrees in a dialog (one question at a time).
  **Page ↔ source:** the Debugger domain is on in shared tabs only for `scriptParsed` (source
  maps) and must never pause a page: `setSkipAllPauses`, sent again on every new page (Chromium
  drops it on a renderer swap), and any pause that slips through is resumed. Source maps are
  inline `data:` or fetched by main through the tab's session, http(s) on the script's own origin
  only, size-capped (`source-maps.ts`). An element's source line comes from the framework's dev
  data in the page's main world, so it's untrusted and checked (`parseComponentSource`).
  **Picks:** the user picks an element (Ctrl+Shift+X, the agent menu, or "Send to agent" in the
  page menu; Esc cancels) or sends a shared tab's new errors (the address bar's errors badge);
  picking shares the tab. Picks stay in memory (newest 20), agents read them with `get_picks`,
  and if a Claude started from the terminal panel works on that tab, "Look at … (pick N): " is
  typed into its prompt, never sent. Agents can't pick (Ctrl+Shift+X is a refused shortcut).
- **Terminal** (`terminals.ts`): shells run as the user, so only the user starts them (panel,
  Ctrl+`); no page and no agent tool can. The terminal view is sandboxed, can't navigate or open
  windows, and its messages are size-checked (input ≤ 64 KB). The shell's environment drops
  `ELECTRON_*`; the agent token is never put in it (only the config file has it). Keys go to the
  shell except Ctrl+`, Ctrl+Shift+`, tab switching, fullscreen and Ctrl+Shift+X (pick).

## Roadmap
- **Milestone 1 (done):** frameless window, back/forward/reload-stop, address bar, title sync,
  Cmd/Ctrl+L and Cmd/Ctrl+R.
- **Home page (done):** `browminal://home/` with ChatGPT/Claude prompt; Google search.
- **Browser essentials (done):** tabs, page essentials, permissions, downloads, bookmarks, ad
  blocker — [docs/plans/browser-essentials.md](docs/plans/browser-essentials.md).
- **Agent browser (done; the main purpose from now on):** Phases 1 (agent bridge), 2 (read and
  act: refs, click, type, forms, keys, dialogs), 3 (debug: console, network, inspect, emulate),
  4 (page ↔ source: source maps, picks, errors badge), 5 (terminal panel) and 6 (docs:
  [docs/agents.md](docs/agents.md)) — [docs/plans/agent-browser.md](docs/plans/agent-browser.md).
  Not built yet: drag and drop, iframes, CPU throttling, original names in minified stacks, a real
  "Connect an agent" dialog (the agent menu stands in).
- **Creator browser (parked):** capture, studio mode, device preview, profiles, clips panel,
  Claude/ChatGPT handoff — [docs/plans/creator-browser.md](docs/plans/creator-browser.md).
- **Later (don't start until asked):** history + address suggestions, session restore, design pass
  (replaces the placeholder native menus for downloads, bookmark overflow, the shield and agents, and the
  plain tab strip).
