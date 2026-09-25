# Nebula — desktop web browser (Electron)

## Stack
- **electron-vite** (React + TypeScript template, `@quick-start/electron`).
- **Bun** is the package manager and script runner only. The app runs on Electron's Node:
  never use Bun-only APIs (`Bun.*`, `bun:*` imports) in `src/main`, `src/preload` or `src/renderer`.
  `bun:test` is allowed in `*.test.ts` files only.
- `package.json` has `"trustedDependencies": ["electron", "esbuild"]` so their install scripts run under Bun.
- **Tailwind CSS v4** via `@tailwindcss/vite` (theme tokens in `src/renderer/src/assets/main.css`).

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
  plus push events main sends (`onState` → one `BrowserState`, batched to at most one per tick;
  `onFocusAddressBar`). The contract lives in `src/shared/types.ts` (`BrowserApi`, `BrowserState`,
  `IpcChannel`); change it there first.
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
| `tabs.ts` | `Tab` class: one `WebContentsView`, its events, window.open → new tab |
| `favicons.ts` | Fetches favicons in main and returns checked `data:` URLs (`image-type.ts` sniffs) |
| `user-agent.ts` | Pure: strips `Electron/x` and the app token from the user agent |
| `ipc.ts` | `ipcMain` handlers, sender and argument validation |
| `shortcuts.ts` | Cmd/Ctrl+L, Cmd/Ctrl+R via `before-input-event` on UI and every tab |
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
- The UI renderer must not navigate away from itself or open windows.
- Only http(s) URLs are loaded into tabs from the address bar.

## Roadmap
- **Milestone 1 (done):** frameless window, back/forward/reload-stop, address bar, title sync,
  Cmd/Ctrl+L and Cmd/Ctrl+R.
- **Home page (done):** `nebula://home/` with ChatGPT/Claude prompt; Google search.
- **Current plan: browser essentials** — [docs/plans/browser-essentials.md](docs/plans/browser-essentials.md).
  **Phase 1 (tabs) done**; build the next phase only when the user says so. Remaining: page
  essentials (shortcuts, context menu, find, zoom, error pages, fullscreen), permissions,
  downloads, bookmarks, ad blocking, docs.
- **Later (don't start until asked):** history + address suggestions, session restore, design pass.
