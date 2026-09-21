import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  /**
   * The platform this dev server talks to — resolved once, here, and then used by
   * both the proxy and the header that names it.
   *
   * Two things were wrong with reading it separately in each place. The proxy read
   * `process.env`, which does not carry `.env` files (Vite loads those itself), so
   * setting `VITE_PROTEAN_TARGET` in `.env` moved the label in the header while
   * every request still went to the default — the header named a host nothing was
   * sent to. And with the variable unset the two fell back differently: the proxy
   * to `http://localhost:8080`, the header to the dev server's own origin. Both
   * are the same question, so it is answered in one place and handed to both.
   */
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const platformTarget = env.VITE_PROTEAN_TARGET?.trim() || 'http://localhost:8080'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Dev only, and deliberately so: `vite build` carries no proxy, so a production
    // bundle sends every request to its own origin whatever this said at build time.
    // Injecting it there would let the header name an address no request goes to —
    // which is why the console ignores this variable outside dev (`platformOrigin`).
    define:
      command === 'serve'
        ? { 'import.meta.env.VITE_PROTEAN_TARGET': JSON.stringify(platformTarget) }
        : {},
    server: {
      // Dev proxy → any Protean-enabled Spring app exposing the /platform control plane.
      // Override the target with VITE_PROTEAN_TARGET (shell or .env).
      proxy: {
        '/platform': {
          target: platformTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
