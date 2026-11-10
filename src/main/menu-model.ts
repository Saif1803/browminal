import type { MenuRow } from '../shared/overlay'

/** Keys held when a menu item was chosen: Ctrl/Cmd+click on a bookmark opens it behind. */
export interface MenuModifiers {
  /** Ctrl, or Cmd on macOS. */
  ctrl: boolean
  shift: boolean
}

export type MenuAction = (modifiers: MenuModifiers) => void

/** A menu as main builds it (the shield, downloads, bookmarks, right-click); the overlay draws it. */
export type MenuEntry =
  | { type: 'separator' }
  | {
      type?: 'item'
      label: string
      enabled?: boolean
      /** A check mark column: true or false for a checkbox row, left out for a plain one. */
      checked?: boolean
      /** A checked `data:image/…` URL (a bookmark's favicon). */
      icon?: string | null
      /** Shown on the right, e.g. "Ctrl+Shift+B" (handled elsewhere; this only shows it). */
      shortcut?: string
      /** Opens in place of the menu, with a way back. */
      submenu?: MenuEntry[]
      click?: MenuAction
    }

/**
 * The rows the overlay draws and what each id does. Separators are tidied (none first, last or
 * twice in a row); an item with nothing to do is disabled.
 */
export function menuRows(entries: readonly MenuEntry[]): {
  rows: MenuRow[]
  actions: Map<number, MenuAction>
} {
  const actions = new Map<number, MenuAction>()
  let nextId = 1
  const build = (list: readonly MenuEntry[]): MenuRow[] => {
    const rows: MenuRow[] = []
    for (const entry of list) {
      if (entry.type === 'separator') {
        if (rows.length > 0 && rows.at(-1)?.kind !== 'separator') rows.push({ kind: 'separator' })
        continue
      }
      const id = nextId++
      const submenu = entry.submenu ? build(entry.submenu) : null
      const hasSubmenu = submenu !== null && submenu.length > 0
      if (entry.click && !hasSubmenu) actions.set(id, entry.click)
      rows.push({
        kind: 'item',
        id,
        label: entry.label,
        enabled: (entry.enabled ?? true) && (hasSubmenu || entry.click !== undefined),
        checked: entry.checked ?? null,
        icon: entry.icon ?? null,
        shortcut: entry.shortcut ?? null,
        submenu: hasSubmenu ? submenu : null
      })
    }
    if (rows.at(-1)?.kind === 'separator') rows.pop()
    return rows
  }
  return { rows: build(entries), actions }
}
