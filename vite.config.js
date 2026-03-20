import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
  ]
  ,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('react') || id.includes('scheduler') || id.includes('react-router')) {
            return 'react-vendor';
          }

          if (id.includes('@tanstack/react-query')) {
            return 'data-vendor';
          }

          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('embla-carousel')) {
            return 'ui-vendor';
          }

          if (id.includes('three') || id.includes('react-leaflet') || id.includes('recharts') || id.includes('framer-motion') || id.includes('react-quill')) {
            return 'heavy-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
});
