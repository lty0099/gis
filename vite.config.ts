import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
// 👉 Leaflet 和 leaflet-draw 样式文件特殊处理
import path from 'path'
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      leaflet: path.resolve(__dirname, 'node_modules/leaflet'),
      'leaflet-draw': path.resolve(__dirname, 'node_modules/leaflet-draw'),
    },
  },
  optimizeDeps: {
    include: ['leaflet', 'leaflet-draw'],
  },
})
