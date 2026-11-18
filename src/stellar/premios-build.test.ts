import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../../vite.config";
import { avisosDelRetiro, problemasDePremios, problemasDelRetiro } from "./premios-build";
import { cuentaDeCobrosDelPortero } from "./retiro-config";

/**
 * El build no sale con el modo premios junto con el pago con el saldo o con la compra con QR: el modo promete que la
 * cuenta solo ve su saldo y recibe, y esos dos firman con ella o le traen dinero. No toca ninguna bandera: obliga a elegir.
 *
 * Tampoco sale con el costo del retiro a medio poner (`VITE_RETIRO_COSTO` y `VITE_RETIRO_CUENTA`): una variable mal
 * escrita, la cuenta sin el costo, o un costo que se cobra sin el voto por contenido, sin el portero o con otra cuenta que
 * la de cobros del portero.
 */

/** Cuentas de verdad de testnet (públicas), con su final de control en regla. */
const COBROS = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const OTRA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const PORTERO = "https://pm.tinkazo.app";
/** Un entorno que cobra y está completo: el que el build deja salir. */
const COMPLETO = { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: COBROS, VITE_VOTO_POR_CONTENIDO: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO };
const DEL_PORTERO = { cuentaDeCobros: COBROS };

describe("el modo premios y la venta", () => {
  it("con el pago con el saldo prendido, el build no sale: nombra las banderas y no sus valores", () => {
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_RAMPA=premios");
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
  });

  it("con la compra con QR prendida, tampoco", () => {
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_COMPRA_QR=1");
  });

  it("con las dos, dice las dos", () => {
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_ALTA_PAGO: "1" })).toHaveLength(2);
  });

  it("lee el modo como lo lee el sitio: sin mayúsculas ni espacios que importen", () => {
    expect(problemasDePremios({ VITE_RAMPA: "  Premios ", VITE_PAGO_CON_SALDO: "1" })).toHaveLength(1);
    expect(problemasDePremios({ VITE_RAMPA: "PREMIOS", VITE_COMPRA_QR: "1" })).toHaveLength(1);
  });

  it("con el modo premios solo, o con premios y la venta sin esas dos, no hay ningún problema", () => {
    expect(problemasDePremios({ VITE_RAMPA: "premios" })).toEqual([]);
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_ALTA_PAGO: "1", VITE_ALTA: "1" })).toEqual([]);
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "0", VITE_COMPRA_QR: "" })).toEqual([]);
    expect(problemasDePremios({})).toEqual([]);
  });

  it("con la venta sin el modo premios, o con otro modo de la rampa, el build sale como hoy", () => {
    for (const rampa of [undefined, "", "pollar", "recibir", "meru", "premio", "premios,recibir"]) {
      expect(problemasDePremios({ ...(rampa === undefined ? {} : { VITE_RAMPA: rampa }), VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1" }), String(rampa)).toEqual([]);
    }
  });

  it("no escribe valores de variables: ni una dirección ni una llave llegan a la bitácora", () => {
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1", VITE_PATROCINIO_URL_MAINNET: secreto, VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_llave" });
    expect(p.join(" ")).not.toContain(secreto);
    expect(p.join(" ")).not.toContain("pub_llave");
  });
});

describe("el costo del retiro: lo que frena el build", () => {
  it("un entorno completo sale", () => {
    expect(problemasDelRetiro(COMPLETO, DEL_PORTERO)).toEqual([]);
  });

  it("sin ninguna de las dos variables sale como hoy, con lo demás prendido o no", () => {
    expect(problemasDelRetiro({}, DEL_PORTERO)).toEqual([]);
    expect(problemasDelRetiro({}, { cuentaDeCobros: null })).toEqual([]);
    expect(problemasDelRetiro({ VITE_RETIRO_COSTO: "", VITE_RETIRO_CUENTA: "" }, DEL_PORTERO)).toEqual([]);
    expect(problemasDelRetiro({ VITE_VOTO_POR_CONTENIDO: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO }, DEL_PORTERO)).toEqual([]);
  });

  it("el costo mal escrito frena el build y nombra la variable", () => {
    for (const mal of ["0,50", "abc", "-1", "0.12345678", "1000", " 0 5"]) {
      const p = problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_COSTO: mal }, DEL_PORTERO);
      expect(p, mal).toHaveLength(1);
      expect(p[0], mal).toContain("VITE_RETIRO_COSTO");
      expect(p[0], mal).toContain("mal escrita");
    }
  });

  it("el costo arriba de 5 dólares frena el build y dice el tope", () => {
    const p = problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_COSTO: "5.01" }, DEL_PORTERO);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_RETIRO_COSTO");
    expect(p[0]).toContain("tope de 5 dólares");
  });

  it("el costo de 5 dólares justos sale", () => {
    expect(problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_COSTO: "5" }, DEL_PORTERO)).toEqual([]);
  });

  it("una cuenta que no es una dirección G de verdad frena el build, también con el costo en cero", () => {
    const mala = `${COBROS.slice(0, 55)}${COBROS[55] === "A" ? "B" : "A"}`;
    for (const cuenta of [mala, "hola", `C${COBROS.slice(1)}`]) {
      for (const costo of ["0.50", "0", ""]) {
        const p = problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_COSTO: costo, VITE_RETIRO_CUENTA: cuenta }, DEL_PORTERO);
        expect(p.join(" "), `${cuenta} ${costo}`).toContain("VITE_RETIRO_CUENTA no es una cuenta de Stellar válida");
      }
    }
  });

  it("la cuenta sin el costo frena el build: no se sabe cuánto cobrar", () => {
    for (const costo of [undefined, "", "   "]) {
      const p = problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_COSTO: costo }, DEL_PORTERO);
      expect(p, String(costo)).toHaveLength(1);
      expect(p[0]).toContain("VITE_RETIRO_CUENTA está puesta sin VITE_RETIRO_COSTO");
    }
  });

  it("la cuenta de cobros con el costo en cero sale: no se cobra nada y no hace falta nada más", () => {
    expect(problemasDelRetiro({ VITE_RETIRO_COSTO: "0", VITE_RETIRO_CUENTA: COBROS }, DEL_PORTERO)).toEqual([]);
    expect(problemasDelRetiro({ VITE_RETIRO_COSTO: "0.00", VITE_RETIRO_CUENTA: COBROS }, { cuentaDeCobros: null })).toEqual([]);
  });

  it("otra cuenta que la de cobros del portero no sale ni con el costo en cero", () => {
    const p = problemasDelRetiro({ VITE_RETIRO_COSTO: "0.00", VITE_RETIRO_CUENTA: OTRA }, DEL_PORTERO);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_RETIRO_CUENTA no es la CUENTA_COBROS del portero");
  });

  it("otra cuenta que la de cobros del portero tampoco sale sin el costo, y lo dice junto con lo que falta", () => {
    const p = problemasDelRetiro({ VITE_RETIRO_CUENTA: OTRA }, DEL_PORTERO);
    expect(p).toHaveLength(2);
    expect(p.join(" ")).toContain("VITE_RETIRO_CUENTA está puesta sin VITE_RETIRO_COSTO");
    expect(p.join(" ")).toContain("no es la CUENTA_COBROS del portero");
  });

  it("el costo sin la cuenta sale: no se cobra nada", () => {
    expect(problemasDelRetiro({ VITE_RETIRO_COSTO: "0.50" }, DEL_PORTERO)).toEqual([]);
    expect(problemasDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "" }, DEL_PORTERO)).toEqual([]);
  });

  it("con otra cuenta que la de cobros del portero, el build no sale", () => {
    const p = problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_CUENTA: OTRA }, DEL_PORTERO);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_RETIRO_CUENTA no es la CUENTA_COBROS del portero");
  });

  it("si no se pudo leer la cuenta de cobros del portero, el build no sale", () => {
    const p = problemasDelRetiro(COMPLETO, { cuentaDeCobros: null });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("No se pudo leer CUENTA_COBROS");
  });

  it("el costo sin el voto por contenido no sale, con cualquier valor que no sea 1", () => {
    for (const voto of [undefined, "", "0", "true", " 1"]) {
      const p = problemasDelRetiro({ ...COMPLETO, VITE_VOTO_POR_CONTENIDO: voto }, DEL_PORTERO);
      expect(p, String(voto)).toHaveLength(1);
      expect(p[0]).toContain("VITE_VOTO_POR_CONTENIDO=1");
    }
  });

  it("el costo sin la dirección del portero de la red principal no sale", () => {
    for (const url of [undefined, "", "   "]) {
      const p = problemasDelRetiro({ ...COMPLETO, VITE_PATROCINIO_URL_MAINNET: url }, DEL_PORTERO);
      expect(p, String(url)).toHaveLength(1);
      expect(p[0]).toContain("VITE_PATROCINIO_URL_MAINNET");
    }
  });

  it("lo que falta se dice junto: cada problema sale una vez", () => {
    const p = problemasDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: OTRA }, DEL_PORTERO);
    expect(p).toHaveLength(3);
  });

  it("no escribe valores de variables: ni la cuenta ni la dirección del portero llegan a la bitácora", () => {
    const secreto = "https://secreto.example/ruta";
    const peor = { VITE_RETIRO_COSTO: "0,5", VITE_RETIRO_CUENTA: OTRA, VITE_PATROCINIO_URL_MAINNET: secreto };
    const todo = [...problemasDelRetiro(peor, DEL_PORTERO), ...problemasDelRetiro({ ...COMPLETO, VITE_RETIRO_CUENTA: OTRA }, DEL_PORTERO)].join(" ");
    expect(todo).not.toContain(secreto);
    expect(todo).not.toContain(OTRA);
    expect(todo).not.toContain(COBROS);
    expect(todo).not.toContain("0,5");
  });

  it("los mensajes no llevan punto y coma, comillas angulares ni signos de exclamación", () => {
    const peor = { VITE_RETIRO_COSTO: "9", VITE_RETIRO_CUENTA: "x" };
    const todo = [
      ...problemasDelRetiro(peor, DEL_PORTERO),
      ...problemasDelRetiro({ VITE_RETIRO_CUENTA: COBROS }, DEL_PORTERO),
      ...problemasDelRetiro(COMPLETO, { cuentaDeCobros: null }),
    ];
    for (const mensaje of todo) expect(mensaje).not.toMatch(/[«»;·—!¡]/);
  });

  it("no toca lo del modo premios: son controles aparte", () => {
    expect(problemasDePremios({ VITE_RAMPA: "premios", ...COMPLETO })).toEqual([]);
    expect(problemasDelRetiro({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1" }, DEL_PORTERO)).toEqual([]);
  });
});

describe("el costo del retiro: lo que el build avisa y no frena", () => {
  it("el costo sin la cuenta deja una línea en la bitácora, sin valores", () => {
    for (const cuenta of [undefined, "", "  "]) {
      const a = avisosDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: cuenta });
      expect(a, String(cuenta)).toHaveLength(1);
      expect(a[0]).toContain("VITE_RETIRO_COSTO está puesta sin VITE_RETIRO_CUENTA");
      expect(a[0]).toContain("no se cobra nada");
      expect(a[0]).not.toContain("0.50");
    }
  });

  it("no avisa con el costo vacío, en cero, mal escrito o con la cuenta puesta", () => {
    expect(avisosDelRetiro({})).toEqual([]);
    expect(avisosDelRetiro({ VITE_RETIRO_COSTO: "0" })).toEqual([]);
    expect(avisosDelRetiro({ VITE_RETIRO_COSTO: "0,50" })).toEqual([]);
    expect(avisosDelRetiro(COMPLETO)).toEqual([]);
    expect(avisosDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "hola" })).toEqual([]);
  });
});

describe("vite.config.ts frena el build con esta regla", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

  it("arma el control solo al construir, con las variables VITE_ del entorno, y lo pone entre los plugins", () => {
    expect(config).toMatch(/import \{[^}]*\bproblemasDePremios\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));
    expect(control).toContain('apply: "build"');
    expect(control).toContain('loadEnv(mode, __dirname, ["VITE_"])');
    expect(control).toMatch(/if \(problemas\.length\) throw new Error/);
    expect(config).toMatch(/plugins: \[[^\]]*validarModoPremios\(\)/);
  });

  it("no frena pnpm dev ni las pruebas: el control es solo del build", () => {
    const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));
    expect(control).not.toContain("configureServer");
    expect(control).not.toMatch(/apply:\s*"serve"/);
  });
});

describe("vite.config.ts frena el build con el costo del retiro a medio poner", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const control = config.slice(config.indexOf("function validarCostoDelRetiro"), config.indexOf("function adelantarLectura"));

  it("arma el control solo al construir, con las variables VITE_ y VERCEL_ENV del entorno, y lo pone entre los plugins", () => {
    expect(config).toMatch(/import \{[^}]*\bproblemasDelRetiro\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    expect(control).toContain('apply: "build"');
    expect(control).toContain('loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"])');
    expect(control).toMatch(/if \(problemas\.length\) throw new Error/);
    expect(config).toMatch(/plugins: \[[^\]]*validarCostoDelRetiro\(\)/);
  });

  it("compara con la CUENTA_COBROS que lee de workers/patrocinio/wrangler.toml, y con la portada", () => {
    expect(config).toContain('"workers/patrocinio/wrangler.toml"');
    expect(control).toContain("problemasDelRetiro(env, { cuentaDeCobros: cuentaDeCobrosDelWrangler() })");
    expect(control).toContain("problemasDeLaPortadaConRetiro(env, portada)");
  });

  it("deja los avisos en la bitácora del build y no los convierte en error", () => {
    expect(control).toContain("avisosDelRetiro(env)");
    expect(control).toContain("this.warn(aviso)");
  });

  it("no frena pnpm dev ni las pruebas: el control es solo del build", () => {
    expect(control).not.toContain("configureServer");
    expect(control).not.toMatch(/apply:\s*"serve"/);
  });

  it("si el wrangler.toml no se puede leer, el control lo toma como cuenta sin leer y no revienta antes de decirlo", () => {
    const lector = config.slice(config.indexOf("function cuentaDeCobrosDelWrangler"), config.indexOf("function validarCostoDelRetiro"));
    expect(lector).toContain("try {");
    expect(lector).toContain("return null;");
  });
});

/** El plugin armado de verdad en `vite.config.ts`, con sus dos ganchos tal como los llama el build. */
interface ControlDelBuild {
  name: string;
  config(c: object, entorno: { mode: string; command: string }): void;
  buildStart(this: { warn(m: string): void }): void;
}

describe("el control del costo del retiro, armado como lo arma el build", () => {
  const control = (viteConfig.plugins as unknown as ControlDelBuild[]).find((p) => p?.name === "tinkazo:costo-del-retiro") as ControlDelBuild;
  const wrangler = readFileSync(new URL("../../workers/patrocinio/wrangler.toml", import.meta.url), "utf8");
  const cobrosDeVerdad = cuentaDeCobrosDelPortero(wrangler) as string;

  /** Pone el entorno del build: lo que no se dice queda vacío, aunque la máquina tenga esas variables en su `.env.local`. */
  function entorno(env: Record<string, string>): void {
    const nombres = ["VITE_RETIRO_COSTO", "VITE_RETIRO_CUENTA", "VITE_VOTO_POR_CONTENIDO", "VITE_PATROCINIO_URL_MAINNET", "VERCEL_ENV"];
    for (const k of nombres) vi.stubEnv(k, env[k] ?? "");
  }
  const correr = (mode = "production"): void => control.config({}, { mode, command: "build" });
  const completo = {
    VITE_RETIRO_COSTO: "0.50",
    VITE_RETIRO_CUENTA: cobrosDeVerdad,
    VITE_VOTO_POR_CONTENIDO: "1",
    VITE_PATROCINIO_URL_MAINNET: PORTERO,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("está entre los plugins y la cuenta de cobros del portero se lee del archivo de verdad", () => {
    expect(control).toBeTruthy();
    expect(cobrosDeVerdad).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it("sin nada configurado, el build sale como hoy", () => {
    entorno({});
    expect(() => correr()).not.toThrow();
    entorno({ VERCEL_ENV: "production" });
    expect(() => correr()).not.toThrow();
  });

  it("con la cuenta de cobros del portero y todo lo demás, el build sale fuera de producción", () => {
    entorno(completo);
    expect(() => correr()).not.toThrow();
  });

  it("con otra cuenta que la de cobros del portero, el build no sale y no escribe la cuenta", () => {
    entorno({ ...completo, VITE_RETIRO_CUENTA: OTRA });
    expect(() => correr()).toThrow(/El costo del retiro está a medio poner/);
    try {
      correr();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(OTRA);
      expect(String((e as Error).message)).not.toContain(cobrosDeVerdad);
    }
  });

  it("con el costo mal escrito, el build no sale", () => {
    entorno({ ...completo, VITE_RETIRO_COSTO: "0,50" });
    expect(() => correr()).toThrow(/VITE_RETIRO_COSTO está mal escrita/);
  });

  it("con el costo sin el voto por contenido, el build no sale", () => {
    entorno({ ...completo, VITE_VOTO_POR_CONTENIDO: "" });
    expect(() => correr()).toThrow(/VITE_VOTO_POR_CONTENIDO=1/);
  });

  it("en producción con el costo prendido, el build no sale mientras la portada diga que no se cobra nada", () => {
    entorno({ ...completo, VERCEL_ENV: "production" });
    expect(() => correr()).toThrow(/index\.html todavía dice lo de antes/);
  });

  it("con el costo sin la cuenta, el build sale y deja un aviso en la bitácora, sin valores", () => {
    entorno({ VITE_RETIRO_COSTO: "0.50" });
    expect(() => correr()).not.toThrow();
    const warn = vi.fn();
    control.buildStart.call({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("VITE_RETIRO_COSTO está puesta sin VITE_RETIRO_CUENTA");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("0.50");
  });

  it("sin el aviso, el build no avisa nada", () => {
    entorno(completo);
    correr();
    const warn = vi.fn();
    control.buildStart.call({ warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
