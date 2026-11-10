# Browminal

A desktop browser for localhost development: terminal coding agents (Claude Code, Codex or any
MCP client) see, drive and debug the tabs you share with them. Built with Electron, React,
TypeScript, Tailwind CSS and a small Rust module. How to connect an agent: [docs/agents.md](docs/agents.md).

## Setup

Needs [Bun](https://bun.sh) and [Rust](https://rustup.rs) (the native module in `native/`).

```bash
bun install
```

## Development

```bash
bun run dev        # start with hot reload (rebuilds native/ if it changed)
bun run typecheck
bun test
bun run lint
```

## Build

```bash
bun run build:win   # or build:mac / build:linux
```

See [CLAUDE.md](CLAUDE.md) for architecture and security rules.
