import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const disablePWA = process.env.VITE_DISABLE_PWA === 'true' // eslint-disable-line no-undef

const neo4jApiProxyTarget =
  process.env.VITE_NEO4J_API_PROXY_TARGET || 'https://dzavkrusst.us-east-1.awsapprunner.com' // eslint-disable-line no-undef

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-recharts': ['recharts'],
          'vendor-nvl': ['@neo4j-nvl/react'],
        },
      },
    },
    // Strip heavy graph/visualisation chunks out of the entry's <link
    // rel="modulepreload"> list. They're already lazy-loaded behind
    // React.lazy, but Vite's default preload still eagerly DOWNLOADS them on
    // every page load. With these excluded, /feed and /explore stop pulling
    // 1.7 MB of @neo4j-nvl that they never execute.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(
          dep =>
            !dep.includes('vendor-nvl') &&
            !dep.includes('vendor-recharts') &&
            !dep.includes('CoseBilkentLayout') &&
            !dep.includes('HierarchicalLayout')
        ),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(disablePWA
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: [
              'favicon.svg',
              'favicon-32x32.png',
              'favicon-16x16.png',
              'apple-touch-icon-180x180.png',
            ],
            manifest: {
              name: 'Boyk - Corporate Intelligence & Boycott Tracker',
              short_name: 'Boyk',
              description:
                'Track corporate ownership, map company connections, and organize boycotts with real-time intelligence.',
              theme_color: '#0f0f1a',
              background_color: '#0f0f1a',
              display: 'standalone',
              scope: '/',
              start_url: '/',
              orientation: 'portrait-primary',
              categories: ['business', 'news', 'social'],
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
                  src: 'maskable-icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{svg,png,woff2}'],
              navigateFallback: null,
              skipWaiting: true,
              clientsClaim: true,
              cleanupOutdatedCaches: true,
              runtimeCaching: [
                {
                  urlPattern: ({ request }) => request.mode === 'navigate',
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'html-cache',
                    expiration: {
                      maxEntries: 10,
                      maxAgeSeconds: 60 * 60, // 1 hour
                    },
                  },
                },
                {
                  urlPattern: /\.(?:js|css)$/i,
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'assets-cache',
                    expiration: {
                      maxEntries: 80,
                      maxAgeSeconds: 24 * 60 * 60, // 24 hours
                    },
                  },
                },
              ],
            },
          }),
        ]),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG, // eslint-disable-line no-undef
      project: process.env.SENTRY_PROJECT, // eslint-disable-line no-undef
      authToken: process.env.SENTRY_AUTH_TOKEN, // eslint-disable-line no-undef
      disable: !process.env.SENTRY_AUTH_TOKEN, // eslint-disable-line no-undef
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/littlesis-api': {
        target: 'https://littlesis.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/littlesis-api/, '/api'),
      },
      '/neo4j-api': {
        target: neo4jApiProxyTarget,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/neo4j-api/, ''),
      },
    },
  },
})
