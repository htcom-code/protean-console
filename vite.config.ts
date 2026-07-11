import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev proxy → any Protean-enabled Spring app exposing the /platform control plane.
    // Override the target with VITE_PROTEAN_TARGET when the platform runs elsewhere.
    proxy: {
      '/platform': {
        target: process.env.VITE_PROTEAN_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
