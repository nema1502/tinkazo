import { resolve } from "node:path";
import { defineConfig } from "vite";

// Tres páginas. El sitio, que es la herramienta y nada más; la verificación
// pública, que se abre desde el QR o el enlace del comprobante y no necesita
// cuenta; y los precios, que salieron de la principal para no meterle una
// tabla de precios a quien solo quiere sortear.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        verificar: resolve(__dirname, "verificar.html"),
        precios: resolve(__dirname, "precios.html"),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
