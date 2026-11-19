import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk/base";
import {
  ES_EVENTO_CAMPANA,
  FASES,
  MAX_TEXTO_CAMPANA,
  VENTANA_PASE_MS,
  cambioValido,
  cierreValido,
  hastaDelPase,
  leerCampanaFirmada,
  leerTextoDeCampana,
  paseDe,
  paseValido,
  ventanaDelPase,
} from "../../workers/sala/src/campana";
import { aB64url, firmaCanonica, verificarFirma } from "../../workers/sala/src/firma";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const secreto = ed25519.utils.randomSecretKey();
const publica = hex(ed25519.getPublicKey(secreto));
const AHORA = 1_800_000_000_000;
const base = {
  v: 1,
  evento: "feria-del-libro",
  red: "testnet",
  cierra_ms: AHORA + 3_600_000,
  sorteo_ms: AHORA + 7_200_000,
  premios: ["400000000", "200000000"],
};

function firmar(datos: unknown, llave = secreto): { texto: string; firma: string } {
  const texto = typeof datos === "string" ? datos : JSON.stringify(datos);
  const firma = ed25519.sign(new TextEncoder().encode(texto), llave);
  return { texto, firma: Buffer.from(firma).toString("base64url") };
}

describe("la campaña firmada", () => {
  it("una campaña bien firmada conserva sus datos y el texto tal cual", () => {
    const texto = JSON.stringify({ ...base, presentacion: "Una feria de prueba" });
    const r = leerCampanaFirmada({ texto, firma: firmar(texto).firma }, publica, AHORA);
    expect(r).toEqual({
      ok: true,
      texto,
      firma: firmar(texto).firma,
      evento: base.evento,
      red: base.red,
      cierraMs: base.cierra_ms,
      sorteoMs: base.sorteo_ms,
      premios: 2,
      organizadora: null,
    });
  });

  it("guarda cuántos premios firmó la empresa y quién sella, si la campaña lo nombra", () => {
    const organizadora = Keypair.random().publicKey();
    const f = firmar({ ...base, premios: ["100000"], organizadora });
    expect(leerCampanaFirmada(f, publica, AHORA)).toMatchObject({ ok: true, premios: 1, organizadora });
    const diez = firmar({ ...base, premios: Array(10).fill("100000") });
    expect(leerCampanaFirmada(diez, publica, AHORA)).toMatchObject({ ok: true, premios: 10 });
  });

  it("una campaña sin premios, con más de diez o con un premio que no es un monto da forma", () => {
    const malas: unknown[] = [undefined, [], Array(11).fill("100000"), "400000000", [400000000], ["abc"], ["-5"], ["1.5"], [""], ["1".repeat(17)]];
    for (const premios of malas) {
      const r = leerCampanaFirmada(firmar({ ...base, premios }), publica, AHORA);
      expect(r, JSON.stringify(premios)).toEqual({ ok: false, motivo: "forma" });
    }
  });

  it("una cuenta de quien sella que no es una cuenta de Stellar da forma", () => {
    for (const organizadora of ["no", 12, `G${"A".repeat(55)}`, `C${"A".repeat(55)}`, {}]) {
      const r = leerCampanaFirmada(firmar({ ...base, organizadora }), publica, AHORA);
      expect(r, JSON.stringify(organizadora)).toEqual({ ok: false, motivo: "forma" });
    }
  });

  it("una campaña con organizadora en null se lee como una que no la nombra", () => {
    const r = leerCampanaFirmada(firmar({ ...base, organizadora: null }), publica, AHORA);
    expect(r).toMatchObject({ ok: true, organizadora: null });
  });

  it("leer solo el texto dice qué campo no sirve y no mira la firma", () => {
    expect(leerTextoDeCampana(JSON.stringify(base), AHORA)).toMatchObject({ ok: true, premios: 2 });
    expect(leerTextoDeCampana(JSON.stringify({ ...base, sorteo_ms: undefined }), AHORA)).toEqual({
      ok: false,
      motivo: "forma",
      campo: "sorteo_ms",
    });
    expect(leerTextoDeCampana(JSON.stringify({ ...base, premios: [] }), AHORA)).toMatchObject({ campo: "premios" });
    expect(leerTextoDeCampana(JSON.stringify({ ...base, cierra_ms: AHORA }), AHORA)).toEqual({
      ok: false,
      motivo: "vencida",
      campo: "cierra_ms",
    });
    expect(leerTextoDeCampana("[]", AHORA)).toMatchObject({ ok: false, motivo: "forma" });
  });

  it("un carácter cambiado en el texto da firma", () => {
    const f = firmar(base);
    const texto = f.texto.replace("feria-del-libro", "feria-del-librp");
    expect(leerCampanaFirmada({ ...f, texto }, publica, AHORA)).toEqual({ ok: false, motivo: "firma" });
  });

  it("firmada con otra llave da firma", () => {
    const otra = ed25519.utils.randomSecretKey();
    expect(leerCampanaFirmada(firmar(base, otra), publica, AHORA)).toEqual({ ok: false, motivo: "firma" });
  });

  it("con la llave pública en null da firma", () => {
    expect(leerCampanaFirmada(firmar(base), null, AHORA)).toEqual({ ok: false, motivo: "firma" });
  });

  it("un texto firmado que no es JSON da forma", () => {
    expect(leerCampanaFirmada(firmar("esto no es JSON"), publica, AHORA)).toEqual({ ok: false, motivo: "forma" });
  });

  it("una versión, un evento o una red que no corresponden dan forma", () => {
    const variantes = [{ v: 2 }, { evento: "Feria Del Libro" }, { red: "futurenet" }];
    for (const variante of variantes) {
      const r = leerCampanaFirmada(firmar({ ...base, ...variante }), publica, AHORA);
      expect(r).toEqual({ ok: false, motivo: "forma" });
    }
  });

  it("con el cierre en el pasado da vencida", () => {
    const f = firmar({ ...base, cierra_ms: AHORA });
    expect(leerCampanaFirmada(f, publica, AHORA)).toEqual({ ok: false, motivo: "vencida" });
  });

  it("un texto de 80001 caracteres da forma antes de verificar la firma", () => {
    const cuerpo = { texto: "x".repeat(MAX_TEXTO_CAMPANA + 1), firma: "A".repeat(86) };
    expect(leerCampanaFirmada(cuerpo, publica, AHORA)).toEqual({ ok: false, motivo: "forma" });
  });

  it("una firma con los bits sobrantes del final distintos de cero no es canónica y no verifica", () => {
    const f = firmar(base);
    expect(verificarFirma(f.texto, f.firma, publica)).toBe(true);
    // El último carácter de 86 solo usa 2 de sus 6 bits: los otros 4 tienen que ser cero.
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const ultimo = alfabeto.indexOf(f.firma.slice(-1));
    expect(ultimo % 16).toBe(0);
    for (const sobra of [1, 5, 15]) {
      const otra = f.firma.slice(0, -1) + alfabeto[ultimo + sobra];
      expect(otra).not.toBe(f.firma);
      expect(firmaCanonica(otra)).toBeNull();
      expect(verificarFirma(f.texto, otra, publica)).toBe(false);
      expect(leerCampanaFirmada({ texto: f.texto, firma: otra }, publica, AHORA)).toEqual({ ok: false, motivo: "firma" });
    }
  });

  it("una firma canónica da sus 64 bytes y vuelve a la misma cadena", () => {
    const f = firmar(base);
    const bytes = firmaCanonica(f.firma);
    expect(bytes).toHaveLength(64);
    expect(bytes && aB64url(bytes)).toBe(f.firma);
  });

  it("firmas de otro largo, con relleno o con caracteres que no son base64url no son canónicas", () => {
    const f = firmar(base);
    for (const firma of ["", f.firma.slice(1), `${f.firma}A`, `${f.firma}=`, f.firma.replace(/.$/, "+"), f.firma.replace(/^./, "/")]) {
      expect(firmaCanonica(firma), firma).toBeNull();
    }
  });

  it("una firma de 85 o 87 caracteres da falso y no lanza", () => {
    for (const firma of ["A".repeat(85), "A".repeat(87)]) {
      expect(() => verificarFirma("texto", firma, publica)).not.toThrow();
      expect(verificarFirma("texto", firma, publica)).toBe(false);
    }
  });

  it("el evento tiene exactamente la misma forma que en el modelo del sitio", () => {
    const modelo = readFileSync(new URL("../campana/modelo.ts", import.meta.url), "utf8");
    expect(modelo).toContain(ES_EVENTO_CAMPANA.source);
  });
});

describe("las fases y su cierre", () => {
  it("cada par de fases permite solo las transiciones de quien organiza", () => {
    const permitidas = new Set(["lista:abierta", "abierta:abierta", "abierta:cerrada", "cerrada:abierta", "cerrada:sellada"]);
    for (const de of FASES) {
      for (const a of FASES) expect(cambioValido(de, a), `${de} a ${a}`).toBe(permitidas.has(`${de}:${a}`));
    }
  });

  it("el cierre va de un minuto a doce horas y tiene que ser entero", () => {
    expect(cierreValido(AHORA + 59_000, AHORA)).toBe(false);
    expect(cierreValido(AHORA + 60_000, AHORA)).toBe(true);
    expect(cierreValido(AHORA + 12 * 3_600_000, AHORA)).toBe(true);
    expect(cierreValido(AHORA + 12 * 3_600_000 + 1, AHORA)).toBe(false);
    expect(cierreValido(AHORA + 60_000 + 0.5, AHORA)).toBe(false);
  });
});

describe("el pase de la pantalla", () => {
  const SECRETO = "01".repeat(32);
  const ahora = 50 * VENTANA_PASE_MS + 1234;
  const actual = ventanaDelPase(ahora);

  it("es determinista en una ventana y cambia en la siguiente", async () => {
    expect(await paseDe(SECRETO, actual)).toBe(await paseDe(SECRETO, actual));
    expect(await paseDe(SECRETO, actual + 1)).not.toBe(await paseDe(SECRETO, actual));
  });

  it("acepta la ventana actual y siete atrás, pero no ocho atrás ni la siguiente", async () => {
    expect(await paseValido(SECRETO, await paseDe(SECRETO, actual), ahora)).toBe(true);
    expect(await paseValido(SECRETO, await paseDe(SECRETO, actual - 7), ahora)).toBe(true);
    expect(await paseValido(SECRETO, await paseDe(SECRETO, actual - 8), ahora)).toBe(false);
    expect(await paseValido(SECRETO, await paseDe(SECRETO, actual + 1), ahora)).toBe(false);
    expect(await paseValido(SECRETO, "A".repeat(11), ahora)).toBe(false);
  });

  it("hastaDelPase es el comienzo de la ventana siguiente", () => {
    expect(hastaDelPase(ahora)).toBe((actual + 1) * VENTANA_PASE_MS);
  });
});
