# Plan: next steps from where Browminal is now

**Status:** approved 2026-11-10 with the recommended answers (order as below, Electron to 45).
Decisions 2 (history and session restore) and 4 (shipping) are still open: Phases 3 and 5 wait
for them.

**Progress (2026-11-10, branch `next-steps`):**
- Phase 0 done: the working tree landed as four commits (rename, internal pages, overlay, docs),
  each passing the three checks; the design inventory and the README are up to date.
- Phase 1: single instance and `bun run smoke` are built, and the smoke test passes on Electron
  39 (2026-11-11, seven runs in a row). Its first runs found a real bug: a tab just brought to
  the front stays hidden under the old one until it draws, and drops input meanwhile, so a click
  right after `new_tab` was lost. Agent tools now wait for their tab to be on screen
  (`TabManager.whenShown`).
- Electron is on **45.3.0** (Node 24, Chromium 156), in three steps (41, 43, 45), each with the
  checks and the smoke test passing. What changed for us: PDFs show in frames of the tab, and the
  frame-navigation rule blocked Chromium's PDF viewer until it was allowed (subframes only); the
  binary downloads on first launch (42); the folder dialog opens beside the last project folder
  (43); `clipboard.writeText` returns a Promise (44, `copyText`); screen sharing reaches the
  permission handler as `display-capture` (45). Left for the manual pass: glass, window controls,
  the terminal, fullscreen video, screen sharing (its picker is a native box the smoke test can't
  answer), a PDF.
- Dependencies are current (2026-11-11): vite 8 (Rolldown), electron-vite 6, plugin-react 6,
  TypeScript 6.0, `@types/node` 24 (Electron's Node), the eslint configs, the Rust crates' patch
  releases. Held back, waiting on others: **ESLint 10** (eslint-plugin-react 7.37.5 doesn't run on
  it) and **TypeScript 7** (typescript-eslint supports < 6.1). `@lydell/node-pty` is a beta, but
  its latest. Phase 1 is done apart from the manual pass.
- Found on the way, fixed 2026-11-14: a tab an agent opened while Browminal was minimized never
  drew and lost clicks (the tool still said it clicked). Three causes: the new tab waited under
  the old one for a frame that never came; pages took the minimized window's tiny size; and
  Chromium drops mouse presses on a hidden page, which also hit a window merely covered by
  others. Now such a page is told it's visible while an agent works on it
  (`TabDebug.wakeIfHidden`); the smoke test minimizes the window and clicks.
- Phase 2: same-site iframes, `drag`, CPU throttling and original names in minified stacks are
  built and unit-tested; the smoke test runs the first three against the real app (minified
  names still only in unit tests). Left: cross-origin (out-of-process)
  iframes, which need child CDP sessions; to be built with the app running.

- Phase 5 started (2026-11-14), decision 4 answered: Browminal is released as open source (MIT),
  built from source, with a Windows installer. Done: `electron-builder.yml` (real `appId`,
  `Browminal`, no publish URL, ad-hoc signing on macOS, AppImage on Linux), version 0.1.0, the
  icon (`build/icon.svg`, `bun run icons`), `LICENSE`, `THIRD-PARTY.md`, the README, and CI (the
  checks on Windows, macOS and Linux; a `v*` tag builds installers into a draft release). The
  packaged Windows app passes the smoke test (`--app`). Not done: signing and notarisation,
  auto-update, the smoke test in CI, any run on macOS or Linux, the public repository itself.
- Phase 3 started (2026-11-18), decision 2 answered for session restore: it's built. The tabs
  are kept in `session.json` (`session.ts`, format in `session-file.ts`), brought back on the next
  launch with only the tab in front loading (the others when first shown, or when an agent tool
  needs one), never shared; `startup: 'home'` in `settings.json` keeps nothing. The smoke test
  quits, relaunches and checks the tabs, that a background tab fetches nothing, and that Ctrl+1
  loads it. Not built yet: history and suggestions (`history-list.ts` is written, not wired in),
  a place in the UI to choose the startup setting.
- Tab strip done (2026-11-20): drag to reorder (the tab follows the pointer, the others glide
  aside, the new order shows at once; pure rules in `src/shared/tab-drag.ts`) and a right-click
  menu through the overlay (`tab-menu.ts`). The smoke test drags a tab with real mouse events and
  picks Duplicate from the menu. No keyboard reorder yet.

## Where it stands (checked 2026-11-10)
- Browser essentials and the agent browser (Phases 1–6) are done. `bun run typecheck`,
  `bun test` (318 tests, 35 files) and `bun run lint` are all green.
- **About 100 files are changed and not committed** (+2 667 / −1 361 lines): the rename to
  Browminal, the overlay (agent sheet, errors popover, questions, menus), `menu-model.ts`,
  `shared/agents.ts`, the bundled Inter font. The last commit is the adblock-rust one.
- **Electron is 39.8.10; the current release is 45.2.3.** Electron supports its newest three
  majors, so 39 no longer gets Chromium security fixes. For a browser this is the biggest risk
  in the repo.
- **No single-instance lock.** A second Browminal started by accident shares `userData`: two
  processes write `settings.json`, `bookmarks.json` and `agent.json`, and compete for port 9339.
- **Every runtime check is by hand** (the CDP procedure in the memory note). Nothing runs the
  built app automatically, so an Electron upgrade can't be checked without redoing it all.
- Agent gaps, as listed in `docs/agents.md`: iframes (only the main frame is read), drag and
  drop, CPU throttling, original names in minified stacks.
- Still native: the downloads quit prompt, the screen-share picker. Downloads and the shield are
  plain overlay menus, not panels. The tab strip has no drag to reorder and no right-click menu.
- `docs/design-inventory.md` describes the UI from before the overlay (native menus, a "Claude"
  button in the terminal header). `electron-builder.yml` still has the template's
  `appId: com.electron.app`, `maintainer: electronjs.org` and an `example.com` update URL.

The order below is: make the base safe, then close the agent gaps (the app's main purpose), then
daily-use comfort, then the rest of the design pass, then shipping.

## What gets built

### Phase 0: Land what's there
- Commit the working tree in a few commits that each pass the three checks: the rename, the
  overlay and menus, the fonts and internal pages, docs.
- Bring `docs/design-inventory.md` up to date (overlay surfaces, the terminal start page, what is
  still a placeholder) and fix the README's one-line description.

### Phase 1: A safe base
- **Single instance:** `app.requestSingleInstanceLock()` in `index.ts`; a second launch focuses
  the window (and opens an http(s) URL from its command line in a new tab, through
  `resolveInput`'s http(s) rule only).
- **Smoke test of the built app** (`scripts/smoke.ts`, `bun run smoke`): the memory note's manual
  procedure as a script. It builds, starts the app on a throwaway `--user-data-dir` with the
  bridge pre-enabled on a spare port, and drives it **through the bridge's own MCP endpoint**
  (no `--remote-debugging-port` in the product, only in this script where it needs the UI):
  open a local test page, `read_page`, `click`, `fill`, `console_messages`, `network_requests`,
  `screenshot`, an unshared tab stays invisible, a request with an `Origin` header is refused,
  a page can't navigate to `browminal://`. It exits non-zero on the first failure.
- **Electron 39 → 45**, one or two majors at a time, reading each release's breaking changes,
  with the smoke test and the three checks after every step. Watch: `WebContentsView` and
  `titleBarOverlay` behaviour, `webContents.debugger`, acrylic/vibrancy, `@lydell/node-pty`
  prebuilds for the new ABI, the napi module (Node-API, so it should need no change).
- Other dependencies to current, in the same way.

### Phase 2: Agent gaps
Biggest first.
- **Iframes.** Today refs, `read_page`, `find`, `click`, `inspect` and `evaluate` see the main
  frame only, so Storybook's preview, embedded sign-in and payment forms, and any app in an
  iframe are invisible. Same-process frames: read the tree per frame
  (`Accessibility.getFullAXTree` with `frameId`) and join them under their `<iframe>` node in
  `ax-tree.ts`. Out-of-process frames: `Target.setAutoAttach` with `flatten`, one child session
  per frame in `cdp.ts`, refs that carry their session. Clicks need the frame's offset added to
  the box. `canInspect` applies per frame (never a `browminal://` frame). Console and network
  logs take the child sessions' events too.
- **Drag and drop:** a `drag(from, to)` tool with `Input.setInterceptDrags` +
  `Input.dispatchDragEvent` for HTML5 drag, plain mouse press/move/release for pointer-based
  libraries; the tool tries the first and reports which it used.
- **CPU throttling:** `emulate` gets `cpu: 4 | 6 | 1` (`Emulation.setCPUThrottlingRate`), shown
  in the emulation badge and reset with it.
- **Original names in minified stacks:** `source-maps.ts` already resolves file and line; take
  the `name` of the mapping at the *caller's* call site for each frame's function name.
- `docs/agents.md` updated for each (its "Not built yet" section shrinks to nothing).

### Phase 3: Daily use
- **Session restore:** `session.json` through `JsonStore` (tab URLs, order, active tab, checked
  on read, http(s) only); written on change, restored on start, tabs other than the active one
  loaded when first shown. Shared-with-agent is **not** restored: sharing is always a fresh
  decision.
- **Tab strip:** drag to reorder (the `move-to-index` left out of essentials), and a right-click
  menu through the overlay: Reload, Duplicate, Mute, Share with agents, Close, Close others,
  Reopen closed tab.
- **History and address suggestions:** `history.json` (URL, title, last visit, visit count;
  capped, checked on read), suggestions from history and bookmarks under the address bar, drawn
  by the overlay; "Clear history". Ranking is a pure, tested module.
- **Remembered permissions** (optional): Allow/Block kept per origin across restarts, with a
  place to see and remove them.

### Phase 4: Finish the design pass
Needs designs from the "Nebula Design Pass" project first; build order as they arrive.
- Downloads panel and shield panel in place of the plain menus.
- Screen-share picker and the downloads quit prompt as overlay questions (the last two native
  boxes; the OS folder picker stays native).
- A picks list (the newest 20 are in memory but the user can't see them).
- A settings page (`browminal://settings/` can't have IPC, so it's an overlay surface or a row
  in the UI): bridge port, share-all, ad blocker, bookmarks bar, terminal defaults, permissions.
- The tab strip's final look.

### Phase 5: Ship it (only if others will install it)
- `electron-builder.yml`: a real `appId`, maintainer, icons, the description; remove the
  `example.com` publish URL until there is an update server.
- Windows code signing, macOS signing and notarisation (`notarize: false` today).
- Auto-update (`electron-updater` against GitHub Releases), asked for, never silent mid-session.
- CI (GitHub Actions): the three checks, clippy and rustfmt, the smoke test, on Windows and macOS.

## Rules that change (need your OK)
1. **Phase 1:** a second launch may hand an http(s) URL to the running instance (new tab).
2. **Phase 2:** main attaches CDP sessions to **frames inside shared tabs**, including
   cross-origin ones. Sharing a tab then shares what it embeds; the docs must say so.
3. **Phase 3:** Browminal starts keeping browsing history and open tabs on disk
   (`history.json`, `session.json`), where today nothing about visited pages is stored.

## Decisions for you
1. **Order:** as above (recommended), or daily use (Phase 3) before the agent gaps?
2. **History and session restore** are under "Later (don't start until asked)" in `CLAUDE.md`.
   Start them in Phase 3, or keep them parked?
3. **Electron:** go to 45 now (recommended), or stop at the oldest still-supported major?
4. **Shipping:** is Browminal only for you, or will others install it? Phase 5 is only worth
   doing for the second.

## Verification
- Each phase ends with `bun run typecheck`, `bun test`, `bun run lint` (clippy and rustfmt when
  `native/` changed) and, from Phase 1 on, `bun run smoke`; then one commit per phase or step.
- New pure logic gets tests: joined frame trees in `ax-tree.ts`, names in `source-maps.ts`,
  `session.json` and `history.json` formats, suggestion ranking.
- Phase 2 end to end with the real Claude Code against a test app with a same-origin iframe, a
  cross-origin iframe, a drag-to-sort list and a minified build.
- Phase 1's upgrade: a manual pass on glass, window controls, the terminal and fullscreen video
  after the last step, since the smoke test can't see those.
