import type { ContextMenuParams, WebContents } from 'electron'
import { copyText } from './copy-text'
import { SEARCH_URL, isHttpUrl } from '../shared/url'
import { canInspect } from './agent-policy'
import type { MenuEntry } from './menu-model'
import type { Tab } from './tabs'
import type { MainWindow } from './window'

const SEARCH_LABEL_LENGTH = 32

/** Menu sections, joined with separators; empty sections are dropped. */
function joinSections(sections: MenuEntry[][]): MenuEntry[] | null {
  const items = sections
    .filter((section) => section.length > 0)
    .flatMap((section, i) => (i === 0 ? section : [{ type: 'separator' as const }, ...section]))
  return items.length > 0 ? items : null
}

function spellingItems(wc: WebContents, params: ContextMenuParams): MenuEntry[] {
  if (!params.misspelledWord) return []
  if (params.dictionarySuggestions.length === 0) {
    return [{ label: 'No spelling suggestions', enabled: false }]
  }
  return params.dictionarySuggestions.slice(0, 5).map((word) => ({
    label: word,
    click: () => wc.replaceMisspelling(word)
  }))
}

function editItems(wc: WebContents, params: ContextMenuParams): MenuEntry[] {
  const flags = params.editFlags
  const copy = { label: 'Copy', enabled: flags.canCopy, click: () => wc.copy() }
  if (params.isEditable) {
    return [
      { label: 'Cut', enabled: flags.canCut, click: () => wc.cut() },
      copy,
      { label: 'Paste', enabled: flags.canPaste, click: () => wc.paste() },
      { label: 'Select all', enabled: flags.canSelectAll, click: () => wc.selectAll() }
    ]
  }
  return params.selectionText.trim() ? [copy] : []
}

/** Right-click in a page. */
function pageMenu(
  { tabs, agent }: MainWindow,
  tab: Tab,
  params: ContextMenuParams
): MenuEntry[] | null {
  const wc = tab.webContents
  const openInNewTab = (url: string, background: boolean): void => {
    tabs.create({ url, background, openerId: tab.id })
  }

  const link: MenuEntry[] = []
  if (params.linkURL) {
    if (isHttpUrl(params.linkURL)) {
      link.push({
        label: 'Open link in new tab',
        click: () => openInNewTab(params.linkURL, true)
      })
    }
    link.push({ label: 'Copy link address', click: () => copyText(params.linkURL) })
  }

  const image: MenuEntry[] = []
  if (params.mediaType === 'image' && params.srcURL) {
    if (isHttpUrl(params.srcURL)) {
      image.push({
        label: 'Open image in new tab',
        click: () => openInNewTab(params.srcURL, true)
      })
    }
    image.push(
      { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) }
    )
  }

  const text = params.selectionText.trim().replace(/\s+/g, ' ')
  const shortText =
    text.length > SEARCH_LABEL_LENGTH ? `${text.slice(0, SEARCH_LABEL_LENGTH)}…` : text
  const search: MenuEntry[] = text
    ? [
        {
          label: `Search Google for “${shortText}”`,
          click: () => openInNewTab(SEARCH_URL + encodeURIComponent(text), false)
        }
      ]
    : []

  // Back/Forward/Reload only when clicking the page itself, like other browsers.
  const isPlainPage = !params.linkURL && !image.length && !params.isEditable && !text
  const history = wc.navigationHistory
  const navigation: MenuEntry[] = isPlainPage
    ? [
        { label: 'Back', enabled: history.canGoBack(), click: () => tab.back() },
        { label: 'Forward', enabled: history.canGoForward(), click: () => tab.forward() },
        { label: 'Reload', click: () => tab.reload() }
      ]
    : []

  const inspect: MenuEntry[] = [
    { label: 'Inspect', click: () => tab.inspectElement(params.x, params.y) }
  ]
  if (canInspect(wc.getURL())) {
    // params are in the view's DIPs; the page's CSS px differ by its zoom.
    const zoom = wc.getZoomFactor()
    inspect.unshift({
      label: 'Send to agent',
      click: () => void agent.pickAt(tab.id, params.x / zoom, params.y / zoom)
    })
  }

  return joinSections([
    spellingItems(wc, params),
    navigation,
    link,
    image,
    editItems(wc, params),
    search,
    inspect
  ])
}

/**
 * Right-click menus (overlay menus at the pointer): the full menu in pages, and cut/copy/paste in
 * the UI's text fields (the address bar and find bar). Everything else in the UI gets no menu.
 */
export function registerContextMenus(main: MainWindow): void {
  const { window, tabs, overlay } = main
  const ui = window.webContents
  /** `params` are in `source`'s coordinates; `at` is where that view sits in the window. */
  const popup = (
    template: MenuEntry[] | null,
    params: ContextMenuParams,
    source: WebContents,
    at: { x: number; y: number }
  ): void => {
    if (!template || window.isDestroyed()) return
    overlay.showMenu(template, at.x + params.x, at.y + params.y, {
      at: 'pointer',
      returnTo: source
    })
  }

  ui.on('context-menu', (_event, params) => {
    const template = joinSections([spellingItems(ui, params), editItems(ui, params)])
    popup(template, params, ui, { x: 0, y: 0 })
  })
  tabs.onTabCreated((tab) => {
    tab.webContents.on('context-menu', (_event, params) =>
      popup(pageMenu(main, tab, params), params, tab.webContents, tab.bounds)
    )
  })
}
