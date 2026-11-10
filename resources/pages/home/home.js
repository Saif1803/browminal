// Home page for browminal://home/. Runs in a sandboxed tab with no preload and no Node access.

const STORAGE_KEY = 'browminal.assistant'

// Where the prompt goes, and how the box reads for each choice.
const ASSISTANTS = {
  chatgpt: {
    button: 'Ask ChatGPT',
    placeholder: 'Ask anything',
    ask: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`
  },
  claude: {
    button: 'Ask Claude',
    placeholder: 'Ask anything',
    ask: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`
  },
  google: {
    button: 'Search Google',
    placeholder: 'Search the web',
    ask: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  }
}

const form = document.getElementById('prompt-form')
const input = document.getElementById('prompt')
const askButton = document.getElementById('ask')
const radios = document.querySelectorAll('input[name="assistant"]')

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Up late?'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function readChoice() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved in ASSISTANTS ? saved : 'chatgpt'
  } catch {
    return 'chatgpt'
  }
}

function saveChoice(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
}

function selected() {
  const checked = document.querySelector('input[name="assistant"]:checked')
  return ASSISTANTS[checked?.value] ? checked.value : 'chatgpt'
}

function syncChoice() {
  const choice = ASSISTANTS[selected()]
  askButton.setAttribute('aria-label', choice.button)
  askButton.title = choice.button
  input.placeholder = choice.placeholder
}

function autoGrow() {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`
}

function ask() {
  const question = input.value.trim()
  if (!question) {
    input.focus()
    return
  }
  window.location.href = ASSISTANTS[selected()].ask(question)
}

document.getElementById('greeting').textContent = greeting()

const initial = readChoice()
for (const radio of radios) {
  radio.checked = radio.value === initial
  radio.addEventListener('change', () => {
    saveChoice(radio.value)
    syncChoice()
    input.focus()
  })
}
syncChoice()

input.addEventListener('input', autoGrow)
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    ask()
  }
})

form.addEventListener('submit', (event) => {
  event.preventDefault()
  ask()
})

// Favourite sites: kept in this page's localStorage (no IPC), checked on every read.

const FAVORITES_KEY = 'browminal.favorites'
const MAX_FAVORITES = 24
const MAX_NAME = 40

// Bundled icons a favourite may name; sites the user adds get a letter tile instead (the CSP
// allows only this page's own images).
const ICONS = {
  chatgpt: 'icons/chatgpt.svg',
  claude: 'icons/claude.svg',
  google: 'icons/google.png'
}

const DEFAULT_FAVORITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'chatgpt' },
  { name: 'Claude', url: 'https://claude.ai/new', icon: 'claude' },
  { name: 'Google', url: 'https://www.google.com/', icon: 'google' }
]

const SVG_NS = 'http://www.w3.org/2000/svg'

const shortcuts = document.getElementById('shortcuts')
const addDialog = document.getElementById('add-dialog')
const addForm = document.getElementById('add-form')
const addUrl = document.getElementById('add-url')
const addName = document.getElementById('add-name')
const addError = document.getElementById('add-error')

/**
 * The http(s) URL for what the user typed, or null: "github.com" gets https://, localhost and
 * IP addresses get http://, like the address bar. No other schemes, no user:password@.
 */
function siteUrl(text) {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  let candidate = trimmed
  if (!/^https?:\/\//i.test(trimmed)) {
    if (trimmed.includes('://')) return null
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])([:/?#]|$)/i.test(trimmed)
    candidate = `${local ? 'http' : 'https'}://${trimmed}`
  }
  let url
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname
  if (!host.includes('.') && host !== 'localhost' && !host.startsWith('[')) return null
  return url.href
}

function siteName(url) {
  return new URL(url).hostname.replace(/^www\./, '')
}

function defaultFavorites() {
  return DEFAULT_FAVORITES.map((favorite) => ({ ...favorite }))
}

/** The saved list, or the defaults when nothing was saved; bad entries are dropped. */
function readFavorites() {
  let saved
  try {
    saved = localStorage.getItem(FAVORITES_KEY)
  } catch {
    saved = null
  }
  if (saved === null) return defaultFavorites()
  let parsed
  try {
    parsed = JSON.parse(saved)
  } catch {
    return defaultFavorites()
  }
  if (!Array.isArray(parsed)) return defaultFavorites()
  const favorites = []
  for (const entry of parsed) {
    if (!entry || typeof entry.url !== 'string' || typeof entry.name !== 'string') continue
    const url = siteUrl(entry.url)
    const name = entry.name.trim().slice(0, MAX_NAME)
    if (!url || url !== entry.url || !name) continue
    const icon = Object.hasOwn(ICONS, entry.icon) ? entry.icon : undefined
    favorites.push({ name, url, icon })
    if (favorites.length === MAX_FAVORITES) break
  }
  return favorites
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  } catch {
    // Storage unavailable: the change lasts until the page closes.
  }
}

function svgIcon(className, paths) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

/** A site's letter tile, in a hue picked from its host so it stays the same. */
function letterIcon(favorite) {
  const host = siteName(favorite.url)
  let hash = 0
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const tile = document.createElement('span')
  tile.className = 'shortcut-icon shortcut-letter'
  tile.textContent = (favorite.name.match(/[\p{L}\p{N}]/u)?.[0] ?? host[0]).toUpperCase()
  tile.style.backgroundColor = `hsl(${hash % 360} 38% 42%)`
  return tile
}

function favoriteTile(favorite, index) {
  const item = document.createElement('div')
  item.className = 'shortcut-item'

  const link = document.createElement('a')
  link.className = 'shortcut'
  link.href = favorite.url
  link.title = favorite.url
  if (favorite.icon) {
    const icon = document.createElement('img')
    icon.className = 'shortcut-icon'
    icon.src = ICONS[favorite.icon]
    icon.alt = ''
    link.append(icon)
  } else {
    link.append(letterIcon(favorite))
  }
  const name = document.createElement('span')
  name.className = 'shortcut-name'
  name.textContent = favorite.name
  link.append(name)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'shortcut-remove'
  remove.title = 'Remove'
  remove.setAttribute('aria-label', `Remove ${favorite.name}`)
  remove.append(svgIcon('shortcut-remove-icon', ['M18 6 6 18', 'm6 6 12 12']))
  remove.addEventListener('click', () => {
    favorites.splice(index, 1)
    saveFavorites()
    renderFavorites()
    // Keep the keyboard in the row: the tile that took this one's place, or Add.
    shortcuts.querySelectorAll('.shortcut')[index]?.focus()
  })

  item.append(link, remove)
  return item
}

function addTile() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'shortcut shortcut-add'
  button.id = 'add-site'
  const icon = document.createElement('span')
  icon.className = 'shortcut-icon'
  icon.append(svgIcon('shortcut-add-icon', ['M12 5v14', 'M5 12h14']))
  const name = document.createElement('span')
  name.className = 'shortcut-name'
  name.textContent = 'Add'
  button.append(icon, name)
  button.addEventListener('click', openAddDialog)
  return button
}

function renderFavorites() {
  const tiles = favorites.map(favoriteTile)
  if (favorites.length < MAX_FAVORITES) tiles.push(addTile())
  shortcuts.replaceChildren(...tiles)
}

function openAddDialog() {
  addForm.reset()
  addError.textContent = ''
  addDialog.showModal()
  addUrl.focus()
}

function addFavorite() {
  const url = siteUrl(addUrl.value)
  if (!url) {
    addError.textContent = 'Enter a web address, like example.com'
    addUrl.focus()
    return
  }
  if (favorites.some((favorite) => favorite.url === url)) {
    addError.textContent = 'That site is already here'
    addUrl.focus()
    return
  }
  const name = addName.value.trim().slice(0, MAX_NAME) || siteName(url)
  favorites.push({ name, url })
  saveFavorites()
  renderFavorites()
  addDialog.close()
  document.getElementById('add-site')?.focus()
}

let favorites = readFavorites()
renderFavorites()

addForm.addEventListener('submit', (event) => {
  event.preventDefault()
  addFavorite()
})
document.getElementById('add-cancel').addEventListener('click', () => addDialog.close())
// A click on the backdrop (the dialog element itself, outside its form) closes it.
addDialog.addEventListener('click', (event) => {
  if (event.target === addDialog) addDialog.close()
})
// Another home tab changed the list.
window.addEventListener('storage', (event) => {
  if (event.key !== FAVORITES_KEY && event.key !== null) return
  favorites = readFavorites()
  renderFavorites()
})

input.focus()
