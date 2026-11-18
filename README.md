# Browminal

A desktop browser for localhost development. Your terminal coding agent (Claude Code, Codex or
any MCP client) sees, drives and debugs the tabs you share with it, in the browser you already
have open.

- **A terminal beside the page.** Start an agent from the panel and it is already connected to
  the tab it sits next to.
- **Agents read pages as text, not screenshots.** They get the accessibility tree with refs, then
  click, type, fill forms, drag and press keys.
- **Debugging tools.** Console messages and network requests, an element's styles and the CSS
  rules behind them, device, network and CPU emulation.
- **Page to source.** Errors and stack traces point at your original files through source maps.
  Pick an element (Ctrl+Shift+X) and the agent gets the component and the line it is written on.
- **You decide what is shared.** Agents see only the tabs you share. The bridge listens on
  127.0.0.1 only, needs a token, and can't be reached by web pages.
- **A browser for the rest.** Tabs, bookmarks, downloads, find, zoom, permissions and a built-in
  ad blocker.

How to connect an agent, and every tool it gets: [docs/agents.md](docs/agents.md).

> Browminal is at 0.1: it is new, and it has been run on Windows only. The macOS and Linux
> builds compile from the same code but haven't been tried by hand yet. If something breaks
> there, please open an issue.

## Run it

Browminal is built from source. You need:

- [Bun](https://bun.sh)
- [Rust](https://rustup.rs) (for the small native module in `native/`)
- **macOS:** Xcode's command-line tools (`xcode-select --install`)
- **Windows:** the "Desktop development with C++" tools, which the Rust installer offers
- **Linux:** `build-essential`

Then:

```bash
git clone https://github.com/Saif1803/browminal.git
cd browminal
bun install
bun run dev
```

`bun install` builds the native module, and the first start downloads Electron.

### Make an app you can install

```bash
bun run build:mac     # a .dmg and a .zip in dist/
bun run build:win     # an installer in dist/
bun run build:linux   # an AppImage in dist/
```

Build on the system you want the app for. The apps aren't signed yet: one you built yourself
opens normally, but a copy downloaded from someone else is held back by macOS Gatekeeper and gets
a SmartScreen warning on Windows.

## Start an agent

1. Open the terminal panel (Ctrl+`, or Cmd+` on macOS).
2. Choose your project's folder and type the agent's command, such as `claude` or `codex`.
3. **Start session.** The agent starts connected to the current tab.

Agents you run in your own terminal connect with one command; see
[docs/agents.md](docs/agents.md#from-your-own-terminal).

## Development

```bash
bun run dev          # start with hot reload (rebuilds native/ if it changed)
bun run typecheck
bun test
bun run lint
bun run smoke        # builds, then drives the real app through the agent bridge
bun run icons        # regenerate the icons from build/icon.svg
```

[CLAUDE.md](CLAUDE.md) describes the architecture and the security rules.

## Licence

[MIT](LICENSE). What Browminal is built on: [THIRD-PARTY.md](THIRD-PARTY.md).
