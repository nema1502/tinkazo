import { defineConfig } from "vite";

// Sitio estático de una sola entrada (index.html). La página de verificación
// (verificar.html) se agrega como segunda entrada en la épica 4.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
