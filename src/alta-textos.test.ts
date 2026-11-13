import { describe, expect, it } from "vitest";
import { CLAVES_DE_MOTIVO } from "./stellar/alta-api";
import { TEXTOS_ALTA } from "./alta-textos";
import { TEXTOS_ALTA_SIN_PAGO } from "./alta-textos-sin-pago";
import { textoDelProducto } from "./stellar/alta-oferta";
import { T } from "./i18n";

const CLAVES = Object.keys(TEXTOS_ALTA.es);
const IDIOMAS = ["es", "en"] as const;

/** Lo que se reemplaza dentro de un texto: `{n}`, `{fecha}`… */
const variables = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

/**
 * Las claves que el diseño (sección 8) pone en esta tanda: todas las del acceso y el cupo, ninguna del pago. Las dos
 * de «Organizá 10…» y «…50…» son una sola, `cupoOfSumarPaquete`: el producto y su precio los dice el servidor.
 * `cupoOfCeroSumar` es el texto del diseño para cero sorteos con la compra prendida, con nombre propio: va solo en la
 * línea del cupo, junto al botón de sumar, y `errAnchor.porteroSinSorteos` dice siempre el que no ofrece comprar.
 */
const DEL_DISENO = [
  "altaFranja", "altaAbrirAfuera", "altaCopiarEnlace", "altaConBilleteraPropia",
  "altaTexto", "altaTengoCupon", "altaPrimerPaquete", "altaPrimerPaqueteNota", "altaNoTengo", "altaCuponListo", "altaActivarConCupon", "altaOtroCupon",
  "altaCuponLabel", "altaCuponAyuda", "altaRevisando", "altaCuponOk", "altaCuponOk1", "altaActivarCupon", "altaActivarPago", "altaYaActivada", "altaCuponGuardado",
  "clBajadaConPago", "altaErrForma", "altaErrNoExiste", "altaErrVencido", "altaErrAnulado", "altaErrUsado", "altaErrLote", "altaErrIntentos", "altaErrServicio",
  "cupoOfQuedan", "cupoOfQueda1", "cupoOfVencen", "cupoOfVencenTodos", "cupoOfPocos", "cupoOfUnoPorPremio", "cupoOfDoble", "cupoOfSumar", "cupoOfCeroTitulo",
  "cupoOfCeroTexto", "cupoOfVencidoTexto", "cupoOfSumarPaquete", "cupoOfCeroSumar", "cupoOfUsarCupon", "cupoOfTopeMes", "errAnchor.porteroSinAlta", "errAnchor.porteroSinSorteos",
];

describe("los textos del acceso con cupón", () => {
  it("están todas las claves de la sección 8 que no son de pago, y solo esas", () => {
    expect([...CLAVES].sort()).toEqual([...DEL_DISENO].sort());
    expect(CLAVES.some((k) => k.startsWith("pago"))).toBe(false);
  });

  it("cada clave está en español y en inglés, con texto, y los dos idiomas tienen las mismas", () => {
    expect(Object.keys(TEXTOS_ALTA.en).sort()).toEqual(Object.keys(TEXTOS_ALTA.es).sort());
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k]?.trim(), `${l} ${k}`).toBeTruthy();
  });

  it("los dos idiomas llevan los mismos datos entre llaves", () => {
    for (const k of CLAVES) expect(variables(TEXTOS_ALTA.en[k] as string), k).toEqual(variables(TEXTOS_ALTA.es[k] as string));
  });

  it("los datos que lleva cada texto son los que el código reemplaza", () => {
    const permitidos = new Set(["codigo", "n", "fecha", "min", "max", "sorteos", "precio"]);
    for (const k of CLAVES) for (const l of IDIOMAS) for (const v of variables(TEXTOS_ALTA[l][k] as string)) expect(permitidos.has(v), `${l} ${k} {${v}}`).toBe(true);
  });

  it("ninguno lleva punto medio, raya larga o media, flecha ni signo de exclamación", () => {
    const prohibido = /[·•—–―→←↑↓⇒⟶➜!¡]/;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k], `${l} ${k}`).not.toMatch(prohibido);
  });

  it("nunca rifa, lotería, raffle, ticket, boleto ni apuesta", () => {
    const palabras = /rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k], `${l} ${k}`).not.toMatch(palabras);
  });

  it("nada de tecnicismos a la vista: USDC, Stellar, exchange y memo solo en las claves de pago", () => {
    const tecnico = /\b(USDC|Stellar|exchange|memo|XLM|hash|firma|signature|contrato|contract|red principal|mainnet|testnet|drand)\b/i;
    for (const k of CLAVES.filter((c) => !c.startsWith("pago"))) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k], `${l} ${k}`).not.toMatch(tecnico);
  });

  it("la billetera propia se nombra solo donde el diseño la nombra", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) {
      const dice = /billetera|wallet/i.test(TEXTOS_ALTA[l][k] as string);
      expect(dice, `${l} ${k}`).toBe(k === "altaConBilleteraPropia");
    }
  });

  it("el modo Oficial se llama Oficial en español y Live en inglés, y el de prueba Prueba y Test", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_ALTA.es[k], k).not.toMatch(/\bLive\b|\bTest\b|\bmain ?net\b/);
      expect(TEXTOS_ALTA.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
    expect(TEXTOS_ALTA.es.altaTexto).toContain("modo Oficial");
    expect(TEXTOS_ALTA.en.altaTexto).toContain("Live mode");
  });

  it("los textos más leídos son los del diseño, palabra por palabra", () => {
    expect(TEXTOS_ALTA.es.altaFranja).toBe("Tenés un cupón de Tinkazo. Entrá con Google o con tu correo para usarlo.");
    // Los que ofrecen un producto dicen lo del diseño con los números que manda el servidor, y ninguno escrito a mano.
    expect(textoDelProducto({ id: "alta", usdc: "2", sorteos: 3, dias: 365 }, "es")).toBe("3 sorteos oficiales por 2 dólares");
    expect(textoDelProducto({ id: "alta", usdc: "2", sorteos: 3, dias: 365 }, "en")).toBe("3 Live draws for US$2");
    expect(textoDelProducto({ id: "p10", usdc: "5", sorteos: 10, dias: 365 }, "es")).toBe("Organizá 10 sorteos oficiales por 5 dólares");
    expect(textoDelProducto({ id: "p50", usdc: "20", sorteos: 50, dias: 365 }, "en")).toBe("Run 50 Live draws for US$20");
    for (const k of ["altaPrimerPaquete", "cupoOfSumarPaquete"]) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k], `${l} ${k}`).not.toMatch(/\d/);
    expect(TEXTOS_ALTA.es.cupoOfUnoPorPremio).toBe("Cada premio que sorteás de a uno usa un sorteo. Si son iguales, poné cuántos ganan y es uno solo.");
    expect(TEXTOS_ALTA.es.cupoOfCeroTitulo).toBe("Se te acabaron los sorteos oficiales");
    expect(TEXTOS_ALTA.en.cupoOfCeroTitulo).toBe("You're out of Live draws");
  });
});

describe("lo que decidió quien dirige", () => {
  it("el cupón ya usado y el del mismo evento dicen qué hacer", () => {
    expect(TEXTOS_ALTA.es.altaErrUsado).toBe("Ese cupón ya se usó. Si lo usaste vos, entrá con la cuenta con la que lo activaste y tus sorteos van a estar ahí. Si no, pedile otro a quien te lo dio.");
    expect(TEXTOS_ALTA.es.altaErrLote).toBe("Ya usaste un cupón de este evento: va uno por persona. Los sorteos de ese cupón están en esta misma cuenta.");
    expect(TEXTOS_ALTA.en.altaErrUsado).toBe("That coupon has already been used. If you used it, sign in with the account you activated it with and your draws will be there. If not, ask whoever gave it to you for a new one.");
    expect(TEXTOS_ALTA.en.altaErrLote).toBe("You've already used a coupon from this event: it's one per person. That coupon's draws are on this same account.");
  });

  it("la ayuda del campo nombra el QR de la tarjeta", () => {
    expect(TEXTOS_ALTA.es.altaCuponAyuda).toBe("Son 12 letras y números. Están en la tarjeta o en el mensaje que te dieron. Si la tarjeta tiene un QR, es más fácil escanearlo con la cámara del celular.");
    expect(TEXTOS_ALTA.en.altaCuponAyuda).toBe("It's 12 letters and numbers, on the card or in the message you got. If the card has a QR code, scanning it with your phone camera is easier.");
  });
});

describe("están en el diccionario del sitio", () => {
  it("cada clave llega a T en los dos idiomas con el mismo texto (con el pago apagado, la variante sin pago)", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_ALTA_SIN_PAGO[l][k] ?? TEXTOS_ALTA[l][k]);
  });

  it("cada texto que nombra el cliente del servidor existe en los dos idiomas", () => {
    const claves = [...new Set(Object.values(CLAVES_DE_MOTIVO))];
    expect(claves.length).toBeGreaterThan(5);
    for (const k of claves) for (const l of IDIOMAS) expect(typeof T[l][k] === "string" && (T[l][k] as string).trim() !== "", `${l} ${k}`).toBe(true);
  });

  it("las claves de la pantalla de la cuenta que se reusan siguen ahí", () => {
    for (const k of ["clErrSesion", "clEntrarDeNuevo", "clErrServicio", "clErrRed", "clBajada", "clActivarTexto"]) for (const l of IDIOMAS) expect(typeof T[l][k], `${l} ${k}`).toBe("string");
  });
});
