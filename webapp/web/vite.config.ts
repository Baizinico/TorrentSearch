import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：开发模式代理 /api 到后端 :3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE 流式响应需要关闭缓冲
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 让 text/event-stream 直通，不缓冲
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
});
