import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ['@modelcontextprotocol/server'] } } },
  preload: {},
  renderer: {}
})
