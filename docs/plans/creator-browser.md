# Plan: Nebula for content creators

**Status:** draft 2026-09-25, waiting for your OK. Nothing here is built yet.

## Context
Browser essentials are done (tabs, page essentials, permissions, downloads, bookmarks, ad blocker;
see [browser-essentials.md](browser-essentials.md)). This round makes Nebula a browser for
**content creators**: the place where material is **captured, previewed and handed off** while
making content. It does not try to replace the platforms' own studios (YouTube Studio, TikTok,
Instagram) for posting or analytics.

The UI stays plain like last round: new controls use the existing tokens, and menus that need a
real design are native placeholder menus until the design pass.

**Not in this round:** video downloaders for YouTube/Instagram/TikTok (against their terms and a
constant maintenance job), auto-posting by scripting platform sites (gets accounts flagged; later,
official APIs only), analytics dashboards (OAuth per platform), history/suggestions, session
restore.

All rules in `CLAUDE.md` still apply. **Three rules change and need your OK via this plan:**
1. **The UI may record one tab** (Phase 2). Today the UI always gets "no" for every permission.
   After this change, main grants the UI's `getDisplayMedia` request once, only right after the
   user pressed Record in Nebula's own controls, and only for the active tab's frame (never a
   screen or another app).
2. **Main attaches the Chromium debugger to a tab** for a moment (Phase 2 full-page screenshots,
   Phase 4 touch emulation), only from a user command, never from anything a page does.
3. **More than one session** (Phase 5 profiles). Every rule that is set up on the default session
   today (permissions, ad blocker, downloads, user agent) is set up on every profile's session.

## What gets built

### Phase 1: One setup for every session (no visible change)
Profiles (Phase 5) need several sessions, but `permissions.ts`, `adblock.ts` (the session's only
`webRequest.onBeforeRequest`) and `downloads.ts` each reach for `session.defaultSession` directly.
Fix that first, before new features add more of the same.
- **`src/main/sessions.ts`** (new): `setupSession(ses)` runs every per-session setup in one place:
  permission handlers, display-media handler, device-picker cancels, the ad blocker's request
  handler, `will-download`, spellchecker. `index.ts` calls it for the default session.
- `permissions.ts`, `adblock.ts` and `downloads.ts` take a `Session` instead of using
  `session.defaultSession`. Remembered permission answers are kept per session.
- The ad blocker keeps one engine and one set of per-tab counts; it adds/removes its handler on
  every registered session when it's switched on/off.
- Tests: none new (no pure logic); `bun run typecheck`/`bun test` and a manual pass over
  permissions, downloads and the shield.

### Phase 2: Capture
**Screenshots**
- **`src/main/capture.ts`** (new):
  - *Visible area:* `webContents.capturePage()` of the active tab.
  - *Full page:* `webContents.debugger.attach()`, `Page.captureScreenshot` with
    `captureBeyondViewport`, detach. Height capped (Chromium's texture limit, ~16k px); taller pages
    are cut with a note in the result. If the debugger can't attach (e.g. DevTools is using it on
    older Chromium), it falls back to the visible area and says so.
  - *Region:* freeze-frame, so no overlay has to sit above a live page. Main captures the visible
    area, detaches the tab view and tells the UI (state `capture: {mode: 'region', image}`); the UI
    fills the window with the still image and lets the user drag a rectangle; main crops it
    (`nativeImage.crop`) and re-attaches the tab. Esc cancels.
- Results are copied to the clipboard **and** saved as PNG in `Pictures/Nebula/`
  (`app.getPath('pictures')`) as `Nebula 2026-09-25 14.03.12.png`, cleaned and numbered with
  `download-names.ts`. A short "Saved: Show in folder" notice appears in the toolbar.
- **Pure, tested:** `capture-names.ts` (file names from a date), `capture-region.ts` (clamp and
  scale a UI-drawn rectangle to image pixels, device pixel ratio included).

**Recording a tab**
- Press Record → main arms a one-shot grant (valid ~2 s, for this tab's main frame) → the UI calls
  `getDisplayMedia` → the display-media handler sees the UI as sender, checks the grant and answers
  `{video: tab.mainFrame, audio: tab.mainFrame}` (Electron captures that `WebFrameMain` directly,
  with the tab's own audio, nothing else on screen). Any other request from the UI is still denied.
- The UI encodes with `MediaRecorder` and sends chunks to main (`capture:recording-chunk`, typed
  `ArrayBuffer`, size-capped per chunk and per recording), which appends them to a file in
  `Videos/Nebula/`. Stop, closing the tab or switching tabs ends the recording and finishes the file.
- **Format:** WebM (VP9/Opus) always works. MP4 only if `MediaRecorder.isTypeSupported('video/mp4')`
  says so in Electron's Chromium (to check; Electron may lack the H.264 encoder). No ffmpeg. GIF is
  left out of this round.
- A red dot with the elapsed time replaces the capture button while recording; the tab's strip entry
  shows a recording mark.

**Controls**
- Toolbar camera button → native placeholder menu: Visible area, Full page, Region, Record tab /
  Stop recording, Open captures folder.
- Shortcuts in `shortcut-map.ts`: Ctrl/Cmd+Shift+S region screenshot (Edge's web-capture key),
  Ctrl/Cmd+Shift+E start/stop recording. Page right-click gets "Capture full page".
- **IPC:** `capture:screenshot(kind)`, `capture:region-done(rect | null)`, `capture:record-toggle`,
  `capture:recording-chunk`, `capture:recording-ended`, `capture:show-menu`.

### Phase 3: Studio mode (clean, fixed-size recording)
For tutorial makers who record with OBS or the Phase 2 recorder.
- A toggle (toolbar menu + Ctrl/Cmd+Shift+U) with a size: **1920×1080, 1280×720, 1080×1920
  (vertical), 1080×1080**. Saved in `settings.json` as `studio: {enabled, size}`.
- While on:
  - The page is laid out at **exactly** the chosen size in CSS pixels. `tab-manager.ts` gives the
    page the exact bounds, square corners and no inset, and grows the window to fit
    (`setContentSize`). If the screen is too small, the page is laid out at the chosen size and
    scaled down to fit with `enableDeviceEmulation` (`viewSize` + `scale`), and the toolbar shows
    "scaled 67%": what it records is then the scaled size.
  - The bookmarks bar and the shield/downloads/zoom badges are hidden; the tab strip shrinks to
    the active tab only; scrollbars are hidden (`scrollbars.ts` gets a hidden mode).
- **Pure, tested:** `studio-layout.ts`: chosen size + screen work area + chrome height → window
  content size, page bounds and scale.

### Phase 4: Device preview
See how a page (or your draft post) looks on a phone, per tab.
- Presets in **`device-presets.ts`** (pure, tested): iPhone 15, Pixel 8, iPad mini, a generic
  1080-wide Android; width, height, device pixel ratio, mobile flag and user agent.
- `Tab.setDevice(preset | null)`: `enableDeviceEmulation({screenPosition: 'mobile', …})`,
  `setUserAgent` (mobile UA) and touch emulation over the debugger
  (`Emulation.setTouchEmulationEnabled`), then reload. The page is laid out centred at the device
  size with the strip behind it showing through.
- The address bar shows the device name as a badge; clicking it opens the preset menu (and "Off").
  Rotate swaps width and height.
- `BrowserState.active` gets `device: {name, width, height, rotated} | null`.
- Later, not this round: two tabs side by side (desktop and phone) in one window.

### Phase 5: Profiles (several accounts at once)
Creators run a brand account and a personal one on the same sites.
- **`profile-list.ts`** (pure, tested): `profiles.json` format (`{version: 1, profiles: [{id, name,
  color}]}`), add/rename/remove, colour from a fixed list of tokens. Checked on every read like
  bookmarks.
- **`profiles.ts`**: the default profile is `session.defaultSession` (existing sign-ins stay);
  others are `session.fromPartition('persist:profile-<id>')`, each passed through `setupSession`
  (Phase 1) when first used.
- Tabs get a `profileId`: `Tab` is created with that session; pages opened with `window.open`
  stay in the opener's profile; the closed-tab stack remembers it; new tabs use the active tab's
  profile. The tab strip shows the profile's colour as an edge on each tab.
- New tab button right-click → "New tab in…" menu; Ctrl/Cmd+Shift+N opens a tab in the next profile.
- **Removing a profile** asks first ("Remove 'Brand' and sign out of every site in it?"), closes its
  tabs, then `clearStorageData()` and deletes its partition folder.
- Bookmarks and settings are shared by all profiles (one `bookmarks.json`, one `settings.json`).
  Downloads from every profile go to the same list.
- `BrowserState` gets `profiles`; `tabs[]` gets `profileId`.

### Phase 6: Clips side panel
A research/moodboard panel: save text, images, links and screenshots with their source.
- **Layout:** the UI already reports its height; it now also reports a right inset
  (`setChromeInsets({top, right})`, replacing `setChromeHeight`; right validated 0–600).
  `tab-manager.ts` narrows the page by it. Change the contract in `types.ts` first.
- **`clip-list.ts`** (pure, tested): `clips.json` format
  (`{version: 1, clips: [{id, kind: 'text' | 'image' | 'link' | 'capture', text?, file?, sourceUrl,
  sourceTitle, createdAt}]}`), checked on read.
- **`clips.ts`**: images and captures are files in `userData/clips/` (never in the JSON or the state
  push); the UI gets a 240 px `data:` thumbnail per clip, so the UI's CSP stays
  `img-src 'self' data:`. Image clips are fetched in main through the tab's own session
  (`ses.fetch`, so signed-in images work), size-capped (10 MB) and checked with `image-type.ts`.
- **Adding:** page right-click → "Clip selection" / "Clip image" / "Clip link"; the capture menu
  gets "Send to clips"; Ctrl/Cmd+Shift+K clips the current page as a link.
- **Using:** `ClipsPanel.tsx` (toggle Ctrl/Cmd+Shift+Y): list, remove, open source, copy.
  **Drag a clip out** into other apps (Canva, Premiere, Finder) with `webContents.startDrag` from
  main (`clips:start-drag(id)`; main resolves the id to its own file). "Export as Markdown" writes
  the board with source links into Downloads.
- **IPC:** `clips:toggle-panel`, `clips:remove`, `clips:open-source`, `clips:copy`,
  `clips:start-drag`, `clips:export`. Ids are type-checked and must exist.

### Phase 7: Hand off to Claude / ChatGPT
Same approach as the home page: open the assistant's site with the prompt filled in. No API keys,
nothing stored, nothing sent until the user picks an item.
- **`prompt-templates.ts`** (pure, tested): templates that take the page title, URL and selection:
  *Write captions*, *Hook ideas*, *Summarise*, *Turn into a thread*, *Explain*. Selections are
  trimmed so the URL stays under ~8 000 characters.
- Page right-click (with or without a selection) → "Ask Claude…" / "Ask ChatGPT…" submenus → a new
  tab next to the page with `https://claude.ai/new?q=…` or `https://chatgpt.com/?q=…`.
- The clips panel gets "Ask Claude with these clips" (text and links only).

### Phase 8: Docs
Update `CLAUDE.md`: new modules in the table, the three rule changes above, the new storage
(`profiles.json`, `clips.json`, `userData/clips/`, `settings.json` `studio`), capture folders, and
the roadmap.

## Critical files
- **Modify:** `src/main/{index,window,tab-manager,tabs,ipc,permissions,adblock,downloads,shortcut-map,shortcuts,context-menu,scrollbars,settings}.ts`,
  `src/shared/{types,layout}.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx, components/*}`, `CLAUDE.md`
- **New main modules:** `sessions`, `capture`, `capture-names`, `capture-region`, `capture-menu`,
  `studio-layout`, `device-presets`, `profile-list`, `profiles`, `clip-list`, `clips`,
  `prompt-templates`
- **New UI components:** `CaptureButton`, `RegionPicker`, `RecordingBadge`, `DeviceBadge`, `ClipsPanel`
- **Reused as-is:** `JsonStore`, `download-names.ts`, `image-type.ts`, `assertTrustedSender`,
  `favicons.ts`, the native-menu placeholder pattern

## Decisions for you
1. **OK to the three rule changes** (UI records one tab on request; debugger on tabs from user
   commands; several sessions).
2. **Order:** as above, or profiles earlier (right after Phase 1) if multi-account matters more to
   you than capture.
3. **Recording format:** WebM only is fine for now? MP4 would mean bundling ffmpeg (~80 MB) if
   Electron can't encode H.264 itself.
4. **Where captures go:** `Pictures/Nebula` and `Videos/Nebula`, or everything in `Downloads`.

## Verification
- Each phase ends with `bun run typecheck`, `bun test` (every new pure module gets tests) and
  `bun run lint`, then a commit (one per phase).
- Run the app and screenshot it over CDP (see memory: verify the app over CDP) for layout: region
  picker, studio sizes, device preview, clips panel, profile colours.
- **Manual checklist I'll hand you:**
  - Phase 1: mic prompt, a download and the shield still work.
  - Screenshots: visible / full page on a long article / region; all land in the folder and the
    clipboard.
  - Record a YouTube tab for 10 s with sound; the file plays; a page can't start a recording itself.
  - Studio 1920×1080 on a 1080p screen shows "scaled"; 1280×720 is exact (check a screenshot's
    size).
  - Device preview: a site serves its mobile layout; touch scrolling works.
  - Profiles: sign in to the same site in two profiles at once; remove a profile and its sign-in is
    gone after restart.
  - Clips: clip text, an image and a screenshot; drag one into Explorer/Finder; export Markdown.
  - "Ask Claude → Write captions" opens claude.ai with the selection filled in.
- **Known placeholders** until the design pass: native menus for capture, device presets and
  profiles; the clips panel's plain list.
