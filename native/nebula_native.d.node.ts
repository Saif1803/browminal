// Types for nebula_native.node, built from the Rust crate in this folder (bun run build:native).
// napi-rs names things in camelCase; keep this in step with src/*.rs.

export interface DomTokens {
  classes: string[]
  ids: string[]
}

/** adblock.rs: a loaded filter engine. */
export declare class AdblockEngine {
  private constructor()
  /** `requestType` is Electron's resourceType; `method` may be '' when unknown. */
  shouldBlock(url: string, requestType: string, sourceUrl: string, method: string): boolean
  cosmeticStyles(url: string, dom: DomTokens | null): string
}

declare const native: {
  /** Throws when `file` can't be written. */
  buildAdblockEngine(lists: string, file: string): void
  loadAdblockEngine(file: string): Promise<AdblockEngine | null>
}

export default native
