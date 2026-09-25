# Nebula — desktop web browser (Electron)

## Stack
- **electron-vite** (React + TypeScript template, `@quick-start/electron`).
- **Bun** is the package manager and script runner only. The app runs on Electron's Node:
  never use Bun-only APIs (`Bun.*`, `bun:*` imports) in `src/main`, `src/preload` or `src/renderer`.
  `bun:test` is allowed in `*.test.ts` files only.
- `package.json` has `"trustedDependencies": ["electron", "esbuild"]` so their install scripts run under Bun.
- **Tailwind CSS v4** via `@tailwindcss/vite` (theme tokens in `src/renderer/src/assets/main.css`).
- **Theme:** the Claude desktop app's colours, light or dark following the OS (`prefers-color-scheme`).
  Use the tokens (`strip`, `bar`, `field`, `ink*`, `accent`, `line`), never raw colours. The internal
  pages' CSS repeats the palette, and `src/main/theme.ts` holds the few colours main paints itself
  (native window controls, window and loading backgrounds); keep all three in sync.

## Commands
```bash
bun install          # install deps (runs Electron's binary download)
bun run dev          # start the app with HMR
bun run typecheck    # tsc for main/preload, renderer, and tests
bun test             # unit tests (src/**/*.test.ts)
bun run lint         # eslint
bun run build        # typecheck + production bundle into out/
bun run build:win    # package Windows installer (build:mac / build:linux likewise)
```
Run `bun run typecheck`, `bun test` and `bun run lint` before calling work done.

## Architecture
- **UI** (tab strip + toolbar) is a React app in the renderer: `src/renderer/src`. It is the
  `webContents` of the main `BrowserWindow`. It measures its own height and reports it with
  `setChromeHeight(px)` (main validates 0–400); the tab-strip row is `TAB_STRIP_HEIGHT` in
  `src/shared/layout.ts`, which the native window controls match.
- **Tabs** are `WebContentsView`s owned by `TabManager` (`src/main/tab-manager.ts`). Only the active
  tab's view is attached (`window.contentView.addChildView`); all are sized below the UI with
  `setBounds`. The UI never sends bounds, only its height.
- **UI ↔ main** only through the typed API in `src/preload/index.ts`, exposed via `contextBridge`
  as `window.browser` (navigation calls act on the active tab; tab calls take a numeric tab id)
  plus push events main sends (`onState` → one `BrowserState` of tabs, downloads and bookmarks, batched in
  `window.ts` to at most one per tick; `onFocusAddressBar`).
  Pure helpers both sides use live in `src/shared/` (`url.ts`, `downloads.ts`, `layout.ts`). The contract lives in `src/shared/types.ts` (`BrowserApi`, `BrowserState`,
  `IpcChannel`); change it there first.
- **Error pages:** a failed main-frame load (not `ERR_ABORTED`) loads `nebula://error/?code=…&url=…`
  (`errorPageUrl` in `src/shared/url.ts`). The address bar shows the failed URL (`displayUrl`),
  Reload retries it, and the failed entry and the error entry are removed from history.
- **Storage:** small JSON files in `userData` through `JsonStore` (`src/main/store.ts`): read once
  and checked (`parseBookmarkFile`, `parseSettings`; bad entries are dropped, a file that isn't JSON
  is kept as `*.broken`), written debounced and atomically (temp file + rename), flushed on quit.
  Files: `bookmarks.json` (`{version: 1, bookmarks}`) and `settings.json` (bookmarks bar, and
  `adblock: {enabled, pausedSites}`). Pure file formats live in their own tested modules.
  The ad blocker's engine is cached separately as `adblock-engine.bin` (binary, not a JsonStore).
- Address-bar input is resolved **in main** by `resolveInput` in `src/shared/url.ts`
  (http(s) as-is; bare domains get `https://`; localhost/IPs get `http://`; everything else,
  including other schemes, is a Google search; empty input goes home).
- **Internal pages** use the privileged `nebula://` scheme (`src/main/protocol.ts`), served only
  from `resources/pages/<page>/` via the allowlist in `src/main/internal-files.ts`. The start page
  is `nebula://home/` (`resources/pages/home`): a prompt box that opens ChatGPT or Claude with
  the question pre-filled, plus direct links. Internal pages are static HTML/CSS/JS loaded in a
  normal sandboxed tab: they get no preload and no IPC, and a strict CSP. Typing `nebula://`
  into the address bar never loads it.

### Main-process modules (`src/main`)
| File | Responsibility |
| --- | --- |
| `index.ts` | App lifecycle only; wires the modules together |
| `window.ts` | Frameless `BrowserWindow`, relays resize and state, window title |
| `tab-manager.ts` | Tab list, active tab, closed-tab stack, layout, batched state push |
| `tab-order.ts` | Pure: where new tabs go, which tab is active after a close |
| `tabs.ts` | `Tab` class: one `WebContentsView`, its events, window.open → new tab, find, zoom, error pages |
| `favicons.ts` | Fetches favicons in main and returns checked `data:` URLs (`image-type.ts` sniffs) |
| `user-agent.ts` | Pure: strips `Electron/x` and the app token from the user agent |
| `navigation-policy.ts` | Pure: where pages may navigate (web yes; `mailto:`/`tel:` ask; everything else blocked) |
| `external-links.ts` | Confirm dialog, then `shell.openExternal`, for `mailto:`/`tel:` only |
| `downloads.ts` | `Downloads`: every download of the app; saves into Downloads, pause/resume/cancel/open, quit prompt |
| `download-names.ts` | Pure: safe file names and "name (1).ext" numbering |
| `downloads-menu.ts` | Native menu for the downloads button (placeholder until the design pass) |
| `store.ts` | `JsonStore`: one JSON file in userData; checked on read, debounced atomic writes |
| `settings.ts` | Pure: `settings.json` format and defaults |
| `adblock.ts` | `Adblock`: filter engine lifecycle (cache, daily update), request blocking, element hiding, per-tab counts |
| `adblock-filters.ts` | Ghostery engine wrapper: build/load, `shouldBlock`, `cosmeticStyles` (no Electron; tested) |
| `adblock-policy.ts` | Pure: sites, paused list, shield status, update timing, page-scan checks |
| `adblock-worker.ts` | Worker thread that parses the filter lists (keeps main responsive) |
| `adblock-menu.ts` | Native menu for the shield (placeholder until the design pass) |
| `bookmark-list.ts` | Pure: `bookmarks.json` format, add/remove/find, URL and favicon checks |
| `bookmarks.ts` | `Bookmarks`: the list and the bar setting; star/Ctrl+D toggle, favicon refresh, open |
| `bookmarks-menu.ts` | Native menus: right-click on a bookmark or the bar, and the "»" overflow |
| `menu-text.ts` | Escapes `&` in native menu labels |
| `theme.ts` | Light/dark colours main paints itself; follows `nativeTheme` |
| `zoom-levels.ts` | Pure: Chrome's zoom steps |
| `permission-policy.ts` | Pure: allow / ask / deny per permission, prompt text, session memory of answers |
| `permissions.ts` | Session permission, check, screen-share and device handlers; Allow/Block dialogs |
| `ipc.ts` | `ipcMain` handlers, sender and argument validation |
| `shortcut-map.ts` | Pure: key input + platform → browser command |
| `shortcuts.ts` | Runs commands from `before-input-event` on UI and every tab; mouse back/forward, swipe |
| `context-menu.ts` | Native right-click menus for pages, and cut/copy/paste in the UI's text fields |
| `protocol.ts` | Registers and serves the `nebula://` scheme |
| `internal-files.ts` | Pure URL → file mapping for `nebula://` (allowlist, traversal guard) |

Keep new main-process code in focused modules like these rather than growing `index.ts`.

### Window chrome
`titleBarStyle: 'hidden'`: traffic lights on macOS (`trafficLightPosition`), `titleBarOverlay`
on Windows/Linux, both sized to the tab strip. The UI is `-webkit-app-region: drag` (`.app-drag`);
every interactive control must be `.app-no-drag`. `.titlebar-safe` (on the tab strip) reserves
space for the native controls.

## Security rules (non-negotiable)
- Tab views: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload**.
- Only the UI renderer gets the preload. Never expose `ipcRenderer` or generic
  send/invoke helpers; expose one named function per action.
- Validate the sender of **every** IPC message in main (`assertTrustedSender` in `ipc.ts`:
  must be the main window's UI webContents, top frame, trusted URL). Validate argument types too.
- Pages never open OS windows. `window.open`/`target=_blank`/middle-click open a **new tab**
  (http(s) or blank only; everything else is denied). A `window.open` page is adopted so
  `window.opener` works, with the same forced `webPreferences` (`overrideBrowserWindowOptions`).
  `<webview>` attachment is blocked.
- Pages can't navigate any frame (or be redirected) to `nebula://`, `file:` or other apps' schemes
  (`will-frame-navigate` / `will-redirect` + `decideNavigation`). `mailto:`/`tel:` open only after
  the user confirms, and only from the active tab. Main's own `loadURL` is not affected.
- The UI renderer must not navigate away from itself or open windows.
- **Permissions** (`permissions.ts`): fullscreen and clipboard writes are allowed; camera, microphone,
  location, notifications and clipboard reads ask (Allow/Block, remembered per origin until the
  browser closes); everything else is denied, including `openExternal`. Only the active tab can
  ask; the UI and `nebula://` pages always get "no". Screen sharing asks every time (screens only,
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
- **Ad blocker** (`adblock.ts`): uses `@ghostery/adblocker` directly, **never**
  `@ghostery/adblocker-electron` (its `enableBlockingInSession` adds a preload to every page and
  unchecked IPC handlers). Our own `webRequest.onBeforeRequest` (the session's only one) cancels
  matching requests from tabs; main frames, paused sites, the UI and main's own fetches are never
  blocked. Element hiding is CSS main inserts (`cssOrigin: 'user'`); the page scan for class
  names/ids runs in an isolated world and its result is checked (`parseDomTokens`). No scriptlets,
  redirect resources or `$csp` rules: nothing from the lists runs as code in pages.

## Roadmap
- **Milestone 1 (done):** frameless window, back/forward/reload-stop, address bar, title sync,
  Cmd/Ctrl+L and Cmd/Ctrl+R.
- **Home page (done):** `nebula://home/` with ChatGPT/Claude prompt; Google search.
- **Current plan: browser essentials** — [docs/plans/browser-essentials.md](docs/plans/browser-essentials.md).
  **Phases 1–6 (tabs, page essentials, permissions, downloads, bookmarks, ad blocker) done**;
  build the next phase only when the user says so. Remaining: docs.
- **Later (don't start until asked):** history + address suggestions, session restore, design pass.
