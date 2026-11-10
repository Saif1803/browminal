import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { MenuRow, MenuView as Menu } from '@shared/overlay'
import { CheckedIcon, SubmenuBackIcon, SubmenuIcon } from '../components/icons'

type Item = Extract<MenuRow, { kind: 'item' }>

/** One level of the menu: the top, or a submenu opened in its place. */
interface Level {
  /** The row that opened it; null at the top. */
  parent: string | null
  rows: MenuRow[]
}

const isEnabled = (row: MenuRow | undefined): row is Item => row?.kind === 'item' && row.enabled

/** The next enabled row from `from`, going `step` (±1), wrapping; -1 if there is none. */
function nextEnabled(rows: MenuRow[], from: number, step: 1 | -1): number {
  for (let i = 1; i <= rows.length; i++) {
    const index = (((from + step * i) % rows.length) + rows.length) % rows.length
    if (isEnabled(rows[index])) return index
  }
  return -1
}

/**
 * A menu over the window (the shield, downloads, bookmarks, right-click), in place of a native
 * one. Arrow keys and type-ahead move, Enter chooses, → opens a submenu in place and ← goes back;
 * Esc closes (OverlayApp). Main runs the chosen row.
 */
export function MenuView({ menu }: { menu: Menu }): React.JSX.Element {
  const [stack, setStack] = useState<Level[]>([{ parent: null, rows: menu.rows }])
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const level = stack[stack.length - 1]
  const { rows } = level
  const hasChecks = rows.some((row) => row.kind === 'item' && row.checked !== null)
  const hasIcons = rows.some((row) => row.kind === 'item' && row.icon !== null)

  // The keyboard is the menu's from the start, and again in each submenu.
  useEffect(() => listRef.current?.focus(), [stack])

  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (row: Item, ctrl: boolean, shift: boolean): void => {
    if (!row.enabled) return
    if (row.submenu) {
      setStack([...stack, { parent: row.label, rows: row.submenu }])
      setActive(nextEnabled(row.submenu, -1, 1))
      return
    }
    window.overlay.choose(row.id, ctrl, shift)
  }

  const back = (): void => {
    if (stack.length === 1) return
    const parent = stack[stack.length - 2]
    setStack(stack.slice(0, -1))
    setActive(parent.rows.findIndex((row) => row.kind === 'item' && row.label === level.parent))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const row = rows[active]
    switch (event.key) {
      case 'ArrowDown':
        setActive(nextEnabled(rows, active, 1))
        break
      case 'ArrowUp':
        setActive(nextEnabled(rows, active < 0 ? 0 : active, -1))
        break
      case 'Home':
        setActive(nextEnabled(rows, -1, 1))
        break
      case 'End':
        setActive(nextEnabled(rows, 0, -1))
        break
      case 'Enter':
      case ' ':
        if (isEnabled(row)) open(row, event.ctrlKey || event.metaKey, event.shiftKey)
        break
      case 'ArrowRight':
        if (isEnabled(row) && row.submenu) open(row, false, false)
        break
      case 'ArrowLeft':
      case 'Backspace':
        back()
        break
      default: {
        // Type-ahead: the next row starting with that letter.
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const letter = event.key.toLowerCase()
        for (let i = 1; i <= rows.length; i++) {
          const index = (active + i) % rows.length
          const candidate = rows[index]
          if (isEnabled(candidate) && candidate.label.toLowerCase().startsWith(letter)) {
            setActive(index)
            break
          }
        }
      }
    }
    event.preventDefault()
  }

  return (
    <div
      ref={listRef}
      role="menu"
      tabIndex={-1}
      aria-label={level.parent ?? undefined}
      aria-activedescendant={active >= 0 ? `menu-row-${active}` : undefined}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setActive(-1)}
      className="flex flex-col overflow-y-auto p-1 text-[13px] outline-none"
      style={{ maxHeight: menu.maxHeight }}
    >
      {level.parent !== null && (
        <>
          <button
            type="button"
            tabIndex={-1}
            onClick={back}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-1.5 text-left font-medium text-ink-muted hover:bg-ink/8 hover:text-ink"
          >
            <SubmenuBackIcon size={14} className="shrink-0" />
            <span className="truncate">{level.parent}</span>
          </button>
          <div role="separator" className="mx-2 my-1 h-px shrink-0 bg-line" />
        </>
      )}
      {rows.map((row, index) =>
        row.kind === 'separator' ? (
          <div key={`sep-${index}`} role="separator" className="mx-2 my-1 h-px shrink-0 bg-line" />
        ) : (
          <div
            key={row.id}
            id={`menu-row-${index}`}
            data-index={index}
            role={row.checked === null ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={row.checked ?? undefined}
            aria-disabled={!row.enabled || undefined}
            aria-haspopup={row.submenu ? 'menu' : undefined}
            onPointerMove={() => setActive(row.enabled ? index : -1)}
            onClick={(event) => open(row, event.ctrlKey || event.metaKey, event.shiftKey)}
            className={`flex h-8 shrink-0 items-center gap-2.5 rounded-[7px] px-2.5 ${
              row.enabled ? 'text-ink' : 'text-ink-faint'
            } ${index === active ? 'bg-ink/8' : ''}`}
          >
            {hasChecks && (
              <span className="grid size-3.5 shrink-0 place-items-center text-ink-muted">
                {row.checked && <CheckedIcon size={14} />}
              </span>
            )}
            {hasIcons &&
              (row.icon ? (
                <img src={row.icon} alt="" className="size-4 shrink-0 rounded-[3px]" />
              ) : (
                <span className="size-4 shrink-0" />
              ))}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {row.shortcut && (
              <span className="shrink-0 pl-4 text-[12px] text-ink-faint">{row.shortcut}</span>
            )}
            {row.submenu && <SubmenuIcon size={14} className="shrink-0 text-ink-faint" />}
          </div>
        )
      )}
    </div>
  )
}
