import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { checkAgentRequest } from './agent-auth'
import { AGENT_PORT_ATTEMPTS } from './agent-policy'

const HOST = '127.0.0.1'
const PATH = '/mcp'
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface AgentServer {
  /** The port it's listening on (the saved one, or the next free one). */
  readonly port: number
  close(): Promise<void>
}

interface Options {
  /** Tried first; then the next ports up to AGENT_PORT_ATTEMPTS. */
  port: number
  /** The tokens let in, read on every request, so a new one takes effect at once. */
  tokens: () => readonly string[]
  /**
   * One MCP server per request: the server is stateless, every call stands on its own.
   * `token`: the one the request carried, which says who is calling.
   */
  createMcp: (token: string) => McpServer
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('not JSON'))
      }
    })
    req.on('error', reject)
  })
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name]
  return Array.isArray(value) ? value.join(',') : value
}

/**
 * The MCP server agents connect to: Streamable HTTP on 127.0.0.1 only. Every request is checked
 * by checkAgentRequest (host, not from a browser, token) before the MCP SDK sees it.
 */
export async function startAgentServer({ port, tokens, createMcp }: Options): Promise<AgentServer> {
  let listeningPort = port

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const check = checkAgentRequest(
      {
        host: header(req, 'host'),
        origin: header(req, 'origin'),
        authorization: header(req, 'authorization'),
        secFetchSite: header(req, 'sec-fetch-site')
      },
      listeningPort,
      tokens()
    )
    if (check.result === 'unauthorized') {
      return reply(res, 401, 'Missing or wrong Browminal agent token')
    }
    if (check.result !== 'ok') return reply(res, 403, 'Forbidden')
    if ((req.url ?? '').split('?')[0] !== PATH) return reply(res, 404, 'Not found')
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      return reply(res, 405, 'Method not allowed')
    }

    let body: unknown
    try {
      body = await readJson(req)
    } catch (error) {
      const tooLarge = (error as Error).message === 'too large'
      return reply(res, tooLarge ? 413 : 400, tooLarge ? 'Request too large' : 'Expected JSON')
    }

    const mcp = createMcp(check.token)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      transport.close().catch(() => {})
      mcp.close().catch(() => {})
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('Agent server request failed:', error)
      if (!res.headersSent) reply(res, 500, 'Internal error')
      else res.end()
    })
  })

  for (let attempt = 0; attempt < AGENT_PORT_ATTEMPTS; attempt++) {
    listeningPort = port + attempt
    if (listeningPort > 65535) break
    try {
      await listen(server, listeningPort)
      return {
        port: listeningPort,
        close: () =>
          new Promise((resolve) => {
            server.close(() => resolve())
            server.closeAllConnections()
          })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`Ports ${port}–${port + AGENT_PORT_ATTEMPTS - 1} are all in use`)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
}
