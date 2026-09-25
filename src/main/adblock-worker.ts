import { parentPort } from 'worker_threads'
import { buildEngine } from './adblock-filters'

// Parsing the filter lists takes most of a second, so it happens here, off main's thread:
// one message in (the lists), one out (the engine's bytes).
parentPort?.once('message', (lists: string) => {
  const bytes = buildEngine(lists)
  parentPort?.postMessage(bytes, [bytes.buffer as ArrayBuffer])
})
