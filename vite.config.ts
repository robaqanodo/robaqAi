import { liveRoomsPlugin } from './server/live-rooms.ts'
import { kasPlugin } from './server/kas-plugin.ts'
import { guestPresence } from './server/presence.ts'
import { watchTogether } from './server/watch-together.ts'
import { desktopAI } from './server/desktop-ai.ts'
import { keyHandoffPlugin } from './server/key-handoff-plugin.ts'
import { mapProxyPlugin } from './server/map-proxy-plugin.ts'
import { chatPlugin } from './server/chat-plugin.ts'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), liveRoomsPlugin(), kasPlugin(), desktopAI(), watchTogether(), guestPresence(), keyHandoffPlugin(), mapProxyPlugin(), chatPlugin()],
  worker: { format: 'es' },
  optimizeDeps: {
    // MapLibre v6's worker breaks under Vite's dep pre-bundler, so GeoJSON lines never draw.
    exclude: ['maplibre-gl'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'react-vendor', test: /node_modules\/(react|react-dom|scheduler)\// }],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8787,
    strictPort: true,
    watch: { ignored: ['**/ios/**', '**/offline-assets/**'] },
    allowedHosts: true,
  },
})
