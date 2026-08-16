import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)

function geminiDevProxy() {
  return {
    name: 'gemini-dev-proxy',
    configureServer(server) {
      const { loadEnvFiles } = require('./electron/load-env.cjs')
      const { chat, getStatus } = require('./electron/ai.cjs')
      loadEnvFiles()

      server.middlewares.use('/api/ai/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(getStatus()))
      })

      server.middlewares.use('/api/ai/chat', (req, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
          })
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            const text = await chat(payload, (current) => {
              res.write(`data: ${JSON.stringify({ text: current })}\n\n`)
            })
            res.write(`data: ${JSON.stringify({ done: true, text })}\n\n`)
          } catch (error) {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
          } finally {
            res.end()
          }
        })
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), geminiDevProxy()],
  base: './',
  css: {
    postcss: {
      plugins: []
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})
