import { defineConfig } from 'vite';

const useLocalEmulators = process.env.VITE_USE_LOCAL_EMULATORS === 'true';
if (useLocalEmulators && !process.env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-')) {
  throw new Error('Proxy dos Emulators exige projectId demo-.');
}

const emulatorProxy = useLocalEmulators ? {
  '/identitytoolkit.googleapis.com': 'http://127.0.0.1:9099',
  '/securetoken.googleapis.com': 'http://127.0.0.1:9099',
  '/google.firestore.v1.Firestore': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    ws: true,
  },
  '/v1/projects/': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  },
} : undefined;

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: emulatorProxy,
  },
  preview: {
    port: 4173
  }
});
