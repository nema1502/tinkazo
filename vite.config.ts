import { resolve } from "node:path";
import { defineConfig } from "vite";

// Dos páginas: el sitio y la verificación pública, que se abre desde el QR o
// el enlace del comprobante y no necesita wallet.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        verificar: resolve(__dirname, "verificar.html"),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
