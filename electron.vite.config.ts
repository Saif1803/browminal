import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preloads can't require a shared chunk, so the two must not import the same
      // module (see src/shared/terminal-view.ts). electron-vite's isolatedEntries would do this,
      // but it crashes when the build's output isn't a terminal.
      rollupOptions: {
        // The UI's preload, and the terminal view's own (terminal I/O only).
        input: {
          index: resolve('src/preload/index.ts'),
          terminal: resolve('src/preload/terminal.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          terminal: resolve('src/renderer/terminal.html')
        }
      }
    }
  }
})
