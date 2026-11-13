import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { MAX_RECARGO_USDC, RECARGO_QR_POR_DEFECTO, leerConfig, leerPrecios, leerRecargo } from "./config";
import { preciosPublicos } from "./rutas-altas";

/**
 * Lo que se configura de la compra con QR: si está abierta (`COMPRAS_QR`), cuántas personas nuevas por día
 * (`COMPRAS_QR_DIA`), la lista del piloto por variable (`COMPRAS_QR_PILOTO`), el mínimo en bolivianos de una carga
 * (`CARGA_MINIMO_BS`), el patrocinio de Pollar que la vigilancia acepta prendido (`PATROCINIO_PERMITIDO`) y el recargo
 * por pagar con QR (`RECARGO_QR`). Todo nace cerrado y solo vale en mainnet con el libro.
 */

const G1 = Keypair.random().publicKey();
const G2 = Keypair.random().publicKey();

describe("las variables de la compra con QR", () => {
  it("nacen cerradas: ni compra con QR, ni personas nuevas, ni mínimo, ni patrocinio permitido, ni piloto", () => {
    for (const RED of ["mainnet", "testnet"]) {
      const cfg = leerConfig({ RED, ALTAS: "1", POLLAR_APP_ID: "app_1" });
      expect(cfg, RED).toMatchObject({ comprasQr: false, comprasQrDia: 0, cargaMinimoBs: 0, patrocinioPermitido: [] });
      expect(cfg.comprasQrTodos, RED).toBe(false);
      expect([...cfg.comprasQrPiloto], RED).toEqual([]);
      expect(cfg.faltaAltas, RED).toEqual([]);
    }
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" }).recargoQr).toEqual(leerRecargo(RECARGO_QR_POR_DEFECTO));
  });

  it("solo un 1 en COMPRAS_QR la prende, y solo en mainnet con el libro", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1" }).comprasQr).toBe(true);
    for (const v of ["true", " 1", "01", "0", ""]) expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: v }).comprasQr, JSON.stringify(v)).toBe(false);
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", COMPRAS_QR: "1" }).comprasQr).toBe(false);
    expect(leerConfig({ RED: "testnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1" }).comprasQr).toBe(false);
  });

  it("las personas nuevas por día y el mínimo de la carga son enteros; lo mal escrito vale 0", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR_DIA: "5", CARGA_MINIMO_BS: "100" })).toMatchObject({ comprasQrDia: 5, cargaMinimoBs: 100 });
    for (const v of ["-1", "mucho", ""]) {
      const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR_DIA: v, CARGA_MINIMO_BS: v });
      expect(cfg.comprasQrDia, v).toBe(0);
      expect(cfg.cargaMinimoBs, v).toBe(0);
    }
  });

  it("la lista del piloto por variable: cuentas G separadas por coma; una mal escrita la rechaza entera y se anota", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", COMPRAS_QR_PILOTO: ` ${G1} , ${G2} ` });
    expect([...cfg.comprasQrPiloto].sort()).toEqual([G1, G2].sort());
    expect(cfg.faltaAltas).toEqual([]);
    const mal = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", COMPRAS_QR_PILOTO: `${G1},GNOESUNACUENTA` });
    expect([...mal.comprasQrPiloto]).toEqual([]);
    expect(mal.faltaAltas).toEqual(["compras-qr-piloto"]);
    // En testnet no hay piloto.
    expect([...leerConfig({ RED: "testnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR_PILOTO: G1 }).comprasQrPiloto]).toEqual([]);
  });

  it("COMPRAS_QR_PILOTO = todos la abre a cualquier cuenta; vacía es nadie; una mal escrita junto a todos la cierra", () => {
    // Con la confirmación explícita: sin COMPRAS_QR_TODOS en 1, todos cierra (compras-piloto-dos.test.ts).
    const base = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", COMPRAS_QR_TODOS: "1" };
    const todos = leerConfig({ ...base, COMPRAS_QR_PILOTO: "todos" });
    expect(todos.comprasQrTodos).toBe(true);
    expect([...todos.comprasQrPiloto]).toEqual([]);
    expect(todos.faltaAltas).toEqual([]);
    // Con cuentas al lado también: las cuentas no cambian nada mientras esté todos.
    const conCuentas = leerConfig({ ...base, COMPRAS_QR_PILOTO: ` todos , ${G1} ` });
    expect(conCuentas.comprasQrTodos).toBe(true);
    expect([...conCuentas.comprasQrPiloto]).toEqual([G1]);
    // Vacía (como nace): nadie por la variable.
    for (const vacia of ["", " ", ","]) {
      const v = leerConfig({ ...base, COMPRAS_QR_PILOTO: vacia });
      expect(v.comprasQrTodos, JSON.stringify(vacia)).toBe(false);
      expect([...v.comprasQrPiloto], JSON.stringify(vacia)).toEqual([]);
      expect(v.faltaAltas, JSON.stringify(vacia)).toEqual([]);
    }
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" }).comprasQrTodos).toBe(false);
    // Lo mal escrito cierra: una cuenta mal escrita junto a todos, o la palabra con otra forma.
    for (const mal of ["todos,GNOESUNACUENTA", `todos,${G1}x`, "Todos", "TODOS", "todas", "todos;", "*"]) {
      const m = leerConfig({ ...base, COMPRAS_QR_PILOTO: mal });
      expect(m.comprasQrTodos, mal).toBe(false);
      expect([...m.comprasQrPiloto], mal).toEqual([]);
      expect(m.faltaAltas, mal).toEqual(["compras-qr-piloto"]);
    }
    // En testnet no hay piloto.
    expect(leerConfig({ RED: "testnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", COMPRAS_QR_PILOTO: "todos" }).comprasQrTodos).toBe(false);
  });

  it("PATROCINIO_PERMITIDO: banderas sponsor_ separadas por coma; mal escrita queda vacía y se anota", () => {
    // Con la carga prendida: sin la venta, la lista no vale (patrocinio-permitido.test.ts).
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", CARGAS: "1", PATROCINIO_PERMITIDO: "sponsor_trustlines, sponsor_transfer_cosigned" });
    expect(cfg.patrocinioPermitido).toEqual(["sponsor_transfer_cosigned", "sponsor_trustlines"]);
    expect(cfg.faltaAltas).toEqual([]);
    for (const mala of ["sponsor_trustlines,todo", "Sponsor_trustlines", "sponsor_", "sponsor_trustlines;sponsor_x"]) {
      const m = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", PATROCINIO_PERMITIDO: mala });
      expect(m.patrocinioPermitido, mala).toEqual([]);
      expect(m.faltaAltas, mala).toEqual(["patrocinio-permitido"]);
    }
  });

  it("el archivo de mainnet las trae cerradas, con el recargo de la oferta y las dos banderas que la compra necesita; el de testnet no las tiene", () => {
    const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const mainnet = texto.slice(texto.indexOf("[env.mainnet.vars]"));
    const arriba = texto.slice(0, texto.indexOf("[env.mainnet]"));
    expect(mainnet).toMatch(/^COMPRAS_QR = "0"$/m);
    expect(mainnet).toMatch(/^COMPRAS_QR_DIA = "0"$/m);
    expect(mainnet).toMatch(/^COMPRAS_QR_PILOTO = ""$/m);
    expect(mainnet).toMatch(/^CARGA_MINIMO_BS = "0"$/m);
    // Las dos banderas del patrocinio de Pollar que pide la compra con QR (las líneas y los envíos de cuentas
    // co-firmadas), aceptadas por la vigilancia antes de prenderlas en Pollar. Solo cambian lo que la vigilancia espera.
    expect(mainnet).toMatch(/^PATROCINIO_PERMITIDO = "sponsor_transfer_cosigned,sponsor_trustlines"$/m);
    const permitido = /^PATROCINIO_PERMITIDO = "([^"]*)"$/m.exec(mainnet)?.[1] ?? "";
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", PATROCINIO_PERMITIDO: permitido });
    expect(cfg.patrocinioPermitido).toEqual(["sponsor_transfer_cosigned", "sponsor_trustlines"]);
    // Con la venta cerrada del archivo, la lista no vale: la vigilancia espera todo apagado.
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", PATROCINIO_PERMITIDO: permitido }).patrocinioPermitido).toEqual([]);
    expect(cfg.faltaAltas).toEqual([]);
    // Con todas las variables del archivo: nada se vende, nada se carga y ninguna compra con QR empieza.
    const fin = mainnet.indexOf("\n[", 1);
    const vars = Object.fromEntries([...mainnet.slice(0, fin > 0 ? fin : undefined).matchAll(/^([A-Z_]+) = "([^"]*)"$/gm)].map((m) => [m[1]!, m[2]!]));
    expect(leerConfig(vars)).toMatchObject({ altas: true, altasPago: false, cargas: false, comprasQr: false, comprasQrDia: 0, comprasQrTodos: false, faltaAltas: [] });
    // El precio decidido para la semana (4 la primera vez y 0,50 las siguientes), no el valor por defecto del código.
    expect(mainnet).toMatch(/^RECARGO_QR = "4:0\.50"$/m);
    for (const v of ["COMPRAS_QR", "COMPRAS_QR_DIA", "COMPRAS_QR_PILOTO", "CARGA_MINIMO_BS", "PATROCINIO_PERMITIDO", "RECARGO_QR"]) expect(arriba, v).not.toMatch(new RegExp(`^${v}\\b`, "m"));
  });
});

describe("RECARGO_QR", () => {
  it("la primera vez y las siguientes, en USDC con punto: por defecto 4,25 y 0,50, los de la oferta", () => {
    expect(RECARGO_QR_POR_DEFECTO).toBe("4.25:0.5");
    expect(leerRecargo("4.25:0.5")).toEqual({ primera: 42_500_000, siguientes: 5_000_000, primeraUsdc: "4.25", siguientesUsdc: "0.5" });
    expect(leerRecargo(" 3:0 ")).toEqual({ primera: 30_000_000, siguientes: 0, primeraUsdc: "3", siguientesUsdc: "0" });
    expect(leerRecargo(`${MAX_RECARGO_USDC}:${MAX_RECARGO_USDC}`)).not.toBeNull();
  });

  it("lo mal escrito se rechaza entero: un recargo a medias no se cobra", () => {
    for (const mal of ["4.25", "4,25:0.5", "4.25:0.5:1", "-1:0", "a:b", "4.12345678:0", "", ":", "4.25:", "1e3:0", `${MAX_RECARGO_USDC + 1}:0`, `0:${MAX_RECARGO_USDC}.0000001`]) {
      expect(leerRecargo(mal), mal).toBeNull();
    }
  });

  it("con la compra con QR prendida y el recargo mal escrito, no hay recargo y se anota: la compra con QR no se abre", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", RECARGO_QR: "4,25:0,5" });
    expect(cfg.recargoQr).toBeNull();
    expect(cfg.faltaAltas).toEqual(["recargo-qr"]);
    // Con la compra con QR cerrada no se anota: no se usa.
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", RECARGO_QR: "x" }).faltaAltas).toEqual([]);
  });
});

describe("GET /v1/alta/precios dice el recargo del QR", () => {
  it("solo con la compra con QR prendida y el recargo bien escrito; si no, null", () => {
    expect(preciosPublicos(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1" }))).toMatchObject({ recargoQr: { primera: "4.25", siguientes: "0.5" } });
    expect(preciosPublicos(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", RECARGO_QR: "3:1.25" }))).toMatchObject({ recargoQr: { primera: "3", siguientes: "1.25" } });
    expect(preciosPublicos(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" })).recargoQr).toBeNull();
    expect(preciosPublicos(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", COMPRAS_QR: "1", RECARGO_QR: "mal" })).recargoQr).toBeNull();
  });
});

describe("ningún precio con QR pierde en el peor razonable", () => {
  /** Las variables de `[env.mainnet.vars]`, como las lee el Worker. */
  const vars = (): Record<string, string> => {
    const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const mainnet = texto.slice(texto.indexOf("[env.mainnet.vars]"));
    return Object.fromEntries([...mainnet.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"$/gm)].map((m) => [m[1] as string, m[2] as string]));
  };

  it("el primer paquete con la primera vez, y el de diez con la primera vez y con las siguientes, con los números exactos", () => {
    const v = vars();
    const precios = leerPrecios(v.PRECIOS ?? "");
    const recargo = leerRecargo(v.RECARGO_QR ?? "");
    expect(precios).not.toBeNull();
    expect(recargo).not.toBeNull();
    // En micro-dólares, con el crédito de Pollar a US$0,01. El paquete en el peor razonable: la cuenta nueva siempre (35),
    // 12 meses de cuenta aunque el paquete dure menos (10 por mes) y cada sorteo con 2,5 firmas de 20 y US$0,156 de red.
    const paquete = (sorteos: number) => 350_000 + 12 * 100_000 + sorteos * (2.5 * 200_000 + 156_000);
    // Lo que suma pagar con QR. La primera vez: la verificación (193), la línea (10), la carga en su extremo alto (123), la
    // cuenta de paso y el gas (35) y el pago con el saldo (20). Las siguientes: la carga, la cuenta de paso y el gas y el pago.
    const qrPrimera = (193 + 10 + 123 + 35 + 20) * 10_000;
    const qrSiguientes = (123 + 35 + 20) * 10_000;
    // Entra el 95 % de lo pagado.
    const entra = (monto: number) => Math.floor((monto * 95) / 1000);
    const deja = (id: string, primera: boolean) => {
      const p = precios?.find((x) => x.id === id);
      if (!p || !recargo) throw new Error(`falta ${id}`);
      return entra(p.monto + (primera ? recargo.primera : recargo.siguientes)) - paquete(p.sorteos) - (primera ? qrPrimera : qrSiguientes);
    };
    const casos = { altaPrimera: deja("alta", true), p10Primera: deja("p10", true), p10Siguientes: deja("p10", false) };
    for (const [caso, n] of Object.entries(casos)) expect(n, caso).toBeGreaterThanOrEqual(0);
    // Con el recargo de la semana (4 la primera vez): 0,25 menos por el 95 % que entra, en cada caso con la primera vez.
    expect(casos).toEqual({ altaPrimera: 272_000, p10Primera: 1_380_000, p10Siguientes: 85_000 });
    // El primer paquete con las siguientes no existe: pagar la primera vez da acceso, y con acceso no se compra el primero.
  });
});
