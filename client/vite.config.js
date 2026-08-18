import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io/': {
        target: 'http://server:5000', // docker-compose内のサーバーコンテナ名:ポート
        ws: true,
        changeOrigin: true
      }
    }
  }
})