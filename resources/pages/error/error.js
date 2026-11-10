// Error page for browminal://error/?code=<net error name>&url=<failed URL>.
// Runs in a sandboxed tab with no preload and no Node access; main loads it when a page fails.

const params = new URLSearchParams(location.search)
const code = params.get('code') || ''

/** The failed URL, only if it's http(s): it's the one thing this page will navigate to. */
function failedUrl() {
  try {
    const url = new URL(params.get('url') || '')
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** [title, message] for a net error name; `site` is the host name. */
function describe(site) {
  if (code === 'CRASHED') {
    return ['This page crashed', 'Something went wrong while showing this page.']
  }
  if (code === 'ERR_INTERNET_DISCONNECTED') {
    return ["You're offline", 'Check your internet connection, then try again.']
  }
  if (code === 'ERR_NAME_NOT_RESOLVED' || code === 'ERR_NAME_RESOLUTION_FAILED') {
    return ["This site can't be reached", `${site}'s address couldn't be found.`]
  }
  if (code === 'ERR_CONNECTION_REFUSED') {
    return ["This site can't be reached", `${site} refused to connect.`]
  }
  if (code === 'ERR_CONNECTION_TIMED_OUT' || code === 'ERR_TIMED_OUT') {
    return ["This site can't be reached", `${site} took too long to respond.`]
  }
  if (code === 'ERR_CONNECTION_RESET' || code === 'ERR_CONNECTION_CLOSED') {
    return ["This site can't be reached", 'The connection was interrupted.']
  }
  if (code.startsWith('ERR_CERT_')) {
    return [
      "Your connection isn't private",
      `${site}'s security certificate isn't trusted, so Browminal didn't open the page. Someone may be trying to intercept your connection.`
    ]
  }
  if (code.startsWith('ERR_SSL_')) {
    return ["This site can't provide a secure connection", `${site} sent an invalid response.`]
  }
  if (code === 'ERR_TOO_MANY_REDIRECTS') {
    return ["This page isn't working", `${site} redirected you too many times.`]
  }
  if (code === 'ERR_BLOCKED_BY_CLIENT') {
    return ['This page was blocked', 'Browminal blocked this page.']
  }
  return ["This page couldn't be loaded", `${site} couldn't be loaded.`]
}

const url = failedUrl()
const site = url ? url.hostname : 'The page'
const [title, message] = describe(site)

document.title = url ? url.hostname : title
document.getElementById('title').textContent = title
document.getElementById('message').textContent = message
document.getElementById('code').textContent = code

const retry = document.getElementById('retry')
if (url) {
  retry.hidden = false
  retry.addEventListener('click', () => {
    location.href = url.href
  })
  retry.focus()
}
