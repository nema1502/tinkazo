import { describe, expect, it } from "vitest";
import { elegirMime, MIMES_PREFERIDOS } from "./grabar";

/** El formato que pide MediaRecorder, del que mejor entra en WhatsApp para abajo. */
describe("elegir el formato de grabación", () => {
  it("prefiere MP4 (H.264) cuando el navegador lo sabe escribir", () => {
    const elegido = elegirMime(["video/webm;codecs=vp9", ...MIMES_PREFERIDOS]);
    expect(elegido).toBe(MIMES_PREFERIDOS[0]);
    expect(elegido).toMatch(/^video\/mp4/);
  });

  it("cae a WebM si no hay MP4", () => {
    const elegido = elegirMime(["video/webm;codecs=vp8", "video/webm"]);
    expect(elegido).toMatch(/^video\/webm/);
  });

  it("devuelve null si el navegador no sabe grabar nada de lo pedido", () => {
    expect(elegirMime([])).toBeNull();
    expect(elegirMime(["audio/ogg"])).toBeNull();
  });
});
