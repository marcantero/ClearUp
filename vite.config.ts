import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ClearCut/',
  plugins: [react()],
  optimizeDeps: {
    // Transformers.js incluye código avanzado que no se lleva bien
    // con el pre-bundling de esbuild. Lo excluimos para evitar
    // errores de build.
    exclude: ['@huggingface/transformers'],
  },
  ssr: {
    // Evita que Vite intente tratar @huggingface/transformers como
    // dependencia externa en SSR, lo que puede romper el bundle.
    noExternal: ['@huggingface/transformers'],
  },
  build: {
    // Necesario para que el worker y Transformers.js funcionen
    // correctamente en navegadores modernos.
    target: 'esnext',
  },
});
