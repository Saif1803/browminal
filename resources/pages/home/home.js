// Home page for nebula://home/. Runs in a sandboxed tab with no preload and no Node access.

const STORAGE_KEY = 'nebula.assistant'

const ASK_HINT = 'Press Enter to ask, Shift+Enter for a new line'

// Where the prompt goes, and how the box reads for each choice.
const ASSISTANTS = {
  chatgpt: {
    button: 'Ask ChatGPT',
    placeholder: 'Ask anything',
    hint: ASK_HINT,
    ask: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`
  },
  claude: {
    button: 'Ask Claude',
    placeholder: 'Ask anything',
    hint: ASK_HINT,
    ask: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`
  },
  google: {
    button: 'Search Google',
    placeholder: 'Search the web',
    hint: 'Press Enter to search',
    ask: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  }
}

const form = document.getElementById('prompt-form')
const input = document.getElementById('prompt')
const askButton = document.getElementById('ask')
const hint = document.getElementById('hint')
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
  askButton.textContent = choice.button
  input.placeholder = choice.placeholder
  hint.textContent = choice.hint
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

input.focus()
