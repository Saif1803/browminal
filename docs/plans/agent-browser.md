# Plan: Browminal for coding agents

**Status:** approved 2026-11-02 with the recommended answers (sharing per tab, creator plan
parked, terminal panel in this round). Phases 1–2 first, then use it for real before Phase 3 on.
**Phase 1 done** 2026-11-02, checked end to end with Claude Code (`claude -p` with a
`--mcp-config`) against a local test page. Not built in Phase 1: the "Connect an agent" dialog is
the agent button's native menu (copy command / JSON / new token), as planned for placeholders.
**Phase 2 done** 2026-11-02, checked with Claude Code filling a sign-up form, cancelling a
`confirm()` and following a hover-only link without `evaluate`. Not built from the Phase 2 text:
`drag` (CDP mouse events don't start HTML drag-and-drop; later with `Input.dispatchDragEvent`) and
`wait_for(networkIdle)` (needs the network log of Phase 3). Refs are backend DOM node ids, and
only the main frame's tree is read (no iframes yet).
**Phase 3 done** 2026-11-02, checked with Claude Code finding a failed API call, an uncaught
error and the CSS rule behind an invisible button in a test app. Differences from the text below:
`reload(ignoreCache)` is `navigate` `hardReload` (already there); `wait_for(networkIdle)` came
with it; emulation presets are iPhone 15, Pixel 8 and iPad Air, networks offline, slow 3G and
fast 3G; the emulation badge resets it when clicked. Not built: CPU throttling, and the rule
locations of Vite's injected `<style>` tags point at the page, not the `.css` file (Phase 4's
source maps).
**Phase 4 done** 2026-11-02, checked with Claude Code finding the line behind a picked button
in a Vite + React 19 test app (dev server and minified build). Differences from the text below:
an element's source line comes from React's `_debugSource` (≤18) or `_debugStack` (19, resolved
through source maps), Vue's `__file` (file only) and Svelte's `__svelte_meta`; `inspect` shows it
too. CSS rules map through a stylesheet's source map, and Vite's injected `<style>`s name their
file (`data-vite-dev-id`). "Send to agent" is in the page's right-click menu (it picks the
element under the pointer); there is no tab right-click menu yet. The errors badge counts the
page's uncaught errors and `console.error` since it loaded, until they're sent, dismissed or an
agent reads them; it lives in the address bar, with a native placeholder menu. Picks are typed
into the terminal agent's prompt (the Phase 5 item). Not built: original function names for
minified frames (the stack shows the minified name with the original file and line).
**Phase 5 done** 2026-11-02, moved ahead of Phases 2–4 at your request ("a literal terminal in the
browser"). Differences from the text below: the panel docks at the bottom or on the right; the
UI draws its header row and main lays the page out with `windowLayout` (no `setChromeInsets`);
the terminal's agent finds its tab through an `x-browminal-terminal` header in its MCP config
instead of environment variables; picks (Phase 4) don't exist yet, so nothing is typed into the
agent's prompt.
**Phase 6 done** 2026-11-02: `docs/agents.md` (connecting from the panel or your own terminal,
sharing, picks, every tool, what agents can't do, the bridge's checks) and `CLAUDE.md` brought up
to date. The plan is complete; what's not built is listed in the phases above and the roadmap.

**Positioning:** a **developer's browser for localhost work**, the one you open next to your
terminal while building a web app, not an everyday browser. Chrome plus chrome-devtools-mcp
already covers "an agent can see the page"; Browminal has to win on page ↔ code (Phase 4), the
terminal next to the page (Phase 5), any agent, and per-tab consent.

## Context
Browminal's main use from now on: **a coding agent running in a terminal (Claude Code, or any
agent that speaks MCP) can see, drive and debug the pages open in Browminal**, the way it reads and
edits code in an IDE. In an IDE the agent works on files; here the page is the thing it works on,
and for a local dev server (`localhost:5173`) the page and the code are the same project: the
agent looks at the page, finds the bug, edits the source, the page reloads, and it checks again.

This replaces the creator-browser plan as the next round ([creator-browser.md](creator-browser.md)
is parked; three of its pieces are reused here: the debugger on tabs, a side panel that narrows the
page, and full-page screenshots).

**How an agent reaches Browminal:** Browminal runs a small **MCP server inside main**, on loopback only,
behind a token. The agent adds it once:
```bash
claude mcp add --transport http browminal http://127.0.0.1:9339/mcp --header "Authorization: Bearer <token>"
```
Browminal's "Connect an agent" dialog shows that line ready to copy (and the same as JSON for other
agents: Codex, Cursor, Gemini CLI, anything with HTTP MCP). Every tool runs in main through
`webContents.debugger` (the Chrome DevTools Protocol, attached by main) on the tab, so the agent
gets DevTools-level access to the pages it is allowed to touch and nothing else.

**Why not just `--remote-debugging-port`** (what chrome-devtools-mcp and Playwright connect to):
it has no authentication, any local program can attach, and it exposes **every** webContents,
including Browminal's own UI, whose preload can call every IPC handler. That breaks the security
rules. Our own server exposes only tools we wrote, only for shared tabs.

**Not in this round:** a raw CDP endpoint for Playwright/Puppeteer, performance traces, editing
files from inside Browminal (the agent edits files itself, that's its job), recording, profiles,
history/suggestions, session restore. The UI stays plain: new menus are native placeholders until
the design pass.

All rules in `CLAUDE.md` still apply. **Four rules change and need your OK via this plan:**
1. **Main runs a local server** (Phase 1): `127.0.0.1` only, off until you switch it on, every
   request needs the token, and requests from web pages are refused (see Phase 1).
2. **Main attaches the debugger to a tab** while an agent works on it (every phase). Only tabs you
   shared, never the UI or a `browminal://` page.
3. **An agent can act in a shared tab** like a user would: click, type, navigate, run script in
   the page. While it does, the tab is marked and one click stops it.
4. **Browminal can run a terminal** (Phase 5): a shell in a panel next to the page, in its own view
   with its own two-function preload. The main UI's preload does not change.

## What gets built

### Phase 1: The agent bridge
- **`src/main/agent-server.ts`** (new): `node:http` server with `@modelcontextprotocol/sdk`'s
  Streamable HTTP transport on `127.0.0.1:<port>` (default 9339; if it's taken, the next free one,
  and the dialog shows the real one). Started/stopped from settings.
- **`src/main/agent-auth.ts`** (pure, tested), every request:
  - `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding);
  - a request **with an `Origin` header is refused** (browsers always send one on a cross-origin
    `fetch`; terminal agents don't), so no web page can talk to the server, not even ours;
  - `Authorization: Bearer <token>`, compared in constant time. The token is 32 random bytes,
    kept in `userData/agent.json`; "New token" in the dialog replaces it and drops every session.
- **`src/main/agent-tools.ts`**: the tool table (name, input schema, handler). Inputs are checked
  by the schema before a handler runs. First tools:
  - `list_tabs` (id, title, URL, shared?, active?), `select_tab`, `new_tab(url)` (http(s) only,
    same as the address bar), `close_tab` (only tabs the agent opened), `navigate(url | back |
    forward | reload)`;
  - `screenshot(visible | fullPage, maxWidth?)` (PNG, scaled down to keep replies small),
    `get_page_text`, `evaluate(expression)` (page's main world, result as JSON, size-capped).
- **Sharing** (`agent-sharing.ts`, pure, tested): an agent sees and touches only **shared** tabs.
  A tab is shared when you click "Share with agent" (toolbar button / Ctrl+Shift+A / tab
  right-click), or when the agent opened it. Unsharing, closing the tab or turning the bridge off
  detaches the debugger. Setting `shareAll` shares every tab (off by default).
- **Indicator:** a shared tab gets a mark in the tab strip; while an agent is acting on it (a
  command in the last ~2 s) the page edge glows in `accent` and the toolbar shows "Agent working ·
  Stop". Stop unshares the tab.
- **Settings:** `settings.json` gets `agent: {enabled, port, shareAll}`. **Storage:** `agent.json`
  (`{version: 1, token}`) through `JsonStore`.
- **UI:** "Connect an agent" native placeholder dialog: on/off, port, the `claude mcp add` line
  and the JSON config, Copy, New token.
- `BrowserState` gets `agent: {enabled, port, working: tabId | null}`; `tabs[]` gets `shared`.

### Phase 2: See and act like a user
- **`src/main/cdp.ts`** (new): one `CdpSession` per shared tab: attaches lazily (`'1.3'`),
  enables the domains it needs, detaches on unshare/close, and survives cross-process navigations
  (re-enables after `did-start-navigation` swaps the renderer). If DevTools is already attached and
  Chromium refuses, the tool says so instead of failing silently.
- **`read_page`**: the accessibility tree (`Accessibility.getFullAXTree`) as compact text with a
  `ref` per element (`button "Sign in" [ref=12]`), interactive-only filter, depth/size caps.
  Formatting is **`ax-tree.ts`** (pure, tested). `find(text)` searches it.
- **Acting:** `click(ref | x,y)`, `hover`, `type(text)`, `press_key(keys)`, `fill(ref, value)`,
  `select_option`, `scroll`, `drag`. Refs resolve through `DOM.resolveNode` → box model → centre;
  input goes through `Input.dispatch*Event`, so pages see trusted events. Key mapping is
  **`cdp-keys.ts`** (pure, tested; the virtual-key rules from the CDP notes in memory).
- **`wait_for(text | ref | networkIdle, timeout)`**, and `handle_dialog(accept, text?)` for
  `alert/confirm/prompt` (a page blocked on a dialog would otherwise hang every tool; dialogs
  opened while an agent is working are reported to it, the user can still answer them).
- Every action keeps the existing rules: navigations still go through `decideNavigation`,
  downloads and permission prompts still ask **the user**, `mailto:`/`tel:` still confirm.

### Phase 3: Debug like DevTools
- **Console:** per shared tab, a ring buffer (**`console-log.ts`**, pure, tested; 1 000 entries)
  of `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and `Log.entryAdded`, kept from the
  moment the tab is shared. `console_messages(level?, since?, pattern?)`.
- **Network:** **`network-log.ts`** (pure, tested; 500 requests) from `Network.*` events: method,
  URL, status, type, timing, sizes, failures. `network_requests(filter)`,
  `network_request(id)` → headers and body (`Network.getResponseBody`, size-capped). Auth header
  values and cookies are shown as `REDACTED`.
- **Elements:** `inspect(ref)` → outer HTML (capped), box model, computed styles and the matched
  CSS rules with their stylesheet URL and line (`CSS.getMatchedStylesForNode`). `set_style` /
  `set_attribute` for quick live experiments (lost on reload, said so in the reply).
- **Emulation:** `emulate(viewport | device | colorScheme | offline | slow3g | reset)`, shown as a
  badge in the address bar while it's on, so you know the page isn't in its normal state.
- `reload(ignoreCache)` and `clear_site_data` (this tab's origin only, asks you first).

### Phase 4: Page ↔ code
This is what makes it IDE-like for your own projects.
- **Source maps:** errors, console stack traces and `inspect` results are resolved to original
  files and lines (`Debugger.scriptParsed` gives each script's source map URL; main fetches the
  map through the tab's session). **`source-maps.ts`** (pure, tested; `@jridgewell/trace-mapping`).
  A localhost Vite/Next app's error then reads `src/components/Cart.tsx:42`, not
  `index-a1b2.js:1:9921`, so the agent opens the right file.
- **Pick an element:** "Pick for agent" (Ctrl+Shift+X, tab right-click "Send to agent") turns on
  the inspect overlay (`Overlay.setInspectMode`); the element you click is saved as a **pick**:
  selector, ref, outer HTML, styles, a cropped screenshot and its source location when known.
  `get_picks()` returns them. This is the "select code, ask the agent" of an IDE.
- **Errors badge:** a shared tab with new uncaught errors shows a count; clicking it offers "Send
  errors to agent" (a pick of kind `errors`).

### Phase 5: Built-in terminal panel
So the agent can live next to the page with no setup.
- **Layout:** the UI reports insets instead of a height (`setChromeInsets({top, bottom, right})`,
  replacing `setChromeHeight`; validated); `tab-manager.ts` narrows the page. Panel at the bottom
  or right, resizable, Ctrl+` toggles. Change the contract in `types.ts` first.
- **`src/main/terminal.ts`**: a pty per terminal tab with `@lydell/node-pty` (prebuilt binaries,
  so no Visual Studio build tools; rebuilt for Electron by the existing `install-app-deps`).
  Shell: PowerShell on Windows, `$SHELL` elsewhere. Starts in a **project folder** you pick
  (remembered per site: `localhost:5173` → `C:\…\shop`). Killed when the panel or app closes.
- **Terminal view:** its own `WebContentsView` with `@xterm/xterm`, sandboxed, with its own
  preload exposing only `write(data)`, `resize(cols, rows)` and `onData`. Its IPC is checked like
  the UI's (`assertTrustedSender`, but for the terminal view).
- **"Start agent"** runs your agent command (default `claude`) with the bridge already
  configured: `BROWMINAL_MCP_URL` and `BROWMINAL_MCP_TOKEN` in the environment, and for Claude Code
  `--mcp-config <userData/agent-mcp.json>` (written with the current port and token). The active
  tab is shared automatically when you start it from the panel.
- **Picks go straight in:** with the panel open, a pick types "Look at the element I picked in
  Browminal (pick 3): " into the agent's prompt (not sent; you finish the sentence).
- **Links:** `http://localhost:…` in terminal output is clickable and opens in a new tab (other
  URLs open in a tab too; nothing ever opens outside Browminal).

### Phase 6: Docs
Update `CLAUDE.md`: new modules in the table, the four rule changes above, the bridge's checks,
the new storage (`agent.json`, `agent-mcp.json`, `settings.json` `agent`, project folders), the
terminal view and its preload, and the roadmap. Add `docs/agents.md`: connecting Claude Code and
other agents, the tool list, what the agent can and can't do.

## Critical files
- **Modify:** `src/main/{index,window,tab-manager,tabs,ipc,shortcut-map,shortcuts,context-menu,settings}.ts`,
  `src/shared/{types,layout}.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx, components/*}`,
  `package.json`, `CLAUDE.md`
- **New main modules:** `agent-server`, `agent-auth`, `agent-tools`, `agent-sharing`, `cdp`,
  `ax-tree`, `cdp-keys`, `console-log`, `network-log`, `source-maps`, `picks`, `terminal`
- **New:** `src/preload/terminal.ts`, a `terminal` renderer entry (xterm), `docs/agents.md`
- **New dependencies:** `@modelcontextprotocol/sdk`, `@jridgewell/trace-mapping`,
  `@lydell/node-pty`, `@xterm/xterm` + `@xterm/addon-fit`
- **Reused:** `JsonStore`, `resolveInput`/`isHttpUrl`, `decideNavigation`, `assertTrustedSender`,
  the native-menu placeholder pattern

## Decisions for you
1. **OK to the four rule changes** (local server; debugger on shared tabs; agent acts in shared
   tabs; terminal panel).
2. **Sharing:** per tab, you choose (recommended), or every tab by default? Per tab keeps your
   bank and mail tabs out of the agent's reach.
3. **Terminal:** build the panel this round (Phase 5), or external terminals only for now?
4. **Creator plan:** park it (recommended), or come back to it after this round?

## Verification
- Each phase ends with `bun run typecheck`, `bun test` (every pure module gets tests) and
  `bun run lint`, then a commit (one per phase).
- `agent-auth.ts` tests cover: no token, wrong token, `Origin` present, wrong `Host`, rebinding
  host names.
- **End to end with the real Claude Code** (it's installed here): a throwaway profile, a small
  local test app with a deliberate bug, `claude mcp add` against the test instance, then
  `claude -p` runs that list tabs, screenshot, click through a form, read the console error, and
  resolve it to the source file. Also check that an unshared tab is invisible to the agent and
  that a page's `fetch('http://127.0.0.1:9339/mcp')` is refused.
- Screenshots over CDP for layout (shared mark, glow, terminal panel), per the memory note.
- **Manual checklist I'll hand you:** connect Claude Code from your own terminal; share a tab and
  ask it to fix something on a localhost page; Stop mid-task; pick an element and send it; start
  the agent from the terminal panel.
