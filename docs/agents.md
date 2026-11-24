# Coding agents in Browminal

Browminal lets a terminal coding agent (Claude Code, or any MCP client) see, drive and debug the
pages you're building, in the browser you already have open. The agent only ever sees the tabs
you share with it.

## Connect an agent

### From Browminal's terminal panel (easiest)
1. Open the panel (header button, or Ctrl+`). With no session running it shows the start page;
   **Agent** in the panel's header brings it back for another session.
2. **Project:** choose the folder the agent works in. It's remembered for the site, and only its
   name is shown.
3. **Agent:** type the command, or pick one you used before: `claude`, `codex`, or any other.
4. **Start session.** A new terminal opens with the agent already running, connected: nothing is
   typed and there's nothing to press. It works on the current tab (shared for it). It connects
   with a token of its own, which also tells Browminal which tab it works on, so tools that name
   no tab act on that one. The token stops working when the session ends.

Browminal connects the agents it knows by itself, through your shell (so your profile's PATH
applies):
- `claude …` gets `--mcp-config <file>`.
- `codex …` gets `-c mcp_servers.browminal.url=…` and `-c mcp_servers.browminal.http_headers=…`
  (Codex reads no config file of ours, so its session token is on its command line).
- Any other command runs as typed. Write `{mcp-config}` where it takes an MCP config file, e.g.
  `copilot --additional-mcp-config @{mcp-config}`, and Browminal puts in the path of an
  `mcpServers` JSON file. The path is also in the `BROWMINAL_MCP_CONFIG` environment variable.

When the agent exits, so does its terminal; **Restart** starts it again. A plain shell is **+**
in the header, or Ctrl+Shift+`.

### From your own terminal
The agent button (✦, right of the toolbar) opens the **Agents** sheet along the page's right side:
the on/off switch in its header, this tab, and how to connect a client.

1. Switch agents on (the switch next to **Agents**; sharing a tab switches it on too).
2. Under **Connect a client**, pick **Claude Code** and **Copy**, then run it once (the sheet
   shows the token masked; the copy has the real one):
   ```bash
   claude mcp add --scope user --transport http browminal http://127.0.0.1:9339/mcp --header "Authorization: Bearer <token>"
   ```
   For other agents, **MCP config** → **Copy** gives an `mcpServers` entry:
   ```json
   { "mcpServers": { "browminal": { "type": "http", "url": "http://127.0.0.1:9339/mcp",
       "headers": { "Authorization": "Bearer <token>" } } } }
   ```
3. Share the tab you want it to work on (below).

The port is 9339, or the next free one (up to 9348) if something else has it; the copied command
always has the right one. If the bridge can't start, the sheet says
why, with **Try again**. **New token** replaces the token and disconnects every agent: copy the
command again afterwards.

## Share tabs
- **Ctrl+Shift+A** (Cmd+Shift+A on macOS), or **Share this tab** in the Agents sheet: shares the
  active tab. Do it again to unshare. The agent button is tinted while the tab is shared.
- Tabs an agent opens with `new_tab`, and tabs a shared tab opens, are shared too.
- **Share every tab** shares all of them (off by default; keep your mail and bank out of it).
- Tabs that come back when Browminal starts again are not shared: share them again.
- While an agent works on a tab it is marked, the page gets an accent ring and an
  **Agent working · Stop** bar (the sheet shows it too). **Stop** unshares the tab (and turns
  "Share every tab" off).

Browminal's own pages (`browminal://home`, error pages) are never read or scripted, even when shared.

## Show the agent something
- **Pick an element:** Ctrl+Shift+X (or **Pick an element** in the Agents sheet, or right-click →
  **Send to agent**), then click it; Esc cancels. Picking shares the tab.
- **Send errors:** when a shared tab logs uncaught errors or `console.error`, the address bar shows
  an errors badge. Click it to see the newest errors (message, file and line) and **Send to
  agent**, or **Dismiss** them.

The agent reads picks with `get_picks`: the element's HTML, box, styles, a screenshot and the
file and line it's written at (React, Vue and Svelte dev builds, or a `data-review-loc="file:line"`
attribute on it or around it), or the errors mapped to your
source files. If a Claude started from the terminal panel works on that tab, Browminal types
"Look at … (pick N): " into its prompt for you to finish. It never presses Enter.

## Tools
Every tool takes an optional `tabId` (from `list_tabs`). Without one it acts on the tab the agent
used last, the tab of the Browminal terminal it runs in, or the active shared tab.

| Group | Tool | What it does |
| --- | --- | --- |
| Tabs | `list_tabs` | Shared tabs: id, title, URL, which is active |
| | `new_tab` | Opens a URL (bare hosts work: `localhost:5173`) in a new shared tab, waits for load |
| | `select_tab` | Brings a shared tab to the front |
| | `close_tab` | Closes a tab this agent opened (never yours) |
| | `navigate` | Loads a URL, or back / forward / reload (`hardReload` skips the cache) |
| Read | `get_page_text` | Title, URL and visible text: the cheapest read |
| | `screenshot` | The visible part or the whole page, scaled to `maxWidth` |
| | `read_page` | The accessibility tree, one element per line, each with a ref; iframes included |
| | `find` | Elements whose role, name or value contains some text, with refs |
| Act | `click`, `hover` | Real mouse events on a ref or a point |
| | `drag` | Drags a ref or point onto another: HTML5 drag and drop, or press-move-release for pointer-based libraries (says which) |
| | `type`, `fill` | Type where the keyboard is or into a ref; `fill` replaces a field's value |
| | `select_option` | Chooses options in a `<select>` |
| | `press_key` | Keys and combinations (`Enter`, `Control+a`, `Mod+z`) |
| | `scroll` | Scrolls a ref into view, or the page with the wheel |
| | `wait_for` | Text appears / disappears, load, network idle, or some seconds |
| | `handle_dialog` | Accepts or dismisses an alert, confirm, prompt or "Leave page?" |
| | `evaluate` | Runs JavaScript in the page, like the DevTools console (or in an iframe: `frame`) |
| Debug | `console_messages` | Console calls, uncaught exceptions with stacks, browser messages |
| | `network_requests` | Requests: method, status or failure, type, size, time |
| | `network_request` | One request in full: headers, request and response bodies |
| | `inspect` | HTML, box model, computed styles, matching CSS rules with file and line |
| | `set_style`, `set_attribute` | Try a fix live (lost on reload) |
| | `emulate` | Phone or tablet (iPhone 15, Pixel 8, iPad Air), viewport, dark/light, offline, slow/fast 3G, CPU 4× or 6× slower |
| | `clear_site_data` | Cookies, storage, cache and service workers of the tab's site, after you agree |
| Picks | `get_picks` | What you picked or sent (above) |
| Page's own | `page_tools` | The tools the page offers agents itself (WebMCP), with descriptions and inputs |
| | `call_page_tool` | Runs one of them and returns its result |

Logs start when a tab is shared and keep the newest 1000 console entries and 500 requests per
tab. `console_messages` and `network_requests` take `since` (the last `#seq` / `#id` seen) to read
only what's new. Where the page has source maps (any dev server), stacks and CSS rules name your
files (`src/App.tsx:12:5`), not the bundle; in a minified build, stack frames also get their
functions' original names back (from the name the caller used, so `at t` reads `at checkout`).

**Iframes:** `read_page` and `find` include what iframes show, from the page's own site
(Storybook's preview, an app in a frame) or from another (a payment form, a sign-in widget, an
embed on another port of localhost): their elements have refs like any other, so `click`, `fill`,
`type`, `inspect` and the rest work on them. Refs in a frame from another site are big numbers
(from 1000000000); they stay valid until that frame loads another page. Their console lines and
requests show in `console_messages` and `network_requests` too. **Sharing a tab shares
everything it embeds**, from any site. `evaluate` runs in an iframe's document when given its
ref as `frame`; `get_page_text` reads the main frame only. `emulate` reaches frames from other
sites too (colour scheme, user agent, touch, network, CPU); their size is their `<iframe>`'s.
Picking (Ctrl+Shift+X or **Send to agent**) picks elements inside any frame, and a pick's box is
where the element is in the tab.

### Pages with tools of their own (WebMCP, UI SDK)
A page can offer agents tools of its own through WebMCP: it registers them with
`document.modelContext.registerTool` (`navigator.modelContext` in older drafts). Pages built with
[UI SDK](https://ui-sdk.dev/llms.txt) do this with `registerTools(agent, { allow })`: `snapshot`
lists the page's components with their state and actions, `query` finds them and their choices,
and `act` runs several changes in one call. That takes an agent a few calls where reading the
accessibility tree and clicking takes many.

In a shared tab Browminal gives the page `document.modelContext`, so its tools appear. `new_tab`,
`navigate` and `list_tabs` name them, `page_tools` gives their descriptions and inputs, and
`call_page_tool` runs one. The agent is told to prefer them to `read_page` and `click`.
- **The page decides what's allowed.** UI SDK's `allow` callback runs for every step, and a control
  marked `data-agent-confirm` waits for you. If `allow` asks you (a `confirm()` or its own prompt),
  the tool waits for your answer for up to 5½ minutes. A step that "needs a person" comes back to
  the agent as an error that says so, and the agent is told to leave it to you.
- **Share before the page loads.** A page registers its tools as it starts. A tab shared after
  that has none until it's reloaded, and `page_tools` says so.
- Only the top frame of a web page gets `document.modelContext`; iframes and Browminal's own pages
  don't, and tabs you haven't shared don't either.
- What the tools return comes from the page, so the agent treats it as data. Results over 100,000
  characters are cut, and the agent is told where.

UI SDK's `data-review-loc="file:line"` (added by a build step in development) also tells
`inspect` and picks where an element is written.

### While Browminal is minimized or behind other windows
Agents keep working. Chromium treats the pages of a window you can't see as hidden (they stop
drawing and ignore clicks), so before a tool runs on such a page Browminal tells it that it's
visible and focused. Your page then sees `document.visibilityState === 'visible'` and
`document.hasFocus() === true` until you bring Browminal back to the front, when it hears the
truth again.

## What an agent can't do
- See or touch tabs you haven't shared, or Browminal's own pages.
- Load anything but http(s), close your tabs, or open OS windows.
- Press Browminal's shortcuts (Ctrl+W, Ctrl+T, F5, Ctrl+Shift+X…): those keys are refused.
- Pick elements or send errors (only you can).
- Start a shell: only you start terminals.
- Read credentials in network logs: `Authorization`, cookies and API-key headers show as `REDACTED`.
- Get around the usual rules: its navigations, downloads and permission requests go through the
  same checks as yours (`mailto:` asks you, camera asks you, downloads are never opened).
- Have a page's own tools skip the page's rules: `call_page_tool` runs them as the page wrote them,
  with its `allow` and `data-agent-confirm` checks.
- Clear site data without your yes: Browminal asks you under the address bar, marked as an agent's
  request, and the button says **Clear site data**.

`evaluate` does run code in a shared page with that page's own rights, so share only the sites
you'd let the agent use.

## Security
- The server listens on **127.0.0.1 only** and is off until you turn it on.
- Every request needs the bearer token from `agent.json` (in Browminal's user-data folder, written
  owner-only), compared in constant time.
- Requests must be addressed to `127.0.0.1` / `localhost` on that port and carry no `Origin` or
  `Sec-Fetch-Site` header, so no web page can reach the server, not even Browminal's own.
- Browminal never uses `--remote-debugging-port` (it has no auth). The debugger attaches only to
  shared tabs and detaches when you Stop or unshare.
- The token isn't put in your shell's environment; only the terminal's MCP config file (deleted
  with the terminal) holds it.

## Not built yet
Nothing from the plan. `get_page_text` reads the main frame only (use `read_page`, or `evaluate`
with `frame`).
