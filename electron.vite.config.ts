import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), '')

  return {
  // ── Main Process ─────────────────────────────────────────────────────────
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {},
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@engine': resolve('src/engine'),
      },
    },
    build: {
      lib: {
        entry: resolve('src/main/main.ts'),
      },
    },
  },

  // ── Preload ───────────────────────────────────────────────────────────────
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      lib: {
        entry: resolve('src/preload/preload.ts'),
      },
    },
  },

  // ── Renderer ─────────────────────────────────────────────────────────────
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@engine': resolve('src/engine'),
        '@renderer': resolve('src/renderer'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
  }
})
