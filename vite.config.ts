import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    headers: {
      'Permissions-Policy': 'camera=*, microphone=*, display-capture=*',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-512x512.png'],
      manifest: {
        name: 'AV — Aryan & Vidhi',
        short_name: 'AV',
        description: "Aryan & Vidhi's private shared space.",
        theme_color: '#FFFDF7',
        background_color: '#FFFDF7',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: "Quick Nudge",
            short_name: "Nudge",
            description: "Send a quick nudge in AV",
            url: "/?action=nudge",
            icons: [{ src: "favicon.svg", sizes: "96x96" }]
          },
          {
            name: "Love Note",
            short_name: "Chat",
            description: "Open AV chat and send a message",
            url: "/?action=chat",
            icons: [{ src: "favicon.svg", sizes: "96x96" }]
          },
          {
            name: "Today's Tasks",
            short_name: "Tasks",
            description: "Check shared to-do list",
            url: "/?action=today",
            icons: [{ src: "favicon.svg", sizes: "96x96" }]
          },
          {
            name: "Companion Widget",
            short_name: "Widget",
            description: "Open compact couple widget",
            url: "/?widget=true",
            icons: [{ src: "favicon.svg", sizes: "96x96" }]
          }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/__/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        inlineWorkboxRuntime: true,
        importScripts: ['/sw-custom.js']
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('date-fns')) return 'vendor-date';
          if (id.includes('lucide-react') || id.includes('canvas-confetti')) return 'vendor-ui';
          if (id.includes('@tanstack') || id.includes('zustand')) return 'vendor-state';
        },
      },
    },
  },
})
