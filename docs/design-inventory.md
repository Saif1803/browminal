# Browminal — UI inventory (design brief)

Everything a user can see or press in Browminal today, for a design pass. Browminal is a desktop browser
for localhost development: coding agents (Claude Code or any MCP client) see and drive the tabs the
user shares with them. Look: the Claude desktop app's palette, light or dark following the OS; on
Windows 11 and macOS the window is see-through glass (acrylic / vibrancy).

What hangs over the page (the agent sheet, the errors popover, questions and every menu) is drawn
by the **overlay**, a transparent view above the page, as frosted glass. Items marked
**(placeholder)** still stand in for a real designed surface: a plain overlay menu where a panel
should be, or a native OS box. They are what is left of the design pass.

---

## 1. Main window (always on screen)

Frameless window. From top to bottom: tab strip, toolbar, optional bookmarks bar, optional find
bar, then the page (inset from the sides and bottom, rounded corners). The terminal panel, when
open, sits under the page or to its right.

### 1.1 Tab strip (top row, also the window's drag area)
- **Native window controls**: traffic lights (macOS, left) or minimise/maximise/close (Windows/Linux, right). Space is reserved for them.
- **Tab** (one per open page, up to 224 px wide, shrinks to 48 px; scrolls sideways when full)
  - Icon: spinner while loading → site favicon → home icon (accent) for the start page → globe.
  - Title (truncated; "Untitled" if empty).
  - **Shared-with-agents mark** (agent icon, accent) when agents can see this tab.
  - **Mute / Unmute** button, only when the tab plays sound or is muted.
  - **Close** button (always on the active tab, on hover for others).
  - States: active (raised, lit rim), inactive, hover. Middle-click closes.
- **New tab** (+) button after the last tab.

### 1.2 Toolbar (row under the tabs)
Left to right:
- **Back**, **Forward** (disabled when not possible).
- **Reload** ↔ **Stop loading** (swaps while a page loads).
- **Home**.
- **Address bar** (fills the space; see 1.3).
- **Status chips** (appear between the address bar and the buttons, pill-shaped, accent tint):
  - *Picking*: "Click an element to send it to the agent" + **Cancel**.
  - *Pick sent* (a few seconds): "Element sent: pick 3 is in the agent's prompt" / "…ask your agent about it" / "Couldn't pick: …".
  - *Agent working*: pulsing dot + "Agent working" (or "Agent working in "Tab title"") + **Stop**.
- **Downloads** button — only once something was downloaded. Progress ring around it (or spinner if size unknown); accent while running. Opens the downloads menu (3.1).
- **Terminal** button — toggles the terminal panel (Ctrl+`).
- **Agent** button — accent when the current tab is shared; small red dot when agents can't connect. Opens the agent sheet (2.1).
- **Loading bar**: thin accent sweep along the bottom edge of the toolbar while the page loads.

### 1.3 Address bar (inside the toolbar)
- Leading icon: **lock** on https pages, **search** otherwise / while typing.
- Text field: "Search Google or type a URL". Selects all on focus; Esc cancels.
- Trailing badges/buttons (each only when relevant):
  - **Zoom** "125%" — click resets to 100%.
  - **Emulation** badge "iPhone 15 · dark ✕" — an agent is emulating a device/colour scheme/network; click resets.
  - **Errors** badge "⚠ 4" — new console errors on a shared tab; opens the errors popover (2.2).
  - **Shield** (ad blocker) — shield icon + blocked count; crossed-out shield when off/paused. Opens the shield menu (3.2).
  - **Bookmark star** — outline / filled (accent) when bookmarked. Ctrl+D.
- States: rest, hover, focused (accent ring).

### 1.4 Bookmarks bar (optional row; on when "Show bookmarks bar" is on and there are bookmarks)
- **Bookmark chips**: favicon (or globe) + title. Click opens; Ctrl/middle-click opens in background; Shift opens in front. Right-click → bookmark menu (3.3).
- **» More bookmarks** button when chips overflow → overflow menu (3.3).

### 1.5 Find bar (optional row; Ctrl+F)
- Text field "Find in page" + match count "3 / 12" (faint when no matches).
- **Previous match** (↑), **Next match** (↓), **Close** (✕).

### 1.6 Page area
- The web page itself, rounded, inset from the window edges.
- **Agent ring**: an accent glow around the page while an agent works on this tab.
- **Page veil**: while a new page loads, a plain cover that fades from the old page's background colour (no UI, just a transition).
- **Scrollbars**: thin, faint, tinted with the page's theme colour.

### 1.7 Terminal panel (optional; docked bottom or right, resizable)
- **Resize edge** (inner edge): drag, arrow keys, double-click for the default size.
- **Header row** (on the right dock the tab it works on gets a second row):
  - Terminal icon.
  - **Session tabs**: one per shell, title + **Close** (ends the shell); an agent session shows
    its agent's mark (Claude Code, Codex, or the generic agent icon). Hover shows the folder.
  - **New terminal** (+) — a plain shell, Ctrl+Shift+`.
  - **Works on: "Tab title"** — the browser tab this terminal's agent acts on ("Works on no tab"
    when that tab closed); **Use this tab** when it's not the tab on screen.
  - **Agent** button — opens the start page for a new agent session (icon only when narrow).
  - **Dock switch** — "Terminal under the page" / "Terminal beside the page".
  - **Hide** (✕) — shells keep running.
- **Start page** (opening the panel with no session, or **Agent**): "Start an agent session ·
  Works on *tab*", **Project** (folder button: "Choose a folder…" or the folder's name + Change;
  remembered per site; the system folder picker), **Agent** (command field with the agent's mark,
  "claude, codex, or any agent command", the last ones used as marks to switch), **Start session**
  / **Choose folder and start**, "or a plain terminal".
- **Terminal view**: xterm.js (Fira Code) showing the shell. Links in output open in the tab.
- **Exit bar** under an exited shell: "The shell has exited" · **Restart** · **Close**.

---

## 2. Overlay surfaces (designed)

### 2.1 Agent sheet (Agent button) — along the page's top right
- Header: "Agents", the **Let agents connect** switch, Close (Esc).
- Off: "Let coding agents in" — what agents are, and **Let agents connect**.
- *Agent working*: "Agent working on this tab / on another tab" + **Stop**.
- **This tab**: the page's icon, **Share this tab** + switch (on internal pages: "Agents can't read
  Browminal pages"), **Pick an element**, **Share every tab** + switch.
- **Connect a client**: picker (Claude Code / MCP config), the command or the MCP JSON with the token
  masked, **Copy** (main copies the real one), "Run it once in any terminal." / "Add it to your
  client's MCP settings.", **New token**.
- Bridge failed: the error and **Try again**, the rest dimmed.

### 2.2 Errors popover (errors badge)
- The new errors (message, place in source), **Send to agent**, **Dismiss**; after sending:
  "Sent to your agent" / "Couldn't send the errors".

### 2.3 Questions (hang from the address bar's leading icon, one at a time)
- **Permission**: "site wants to use your camera / microphone / location / notifications /
  clipboard" — **Allow** · **Block** (remembered until the browser closes).
- **Open link**: "site wants to open Mail / Phone" + the URL — **Open** · **Cancel**.
- **Agent: clear site data** (marked as the agent's): "you'll be signed out" — **Clear** · **Cancel**.
- A question about a tab goes away unanswered when that tab leaves the front.

---

## 3. Menus (overlay menus, frosted; at the pointer or hanging from a button)

### 3.1 Downloads menu (Downloads button) **(placeholder → downloads panel)**
- One submenu per recent download: "file-name.zip — 45% · 3.2 MB of 7 MB" (status text varies: done, paused, cancelled, failed).
  - Running: **Pause** / **Resume** · **Cancel**
  - Done: **Open** · **Show in folder** (or "File was moved or deleted")
  - **Copy download link** · **Remove from list**
- "N older downloads" (disabled, when the list is long)
- **Open Downloads folder** · **Clear list**

### 3.2 Shield menu (ad blocker) **(placeholder → shield panel)**
- Status line (disabled): "Ad blocker: 12 blocked" / "paused on example.com" / "off" / "downloading filter lists" / "filter lists couldn't be downloaded".
- ☑ **Block ads on example.com** (pause for this site)
- ☑ **Block ads and trackers everywhere**
- **Try again** (only when lists failed to download)

### 3.3 Bookmark menus
- Right-click a bookmark: **Open** · **Open in new tab** · **Copy link address** · **Remove** · ☑ **Show bookmarks bar**
- Right-click the bar: ☑ **Show bookmarks bar**
- "»" overflow: the hidden bookmarks as a list, then ☑ **Show bookmarks bar**

### 3.4 Page right-click menu (sections appear by context)
- Spelling suggestions (or "No spelling suggestions") on a misspelled word.
- Editable field: **Cut** · **Copy** · **Paste** · **Select all**
- Link: **Open link in new tab** · **Copy link address**
- Image: **Open image in new tab** · **Copy image** · **Save image as…**
- Selected text: **Copy** · **Search Google for "…"**
- Nothing special: **Back** · **Forward** · **Reload**
- Always: **Inspect** · **Send to agent** (picks that element)
- In the UI's own text fields (address bar, find): Cut / Copy / Paste / Select all.

### 3.5 Still native **(placeholders)**
- **Share your screen**: choose a screen — screens… · **Cancel** (a native message box).
- **Downloads in progress** on close/quit: **Quit and cancel** · **Keep downloading**.
- **Choose project folder**: the system folder picker (stays native).
- Page `alert` / `confirm` / `prompt`: Electron's native box (stays native).

---

## 4. Internal pages (static HTML in a tab)

### 4.1 Start page — `browminal://home/`
- Greeting: "Good morning / afternoon / evening".
- **Prompt box**: "Ask anything" (multi-line).
  - **Send-to picker** (segmented, sliding thumb, each with its icon): ChatGPT · Claude · Google.
  - **Ask** button: round, search icon only (its label and tooltip follow the picker).
- **Favourite sites**: icon tiles, ChatGPT · Claude · Google to start; sites the user adds get a
  letter tile on a colour from their host. ✕ on hover removes one; the dashed **Add** tile opens
  an "Add a site" dialog (URL, optional name; error line for a bad or duplicate address).
- Solid page colour, also on a glass window.

### 4.2 Error page — `browminal://error/`
- Title "This page couldn't be loaded", message (by error code), the code, **Try again** button.

---

## 5. States worth designing
- Light / dark; glass vs solid window.
- Tab: loading, audible, muted, shared, active/inactive, many tabs overflowing.
- Agent: off · on (not shared) · shared · working · can't connect · picking · pick sent.
- Address bar with several badges at once (zoom + emulation + errors + shield + star) on a narrow window.
- Downloads: none (button hidden) · running (ring) · unknown size · done · failed.
- Terminal: bottom vs right dock, narrow (compact header), no session, exited shell, several sessions.
- Fullscreen page (no chrome, square corners).

## 6. Not built yet (open to design)
A downloads panel, a shield panel, a picks list, a settings page, the tab strip's final look (and
its right-click menu and drag to reorder), history and address suggestions, session restore.
