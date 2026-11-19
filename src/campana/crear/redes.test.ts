import { describe, expect, it } from "vitest";
import { revisarEnlace } from "./redes";

const bien = (url: string): { ok: true; url: string } => ({ ok: true, url });

describe("revisarEnlace", () => {
  it("un enlace de Instagram pasa y queda escrito como lo deja el lector", () => {
    expect(revisarEnlace("instagram", "https://www.instagram.com/alcancia")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("un enlace sin https se completa y pasa", () => {
    expect(revisarEnlace("instagram", "instagram.com/alcancia")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("un enlace con http pasa a https", () => {
    expect(revisarEnlace("youtube", "http://www.youtube.com/@alcancia")).toEqual(bien("https://www.youtube.com/@alcancia"));
  });

  it("un enlace de TikTok en la fila de Instagram dice que no es de Instagram", () => {
    expect(revisarEnlace("instagram", "https://www.tiktok.com/@alcancia")).toEqual({ ok: false, motivo: "otra-red" });
  });

  it("un enlace de otro sitio en la fila de YouTube no sirve", () => {
    expect(revisarEnlace("youtube", "https://example.org/alcancia")).toEqual({ ok: false, motivo: "mal" });
  });

  it("un enlace con puerto o con usuario no sirve", () => {
    expect(revisarEnlace("instagram", "https://www.instagram.com:8080/alcancia")).toEqual({ ok: false, motivo: "mal" });
    expect(revisarEnlace("instagram", "https://ana@www.instagram.com/alcancia")).toEqual({ ok: false, motivo: "mal" });
  });

  it("la fila de otro enlace acepta cualquier dirección con https", () => {
    expect(revisarEnlace("enlace", "https://example.org/campana")).toEqual(bien("https://example.org/campana"));
  });

  it("lo que no es una dirección no sirve", () => {
    expect(revisarEnlace("instagram", "hola mundo")).toEqual({ ok: false, motivo: "mal" });
    expect(revisarEnlace("enlace", "alcancia")).toEqual({ ok: false, motivo: "mal" });
    expect(revisarEnlace("enlace", "ftp://example.org/x")).toEqual({ ok: false, motivo: "mal" });
  });

  it("vacío dice que está vacío", () => {
    expect(revisarEnlace("tiktok", "   ")).toEqual({ ok: false, motivo: "vacio" });
  });

  it("una dirección de más de 300 caracteres no sirve", () => {
    expect(revisarEnlace("enlace", `https://example.org/${"a".repeat(300)}`)).toEqual({ ok: false, motivo: "mal" });
    expect(revisarEnlace("enlace", `https://example.org/${"a".repeat(270)}`).ok).toBe(true);
  });
});

describe("el usuario solo", () => {
  it("@alcancia en Instagram pasa a su perfil", () => {
    expect(revisarEnlace("instagram", "@alcancia")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("alcancia sin arroba en Instagram también", () => {
    expect(revisarEnlace("instagram", "alcancia")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("el usuario pasa a su perfil en TikTok, X, YouTube y Facebook", () => {
    expect(revisarEnlace("tiktok", "alcancia")).toEqual(bien("https://www.tiktok.com/@alcancia"));
    expect(revisarEnlace("x", "@alcancia")).toEqual(bien("https://x.com/alcancia"));
    expect(revisarEnlace("youtube", "alcancia")).toEqual(bien("https://www.youtube.com/@alcancia"));
    expect(revisarEnlace("facebook", "alcancia")).toEqual(bien("https://www.facebook.com/alcancia"));
  });

  it("+59170000000 en WhatsApp pasa a wa.me", () => {
    expect(revisarEnlace("whatsapp", "+59170000000")).toEqual(bien("https://wa.me/59170000000"));
  });

  it("un dominio de la red escrito sin https no se toma por usuario", () => {
    expect(revisarEnlace("instagram", "instagram.com")).toEqual(bien("https://www.instagram.com/"));
  });
});

describe("lo que se copia del celular", () => {
  it("saca igsh de Instagram", () => {
    expect(revisarEnlace("instagram", "https://instagram.com/alcancia?igsh=abc123")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("saca _t y _r de TikTok", () => {
    expect(revisarEnlace("tiktok", "https://www.tiktok.com/@alcancia?_t=8abc&_r=1")).toEqual(bien("https://www.tiktok.com/@alcancia"));
  });

  it("saca si de YouTube", () => {
    expect(revisarEnlace("youtube", "https://youtube.com/@alcancia?si=xyz")).toEqual(bien("https://youtube.com/@alcancia"));
  });

  it("saca s y t de X, pero solo en X", () => {
    expect(revisarEnlace("x", "https://x.com/alcancia?s=20&t=abc")).toEqual(bien("https://x.com/alcancia"));
    expect(revisarEnlace("enlace", "https://example.org/a?s=20&t=abc")).toEqual(bien("https://example.org/a?s=20&t=abc"));
  });

  it("saca fbclid y utm_ y el numeral", () => {
    const largo = "https://www.facebook.com/alcancia?fbclid=zz&utm_source=a&utm_medium=b#seccion";
    expect(revisarEnlace("facebook", largo)).toEqual(bien("https://www.facebook.com/alcancia"));
    expect(revisarEnlace("enlace", "https://example.org/a?utm_campaign=x&b=1#arriba")).toEqual(bien("https://example.org/a?b=1"));
  });

  it("web.facebook.com y mobile.facebook.com pasan a www.facebook.com", () => {
    expect(revisarEnlace("facebook", "https://web.facebook.com/alcancia")).toEqual(bien("https://www.facebook.com/alcancia"));
    expect(revisarEnlace("facebook", "https://mobile.facebook.com/alcancia")).toEqual(bien("https://www.facebook.com/alcancia"));
    expect(revisarEnlace("facebook", "https://mbasic.facebook.com/alcancia")).toEqual(bien("https://www.facebook.com/alcancia"));
  });

  it("m.instagram.com pasa a www.instagram.com", () => {
    expect(revisarEnlace("instagram", "https://m.instagram.com/alcancia")).toEqual(bien("https://www.instagram.com/alcancia"));
  });

  it("m.tiktok.com pasa a www.tiktok.com", () => {
    expect(revisarEnlace("tiktok", "https://m.tiktok.com/@alcancia")).toEqual(bien("https://www.tiktok.com/@alcancia"));
  });

  it("mobile.twitter.com y mobile.x.com pasan a x.com", () => {
    expect(revisarEnlace("x", "https://mobile.twitter.com/alcancia")).toEqual(bien("https://x.com/alcancia"));
    expect(revisarEnlace("x", "https://mobile.x.com/alcancia")).toEqual(bien("https://x.com/alcancia"));
  });

  it("api.whatsapp.com/send con el teléfono pasa a wa.me", () => {
    const enlace = "https://api.whatsapp.com/send?phone=59170000000&text=hola";
    expect(revisarEnlace("whatsapp", enlace)).toEqual(bien("https://wa.me/59170000000"));
  });

  it("los enlaces cortos que solo redirigen piden copiar la dirección del perfil", () => {
    expect(revisarEnlace("tiktok", "https://vt.tiktok.com/ZSabc/")).toEqual({ ok: false, motivo: "corto" });
    expect(revisarEnlace("facebook", "https://fb.me/alcancia")).toEqual({ ok: false, motivo: "corto" });
    expect(revisarEnlace("x", "https://t.co/abc")).toEqual({ ok: false, motivo: "corto" });
  });
});
