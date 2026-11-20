import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * Los textos de «Dejá tu cuenta lista» (`cl…` en `src/i18n.ts`). Los lee alguien que entra por primera vez, a veces con
 * la pantalla proyectada: en los dos idiomas, sin el punto medio, sin rayas largas, sin flechas, sin signos de
 * exclamación, y sin palabras técnicas (ni la billetera, ni la firma, ni el nombre de quien custodia). «Aparato» tampoco:
 * se dice «este celular» o «esta compu».
 */

const claves = Object.keys(T.es).filter((k) => /^cl[A-Z]/.test(k));

/** Una palabra entera, sin distinguir mayúsculas: «firma» no es «confirmar». */
const palabra = (p: string): RegExp => new RegExp(`(^|[^\\p{L}])${p}([^\\p{L}]|$)`, "iu");
const palabras = (s: string): number => s.split(/\s+/u).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
const PROHIBIDAS_ES = ["turnkey", "pollar", "firma", "firmar", "cofirma", "co-firma", "hash", "xlm", "stellar", "transacción", "transaccion", "billetera", "línea de confianza", "llave", "llaves", "passkey", "pin", "aparato", "aparatos"].map(palabra);
const PROHIBIDAS_EN = ["turnkey", "pollar", "signature", "wallet", "transaction", "trustline", "passkey", "pin", "device", "xlm", "stellar", "hash"].map(palabra);

describe("los textos de «Dejá tu cuenta lista»", () => {
  it("son los de la tabla y están en los dos idiomas", () => {
    expect(claves.length).toBe(64);
    for (const k of claves) {
      expect(typeof T.es[k], k).toBe("string");
      expect(typeof T.en[k], k).toBe("string");
      expect((T.en[k] as string).length, k).toBeGreaterThan(0);
    }
    for (const k of Object.keys(T.en).filter((x) => /^cl[A-Z]/.test(x))) expect(T.es[k], k).toBeDefined();
  });

  it("no tienen punto medio, rayas largas, flechas ni signos de exclamación", () => {
    for (const k of claves)
      for (const l of ["es", "en"] as const) {
        const s = T[l][k] as string;
        expect(s, `${l}.${k}`).not.toMatch(/[·—–←-⇿!¡]/);
      }
  });

  it("no dicen nada técnico ni «aparato»", () => {
    for (const k of claves) {
      for (const r of PROHIBIDAS_ES) expect(T.es[k] as string, `es.${k} ${r}`).not.toMatch(r);
      for (const r of PROHIBIDAS_EN) expect(T.en[k] as string, `en.${k} ${r}`).not.toMatch(r);
    }
  });

  it("el correo tapado usa la viñeta y no el punto medio", () => {
    expect(T.es.clMandarA).toContain("{mail}");
    expect(T.en.clMandarA).toContain("{mail}");
  });

  it("el paso no tiene un «Ahora no»", () => {
    for (const k of claves) expect((T.es[k] as string).trim().toLowerCase(), k).not.toBe("ahora no");
  });

  it("los títulos tienen cinco palabras o menos, en los dos idiomas", () => {
    const titulos = [
      "clTitulo", "clActivarTitulo", "clProtegerTitulo", "clAparatoTitulo",
      "clSinFormaTitulo", "clListaTitulo", "protCodeTitulo", "altaTituloSorteos", "clPremioEsperaTitulo",
    ];
    for (const k of titulos) for (const l of ["es", "en"] as const) expect(palabras(String(T[l][k])), `${l}.${k}`).toBeLessThanOrEqual(5);
  });

  it("las líneas a la vista tienen nueve palabras o menos, en los dos idiomas", () => {
    const lineas = [
      "clBajada", "clActivarTexto", "clActivarLento", "clProtegerTextoCel", "clProtegerTextoCompu",
      "clAparatoTextoCel", "clAparatoTextoCompu", "clSinForma", "clPrimerSello", "clCorreoSpam",
      "protCodeLead", "altaTexto", "altaYaActivada", "altaCuponListo", "altaActivarCupon", "altaActivarPago",
      "altaCuponOk", "altaCuponOk1", "clPremioListo", "clPremioEspera", "clVentanaLista",
    ];
    for (const k of lineas) {
      for (const l of ["es", "en"] as const) {
        expect(palabras(String(T[l][k])), `${l}.${k}: ${String(T[l][k])}`).toBeLessThanOrEqual(9);
      }
    }
  });

  it("cada error dice qué hacer en una oración de dieciséis palabras o menos", () => {
    const errores = [
      "clErrRed", "clErrTarda", "clErrFallo", "clErrTope", "clErrRara", "clErrSinPedido", "clErrSinPedidoFin",
      "clErrServicio", "clErrSesion", "clCodigoRecargado", "clCodigoVencido", "clCodigoViejo", "clDesbloqueoFalla",
      "protBadMail", "protBadCode", "protFalla", "protTarda", "protNoQuedo", "protPasskeyBloqueada",
      "altaErrForma", "altaErrNoExiste", "altaErrVencido", "altaErrAnulado", "altaErrUsado", "altaErrLote",
      "altaErrIntentos", "altaErrIntentos1", "altaErrServicio", "altaErrCuentaDeOtro",
    ];
    for (const k of errores) {
      for (const l of ["es", "en"] as const) {
        expect(palabras(String(T[l][k])), `${l}.${k}: ${String(T[l][k])}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it("ningún texto del paso dice modo Oficial ni para sortear", () => {
    const otras = [
      "protCodeTitulo", "protCodeLead", "protMailLabel", "protMailGo", "protCodeGo", "protOtroCodigo", "protOtroCorreo",
      "protEnviando", "protHaciendo", "protReenviado", "protBadMail", "protBadCode", "protFalla", "protTarda",
      "protNoQuedo", "protPasskeyBloqueada", "altaTituloSorteos", "altaTexto", "altaYaActivada", "altaNoTengo",
      "altaNoTengoResumen", "altaCuponListo", "altaCuponOk", "altaCuponOk1", "altaActivarCupon", "altaActivarPago",
      "altaCuponGuardado", "altaErrCuentaDeOtro",
    ];
    for (const k of [...claves, ...otras]) {
      expect(String(T.es[k]), `es.${k}`).not.toMatch(/modo Oficial|para sortear/i);
      expect(String(T.en[k]), `en.${k}`).not.toMatch(/Live mode|to draw/i);
    }
  });
});
