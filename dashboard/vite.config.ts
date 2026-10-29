// node_modules
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
// lib
import { chunkFileName, HEAVY_CHUNK_GLOB_IGNORES } from './src/lib/buildChunkNames';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['logo.png', 'notification-badge.png'],
      manifest: {
        name: 'Nova Code',
        short_name: 'Nova Code',
        description: 'Nova Code Dashboard',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      injectManifest: {
        // 'es' (default) makes the plugin pass the deprecated rolldown inlineDynamicImports option
        rollupFormat: 'iife',
        // App shell only; heavy lazy chunks are cached at runtime by sw.ts (nova-assets)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: HEAVY_CHUNK_GLOB_IGNORES
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2024',
    rolldownOptions: {
      output: {
        chunkFileNames: chunkFileName
      }
    }
  },
  server: {
    host: true,
    port: 8080,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      }
    }
  }
});
