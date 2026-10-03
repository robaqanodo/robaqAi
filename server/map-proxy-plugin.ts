import type { Plugin } from 'vite'
import { mapProxyMiddleware } from './map-proxy.ts'

export function mapProxyPlugin(): Plugin {
  return {
    name: 'robaq-map-proxy',
    configureServer(server) { server.middlewares.use(mapProxyMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(mapProxyMiddleware) },
  }
}
