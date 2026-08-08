import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': '../shared',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'trois': ['@react-three/fiber', '@react-three/drei'],
          'zustand': ['zustand'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
