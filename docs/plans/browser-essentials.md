# Plan: browser essentials for Nebula

**Status:** approved 2026-09-25. Phases 1–4 done 2026-09-25. Build phases in order and commit after each phase.

**Changes made while building Phase 1:**
- `favicons.ts` (plus the pure `image-type.ts` sniffer) was built in Phase 1, because the tab strip shows favicons. Phase 5 reuses it for bookmarks.
- `BrowserState` holds only what exists so far (`tabs`, `active`). Each later phase adds its own fields; `zoomFactor` arrives with zoom in Phase 2.
- `move-to-index` was left out: nothing calls it until tabs can be dragged.
- Links opened with middle-click or a modifier key have no Chromium-created page to adopt, so the new tab loads the URL itself (with referrer and form data).

**Changes made while building Phase 2:**
- Ctrl+D and Ctrl+Shift+B are not mapped yet; they arrive with bookmarks in Phase 5.
- A few standard extras were mapped: Ctrl+PageUp/PageDown and Ctrl+F4 (Windows/Linux), Cmd+[ / Cmd+] and Cmd+Shift+[ / ] (macOS), Shift+F5 / Ctrl+F5 (hard reload), F3 and Ctrl+G (find next), and Shift+F12 in dev for the UI's own DevTools.
- Pages can no longer navigate to `nebula://` (an error page there would let a site fake the address bar), `file:` or other apps' schemes (`navigation-policy.ts`).
- `mailto:`/`tel:` are caught with `will-frame-navigate` and the window-open handler. Phase 3's permission handler should also deny Electron's `openExternal` permission, so nothing else can open other apps.
- The UI's text fields (address bar, find bar) got a cut/copy/paste context menu.
- A crashed page shows the error page ("This page crashed") too.
- History is kept clean: the failed load's own entry and the error page's entry are removed when the error page loads or a retry succeeds.

**Changes made while building Phase 3:**
- `openExternal` is denied by the permission handler, so only the Phase 2 confirm dialog can open other apps.
- Only the active tab can prompt. A background tab's request is refused without being remembered, so the site can ask again once it's in front.
- Screen sharing offers whole screens only (one button per screen), never audio, and requires a user gesture. Chromium first sends a `media` request with no camera/microphone type; that is let through to the screen picker, which asks.
- Permission checks can't answer "ask", so until a site requests something, `navigator.permissions.query` reports `denied` (not `prompt`). Requesting still shows the dialog.
- Also closed: Electron's default of handing the first Bluetooth device to `navigator.bluetooth.requestDevice`, and the USB, HID and serial pickers.

**Changes made while building Phase 4:**
- `BrowserState.downloads` is the full list (newest first, without file paths), so a designed panel can use it later. Status text, sizes and overall progress are pure helpers in `src/shared/downloads.ts`, shared by the UI and main.
- State batching moved from `TabManager` to `window.ts`, which pushes tabs and downloads together (at most once per tick). `Downloads` lives for the whole app (the session's `will-download`), not per window.
- File names are cleaned before use (no folders, no characters Windows rejects, no device names like `CON`, max 200 characters), then numbered like Chrome (`file (1).zip`, `src (1).tar.gz`).
- Only pages in tabs can download. A tab that a link opened just to download (`target=_blank`, middle-click) is closed again and its opener comes back to the front.
- Extras in the menu: Pause/Resume, Resume after a network interruption, Copy download link, Remove from list, Open Downloads folder. Files that were moved or deleted show "Deleted".
- Download progress shows on the taskbar/Dock icon; macOS bounces the Downloads stack when one finishes.
- Closing Nebula while downloads run asks first ("Quit and cancel" / "Keep downloading"); quitting cancels them so no partial files are left. On macOS closing the window keeps downloading, and Quit asks.
- Checked: Chromium adds the Windows mark-of-the-web (`Zone.Identifier`) to downloads, so SmartScreen still checks downloaded programs.

## Context
Nebula (Electron + electron-vite + React/TS + Tailwind v4, Bun) currently has **one tab**, a top bar (back/forward/reload-stop/home + address bar), a `nebula://home/` page (ChatGPT/Claude prompt), and Google search. You asked for "whatever is a must for a browser". You'll decide the visual design and anything else later, so this round builds **functionality and architecture** and keeps the UI plain, using the existing tokens in `src/renderer/src/assets/main.css`.

Scope you chose: essentials + **bookmarks** + **ad blocker**. Downloads **auto-save to the Downloads folder**. Not in this round: history/suggestions, session restore.

All existing rules in `CLAUDE.md` still apply: sandboxed tabs with no preload, only the UI gets the preload, every IPC sender is validated, and main is modular. **One rule changes (needs your OK via this plan):** tabs currently can't open new windows at all. After this change, `window.open` / `target=_blank` / middle-click open **a new tab** (never a new OS window). The new tab gets the same locked-down `webPreferences`. This is needed for normal browsing and for "Sign in with Google" popups, which use `window.opener`.

## What gets built

### Phase 1: Tabs foundation
- **`src/main/tab-manager.ts`** (new): owns `Tab[]`, the active id and a closed-tab stack (for Ctrl+Shift+T), plus create / close / activate / move-to-index. Only the active tab's view is attached/visible. It lays out tabs below the UI. Closing the last tab opens a new home tab.
- **`src/main/tab-order.ts`** (new, pure, tested): which tab becomes active after a close, and where a new tab is inserted (next to the opener).
- **`src/main/tabs.ts`**: `Tab` gets a numeric `id`, a favicon (`page-favicon-updated`), audio state (`isCurrentlyAudible` / `setAudioMuted`), and a zoom factor. `setWindowOpenHandler` changes from always-deny to `{action:'allow', createWindow}`.
  - `createWindow` builds a new `Tab` around the provided `webContents`, which keeps `window.opener` working for OAuth. It forces `sandbox/contextIsolation/nodeIntegration:false` and no preload.
  - It uses `disposition` to decide foreground vs background (middle-click = background).
  - `window.close()` from a page closes its tab.
- **UI-reported chrome height**: the UI measures its own height (ResizeObserver) and calls `window.browser.setChromeHeight(px)`. Main validates it (integer 0–400) and places tabs below it. This lets you redesign the top area later without touching main. `TOOLBAR_HEIGHT` in `window.ts` goes away. `titleBarOverlay` height matches the tab-strip row (`src/shared/layout.ts`).
- **State push**: replace `TabState` with one `BrowserState` in `src/shared/types.ts`:
  - `tabs[]`: `{id, title, url, favicon, isLoading, isAudible, isMuted}`
  - `active`: current tab details + `zoomFactor`, `blockedCount`, `isBookmarked`
  - `find`, `downloads`, `bookmarks`, `bookmarksBarVisible`, `adblock`
  - Main batches changes so it sends at most one push per tick.
- **IPC** (`src/main/ipc.ts`, all through the existing `assertTrustedSender`): add `tabs:new/close/activate/reopen/toggle-mute`. Tab ids are type-checked and must exist.
- **UI**: `TabStrip.tsx` in the top row (drag region, favicons, titles, close ×, "+" button, speaker icon for audible tabs). The existing `NavButtons` / `AddressBar` move to the second row.
- **User agent**: strip `Electron/x` and `nebula/x` from `app.userAgentFallback`. Otherwise Google sign-in (used by ChatGPT/Claude) blocks "embedded browsers". The cleaning function is in `src/main/user-agent.ts` and tested.

### Phase 2: Page essentials
- **Shortcuts**: `src/main/shortcut-map.ts` (new, pure, tested) maps key input + platform to a command. `shortcuts.ts` runs the commands and is attached to the UI and **every** tab's webContents.
  - Ctrl/Cmd +: T, W, Shift+T, Tab / Shift+Tab, 1–8, 9 (last tab), L, R, Shift+R (hard reload), F, D (bookmark), Shift+B (bookmarks bar), P (print), = / − / 0 (zoom)
  - Also: F5, Esc (stop), Alt+←/→, Alt+Home, F11 (window fullscreen), F12 / Ctrl+Shift+I (page DevTools)
  - Mouse back/forward buttons: `app-command` on Windows, `swipe` on macOS.
- **Context menu** (`src/main/context-menu.ts`): native `Menu.popup` from the `context-menu` params. Entries:
  - Back, Forward, Reload
  - For links: open in new tab, copy link address
  - For images: open image in new tab, copy image, save image as
  - For text: Cut / Copy / Paste / Select all, spelling suggestions, "Search Google for '…'"
  - Inspect
- **Find in page**: `FindBar.tsx` row, shown with Ctrl+F. Uses `findInPage` / `stopFindInPage` and the `found-in-page` event for "3 of 12". Enter / Shift+Enter move next / previous; Esc closes. The chrome height grows automatically.
- **Zoom**: per-site zoom (Chromium default), Ctrl +/−/0 and Ctrl+wheel. The address bar shows a "110%" badge when not at 100%; clicking it resets.
- **Error pages**: when the main frame fails to load (not for `ERR_ABORTED`), load `nebula://error/?code=…&url=…`.
  - The page is new: `resources/pages/error/`, and `error` is added to `PAGES` in `src/main/internal-files.ts`.
  - The address bar keeps showing the failed URL, and Reload retries it.
  - The page's "Try again" only follows http(s) URLs.
  - The error URL builder goes in `src/shared/url.ts` (tested).
- **HTML fullscreen** (videos): `enter-html-full-screen` puts the window in fullscreen, hides the UI and lays the tab out at `y=0`. Leaving restores it.
- **External links** (`mailto:`, `tel:`): ask first with a native dialog, then `shell.openExternal`, for those two schemes only. Every other scheme is ignored.
- **Print**: `webContents.print()`.

### Phase 3: Permissions (security must)
Electron **grants every permission by default** today. `src/main/permissions.ts` adds `setPermissionRequestHandler` + `setPermissionCheckHandler` on the default session. The pure policy lives in `permission-policy.ts` (tested):
- **Allow silently:** fullscreen, clipboard-sanitized-write.
- **Prompt** with a native dialog ("chatgpt.com wants to use your microphone. Allow / Block"): camera, mic, geolocation, notifications, clipboard-read, screen share (via `setDisplayMediaRequestHandler`).
  - Decisions are remembered per site **for this session only**; persisting them would need the storage you postponed.
- **Deny:** everything else.
- Requests from the UI renderer and from `nebula://` pages are always denied.

### Phase 4: Downloads
`src/main/downloads.ts`: `will-download` → `setSavePath` into `app.getPath('downloads')`, with unique names like "file (1).zip" from `download-names.ts` (pure, tested). It tracks progress / done / cancelled / failed.
- **UI:** a downloads button appears in the toolbar once there is a download, with a progress ring.
- **Clicking it** opens a native menu of recent downloads: cancel while in progress; **Open** / **Show in folder** when done; **Clear list**.
- Downloads never open automatically.
- The native menu is a placeholder until you design a panel.

### Phase 5: Bookmarks
- **`src/main/store.ts`** (new): a small JSON store in `userData`. It validates on read and writes atomically (temp file + rename, debounced). Two files:
  - `bookmarks.json`: `{id, url, title, favicon}`
  - `settings.json`: bookmarks bar visible, ad-block on/off, sites where ad blocking is paused
- **`src/main/bookmarks.ts`**: add / remove / toggle for the active tab. Only http(s) URLs can be bookmarked. Parsing and validation are in a pure, tested module.
- **Favicons** (`src/main/favicons.ts`): main downloads the page's favicon itself (size-capped, cached) and turns it into a `data:` URL. The UI's CSP (`img-src 'self' data:`) stays as it is, and bookmarks store the icon.
- **UI:**
  - A star button in the address bar (and Ctrl+D) bookmarks the page or removes the bookmark.
  - `BookmarksBar.tsx` row with chips; toggle it with Ctrl+Shift+B.
  - Bookmarks that don't fit go into a "»" native menu.
  - Right-click a chip for a native menu: Open, Open in new tab, Remove.
- **IPC:** `bookmarks:toggle-current/open/remove/show-menu` and `bookmarks-bar:toggle`. Ids and URLs are validated.

### Phase 6: Ad blocker
- **`src/main/adblock.ts`** uses `@ghostery/adblocker-electron`'s engine (ads + tracking lists).
  - The engine is cached as `userData/adblock-engine.bin` and refreshed in the background.
  - It **does not** call `enableBlockingInSession`, because that registers a session-wide preload and would break the "tabs have no preload" rule. I'll confirm this against the package source when I build it.
- **Network blocking:** our own `webRequest.onBeforeRequest` hands off to the engine and skips sites where you've paused blocking.
- **Hiding ad boxes:** main injects CSS on `dom-ready` using the engine's rules for that site, with no preload involved.
- **Counting:** blocked requests are counted per tab and reset on navigation.
- **UI:** a shield in the address bar shows "12". Clicking it opens a native menu: pause on this site, turn off everywhere, turn on. The setting is saved in `settings.json`.
- If the filter lists can't be downloaded (offline), browsing still works and the shield shows "off".

### Phase 7: Docs
Update `CLAUDE.md`: new modules, the window.open → new tab rule, the permissions / download / ad-block rules and the storage files. Update the roadmap (done: essentials, bookmarks, ad blocker; later: history + suggestions, session restore, design pass).

## Critical files
- **Modify:** `src/main/{index,window,tabs,ipc,shortcuts,internal-files}.ts`, `src/shared/{types,url}.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx, components/*}`, `CLAUDE.md`, `package.json` (add `@ghostery/adblocker-electron`)
- **New main modules:** `tab-manager`, `tab-order`, `shortcut-map`, `context-menu`, `permissions`, `permission-policy`, `downloads`, `download-names`, `store`, `bookmarks`, `favicons`, `adblock`, `user-agent`
- **New shared:** `src/shared/layout.ts`
- **New UI components:** `TabStrip`, `FindBar`, `BookmarksBar`, `DownloadsButton`
- **New page:** `resources/pages/error/`
- **Reused as-is:** `assertTrustedSender` (`ipc.ts`), `resolveInput` / `isHomeUrl` / `HOME_URL` (`shared/url.ts`), `resolveInternalFile` (`internal-files.ts`), `handleInternalProtocol` (`protocol.ts`), and the `NavButton` / icons pattern

## Verification
- Each phase ends with `bun run typecheck`, `bun test` (new pure modules get tests) and `bun run lint` all green, then a commit (one per phase).
- Run `bun run dev` and screenshot the window with the PrintWindow capture used before, to check the layout: tab strip, find bar, bookmarks bar, fullscreen.
- **Manual checklist I'll hand you:**
  - Tabs: open / close / reopen / switch by keyboard; middle-click a link opens a background tab.
  - "Sign in with Google" on chatgpt.com works (popup tab + UA fix).
  - Right-click menus work.
  - Ctrl+F finds text; zoom badge appears; YouTube fullscreen hides the chrome and restores it.
  - Offline shows the error page and Reload retries.
  - Mic prompt appears on ChatGPT voice.
  - A download lands in Downloads with Open / Show in folder.
  - Ctrl+D stars a page, it appears in the bookmarks bar, and it survives a restart.
  - The shield counts blocked requests on a news site; pausing on a site works.
- **Known placeholders** until your design pass: native menus for downloads / bookmark overflow / shield, and a plain horizontal tab strip.
