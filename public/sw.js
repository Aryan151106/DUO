// Duo Root Service Worker (Development Fallback)
// In production builds, vite-plugin-pwa compiles dist/sw.js incorporating Workbox precache + importScripts('/sw-custom.js').
importScripts('/sw-custom.js');
