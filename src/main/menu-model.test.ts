import { describe, expect, test } from 'bun:test'
import { menuRows } from './menu-model'

describe('menuRows', () => {
  test('numbers the items, keeps their actions and tidies separators', () => {
    const open = (): void => {}
    const { rows, actions } = menuRows([
      { type: 'separator' },
      { label: 'Open', click: open },
      { type: 'separator' },
      { type: 'separator' },
      { label: 'Show bar', checked: true, shortcut: 'Ctrl+Shift+B', click: open },
      { type: 'separator' }
    ])
    expect(rows).toEqual([
      {
        kind: 'item',
        id: 1,
        label: 'Open',
        enabled: true,
        checked: null,
        icon: null,
        shortcut: null,
        submenu: null
      },
      { kind: 'separator' },
      {
        kind: 'item',
        id: 2,
        label: 'Show bar',
        enabled: true,
        checked: true,
        icon: null,
        shortcut: 'Ctrl+Shift+B',
        submenu: null
      }
    ])
    expect([...actions.keys()]).toEqual([1, 2])
  })

  test('submenus get ids of their own; rows with nothing to do are disabled', () => {
    const { rows, actions } = menuRows([
      { label: 'file.zip — Done', submenu: [{ label: 'Open', click: () => {} }] },
      { label: 'Empty', submenu: [] },
      { label: '29 blocked' },
      { label: 'Off', enabled: false, click: () => {} }
    ])
    const [file, empty, info, off] = rows
    expect(file).toMatchObject({ id: 1, enabled: true, submenu: [{ id: 2, label: 'Open' }] })
    expect(empty).toMatchObject({ enabled: false, submenu: null })
    expect(info).toMatchObject({ enabled: false })
    expect(off).toMatchObject({ enabled: false })
    expect([...actions.keys()]).toEqual([2, 5])
  })
})
