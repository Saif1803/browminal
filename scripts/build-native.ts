// Builds the Rust crate in native/ and puts the library at native/nebula_native.node, where main
// imports it. Runs on install, dev and build; needs Rust (https://rustup.rs). Cargo only rebuilds
// what changed, so it's quick when the crate hasn't.
import { spawnSync } from 'child_process'
import { copyFileSync } from 'fs'
import { join } from 'path'

const crate = join(import.meta.dirname, '..', 'native')
const cargo = spawnSync(
  'cargo',
  ['build', '--release', '--manifest-path', join(crate, 'Cargo.toml')],
  { stdio: 'inherit' }
)
if (cargo.error) {
  console.error(`Could not run cargo (${cargo.error.message}). Install Rust from https://rustup.rs`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

const library =
  process.platform === 'win32'
    ? 'nebula_native.dll'
    : process.platform === 'darwin'
      ? 'libnebula_native.dylib'
      : 'libnebula_native.so'
copyFileSync(join(crate, 'target', 'release', library), join(crate, 'nebula_native.node'))
