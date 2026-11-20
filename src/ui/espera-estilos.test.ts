import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lo que la hoja de estilos decide en la espera desde el 20 de noviembre de 2026 (docs/ux.md, La espera): una sola frase
 * de confianza por pantalla, la calcomanía En vivo del celular de quien mira y la leyenda del QR que se lee desde el fondo.
 * Sin navegador: se lee la regla en el texto de la hoja.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** El cuerpo de la última regla con ese selector exacto al comienzo de un renglón: con el mismo peso, la última manda. */
const regla = (selector: string): string => {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const todas = [...css.matchAll(new RegExp(`^\\s*${escapado}\\s*\\{([^}]*)\\}`, "gm"))];
  return todas.at(-1)?.[1] ?? "";
};

describe("la espera en la hoja de estilos", () => {
  it("en la sala la línea de Nadie elige no se ve: lo dice el pie", () => {
    expect(regla(".espera:not(.espectador) .espera-nadie")).toMatch(/display:\s*none/);
  });

  it("en el celular de quien mira la explicación se esconde, sin borrarse", () => {
    expect(regla(".espectador .espera-lectura")).toMatch(/display:\s*none/);
  });

  it("con el enlace roto la calcomanía no se ve", () => {
    expect(regla(".espectador-roto .sticker")).toMatch(/display:\s*none/);
  });

  it("la leyenda del QR crece con la pantalla y con el ajuste de la espera", () => {
    expect(regla(".espera-qr figcaption")).toMatch(/font-size:\s*calc\(clamp\(18px, 2vw, 30px\) \* var\(--ajuste, 1\)\)/);
  });

  it("en la página, Subí el volumen tiene su fila al final y no sube al lugar de Empieza en cuando se esconde", () => {
    expect(regla(".wait-vol")).toMatch(/grid-area:\s*v\b/);
    expect(css).toContain('grid-template-areas: "k b" "n b" "i i" "l l" "v v";');
    expect(css).toContain('grid-template-areas: "k" "n" "i" "l" "b" "v";');
  });

  it("el punto de En vivo late cada 1,2 s y se queda quieto con menos movimiento", () => {
    const punto = regla(".sticker.en-vivo::before");
    expect(punto).toMatch(/width:\s*10px/);
    expect(punto).toMatch(/background:\s*currentColor/);
    expect(punto).toMatch(/animation:\s*en-vivo-late 1\.2s/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.sticker\.en-vivo::before \{ animation: none; \} \}/);
  });
});
