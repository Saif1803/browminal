# Third-party work in Browminal

Browminal's own code is under the [MIT licence](LICENSE). It is built on, and ships with, the
work below, each under its own licence.

| What                                                                         | Used for                                              | Licence                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| [Electron](https://www.electronjs.org) (with Chromium and Node.js)           | The app and the pages it shows                        | MIT (Chromium: BSD-3-Clause and others) |
| [adblock-rust](https://github.com/brave/adblock-rust) (Brave)                | The ad blocker's filter engine                        | MPL-2.0                                 |
| [napi-rs](https://napi.rs)                                                   | The Rust module's bridge to Node                      | MIT                                     |
| [React](https://react.dev)                                                   | The UI                                                | MIT                                     |
| [xterm.js](https://xtermjs.org)                                              | The terminal panel                                    | MIT                                     |
| [node-pty](https://github.com/lydell/node-pty) (`@lydell/node-pty`)          | The terminal's shells                                 | MIT                                     |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | The agent bridge                                      | MIT                                     |
| [Zod](https://zod.dev)                                                       | Checking the agent tools' inputs                      | MIT                                     |
| [trace-mapping](https://github.com/jridgewell/sourcemaps)                    | Reading source maps                                   | MIT                                     |
| [Tailwind CSS](https://tailwindcss.com)                                      | The UI's styles                                       | MIT                                     |
| [Lucide](https://lucide.dev)                                                 | Icons                                                 | ISC                                     |
| [Lobe Icons](https://github.com/lobehub/lobe-icons)                          | The Claude Code and Codex marks in the terminal panel | MIT                                     |
| [Inter](https://rsms.me/inter/) (via Fontsource)                             | The UI's font                                         | OFL-1.1                                 |
| [Fira Code](https://github.com/tonsky/FiraCode) (via Fontsource)             | The terminal's font                                   | OFL-1.1                                 |

The Claude Code and Codex marks are their owners' trademarks. They are shown only to tell those
agents apart; Browminal is not affiliated with or endorsed by Anthropic or OpenAI.

## Filter lists

The ad blocker's lists are not part of Browminal. The app downloads them from their publishers
when it runs: [EasyList and EasyPrivacy](https://easylist.to) (GPL-3.0 / CC BY-SA 3.0),
[Peter Lowe's list](https://pgl.yoyo.org/adservers/) and
[uBlock Origin's filters](https://github.com/uBlockOrigin/uAssets) (GPL-3.0).
