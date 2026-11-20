/**
 * Smoke test of the built app (`bun run smoke`; `--no-build` reuses out/; `--app <file>` runs a
 * packaged Browminal instead, e.g. dist/win-unpacked/browminal.exe, and builds nothing).
 *
 * Builds, starts Browminal on a throwaway profile with the agent bridge already on (a spare port),
 * and drives it the way an agent does: through the bridge's own MCP endpoint. Nothing here uses
 * --remote-debugging-port. The user's own tab (opened from the command line, never shared) must
 * stay invisible; requests from a browser or without the token must be refused; a page must not
 * reach browminal://; a second launch must hand its URL to the first and quit; a relaunch must
 * bring the tabs back, loading only the one shown.
 *
 * Exits non-zero on the first failure. Never run it while a Browminal runs from out/ (the build
 * would fail halfway on the locked native module).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const CALL_TIMEOUT_MS = 30_000
const START_TIMEOUT_MS = 60_000

// --- the test site -------------------------------------------------------------------------

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Smoke page</title>
<h1>Smoke</h1>
<label>Name <input id="name"></label>
<button onclick="document.getElementById('out').textContent = 'Hello ' + document.getElementById('name').value">Say hi</button>
<p id="out">Not clicked</p>
<div id="card" draggable="true" role="button" aria-label="Card">Card</div>
<div id="zone" role="region" aria-label="Drop zone" style="width:200px;height:60px;border:1px dashed">Drop here</div>
<iframe src="/frame" title="Inner frame" style="width:300px;height:80px"></iframe>
<script>
  const card = document.getElementById('card')
  const zone = document.getElementById('zone')
  card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'card'))
  zone.addEventListener('dragover', (e) => e.preventDefault())
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.textContent = 'Dropped ' + e.dataTransfer.getData('text/plain')
  })
</script>
<script>
  console.log('smoke console line')
  fetch('/api/ping').then((r) => r.text())
</script>`

// Registers tools the way UI SDK's registerTools does (document.modelContext, a signal each).
const WEBMCP_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>WebMCP page</title>
<p>Region: <span id="region">eu</span></p>
<script>
  const registration = new AbortController()
  const tools = [
    {
      name: 'snapshot',
      description: 'Lists the components on the page',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        components: [{ ref: 'r1', component: 'select', label: 'Region',
          value: document.getElementById('region').textContent }]
      })
    },
    {
      name: 'act',
      description: 'Runs steps',
      inputSchema: { type: 'object', properties: { steps: { type: 'array' } }, required: ['steps'] },
      annotations: { consequentialHint: true, untrustedContentHint: true },
      execute: async ({ steps }) => {
        for (const step of steps) {
          if (step.action === 'press') throw new Error('Needs a person: "Deletes the project"')
          if (step.action === 'ask' && !confirm('Change Region?')) throw new Error('The person said no')
          document.getElementById('region').textContent = step.args[0]
        }
        return { ok: true, values: { Region: document.getElementById('region').textContent } }
      }
    }
  ]
  for (const tool of tools) {
    document.modelContext?.registerTool(tool, { signal: registration.signal }).catch(() => {})
  }
</script>`

const hits: string[] = []

function startSite(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    hits.push(path)
    if (path === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"pong":true}')
      return
    }
    if (path === '/webmcp') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(WEBMCP_PAGE)
      return
    }
    if (path === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><title>Frame</title><button onclick="parent.document.getElementById(' +
          "'out').textContent = 'Frame clicked'\">Frame button</button>"
      )
      return
    }
    const titles: Record<string, string> = {
      '/private': 'Private smoke page',
      '/handed-over': 'Handed over'
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      titles[path] ? `<!doctype html><title>${titles[path]}</title><p>${titles[path]}</p>` : PAGE
    )
  })
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)))
}

// --- helpers -------------------------------------------------------------------------------

function freePort(from: number): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createNetServer()
    probe.once('error', () => {
      if (from > 65000) fail(new Error('no free port'))
      else freePort(from + 1).then(done, fail)
    })
    probe.listen(from, '127.0.0.1', () => probe.close(() => done(from)))
  })
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

async function until<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await probe().catch(() => null)
    if (value !== null) return value
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

class Failure extends Error {}

function check(ok: unknown, what: string, detail = ''): void {
  if (!ok) throw new Failure(detail ? `${what}\n${detail}` : what)
  console.log(`  ok  ${what}`)
}

interface Reply {
  status: number
  body: string
  contentType: string
}

/** One POST to the bridge, with exactly the headers given (node:http adds only Host). */
function post(port: number, body: unknown, headers: Record<string, string>): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers
        },
        timeout: CALL_TIMEOUT_MS
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          done({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: String(res.headers['content-type'] ?? '')
          })
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })
}

interface ToolResult {
  isError?: boolean
  content: { type: string; text?: string; data?: string; mimeType?: string }[]
}

let rpcId = 0

function parseRpc(reply: Reply): { result?: unknown; error?: { message: string } } {
  if (reply.contentType.includes('text/event-stream')) {
    const data = reply.body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
    return JSON.parse(data[data.length - 1] ?? '{}')
  }
  return JSON.parse(reply.body || '{}')
}

interface Bridge {
  call(method: string, params: unknown): Promise<unknown>
  tool(name: string, args?: Record<string, unknown>): Promise<ToolResult>
  text(result: ToolResult): string
  /** A tool that must succeed; its text. */
  ok(name: string, args?: Record<string, unknown>): Promise<string>
}

function bridge(port: number, token: string): Bridge {
  const auth = { authorization: `Bearer ${token}` }
  const call = async (method: string, params: unknown): Promise<unknown> => {
    const reply = await post(port, { jsonrpc: '2.0', id: ++rpcId, method, params }, auth)
    if (reply.status !== 200) throw new Error(`${method}: HTTP ${reply.status} ${reply.body}`)
    const parsed = parseRpc(reply)
    if (parsed.error) throw new Error(`${method}: ${parsed.error.message}`)
    return parsed.result
  }
  const tool = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
    (await call('tools/call', { name, arguments: args })) as ToolResult
  const text = (result: ToolResult): string =>
    result.content.map((part) => part.text ?? '').join('\n')
  const ok = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const result = await tool(name, args)
    if (result.isError) throw new Failure(`${name} failed: ${text(result)}`)
    return text(result)
  }
  return { call, tool, text, ok }
}

// --- the app -------------------------------------------------------------------------------

// Electron's own launcher (as `electron .` runs it): it starts the binary, fetching it first if
// it isn't there yet, and exits with its exit code.
const ELECTRON_CLI = join(ROOT, 'node_modules', 'electron', 'cli.js')

// `--app <file>`: a packaged Browminal to run in place of out/.
const APP_FLAG = process.argv.indexOf('--app')
const PACKAGED_APP = APP_FLAG === -1 ? null : resolve(process.argv[APP_FLAG + 1] ?? '')

function launch(profile: string, url: string, flags: string[] = []): ChildProcess {
  const [command, args] = PACKAGED_APP
    ? [PACKAGED_APP, []]
    : [process.execPath, [ELECTRON_CLI, '.']]
  return spawn(command, [...args, ...flags, `--user-data-dir=${profile}`, url], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' }
  })
}

function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function exited(child: ChildProcess, ms: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), ms)
    child.once('exit', (code) => {
      clearTimeout(timer)
      done(code ?? -1)
    })
  })
}

/**
 * Runs `expression` in the app's main process, through Node's inspector (`--inspect`), and
 * returns its (awaited) value. Only for what no agent tool can do: minimizing the window,
 * dragging a tab in the strip.
 */
async function inMain(port: number, expression: string): Promise<unknown> {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
    webSocketDebuggerUrl: string
  }[]
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  return await new Promise<unknown>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('the inspector did not answer')), 10_000)
    socket.onerror = () => fail(new Error('could not reach the inspector'))
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            includeCommandLineAPI: true,
            awaitPromise: true,
            returnByValue: true
          }
        })
      )
    socket.onmessage = (event) => {
      const reply = JSON.parse(String(event.data))
      if (reply.id !== 1) return
      clearTimeout(timer)
      if (reply.result?.exceptionDetails) fail(new Error(JSON.stringify(reply.result)))
      else done(reply.result?.result?.value)
    }
  }).finally(() => socket.close())
}

const WINDOW = "require('electron').BrowserWindow.getAllWindows()[0]"

// --- the run -------------------------------------------------------------------------------

async function run(): Promise<void> {
  if (PACKAGED_APP) {
    if (!existsSync(PACKAGED_APP)) throw new Failure(`${PACKAGED_APP} is not there`)
    console.log(`Running ${PACKAGED_APP}`)
  } else if (!process.argv.includes('--no-build')) {
    console.log('Building…')
    const vite = join(ROOT, 'node_modules', '.bin', 'electron-vite')
    const build = spawnSync(vite, ['build'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (build.status !== 0) throw new Failure('electron-vite build failed')
  }
  if (!PACKAGED_APP && !existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
    throw new Failure('out/ is not built')
  }

  const sitePort = await freePort(18_500)
  const bridgePort = await freePort(19_400)
  const inspectPort = await freePort(19_600)
  const site = `http://127.0.0.1:${sitePort}`
  const server = await startSite(sitePort)
  const profile = mkdtempSync(join(tmpdir(), 'browminal-smoke-'))
  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      // The ad blocker would fetch filter lists; the smoke test stays offline.
      adblock: { enabled: false, pausedSites: [] },
      agent: { enabled: true, port: bridgePort, shareAll: false }
    })
  )

  const app = launch(profile, `${site}/private`, [`--inspect=${inspectPort}`])
  let log = ''
  app.stdout?.on('data', (chunk) => (log += chunk))
  app.stderr?.on('data', (chunk) => (log += chunk))
  const second: ChildProcess[] = []
  try {
    console.log(`App on profile ${profile}, bridge on ${bridgePort}`)
    const token = await until('agent.json', START_TIMEOUT_MS, async () => {
      if (app.exitCode !== null) throw new Failure(`the app exited (${app.exitCode})\n${log}`)
      const file = join(profile, 'agent.json')
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).token as string) : null
    })
    const agent = bridge(bridgePort, token)
    await until('the bridge', START_TIMEOUT_MS, () => agent.call('tools/list', {}))
    await until('the private page', START_TIMEOUT_MS, async () =>
      hits.includes('/private') ? true : null
    )

    console.log('Bridge checks')
    const init = { jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }
    const fromPage = await post(bridgePort, init, {
      authorization: `Bearer ${token}`,
      origin: site
    })
    check(fromPage.status === 403, 'a request with an Origin header is refused', fromPage.body)
    const fetchSite = await post(bridgePort, init, {
      authorization: `Bearer ${token}`,
      'sec-fetch-site': 'cross-site'
    })
    check(fetchSite.status === 403, 'a request with Sec-Fetch-Site is refused', fetchSite.body)
    const noToken = await post(bridgePort, init, {})
    check(noToken.status === 401, 'a request without the token is refused', noToken.body)
    const wrongToken = await post(bridgePort, init, { authorization: 'Bearer nope' })
    check(wrongToken.status === 401, 'a wrong token is refused', wrongToken.body)
    const wrongHost = await post(bridgePort, init, {
      authorization: `Bearer ${token}`,
      host: `evil.test:${bridgePort}`
    })
    check(wrongHost.status === 403, 'a request for another host is refused', wrongHost.body)

    console.log('Tabs')
    const before = await agent.ok('list_tabs')
    check(
      !before.includes('/private') && !before.includes('Private smoke page'),
      'the user’s unshared tab is invisible',
      before
    )
    check(before.includes('not shared'), 'list_tabs says a tab is not shared', before)
    const opened = await agent.ok('new_tab', { url: `${site}/` })
    const tabId = Number(/\[tab (\d+)\]/.exec(opened)?.[1])
    check(
      Number.isInteger(tabId) && opened.includes('Smoke page'),
      'new_tab opens the page',
      opened
    )
    for (let id = 1; id < tabId; id++) {
      const peek = await agent.tool('get_page_text', { tabId: id })
      check(peek.isError, `tab ${id} (not shared) can’t be read`, agent.text(peek))
    }

    console.log('Page tools')
    const tree = await agent.ok('read_page', { tabId })
    const refOf = (pattern: RegExp): number => {
      const line = tree.split('\n').find((row) => pattern.test(row))
      const ref = Number(/\[ref=(\d+)\]/.exec(line ?? '')?.[1])
      if (!Number.isInteger(ref)) throw new Failure(`no ref for ${pattern} in\n${tree}`)
      return ref
    }
    check(tree.includes('button "Say hi"'), 'read_page shows the button', tree)
    await agent.ok('fill', { tabId, ref: refOf(/textbox "Name"/), value: 'Ada' })
    await agent.ok('click', { tabId, ref: refOf(/button "Say hi"/) })
    const pageText = await until('the click to take effect', 5_000, async () => {
      const text = await agent.ok('get_page_text', { tabId })
      return text.includes('Hello Ada') ? text : null
    })
    check(pageText.includes('Hello Ada'), 'fill and click change the page')

    console.log('Iframes and drag')
    const framed = await agent.ok('read_page', { tabId })
    const frameButton = Number(
      /button "Frame button" \[ref=(\d+)\]/.exec(framed)?.[1] ?? Number.NaN
    )
    check(Number.isInteger(frameButton), 'read_page shows a same-site iframe’s button', framed)
    await agent.ok('click', { tabId, ref: frameButton })
    const afterFrame = await until('the frame click', 5_000, async () => {
      const text = await agent.ok('get_page_text', { tabId })
      return text.includes('Frame clicked') ? text : null
    })
    check(afterFrame.includes('Frame clicked'), 'a click inside the iframe works')
    const dragged = await agent.ok('drag', {
      tabId,
      fromRef: refOf(/button "Card"/),
      toRef: refOf(/region "Drop zone"/)
    })
    const dropped = await until('the drop', 5_000, async () => {
      const text = await agent.ok('get_page_text', { tabId })
      return text.includes('Dropped card') ? text : null
    })
    check(dropped.includes('Dropped card'), 'drag drops with HTML5 drag and drop', dragged)
    check(dragged.includes('HTML5'), 'drag says it used HTML5 drag and drop', dragged)

    console.log('WebMCP page tools')
    const none = await agent.ok('page_tools', { tabId })
    check(none.includes('offers no tools'), 'page_tools says a plain page has none', none)
    const webmcp = await agent.ok('new_tab', { url: `${site}/webmcp` })
    const webmcpTab = Number(/\[tab (\d+)\]/.exec(webmcp)?.[1])
    check(
      webmcp.includes('Page tools (WebMCP): snapshot, act'),
      'new_tab names the page’s own tools',
      webmcp
    )
    const listed = await agent.ok('list_tabs')
    check(listed.includes('page tools: snapshot, act'), 'list_tabs names them', listed)
    const described = await agent.ok('page_tools', { tabId: webmcpTab })
    check(
      described.includes('## snapshot (read-only; returns page content)') &&
        described.includes('"required":["steps"]'),
      'page_tools gives their hints and inputs',
      described
    )
    const snapshot = await agent.ok('call_page_tool', { tabId: webmcpTab, name: 'snapshot' })
    check(
      snapshot.includes('"label":"Region","value":"eu"'),
      'call_page_tool runs snapshot',
      snapshot
    )
    const acted = await agent.ok('call_page_tool', {
      tabId: webmcpTab,
      name: 'act',
      input: { steps: [{ ref: 'Region', action: 'setValue', args: ['us'] }] }
    })
    check(acted.includes('"Region":"us"'), 'call_page_tool runs act and returns its result', acted)
    const refused = await agent.tool('call_page_tool', {
      tabId: webmcpTab,
      name: 'act',
      input: { steps: [{ ref: 'Delete', action: 'press' }] }
    })
    check(
      refused.isError && agent.text(refused).includes('Needs a person'),
      'a step the page refuses comes back as its error',
      agent.text(refused)
    )
    // The page asks the person (confirm) while the call waits; here an agent answers for them.
    const asking = agent.tool('call_page_tool', {
      tabId: webmcpTab,
      name: 'act',
      input: { steps: [{ ref: 'Region', action: 'ask', args: ['apac'] }] }
    })
    await until('the page’s confirm', 10_000, async () => {
      const answer = await agent.tool('handle_dialog', { tabId: webmcpTab, accept: true })
      return agent.text(answer).startsWith('Accepted') ? true : null
    })
    const asked = await asking
    check(
      !asked.isError && agent.text(asked).includes('"Region":"apac"'),
      'a page tool waits while the page asks the person',
      agent.text(asked)
    )
    const missing = await agent.tool('call_page_tool', { tabId: webmcpTab, name: 'nope' })
    check(
      missing.isError && agent.text(missing).includes('It has: snapshot, act'),
      'an unknown tool says which there are',
      agent.text(missing)
    )
    await agent.ok('navigate', { tabId: webmcpTab, url: `${site}/private` })
    const gone = await agent.ok('page_tools', { tabId: webmcpTab })
    check(gone.includes('offers no tools'), 'a new page drops the old page’s tools', gone)
    await agent.ok('close_tab', { tabId: webmcpTab })
    await agent.ok('select_tab', { tabId })

    console.log('Debug tools')
    const slow = await agent.ok('emulate', { tabId, cpu: 4 })
    check(slow.includes('CPU 4× slower'), 'emulate slows the CPU', slow)
    const reset = await agent.ok('emulate', { tabId, reset: true })
    check(reset.includes('Nothing is emulated'), 'emulate resets', reset)
    const consoleText = await agent.ok('console_messages', { tabId })
    check(consoleText.includes('smoke console line'), 'console_messages has the log', consoleText)
    const network = await until('the fetch in the network log', 5_000, async () => {
      const text = await agent.ok('network_requests', { tabId })
      return text.includes('/api/ping') ? text : null
    })
    check(network.includes('/api/ping'), 'network_requests has the fetch')
    const shot = await agent.tool('screenshot', { tabId })
    const image = shot.content.find((part) => part.type === 'image')
    check(
      !shot.isError && image?.mimeType?.startsWith('image/') && (image.data?.length ?? 0) > 1000,
      'screenshot returns an image',
      agent.text(shot)
    )

    console.log('Navigation rules')
    await agent.ok('evaluate', { tabId, expression: "location.href = 'browminal://home/'; 1" })
    await sleep(1_000)
    const where = await agent.ok('evaluate', { tabId, expression: 'location.href' })
    check(
      where.includes(site) && !where.includes('browminal:'),
      'a page can’t open browminal://',
      where
    )

    console.log('Minimized window')
    await inMain(inspectPort, `${WINDOW}.minimize()`)
    await sleep(1_000)
    const hidden = await agent.ok('new_tab', { url: `${site}/` })
    const hiddenId = Number(/\[tab (\d+)\]/.exec(hidden)?.[1])
    check(hidden.includes('Smoke page'), 'new_tab opens a page while minimized', hidden)
    const hiddenTree = await agent.ok('read_page', { tabId: hiddenId })
    const hiddenButton = Number(/button "Say hi" \[ref=(\d+)\]/.exec(hiddenTree)?.[1])
    await agent.ok('click', { tabId: hiddenId, ref: hiddenButton })
    const hiddenText = await until('the click while minimized', 5_000, async () => {
      const text = await agent.ok('get_page_text', { tabId: hiddenId })
      return text.includes('Hello') ? text : null
    }).catch(() => '')
    check(hiddenText.includes('Hello'), 'a click works while minimized')
    const hiddenShot = await agent.tool('screenshot', { tabId: hiddenId })
    check(
      !hiddenShot.isError && hiddenShot.content.some((part) => part.type === 'image'),
      'screenshot works while minimized',
      agent.text(hiddenShot)
    )
    await inMain(inspectPort, `${WINDOW}.restore()`)
    await sleep(500)
    const back = await agent.ok('click', { tabId: hiddenId, ref: hiddenButton })
    check(back.includes('Clicked'), 'the tab still takes clicks once the window is back', back)
    await agent.ok('close_tab', { tabId: hiddenId })

    console.log('Single instance')
    const other = launch(profile, `${site}/handed-over`)
    second.push(other)
    const code = await exited(other, 20_000)
    check(code === 0, 'a second launch on the same profile quits', `exit code ${code}`)
    await until('the handed-over page', 10_000, async () =>
      hits.includes('/handed-over') ? true : null
    )
    check(true, 'its URL opens in the running app')
    const after = await agent.ok('list_tabs')
    check(!after.includes('/handed-over'), 'the handed-over tab is not shared', after)

    console.log('Session restore')
    const sessionFile = join(profile, 'session.json')
    const savedUrls = (): string[] =>
      existsSync(sessionFile)
        ? (JSON.parse(readFileSync(sessionFile, 'utf8')).tabs as { url: string }[]).map(
            (tab) => tab.url
          )
        : []
    await inMain(inspectPort, "require('electron').app.quit()")
    const quitCode = await exited(app, 20_000)
    check(quitCode === 0, 'the app quits', `exit code ${quitCode}`)
    const saved = savedUrls()
    check(
      saved.join(' ') === [`${site}/private`, `${site}/`, `${site}/handed-over`].join(' '),
      'session.json has the open tabs, in order',
      saved.join(', ')
    )
    const privateHits = hits.filter((path) => path === '/private').length
    const relaunchInspect = await freePort(inspectPort + 1)
    const relaunched = launch(profile, `${site}/relaunched`, [`--inspect=${relaunchInspect}`])
    second.push(relaunched)
    await until('the relaunch’s page', START_TIMEOUT_MS, async () => {
      if (relaunched.exitCode !== null)
        throw new Failure(`the relaunch exited (${relaunched.exitCode})`)
      return hits.includes('/relaunched') ? true : null
    })
    const restored = await until('the restored session', 10_000, async () => {
      const urls = savedUrls()
      return urls.length === 4 ? urls : null
    }).catch(() => savedUrls())
    check(
      restored.join(' ') === [...saved, `${site}/relaunched`].join(' '),
      'a relaunch brings the tabs back, its own page after them',
      restored.join(', ')
    )
    await sleep(1_000)
    check(
      hits.filter((path) => path === '/private').length === privateHits,
      'a restored tab in the background loads nothing until it’s shown'
    )
    const relaunchAgent = bridge(bridgePort, token)
    const restoredTabs = await until('the bridge after the relaunch', START_TIMEOUT_MS, () =>
      relaunchAgent.call('tools/list', {}).then(() => relaunchAgent.ok('list_tabs'))
    )
    check(!restoredTabs.includes(site), 'restored tabs are not shared', restoredTabs)
    // Ctrl+1 (Cmd+1), as the shortcut handler sees it: the first tab comes to the front.
    const mac = process.platform === 'darwin'
    const ctrl1 = JSON.stringify({
      type: 'keyDown',
      key: '1',
      code: 'Digit1',
      control: !mac,
      meta: mac,
      shift: false,
      alt: false,
      isAutoRepeat: false
    })
    await inMain(
      relaunchInspect,
      `${WINDOW}.webContents.emit('before-input-event', { preventDefault() {} }, ${ctrl1})`
    )
    const shown = await until('the restored tab to load', 10_000, async () =>
      hits.filter((path) => path === '/private').length > privateHits ? true : null
    ).catch(() => false)
    check(shown, 'a restored tab loads its page when it’s shown')

    console.log('Tab strip')
    // A real drag in the UI: press on the first tab, move past the last one's middle, release.
    await inMain(
      relaunchInspect,
      `(async () => {
      const ui = ${WINDOW}.webContents
      const tabs = JSON.parse(await ui.executeJavaScript(
        "JSON.stringify([...document.querySelectorAll('[data-tab-id]')].map((tab) => { const r = tab.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }))"
      ))
      const wait = (ms) => new Promise((done) => setTimeout(done, ms))
      const [x0, y] = tabs[0].map(Math.round)
      const x1 = Math.round(tabs[tabs.length - 1][0]) + 20
      ui.sendInputEvent({ type: 'mouseDown', x: x0, y, button: 'left', clickCount: 1 })
      for (let x = x0; x <= x1; x += 12) {
        ui.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] })
        await wait(16)
      }
      ui.sendInputEvent({ type: 'mouseMove', x: x1, y, button: 'left', modifiers: ['leftButtonDown'] })
      await wait(50)
      ui.sendInputEvent({ type: 'mouseUp', x: x1, y, button: 'left', clickCount: 1 })
    })()`
    )
    const afterDrag = [`${site}/`, `${site}/handed-over`, `${site}/relaunched`, `${site}/private`]
    const reordered = await until('the dragged tab’s new place', 10_000, async () => {
      const urls = savedUrls()
      return urls.join(' ') === afterDrag.join(' ') ? urls : null
    }).catch(() => savedUrls())
    check(
      reordered.join(' ') === afterDrag.join(' '),
      'dragging the first tab past the last moves it to the end',
      reordered.join(', ')
    )
    // Right-click the second tab (handed-over), then "Duplicate" in the overlay's menu.
    const menuText = await inMain(
      relaunchInspect,
      `(async () => {
      const win = ${WINDOW}
      const ui = win.webContents
      const wait = (ms) => new Promise((done) => setTimeout(done, ms))
      const [x, y] = JSON.parse(await ui.executeJavaScript(
        "JSON.stringify((() => { const r = document.querySelectorAll('[data-tab-id]')[1].getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })())"
      ))
      ui.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
      ui.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
      for (let i = 0; i < 50; i++) {
        await wait(100)
        const overlay = win.contentView.children.find((view) => view.webContents?.getURL().includes('overlay.html'))
        if (!overlay) continue
        const text = await overlay.webContents.executeJavaScript(
          "(() => { const rows = [...document.querySelectorAll('[role^=menuitem]')]; const row = rows.find((r) => r.textContent.includes('Duplicate')); if (!row) return ''; const text = rows.map((r) => r.textContent).join('|'); row.click(); return text })()"
        )
        if (text) return text
      }
      return ''
    })()`
    )
    check(
      typeof menuText === 'string' && menuText.includes('Close other tabs'),
      'right-click on a tab opens its menu',
      String(menuText)
    )
    const afterDuplicate = [
      `${site}/`,
      `${site}/handed-over`,
      `${site}/handed-over`,
      `${site}/relaunched`,
      `${site}/private`
    ]
    const duplicated = await until('the duplicated tab', 10_000, async () => {
      const urls = savedUrls()
      return urls.join(' ') === afterDuplicate.join(' ') ? urls : null
    }).catch(() => savedUrls())
    check(
      duplicated.join(' ') === afterDuplicate.join(' '),
      'its Duplicate opens the page again right of it',
      duplicated.join(', ')
    )
  } catch (error) {
    if (log.trim()) console.error(`\n--- app output ---\n${log.trim()}\n------------------`)
    throw error
  } finally {
    second.forEach(kill)
    kill(app)
    server.close()
    await exited(app, 10_000)
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(500)
      }
    }
  }
}

run().then(
  () => {
    console.log('\nSmoke test passed.')
    process.exit(0)
  },
  (error: unknown) => {
    console.error(`\nSmoke test FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
)
