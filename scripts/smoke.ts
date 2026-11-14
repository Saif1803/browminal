/**
 * Smoke test of the built app (`bun run smoke`; `--no-build` reuses out/; `--app <file>` runs a
 * packaged Browminal instead, e.g. dist/win-unpacked/browminal.exe, and builds nothing).
 *
 * Builds, starts Browminal on a throwaway profile with the agent bridge already on (a spare port),
 * and drives it the way an agent does: through the bridge's own MCP endpoint. Nothing here uses
 * --remote-debugging-port. The user's own tab (opened from the command line, never shared) must
 * stay invisible; requests from a browser or without the token must be refused; a page must not
 * reach browminal://; a second launch must hand its URL to the first and quit.
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

function launch(profile: string, url: string): ChildProcess {
  const [command, args] = PACKAGED_APP
    ? [PACKAGED_APP, []]
    : [process.execPath, [ELECTRON_CLI, '.']]
  return spawn(command, [...args, `--user-data-dir=${profile}`, url], {
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

  const app = launch(profile, `${site}/private`)
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
