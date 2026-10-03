import type { Plugin } from 'vite'
import { keyHandoffHandler, memoryHandoffStore } from './key-handoff.ts'

export function keyHandoffPlugin(): Plugin {
  return { name: 'robaq-key-handoff', configureServer(server) {
    const handle = keyHandoffHandler(memoryHandoffStore())
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/key-handoff') return next()
      void handle(req, res)
    })
  } }
}
