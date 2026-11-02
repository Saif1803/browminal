# Nebula

A personal desktop web browser built with Electron, React, TypeScript and Tailwind CSS.

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
