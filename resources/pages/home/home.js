// Home page for nebula://home/. Runs in a sandboxed tab with no preload and no Node access.

const STORAGE_KEY = 'nebula.assistant'

const ASSISTANTS = {
  chatgpt: { name: 'ChatGPT', ask: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  claude: { name: 'Claude', ask: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` }
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

function syncButton() {
  askButton.textContent = `Ask ${ASSISTANTS[selected()].name}`
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
    syncButton()
    input.focus()
  })
}
syncButton()

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
