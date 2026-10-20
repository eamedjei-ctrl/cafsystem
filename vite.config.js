import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The app is written entirely in React (src/main.jsx). Browsers still need a
 * minimal document to load it, so instead of keeping an index.html file in the
 * project, this plugin generates that shell for the dev server and the build.
 */
function reactShell({ title, entry }) {
  const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#1e40af" />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${entry}"></script>
  </body>
</html>
`
  let htmlId

  return {
    name: 'react-shell',
    configResolved(config) {
      htmlId = resolve(config.root, 'index.html')
    },
    config() {
      return { build: { rollupOptions: { input: resolve(import.meta.dirname, 'index.html') } } }
    },
    resolveId(id) {
      return id === htmlId ? htmlId : null
    },
    load(id) {
      return id === htmlId ? shell : null
    },
    // Dev server: answer page requests (any client-side route) with the shell.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const accept = req.headers.accept ?? ''
        if (req.method !== 'GET' || !accept.includes('text/html')) return next()
        try {
          const html = await server.transformIndexHtml(req.url ?? '/', shell)
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), reactShell({ title: 'Valley View University · Cafeteria Check-in', entry: '/src/main.jsx' })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'tests/**/*.test.js'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
