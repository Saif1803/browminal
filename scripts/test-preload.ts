// Preloaded by `bun test` (bunfig.toml). src/main/native.ts finds the native module through an
// electron-vite asset import, which Bun can't load; in tests it's the built file in native/.
import { mock } from 'bun:test'
import { createRequire } from 'module'
import { join } from 'path'

const root = join(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

mock.module(join(root, 'src', 'main', 'native.ts'), () => ({
  default: require(join(root, 'native', 'browminal_native.node'))
}))
