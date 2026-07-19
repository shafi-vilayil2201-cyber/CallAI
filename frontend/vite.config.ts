import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { join } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: join(__dirname, '..', 'backend', 'public'),
    emptyOutDir: true, // clear old static files before writing
  }
})
