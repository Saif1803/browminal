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
- **UI** (address bar, later the tab strip) is a React app in the renderer: `src/renderer/src`.
  It is the `webContents` of the main `BrowserWindow`, occupying the top bar (`TOOLBAR_HEIGHT` = 44px).
- **Tabs** are `WebContentsView`s owned by the main process, added with `window.contentView.addChildView`
  and positioned below the top bar with `setBounds`; main recomputes bounds on window resize.
  The UI never sends bounds.
- **UI ↔ main** only through the typed API in `src/preload/index.ts`, exposed via `contextBridge`
  as `window.browser` (`navigate`, `back`, `forward`, `reload`, `stop`, `getState`) plus push
  events main sends (`onTabState` → `{url, title, canGoBack, canGoForward, isLoading}`,
  `onFocusAddressBar`). The contract lives in `src/shared/types.ts` (`BrowserApi`, `TabState`,
  `IpcChannel`); change it there first.
- Address-bar input is resolved **in main** by `resolveInput` in `src/shared/url.ts`
  (http(s) as-is; bare domains get `https://`; localhost/IPs get `http://`; everything else,
  including other schemes, is a DuckDuckGo search).

### Main-process modules (`src/main`)
| File | Responsibility |
| --- | --- |
| `index.ts` | App lifecycle only; wires the modules together |
| `window.ts` | Frameless `BrowserWindow`, tab layout on resize, window title |
| `tabs.ts` | `Tab` class: one `WebContentsView`, its events, `TabState` |
| `ipc.ts` | `ipcMain` handlers and sender validation |
| `shortcuts.ts` | Cmd/Ctrl+L, Cmd/Ctrl+R via `before-input-event` on UI and tab |

Keep new main-process code in focused modules like these rather than growing `index.ts`.

### Window chrome
`titleBarStyle: 'hidden'`: traffic lights on macOS (`trafficLightPosition`), `titleBarOverlay`
on Windows/Linux. The top bar is `-webkit-app-region: drag` (`.app-drag`); every interactive
control must be `.app-no-drag`. `.titlebar-safe` reserves space for the native controls.

## Security rules (non-negotiable)
- Tab views: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload**.
- Only the UI renderer gets the preload. Never expose `ipcRenderer` or generic
  send/invoke helpers; expose one named function per action.
- Validate the sender of **every** IPC message in main (`assertTrustedSender` in `ipc.ts`:
  must be the main window's UI webContents, top frame, trusted URL). Validate argument types too.
- Tabs can't open new windows: `setWindowOpenHandler` returns `{ action: 'deny' }`.
  `<webview>` attachment is blocked.
- The UI renderer must not navigate away from itself or open windows.
- Only http(s) URLs are loaded into tabs from the address bar.

## Roadmap
- **Milestone 1 (done):** frameless window, back/forward/reload-stop, address bar, title sync,
  Cmd/Ctrl+L and Cmd/Ctrl+R.
- **Later (don't start until asked):** multiple tabs + tab strip, storage (history/bookmarks/
  session restore), ad blocking.
