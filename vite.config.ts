import { guestPresence } from './server/presence.ts'
import { watchTogether } from './server/watch-together.ts'
import { desktopAI } from './server/desktop-ai.ts'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), desktopAI(), watchTogether(), guestPresence()],
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 8787,
    strictPort: true,
    watch: { ignored: ['**/ios/**', '**/offline-assets/**'] },
    allowedHosts: true,
  },
})
