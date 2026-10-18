/// <reference types="vitest/config" />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

// El sitio, que es la herramienta y nada más; la verificación pública, que se
// abre desde el QR o el enlace del comprobante y no necesita cuenta; y las
// páginas de lectura (precios, juegos, historia, seguridad, términos), que
// salieron de la principal para no meterle nada de eso a quien solo quiere
// sortear.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        verificar: resolve(__dirname, "verificar.html"),
        precios: resolve(__dirname, "precios.html"),
        juegos: resolve(__dirname, "juegos.html"),
        historia: resolve(__dirname, "historia.html"),
        seguridad: resolve(__dirname, "seguridad.html"),
        "como-funciona": resolve(__dirname, "como-funciona.html"),
        lista: resolve(__dirname, "lista.html"),
        terminos: resolve(__dirname, "terminos.html"),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    // Las copias de trabajo de git (worktrees) no se prueban: sin esto,
    // `pnpm test` corría también las pruebas a medias de otra copia y
    // fallaba por trabajo ajeno (18 de octubre de 2026).
    exclude: [...configDefaults.exclude, "**/worktrees/**"],
  },
});
