// Prueba las piezas del prevuelo de la red principal (scripts/lib/prevuelo.mjs) y que el guion las use.
// Sin red: el .wasm es un archivo temporal y el saldo se pasa a mano.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  TOPE_DE_PRUEBAS_MS,
  filaDePruebas,
  huellaDe,
  leerOpciones,
  lineaDeCosto,
  ordenesDeDespliegue,
  reservaDeLaCuenta,
  revisarSaldo,
  revisarWasm,
} from "./prevuelo.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const GUION = resolve(aqui, "..", "preflight-mainnet.mjs");
const CUENTA = `G${"A".repeat(55)}`;
const HUELLA = "ab".repeat(32);

const estados = (filas) => filas.map((f) => f[0]);

describe("leerOpciones", () => {
  it("lee las cinco opciones", () => {
    const o = leerOpciones(["--wasm", "x.wasm", "--sha256", HUELLA.toUpperCase(), "--account", CUENTA, "--necesario", "20", "--sin-pruebas"]);
    expect(o).toEqual({ wasm: "x.wasm", sha256: HUELLA, account: CUENTA, necesario: 20, sinPruebas: true });
  });

  it("sin opciones deja todo vacío y corre las pruebas", () => {
    expect(leerOpciones([])).toEqual({ wasm: null, sha256: null, account: null, necesario: null, sinPruebas: false });
  });

  it("acepta el -- suelto de pnpm y la coma decimal", () => {
    expect(leerOpciones(["--", "--necesario", "16,5"]).necesario).toBe(16.5);
  });

  it("frena una opción desconocida, sin valor o con mala forma", () => {
    expect(() => leerOpciones(["--necesaro", "20"])).toThrow(/desconocida/);
    expect(() => leerOpciones(["--wasm"])).toThrow(/necesita un valor/);
    expect(() => leerOpciones(["--wasm", "--sin-pruebas"])).toThrow(/necesita un valor/);
    expect(() => leerOpciones(["--sha256", "abc"])).toThrow(/64 caracteres/);
    expect(() => leerOpciones(["--account", "SBADSEED"])).toThrow(/cuenta/);
    expect(() => leerOpciones(["--necesario", "cero"])).toThrow(/mayor que cero/);
    expect(() => leerOpciones(["--necesario", "0"])).toThrow(/mayor que cero/);
  });
});

describe("revisarWasm", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "tinkazo-prevuelo-"));
  afterAll(() => rmSync(carpeta, { recursive: true, force: true }));
  const ruta = join(carpeta, "tinkazo-raffle.wasm");
  writeFileSync(ruta, Buffer.from("\0asm\u0001\0\0\0 un contrato de prueba"));
  const contenido = readFileSync(ruta);
  const sha256 = huellaDe(contenido);
  const base = { ruta, bytes: contenido.length, sha256 };

  it("con su huella da ok", () => {
    expect(estados(revisarWasm({ ...base, esperado: sha256 }))).toEqual(["ok"]);
  });

  it("con otra huella da mal y muestra las dos", () => {
    const filas = revisarWasm({ ...base, esperado: HUELLA });
    expect(estados(filas)).toEqual(["mal"]);
    expect(filas[0][2]).toContain(sha256);
    expect(filas[0][2]).toContain(HUELLA);
  });

  it("sin --sha256 da ojo con la huella calculada", () => {
    const filas = revisarWasm({ ...base, esperado: null });
    expect(estados(filas)).toEqual(["ojo"]);
    expect(filas[0][2]).toContain(sha256);
  });

  it("sin --wasm da ojo y nunca mal, aunque venga la huella", () => {
    for (const esperado of [null, HUELLA]) {
      const filas = revisarWasm({ ruta: null, esperado });
      expect(estados(filas)).toEqual(["ojo"]);
      expect(filas[0][2]).toContain("--wasm");
    }
  });

  it("conserva el aviso de más de 20 KB", () => {
    expect(estados(revisarWasm({ ruta, bytes: 21 * 1024, sha256, esperado: sha256 }))).toEqual(["ok", "ojo"]);
    expect(estados(revisarWasm({ ruta, bytes: 20 * 1024, sha256, esperado: sha256 }))).toEqual(["ok"]);
  });
});

describe("la reserva de la cuenta", () => {
  const nativo = (balance, venta = "0.0000000") => ({ asset_type: "native", balance, selling_liabilities: venta });

  it("una cuenta sin subentradas guarda 1 XLM", () => {
    expect(reservaDeLaCuenta({ subentry_count: 0, balances: [nativo("17.0000000")] })).toBe(1);
  });

  it("suma las subentradas, las que patrocina, resta las que le patrocinan y suma lo comprometido en ventas", () => {
    expect(reservaDeLaCuenta({ subentry_count: 2, num_sponsoring: 1, num_sponsored: 1, balances: [nativo("20", "0.5")] })).toBe(2.5);
  });
});

describe("revisarSaldo", () => {
  it("25 XLM con --necesario 20 da ok", () => {
    expect(estados(revisarSaldo({ xlm: 25, necesario: 20 }))).toEqual(["ok"]);
  });

  it("17 XLM sin subentradas no alcanza para 16,4: 1 XLM es la reserva", () => {
    const reserva = reservaDeLaCuenta({ subentry_count: 0, balances: [{ asset_type: "native", balance: "17.0000000" }] });
    const filas = revisarSaldo({ xlm: 17, necesario: 16.4, reserva });
    expect(estados(filas)).toEqual(["mal"]);
    expect(filas[0][2]).toContain("16.00 XLM para gastar");
  });

  it("con subentradas, lo que alcanza justo sin el margen del 10 % da ojo, y con el margen, ok", () => {
    const reserva = reservaDeLaCuenta({ subentry_count: 2, balances: [{ asset_type: "native", balance: "20" }] });
    expect(reserva).toBe(2);
    expect(estados(revisarSaldo({ xlm: 20, necesario: 16.4, reserva }))).toEqual(["ojo"]);
    expect(estados(revisarSaldo({ xlm: 20.1, necesario: 16.4, reserva }))).toEqual(["ok"]);
  });

  it("un saldo o un campo de la cuenta que no es número da mal, no un falso ok", () => {
    expect(estados(revisarSaldo({ xlm: Number("abc"), necesario: 1 }))).toEqual(["mal"]);
    const reserva = reservaDeLaCuenta({ subentry_count: "x", balances: [{ asset_type: "native", balance: "20" }] });
    expect(Number.isNaN(reserva)).toBe(true);
    const filas = revisarSaldo({ xlm: 20, necesario: 1, reserva });
    expect(estados(filas)).toEqual(["mal"]);
    expect(filas[0][2]).toMatch(/formato inesperado/);
  });

  it("25 XLM con --necesario 30 da mal", () => {
    expect(estados(revisarSaldo({ xlm: 25, necesario: 30 }))).toEqual(["mal"]);
  });

  it("sin --necesario da ojo con el saldo a la vista", () => {
    const filas = revisarSaldo({ xlm: 25, necesario: null });
    expect(estados(filas)).toEqual(["ojo"]);
    expect(filas[0][2]).toContain("25.00 XLM");
    expect(filas[0][2]).toContain("--necesario");
  });
});

describe("las corridas de pruebas", () => {
  it("un corte por tiempo dice que fue por tiempo, no una prueba roja", () => {
    const fila = filaDePruebas("los tests del protocolo en TypeScript pasan", { codigo: 1, porTiempo: true, ms: 900_000 });
    expect(fila[0]).toBe("mal");
    expect(fila[2]).toMatch(/por tiempo a los 900 s/);
    expect(fila[2]).toMatch(/no es una prueba roja/);
  });

  it("en verde dice cuánto tardó, y en rojo con qué salió", () => {
    expect(filaDePruebas("x", { codigo: 0, porTiempo: false, ms: 284_450 })).toEqual(["ok", "x", "en 284 s"]);
    expect(filaDePruebas("x", { codigo: 1, porTiempo: false, ms: 3000, error: "Tests  1 failed" })).toEqual(["mal", "x", "salió con 1 en 3 s: Tests  1 failed"]);
  });

  it("el tope da margen sobre lo que tarda la suite (entre 280 y 345 s medidos)", () => {
    expect(TOPE_DE_PRUEBAS_MS).toBeGreaterThanOrEqual(3 * 300_000);
  });
});

describe("el informe", () => {
  it("el costo sale de --necesario, no de una cifra fija", () => {
    expect(lineaDeCosto(null)).toContain("simulación");
    expect(lineaDeCosto(18)).toContain("18 XLM");
    expect(lineaDeCosto(null)).not.toMatch(/\b(16|49|70)\b/);
  });

  it("la orden siguiente nombra la identidad, el .wasm, la huella y el ensayo", () => {
    const [ensayo, despliegue] = ordenesDeDespliegue({ wasm: "tinkazo-raffle_v0.2.0.wasm", sha256: HUELLA });
    expect(ensayo).toBe(`scripts/deploy.sh mainnet <identidad> --wasm tinkazo-raffle_v0.2.0.wasm --sha256 ${HUELLA} --ensayo`);
    expect(despliegue).toBe(`scripts/deploy.sh mainnet <identidad> --wasm tinkazo-raffle_v0.2.0.wasm --sha256 ${HUELLA}`);
    const [sinDatos] = ordenesDeDespliegue({ wasm: null, sha256: null });
    expect(sinDatos).toMatch(/^scripts\/deploy\.sh mainnet <identidad> --wasm <.+> --sha256 <.+> --ensayo$/);
  });
});

describe("el guion", () => {
  const texto = readFileSync(GUION, "utf8");

  it("ya no busca el .wasm compilado ni pide una cifra fija", () => {
    expect(texto).not.toContain("target/wasm32v1-none");
    expect(texto).not.toContain("NEEDED_XLM");
    expect(texto).not.toMatch(/\b70\b/);
    expect(texto).not.toMatch(/`scripts\/deploy\.sh mainnet`/);
  });

  it("usa las piezas de scripts/lib/prevuelo.mjs", () => {
    expect(texto).toMatch(/from "\.\/lib\/prevuelo\.mjs"/);
    for (const pieza of ["leerOpciones(", "revisarWasm(", "revisarSaldo(", "lineaDeCosto(", "ordenesDeDespliegue(", "huellaDe(", "reservaDeLaCuenta(", "filaDePruebas("]) {
      expect(texto).toContain(pieza);
    }
  });

  it("las pruebas no se cortan a los 300 s ni corren con los trabajadores por defecto", () => {
    expect(texto).not.toContain("300_000");
    expect(texto).toMatch(/--maxWorkers=\$\{trabajadores\}/);
    expect(texto).toMatch(/from "\.\/lib\/correr-con-tope\.mjs"/);
    expect(texto).toMatch(/correrConTope\("pnpm"[^\n]*tope: TOPE_DE_PRUEBAS_MS/);
  });
});
