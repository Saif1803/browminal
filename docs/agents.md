# Coding agents in Nebula

Nebula lets a terminal coding agent (Claude Code, or any MCP client) see, drive and debug the
pages you're building, in the browser you already have open. The agent only ever sees the tabs
you share with it.

## Connect an agent

### From Nebula's terminal panel (easiest)
1. Open the panel (header button, or Ctrl+`) and pick the project folder.
2. Click **Claude**. Nebula types `claude --mcp-config <file>` into the shell. That config already
   holds the token and says which tab this terminal works on, so tools that name no tab act on it.

The command comes from `terminal.agentCommand` in `settings.json` (default `claude`). Any agent
that accepts `--mcp-config <file>` with an `mcpServers` JSON file works the same way.

### From your own terminal
1. Agent button → **Let agents connect** (sharing a tab switches it on too).
2. Agent button → **Copy command for Claude Code**, and run it once:
   ```bash
   claude mcp add --scope user --transport http nebula http://127.0.0.1:9339/mcp --header "Authorization: Bearer <token>"
   ```
   For other agents, **Copy MCP config (JSON)** gives an `mcpServers` entry:
   ```json
   { "mcpServers": { "nebula": { "type": "http", "url": "http://127.0.0.1:9339/mcp",
       "headers": { "Authorization": "Bearer <token>" } } } }
   ```
3. Share the tab you want it to work on (below).

The port is 9339, or the next free one (up to 9348) if something else has it; the copied command
always has the right one. **New token** replaces the token and disconnects every agent: copy the
command again afterwards.

## Share tabs
- **Ctrl+Shift+A** (Cmd+Shift+A on macOS), or the agent button → **Share this tab with agents**:
  shares the active tab. Do it again to unshare.
- Tabs an agent opens with `new_tab`, and tabs a shared tab opens, are shared too.
- **Share every tab** shares all of them (off by default; keep your mail and bank out of it).
- While an agent works on a tab it is marked, the page gets an accent ring and an
  **Agent working · Stop** bar. **Stop** unshares the tab (and turns "Share every tab" off).

Nebula's own pages (`nebula://home`, error pages) are never read or scripted, even when shared.

## Show the agent something
- **Pick an element:** Ctrl+Shift+X (or the agent button, or right-click → **Send to agent**),
  then click it; Esc cancels. Picking shares the tab.
- **Send errors:** when a shared tab logs uncaught errors or `console.error`, the address bar shows
  an errors badge; click it → **Send to agent**.

The agent reads picks with `get_picks`: the element's HTML, box, styles, a screenshot and the
file and line it's written at (React, Vue and Svelte dev builds), or the errors mapped to your
source files. If a Claude started from the terminal panel works on that tab, Nebula types
"Look at … (pick N): " into its prompt for you to finish. It never presses Enter.

## Tools
Every tool takes an optional `tabId` (from `list_tabs`). Without one it acts on the tab the agent
used last, the tab of the Nebula terminal it runs in, or the active shared tab.

| Group | Tool | What it does |
| --- | --- | --- |
| Tabs | `list_tabs` | Shared tabs: id, title, URL, which is active |
| | `new_tab` | Opens a URL (bare hosts work: `localhost:5173`) in a new shared tab, waits for load |
| | `select_tab` | Brings a shared tab to the front |
| | `close_tab` | Closes a tab this agent opened (never yours) |
| | `navigate` | Loads a URL, or back / forward / reload (`hardReload` skips the cache) |
| Read | `get_page_text` | Title, URL and visible text: the cheapest read |
| | `screenshot` | The visible part or the whole page, scaled to `maxWidth` |
| | `read_page` | The accessibility tree, one element per line, each with a ref |
| | `find` | Elements whose role, name or value contains some text, with refs |
| Act | `click`, `hover` | Real mouse events on a ref or a point |
| | `type`, `fill` | Type where the keyboard is or into a ref; `fill` replaces a field's value |
| | `select_option` | Chooses options in a `<select>` |
| | `press_key` | Keys and combinations (`Enter`, `Control+a`, `Mod+z`) |
| | `scroll` | Scrolls a ref into view, or the page with the wheel |
| | `wait_for` | Text appears / disappears, load, network idle, or some seconds |
| | `handle_dialog` | Accepts or dismisses an alert, confirm, prompt or "Leave page?" |
| | `evaluate` | Runs JavaScript in the page, like the DevTools console |
| Debug | `console_messages` | Console calls, uncaught exceptions with stacks, browser messages |
| | `network_requests` | Requests: method, status or failure, type, size, time |
| | `network_request` | One request in full: headers, request and response bodies |
| | `inspect` | HTML, box model, computed styles, matching CSS rules with file and line |
| | `set_style`, `set_attribute` | Try a fix live (lost on reload) |
| | `emulate` | Phone or tablet (iPhone 15, Pixel 8, iPad Air), viewport, dark/light, offline, slow/fast 3G |
| | `clear_site_data` | Cookies, storage, cache and service workers of the tab's site, after you agree |
| Picks | `get_picks` | What you picked or sent (above) |

Logs start when a tab is shared and keep the newest 1000 console entries and 500 requests per
tab. `console_messages` and `network_requests` take `since` (the last `#seq` / `#id` seen) to read
only what's new. Where the page has source maps (any dev server), stacks and CSS rules name your
files (`src/App.tsx:12:5`), not the bundle.

## What an agent can't do
- See or touch tabs you haven't shared, or Nebula's own pages.
- Load anything but http(s), close your tabs, or open OS windows.
- Press Nebula's shortcuts (Ctrl+W, Ctrl+T, F5, Ctrl+Shift+X…): those keys are refused.
- Pick elements or send errors (only you can).
- Start a shell: only you start terminals.
- Read credentials in network logs: `Authorization`, cookies and API-key headers show as `REDACTED`.
- Get around the usual rules: its navigations, downloads and permission requests go through the
  same checks as yours (`mailto:` asks you, camera asks you, downloads are never opened).
- Clear site data without your yes in a dialog.

`evaluate` does run code in a shared page with that page's own rights, so share only the sites
you'd let the agent use.

## Security
- The server listens on **127.0.0.1 only** and is off until you turn it on.
- Every request needs the bearer token from `agent.json` (in Nebula's user-data folder, written
  owner-only), compared in constant time.
- Requests must be addressed to `127.0.0.1` / `localhost` on that port and carry no `Origin` or
  `Sec-Fetch-Site` header, so no web page can reach the server, not even Nebula's own.
- Nebula never uses `--remote-debugging-port` (it has no auth). The debugger attaches only to
  shared tabs and detaches when you Stop or unshare.
- The token isn't put in your shell's environment; only the terminal's MCP config file (deleted
  with the terminal) holds it.

## Not built yet
Drag and drop, pages inside iframes (only the main frame is read), CPU throttling, original
function names in minified stack traces (the file and line are mapped), and a real "Connect an
agent" dialog (the agent button's menu stands in for now).
