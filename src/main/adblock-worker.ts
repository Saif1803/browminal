import { createRequire } from 'module'
import { parentPort, workerData } from 'worker_threads'
import type Native from '../../native/nebula_native.node'

// Parsing the filter lists takes a moment, so it happens here, off main's thread: one message in
// (the lists and the file to save the engine to), one out when it's saved. workerData is the
// native module's path (native.ts).
const native: typeof Native = createRequire(__filename)(workerData)

parentPort?.once('message', ({ lists, file }: { lists: string; file: string }) => {
  native.buildAdblockEngine(lists, file)
  parentPort?.postMessage('saved')
})
