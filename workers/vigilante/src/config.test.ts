// Lo que el vigilante lee de su entorno: a quién avisar, desde qué dirección, a qué portero mirar y cada cuánto
// resumir. Cualquier valor raro vuelve al de siempre y nunca rompe la vuelta.
import { describe, expect, it } from "vitest";
import { canalesActivos, destinatarios, faltaConfigurar, horasDeResumen, remitente, urlDelPortero } from "./config";
import { BOT, CHAT, DESTINO, OTRO_DESTINO, mundoFalso } from "./mundo-falso";

describe("destinatarios: la dirección de aviso", () => {
  it("una dirección, o varias separadas por comas, sin espacios de sobra", () => {
    expect(destinatarios(DESTINO)).toEqual([DESTINO]);
    expect(destinatarios(` ${DESTINO} ,${OTRO_DESTINO},`)).toEqual([DESTINO, OTRO_DESTINO]);
  });

  it("sin dirección, o con algo que no es una dirección, no hay a quién avisar", () => {
    expect(destinatarios(undefined)).toEqual([]);
    expect(destinatarios("")).toEqual([]);
    expect(destinatarios("   ")).toEqual([]);
    expect(destinatarios("sin-arroba")).toEqual([]);
    expect(destinatarios("dos@@example.org")).toEqual([]);
    expect(destinatarios("con espacio@example.org")).toEqual([]);
    expect(destinatarios(`${DESTINO}\nOtra: x`)).toEqual([]);
  });

  it("no repite una dirección y se queda con cinco como mucho", () => {
    expect(destinatarios(`${DESTINO},${DESTINO.toUpperCase()}`)).toEqual([DESTINO]);
    const muchas = Array.from({ length: 9 }, (_, i) => `p${i}@example.org`).join(",");
    expect(destinatarios(muchas)).toHaveLength(5);
  });
});

describe("remitente: la dirección desde la que sale el correo", () => {
  it("se arma con el usuario y el dominio, y lleva un nombre", () => {
    expect(remitente({ CORREO_USUARIO: "avisos", CORREO_DOMINIO: "tinkazo.app" })).toEqual({ email: "avisos@tinkazo.app", name: "Vigilante de Tinkazo" });
  });

  it("sin variables, o con algo raro, vale el de siempre", () => {
    const de = { email: "avisos@tinkazo.app", name: "Vigilante de Tinkazo" };
    expect(remitente({})).toEqual(de);
    expect(remitente({ CORREO_USUARIO: "con espacio", CORREO_DOMINIO: "no es un dominio" })).toEqual(de);
    expect(remitente({ CORREO_USUARIO: "a@b", CORREO_DOMINIO: "x" })).toEqual(de);
    expect(remitente({ CORREO_USUARIO: "", CORREO_DOMINIO: "" })).toEqual(de);
  });

  it("acepta otro usuario y otro dominio de la cuenta", () => {
    expect(remitente({ CORREO_USUARIO: "alertas", CORREO_DOMINIO: "ejemplo.example.org" }).email).toBe("alertas@ejemplo.example.org");
  });
});

describe("urlDelPortero", () => {
  it("por defecto, el de mainnet", () => {
    expect(urlDelPortero(undefined)).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("")).toBe("https://pm.tinkazo.app");
  });

  it("saca las barras del final y no acepta algo que no sea https", () => {
    expect(urlDelPortero("https://pm.tinkazo.app/")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("https://pm.tinkazo.app//")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("http://pm.tinkazo.app")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("javascript:alert(1)")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("no es una url")).toBe("https://pm.tinkazo.app");
  });

  it("no deja pasar una dirección con usuario y clave pegados", () => {
    expect(urlDelPortero("https://usuario:clave@pm.tinkazo.app")).toBe("https://pm.tinkazo.app");
  });
});

describe("horasDeResumen", () => {
  it("un entero de 1 a 24, como texto o como número", () => {
    expect(horasDeResumen("24")).toBe(24);
    expect(horasDeResumen("6")).toBe(6);
    expect(horasDeResumen(" 12 ")).toBe(12);
    expect(horasDeResumen("1")).toBe(1);
  });

  it("todo lo demás es uno por día", () => {
    for (const raro of [undefined, "", "0", "-3", "abc", "25", "1.5", "1e2", "NaN"]) expect(horasDeResumen(raro), String(raro)).toBe(24);
  });
});

describe("canalesActivos y qué falta configurar", () => {
  it("el correo pide el binding y la dirección, y Telegram pide sus dos secretos", () => {
    const m = mundoFalso({ conTelegram: true });
    expect(canalesActivos(m.env)).toEqual(["correo", "telegram"]);
    expect(canalesActivos({ ...m.env, TELEGRAM_CHAT_ID: undefined })).toEqual(["correo"]);
    expect(canalesActivos({ ...m.env, TELEGRAM_BOT_TOKEN: undefined })).toEqual(["correo"]);
    expect(canalesActivos({ ...m.env, AVISAR_A: undefined })).toEqual(["telegram"]);
    expect(canalesActivos({ ...m.env, CORREO: undefined })).toEqual(["telegram"]);
    expect(canalesActivos({ ...m.env, AVISAR_A: undefined, TELEGRAM_BOT_TOKEN: undefined })).toEqual([]);
    expect(BOT).toBeTruthy();
    expect(CHAT).toBeTruthy();
  });

  it("dice los nombres de lo que falta, nunca sus valores", () => {
    const m = mundoFalso();
    expect(faltaConfigurar(m.env)).toEqual([]);
    expect(faltaConfigurar({ ...m.env, PORTERO_ADMIN_TOKEN: undefined })).toEqual(["PORTERO_ADMIN_TOKEN"]);
    expect(faltaConfigurar({ ...m.env, AVISAR_A: undefined })).toEqual(["AVISAR_A"]);
    expect(faltaConfigurar({ ...m.env, CORREO: undefined })).toEqual(["CORREO"]);
    expect(faltaConfigurar({ ...m.env, AVISAR_A: undefined, PORTERO_ADMIN_TOKEN: undefined })).toEqual(["PORTERO_ADMIN_TOKEN", "AVISAR_A"]);
    // Con Telegram prendido, aunque falte el correo, hay a quién avisar.
    const t = mundoFalso({ conTelegram: true });
    expect(faltaConfigurar({ ...t.env, AVISAR_A: undefined })).toEqual([]);
  });
});
