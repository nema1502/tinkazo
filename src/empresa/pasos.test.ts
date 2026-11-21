import { describe, expect, it } from "vitest";
import { MAXIMO_DE_PASOS, PASO_VACIO, pasosIniciales, reducirPasos, textoDelPaso } from "./pasos";

describe("los pasos como tarjetas", () => {
  it("arrancan vacíos y se agregan con botones, hasta el tope", () => {
    let pasos = pasosIniciales();
    expect(pasos).toEqual([]);
    for (let i = 0; i < MAXIMO_DE_PASOS + 3; i++) pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    expect(pasos.length).toBe(MAXIMO_DE_PASOS);
  });

  it("subir baja el de su lugar y el resto queda en el mismo orden", () => {
    let pasos = pasosIniciales();
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "tiktok" });
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "enlace" });
    const subido = reducirPasos(pasos, { tipo: "subir", n: 2 });
    expect(subido.map((p) => p.tipo)).toEqual(["instagram", "enlace", "tiktok"]);
    const desdeArriba = reducirPasos(subido, { tipo: "subir", n: 0 });
    expect(desdeArriba.map((p) => p.tipo)).toEqual(["instagram", "enlace", "tiktok"]);
  });

  it("bajar sube el que está después y el último se queda quieto", () => {
    let pasos = pasosIniciales();
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "tiktok" });
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "enlace" });
    const bajado = reducirPasos(pasos, { tipo: "bajar", n: 0 });
    expect(bajado.map((p) => p.tipo)).toEqual(["tiktok", "instagram", "enlace"]);
    const quieto = reducirPasos(bajado, { tipo: "bajar", n: 2 });
    expect(quieto.map((p) => p.tipo)).toEqual(["tiktok", "instagram", "enlace"]);
  });

  it("quitar saca la tarjeta pedida", () => {
    let pasos = pasosIniciales();
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "enlace" });
    const quedan = reducirPasos(pasos, { tipo: "quitar", n: 0 });
    expect(quedan.map((p) => p.tipo)).toEqual(["enlace"]);
  });

  it("pegar el enlace del perfil llena el texto en los dos idiomas", () => {
    let pasos = pasosIniciales();
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    const conUrl = reducirPasos(pasos, { tipo: "url", n: 0, url: "https://instagram.com/cafesol" });
    expect(conUrl[0]?.url).toBe("https://instagram.com/cafesol");
    expect(conUrl[0]?.texto).toEqual({ es: "Seguí a @cafesol en Instagram", en: "Follow @cafesol on Instagram" });
  });

  it("un enlace que no vale no se guarda completo: la tarjeta queda sin texto", () => {
    let pasos = pasosIniciales();
    pasos = reducirPasos(pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    const roto = reducirPasos(pasos, { tipo: "url", n: 0, url: "http://instagram.com/cafesol" });
    expect(roto[0]?.url).toBe("");
    expect(roto[0]?.texto).toEqual({ es: "", en: "" });
    const otroSocial = reducirPasos(roto, { tipo: "url", n: 0, url: "https://tiktok.com/@cafesol" });
    expect(otroSocial[0]?.url).toBe("");
    expect(otroSocial[0]?.texto).toEqual({ es: "", en: "" });
  });

  it("cada: red tiene su texto con su nombre y su cuenta en los dos idiomas", () => {
    expect(textoDelPaso("instagram", "https://instagram.com/cla")).toEqual({ es: "Seguí a @cla en Instagram", en: "Follow @cla on Instagram" });
    expect(textoDelPaso("tiktok", "https://tiktok.com/@cla")).toEqual({ es: "Seguí a @cla en TikTok", en: "Follow @cla on TikTok" });
    expect(textoDelPaso("x", "https://x.com/cla")).toEqual({ es: "Etiquetá a @cla en X", en: "Tag @cla on X" });
    expect(textoDelPaso("youtube", "https://youtube.com/@cla")).toEqual({ es: "Mirá a @cla en YouTube", en: "Watch @cla on YouTube" });
    expect(textoDelPaso("youtube", "https://youtube.com/watch?v=zz")).toEqual({ es: "Mirá el video en YouTube", en: "Watch the video on YouTube" });
    expect(textoDelPaso("facebook", "https://facebook.com/ep")).toEqual({ es: "Visitá la página en Facebook", en: "Visit the Facebook page" });
    expect(textoDelPaso("whatsapp", "https://chat.whatsapp.com/abc")).toEqual({ es: "Entrá al grupo de WhatsApp", en: "Join the WhatsApp group" });
    expect(textoDelPaso("enlace", "https://tinkazo.app/como-funciona.html")).toEqual({ es: "Entrá a este enlace", en: "Open this link" });
  });

  it("la tarjeta nueva viene de su tipo, con el enlace por pegar", () => {
    expect(PASO_VACIO("tiktok")).toEqual({ tipo: "tiktok", url: "", texto: { es: "", en: "" } });
    expect(pasosIniciales()).toEqual([]);
  });
});
