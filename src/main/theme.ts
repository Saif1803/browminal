import { nativeTheme } from 'electron'

/** Colours main paints itself; they match the UI's and the internal pages' CSS. */
export interface ThemeColors {
  /** --color-strip: the tab strip the native window controls sit on. */
  strip: string
  /** The native window controls' symbols. */
  symbol: string
  /** --page of nebula:// pages, shown while they load. */
  internalPage: string
}

const DARK: ThemeColors = { strip: '#1f1e1d', symbol: '#c2c0b6', internalPage: '#262624' }
const LIGHT: ThemeColors = { strip: '#f0eee6', symbol: '#3d3d3a', internalPage: '#faf9f5' }

/** Light or dark follows the OS setting, like the Claude desktop app. */
export function themeColors(): ThemeColors {
  return nativeTheme.shouldUseDarkColors ? DARK : LIGHT
}

/** Called when the OS switches between light and dark. Returns an unsubscribe function. */
export function onThemeChange(listener: () => void): () => void {
  nativeTheme.on('updated', listener)
  return () => nativeTheme.off('updated', listener)
}
