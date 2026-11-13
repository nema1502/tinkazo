import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA } from "./alta-textos";
import { TEXTOS_ALTA_PAGO } from "./alta-textos-pago";
import { T } from "./i18n";
import { CLAVES_DEL_PAGO } from "./stellar/alta-api";

const IDIOMAS = ["es", "en"] as const;
const CLAVES = Object.keys(TEXTOS_ALTA_PAGO.es);
const variables = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("los textos del pago", () => {
  it("todas empiezan con `pago`, están en los dos idiomas y no pisan ninguna clave del acceso", () => {
    expect(CLAVES.length).toBeGreaterThan(0);
    expect(Object.keys(TEXTOS_ALTA_PAGO.en).sort()).toEqual([...CLAVES].sort());
    for (const k of CLAVES) {
      expect(k.startsWith("pago"), k).toBe(true);
      expect(k in TEXTOS_ALTA.es, k).toBe(false);
      for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k]?.trim(), `${l} ${k}`).toBeTruthy();
    }
  });

  it("los dos idiomas llevan los mismos datos entre llaves", () => {
    for (const k of CLAVES) expect(variables(TEXTOS_ALTA_PAGO.en[k] as string), k).toEqual(variables(TEXTOS_ALTA_PAGO.es[k] as string));
  });

  it("ninguno lleva punto medio, raya larga o media, flecha ni signo de exclamación", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k], `${l} ${k}`).not.toMatch(/[·•—–―→←↑↓⇒⟶➜!¡]/);
  });

  it("nunca rifa, lotería, raffle, ticket, boleto ni apuesta", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k], `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i);
  });

  it("nunca token, hash, transacción ni blockchain, ni otra moneda que la que se cobra", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k], `${l} ${k}`).not.toMatch(/\b(token|hash|transacci[oó]n|transaction|blockchain|XLM|lumens?|drand|contrato|contract)\b/i);
  });

  it("el modo Oficial se llama Oficial en español y Live en inglés", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_ALTA_PAGO.es[k], k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(TEXTOS_ALTA_PAGO.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("los botones no nombran monedas, redes, notas técnicas ni exchanges: eso se dice una vez, en el renglón de cómo pagar", () => {
    const BOTONES = ["pagoMedioApp", "pagoPreparando", "pagoYaPague", "pagoBuscando", "pagoNoLlegoBoton", "pagoOtraNota", "pagoCopiar", "pagoCopiado", "pagoAbrirApp"];
    for (const k of BOTONES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k], `${l} ${k}`).not.toMatch(/\b(USDC|Stellar|memo|exchange|token|hash)\b/i);
    // Dónde sí: cómo pagar y qué apps sirven, la nota, lo que llegó y la red equivocada.
    const tecnico = /\b(USDC|Stellar|exchange|memo)\b/i;
    const conTecnico = CLAVES.filter((k) => IDIOMAS.some((l) => tecnico.test((TEXTOS_ALTA_PAGO[l][k] as string).replace(/\{\w+\}/g, "")))).sort();
    expect(conTecnico).toEqual(["pagoComo", "pagoFalta", "pagoNota", "pagoNotaImporta", "pagoRedEquivocada", "pagoSirve", "pagoVence", "pagoVencida"].sort());
  });

  it("solo medios automáticos: ningún texto manda a escribir para pagar ni promete un QR del banco", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PAGO[l][k], `${l} ${k}`).not.toMatch(/bolivianos|QR del banco|te pasamos un QR|send you a QR|bank/i);
    for (const k of ["pagoPregunta", "pagoSi", "pagoNo", "pagoSinDolares", "pagoProbarGratis"]) expect(k in TEXTOS_ALTA_PAGO.es, k).toBe(false);
  });

  it("los del diseño que se ven igual, palabra por palabra", () => {
    const DISENO: Record<string, [string, string]> = {
      pagoParaCuenta: ["Este pago es para la cuenta {correo}.", "This payment is for the account {correo}."],
      pagoNotaImporta: ["Sin la nota no sabemos que el pago es tuyo.", "Without the memo we can't tell the payment is yours."],
      pagoVence: ["Esta nota vale hasta el {fecha}.", "This memo is valid until {fecha}."],
      pagoCuenta: ["Cuenta", "Account"],
      pagoMonto: ["Monto", "Amount"],
      pagoNota: ["Nota (memo), obligatoria", "Memo (required)"],
      pagoAbrirApp: ["Abrir en mi app de pagos", "Open in my payments app"],
      pagoCopiar: ["Copiar", "Copy"],
      pagoCopiado: ["Copiado", "Copied"],
      pagoYaPague: ["Ya pagué", "I've paid"],
      pagoBuscando: ["Buscando tu pago…", "Looking for your payment…"],
      pagoNoLlegoBoton: ["No llegó", "It didn't arrive"],
      pagoFalta: ["Llegaron {recibido} de {total} USDC. Mandá lo que falta con la misma nota.", "{recibido} of {total} USDC arrived. Send the rest with the same memo."],
      pagoDeMas: ["Si mandaste de más, escribinos y te lo devolvemos.", "If you sent too much, write to us and we'll send it back."],
      pagoListo: ["Recibimos tu pago.", "We got your payment."],
      pagoErrRed: ["No pudimos buscar tu pago ahora. Probá de nuevo en un momento.", "We couldn't look for your payment right now. Try again in a moment."],
    };
    for (const [k, [es, en]] of Object.entries(DISENO)) {
      expect(TEXTOS_ALTA_PAGO.es[k], k).toBe(es);
      expect(TEXTOS_ALTA_PAGO.en[k], k).toBe(en);
    }
  });

  it("los del diseño que se acortaron a una línea de 14 palabras como mucho, con el mismo sentido, palabra por palabra", () => {
    // Lo que se sacó de la vista no se perdió: va plegado en Más detalles (`pagoSirve`, `pagoParaCuenta`, `pagoVence`).
    const CORTOS: Record<string, [string, string]> = {
      pagoComo: ["Mandá el monto en USDC por Stellar, con esta nota.", "Send the amount in USDC on Stellar, with this memo."],
      pagoSirve: ["Sirve cualquier app o exchange que tenga USDC en Stellar.", "Any app or exchange that holds USDC on Stellar works."],
      pagoNoLlego: ["Todavía no vemos tu pago. Suele tardar menos de un minuto.", "We don't see your payment yet. It usually takes under a minute."],
      pagoTarda: ["Algunas apps tardan más. Podés cerrar y volver a entrar más tarde.", "Some apps take longer. You can close this and come back later."],
      pagoRedEquivocada: ["Si no lo mandaste por Stellar, no va a llegar. Escribinos a hola@tinkazo.app.", "If you didn't send it on Stellar, it won't arrive. Email us at hola@tinkazo.app."],
      pagoQrAyuda: ["Escaneá con tu app de pagos", "Scan it with your payments app"],
      pagoVencida: ["Esta nota venció el {fecha}. Pedí una nueva antes de pagar.", "This memo expired on {fecha}. Get a new one before you pay."],
    };
    for (const [k, [es, en]] of Object.entries(CORTOS)) {
      expect(TEXTOS_ALTA_PAGO.es[k], k).toBe(es);
      expect(TEXTOS_ALTA_PAGO.en[k], k).toBe(en);
    }
  });
});

describe("no pisan otros textos", () => {
  it("ninguna clave se define en otro archivo de textos: el diccionario las junta y la última ganaría", () => {
    const archivos = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? archivos(join(dir, d.name)) : d.name.endsWith(".ts") && !d.name.endsWith(".test.ts") ? [join(dir, d.name)] : []));
    const otros = archivos("src").filter((a) => !a.replaceAll("\\", "/").endsWith("src/alta-textos-pago.ts"));
    const fuentes = otros.map((a) => [a, readFileSync(a, "utf8")] as const);
    for (const k of CLAVES) {
      const definicion = new RegExp(`^\\s+"?${k}"?\\s*:`, "m");
      const donde = fuentes.filter(([, s]) => definicion.test(s)).map(([a]) => a);
      expect(donde, k).toEqual([]);
    }
  });
});

describe("están en el diccionario del sitio", () => {
  it("cada clave llega a T en los dos idiomas con el mismo texto", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_ALTA_PAGO[l][k]);
  });

  it("cada texto que nombra el cliente del pago existe en los dos idiomas", () => {
    const claves = [...new Set([...Object.values(CLAVES_DEL_PAGO.orden), ...Object.values(CLAVES_DEL_PAGO.pago)])];
    for (const k of claves) for (const l of IDIOMAS) expect(typeof T[l][k] === "string" && (T[l][k] as string).trim() !== "", `${l} ${k}`).toBe(true);
  });
});
