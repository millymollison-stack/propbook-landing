import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2018',
    lib: {
      entry: './src/export/standalone.ts',
      name: 'PropbookApp',
      fileName: () => 'propbook-app.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: '/Users/davidsassistant/.openclaw/workspace/projects',
    minify: 'esbuild',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  },
});
