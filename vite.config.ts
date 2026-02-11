
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  server: {
    port: 3003,
    host: true,
    proxy: {
      // Mapping for all standard Vision One regions
      '/api/trendmicro/us': {
        target: 'https://api.xdr.trendmicro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trendmicro\/us/, '/v3.0'),
        secure: false,
      },
      '/api/trendmicro/eu': {
        target: 'https://api.eu.xdr.trendmicro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trendmicro\/eu/, '/v3.0'),
        secure: false,
      },
      '/api/trendmicro/sg': {
        target: 'https://api.sg.xdr.trendmicro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trendmicro\/sg/, '/v3.0'),
        secure: false,
      },
      '/api/trendmicro/jp': {
        target: 'https://api.jp.xdr.trendmicro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trendmicro\/jp/, '/v3.0'),
        secure: false,
      },
      '/api/trendmicro/au': {
        target: 'https://api.au.xdr.trendmicro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trendmicro\/au/, '/v3.0'),
        secure: false,
      }
    }
  }
});
