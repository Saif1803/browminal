import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preloads can't require a shared chunk, so no two may import the same module
      // (see src/shared/terminal-view.ts). electron-vite's isolatedEntries would do this,
      // but it crashes when the build's output isn't a terminal.
      rolldownOptions: {
        // The UI's preload, the terminal view's own (terminal I/O only) and the overlay's
        // (the popovers' actions only).
        input: {
          index: resolve('src/preload/index.ts'),
          terminal: resolve('src/preload/terminal.ts'),
          overlay: resolve('src/preload/overlay.ts')
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
      rolldownOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          terminal: resolve('src/renderer/terminal.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    }
  }
})
