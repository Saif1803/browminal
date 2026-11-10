import { createRequire } from 'module'
import type Native from '../../native/browminal_native.node'
import path from '../../native/browminal_native.node?asset&asarUnpack'

/**
 * Where Browminal's native module is: the Rust crate in native/ (built by `bun run build:native`),
 * which electron-vite copies next to main's code, outside the asar in a packaged app. Workers
 * get this path from main rather than importing this module, so there's one copy of the file.
 */
export const nativePath = path

const native: typeof Native = createRequire(__filename)(nativePath)

export default native
