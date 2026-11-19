import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../../vite.config";
import { pagarConGoogle, votoPorContenido } from "./cuenta-config";
import { avisosDelRetiro, problemasDePagarConGoogle, problemasDePremios, problemasDelRetiro, problemasDelVoto } from "./premios-build";
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

/**
 * El voto por contenido (`VITE_VOTO_POR_CONTENIDO`): el build no sale con un valor que la dejaría apagada sin aviso, ni con
 * ella junto con lo que firma sin pasar por la regla del voto y nadie probó así en la red principal. Con la variable
 * apagada, el build sale como siempre. No toca ninguna bandera: obliga a elegir.
 */
describe("el voto por contenido y el build", () => {
  const VOTO = { VITE_VOTO_POR_CONTENIDO: "1" };
  const TODO_LO_DEMAS = { VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_RAMPA: "pollar" };

  it("con la bandera sola, o con el modo premios o apagada, el build sale", () => {
    expect(problemasDelVoto(VOTO)).toEqual([]);
    for (const rampa of ["", "premios", " Premios ", "apagada", "algo raro"]) {
      expect(problemasDelVoto({ ...VOTO, VITE_RAMPA: rampa }), rampa).toEqual([]);
    }
  });

  it("la combinación esperada, el modo premios con el voto y sin la venta, no tiene ningún problema en los dos controles", () => {
    const esperada = { ...VOTO, VITE_RAMPA: "premios" };
    expect(problemasDelVoto(esperada)).toEqual([]);
    expect(problemasDePremios(esperada)).toEqual([]);
    expect(problemasDelVoto({ ...esperada, VITE_PAGO_CON_SALDO: "0", VITE_COMPRA_QR: "", VITE_ALTA_PAGO: "1" })).toEqual([]);
  });

  it("apagada, vacía o en 0, no mira nada más: el build sale con todo lo demás prendido", () => {
    for (const v of [undefined, "", "0", "   "]) {
      expect(problemasDelVoto({ ...(v === undefined ? {} : { VITE_VOTO_POR_CONTENIDO: v }), ...TODO_LO_DEMAS }), String(v)).toEqual([]);
    }
    expect(problemasDelVoto({})).toEqual([]);
  });

  it("con el pago con el saldo prendido, el build no sale: nombra las banderas y no sus valores", () => {
    const p = problemasDelVoto({ ...VOTO, VITE_PAGO_CON_SALDO: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_VOTO_POR_CONTENIDO=1");
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
  });

  it("con la compra con QR prendida, tampoco", () => {
    const p = problemasDelVoto({ ...VOTO, VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_COMPRA_QR=1");
  });

  it("con la carga con bolivianos (el modo pollar), tampoco, lo escriba como lo escriba", () => {
    for (const rampa of ["pollar", "  Pollar ", "POLLAR"]) {
      const p = problemasDelVoto({ ...VOTO, VITE_RAMPA: rampa });
      expect(p, rampa).toHaveLength(1);
      expect(p[0], rampa).toContain("VITE_RAMPA=pollar");
    }
  });

  it("con el modo recibir, donde Mandar queda abierto y la regla del voto no deja pasar un pago, tampoco", () => {
    for (const rampa of ["recibir", " Recibir ", "meru", "MERU"]) {
      const p = problemasDelVoto({ ...VOTO, VITE_RAMPA: rampa });
      expect(p, rampa).toHaveLength(1);
      expect(p[0], rampa).toContain("VITE_RAMPA=recibir");
      expect(p[0], rampa).toContain("Mandar");
    }
  });

  it("con las tres, dice las tres, cada una con lo suyo", () => {
    const p = problemasDelVoto({ ...VOTO, ...TODO_LO_DEMAS });
    expect(p).toHaveLength(3);
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
    expect(p[1]).toContain("VITE_COMPRA_QR=1");
    expect(p[2]).toContain("VITE_RAMPA=pollar");
  });

  it("lee la venta como el control del modo premios: solo un 1 la prende", () => {
    expect(problemasDelVoto({ ...VOTO, VITE_PAGO_CON_SALDO: "0", VITE_COMPRA_QR: "", VITE_RAMPA: "premios" })).toEqual([]);
    expect(problemasDelVoto({ ...VOTO, VITE_PAGO_CON_SALDO: "true", VITE_COMPRA_QR: " 1" })).toEqual([]);
  });

  it("un valor que no es 1, 0 ni vacío no sale: dice que acepta 1 o 0 y no escribe el valor", () => {
    for (const v of ["true", "TRUE", "on", "si", "sí", "yes", "2", "01", " 1", "1 ", "uno", "1,0"]) {
      const p = problemasDelVoto({ VITE_VOTO_POR_CONTENIDO: v });
      expect(p, JSON.stringify(v)).toHaveLength(1);
      expect(p[0], JSON.stringify(v)).toContain("VITE_VOTO_POR_CONTENIDO solo acepta 1 o 0");
      expect(p[0], JSON.stringify(v)).not.toContain(`=${v}`);
    }
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    expect(problemasDelVoto({ VITE_VOTO_POR_CONTENIDO: secreto }).join(" ")).not.toContain(secreto);
  });

  it("con un valor raro dice solo eso: las combinaciones se miran con un 1 exacto", () => {
    expect(problemasDelVoto({ VITE_VOTO_POR_CONTENIDO: "true", ...TODO_LO_DEMAS })).toHaveLength(1);
  });

  it("no escribe valores de otras variables: ni una dirección ni una llave llegan a la bitácora", () => {
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    const p = problemasDelVoto({ ...VOTO, ...TODO_LO_DEMAS, VITE_PATROCINIO_URL_MAINNET: secreto, VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_llave" });
    expect(p.join(" ")).not.toContain(secreto);
    expect(p.join(" ")).not.toContain("pub_llave");
  });

  it("el control del modo premios y el del voto dicen cada uno lo suyo y no se pisan", () => {
    const env = { ...VOTO, VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1" };
    expect(problemasDePremios(env)).toHaveLength(1);
    expect(problemasDePremios(env)[0]).toContain("VITE_RAMPA=premios");
    expect(problemasDelVoto(env)).toHaveLength(1);
    expect(problemasDelVoto(env)[0]).toContain("VITE_VOTO_POR_CONTENIDO=1");
  });

  it("la lectura del sitio y la del build coinciden: lo que el build deja pasar vale 1 solo con un 1 exacto", () => {
    for (const v of [undefined, "", "   ", "0", "1", "true", "on", "si", " 1", "1 ", "01", "2"]) {
      const env = v === undefined ? {} : { VITE_VOTO_POR_CONTENIDO: v };
      const dejaPasar = problemasDelVoto(env).length === 0;
      const sitio = votoPorContenido({ votoPorContenido: v });
      expect(sitio, String(v)).toBe(v === "1");
      if (!dejaPasar) expect(sitio, String(v)).toBe(false);
    }
  });
});

describe("vite.config.ts frena el build con esta regla", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));

  it("suma el control del voto al del modo premios, con la misma lectura del entorno y solo al construir", () => {
    expect(config).toMatch(/import \{[^}]*\bproblemasDePremios\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    expect(config).toMatch(/import \{[^}]*\bproblemasDelVoto\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    expect(control).toContain("problemasDePremios(env)");
    expect(control).toContain("problemasDelVoto(env)");
    expect(control.match(/loadEnv\(/g)).toHaveLength(1);
    expect(control).toContain('apply: "build"');
  });

  it("arma el control solo al construir, con las variables VITE_ del entorno, y lo pone entre los plugins", () => {
    expect(control).toContain('apply: "build"');
    expect(control).toContain('loadEnv(mode, __dirname, ["VITE_"])');
    expect(control).toMatch(/if \(problemas\.length\) throw new Error/);
    expect(config).toMatch(/plugins: \[[^\]]*validarModoPremios\(\)/);
  });

  it("no frena pnpm dev ni las pruebas: el control es solo del build", () => {
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

/**
 * Pagar con Google (`VITE_PAGAR_CON_GOOGLE=1`): el build no sale con un valor que la dejaría apagada sin aviso, ni sin el voto
 * por contenido, el modo premios, los premios pagados o el portero de la red principal, ni junto con la venta que paga con
 * el saldo o con QR. Apagada, vacía o en 0, el build sale como siempre.
 */
describe("pagar con Google y el build", () => {
  const COMPLETA: Record<string, string> = {
    VITE_PAGAR_CON_GOOGLE: "1",
    VITE_RAMPA: "premios",
    VITE_VOTO_POR_CONTENIDO: "1",
    VITE_PAGOS: "1",
    VITE_PATROCINIO_URL_MAINNET: PORTERO,
  };
  /** La combinación completa sin una de sus variables. */
  const sin = (nombre: string): Record<string, string> => {
    const copia = { ...COMPLETA };
    delete copia[nombre];
    return copia;
  };
  const TODO_LO_DEMAS = { VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_RAMPA: "pollar", VITE_PAGOS: "1" };

  it("la combinación completa sale, en los cuatro controles", () => {
    expect(problemasDePagarConGoogle(COMPLETA)).toEqual([]);
    expect(problemasDePremios(COMPLETA)).toEqual([]);
    expect(problemasDelVoto(COMPLETA)).toEqual([]);
    expect(problemasDelRetiro(COMPLETA, DEL_PORTERO)).toEqual([]);
  });

  it("apagada, vacía o en 0, no mira nada más: el build sale con todo lo demás faltando o prendido", () => {
    for (const v of [undefined, "", "0", "   "]) {
      const bandera = v === undefined ? {} : { VITE_PAGAR_CON_GOOGLE: v };
      expect(problemasDePagarConGoogle({ ...bandera, ...TODO_LO_DEMAS }), String(v)).toEqual([]);
      expect(problemasDePagarConGoogle(bandera), String(v)).toEqual([]);
    }
    expect(problemasDePagarConGoogle({})).toEqual([]);
  });

  it("sin el voto por contenido no sale, con cualquier valor que no sea 1", () => {
    for (const v of [undefined, "", "0", "true", " 1"]) {
      const p = problemasDePagarConGoogle(v === undefined ? sin("VITE_VOTO_POR_CONTENIDO") : { ...COMPLETA, VITE_VOTO_POR_CONTENIDO: v });
      expect(p, String(v)).toHaveLength(1);
      expect(p[0], String(v)).toContain("VITE_VOTO_POR_CONTENIDO=1");
    }
  });

  it("con otro modo de la rampa que premios no sale, lo escriba como lo escriba", () => {
    for (const rampa of ["", "pollar", "  Pollar ", "recibir", "meru", "apagada", "premio"]) {
      const p = problemasDePagarConGoogle({ ...COMPLETA, VITE_RAMPA: rampa });
      expect(p, rampa).toHaveLength(1);
      expect(p[0], rampa).toContain("VITE_RAMPA=premios");
    }
    expect(problemasDePagarConGoogle(sin("VITE_RAMPA"))).toHaveLength(1);
  });

  it("lee el modo como lo lee el sitio: sin mayúsculas ni espacios que importen", () => {
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_RAMPA: "  Premios " })).toEqual([]);
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_RAMPA: "PREMIOS" })).toEqual([]);
  });

  it("sin los premios pagados no sale: Pagar premio no aparecería", () => {
    for (const v of [undefined, "", "0", "true", " 1"]) {
      const p = problemasDePagarConGoogle(v === undefined ? sin("VITE_PAGOS") : { ...COMPLETA, VITE_PAGOS: v });
      expect(p, String(v)).toHaveLength(1);
      expect(p[0], String(v)).toContain("VITE_PAGOS=1");
    }
  });

  it("sin la dirección del portero de la red principal no sale, ni vacía ni con solo espacios", () => {
    for (const v of [undefined, "", "   "]) {
      const p = problemasDePagarConGoogle(v === undefined ? sin("VITE_PATROCINIO_URL_MAINNET") : { ...COMPLETA, VITE_PATROCINIO_URL_MAINNET: v });
      expect(p, String(v)).toHaveLength(1);
      expect(p[0], String(v)).toContain("VITE_PATROCINIO_URL_MAINNET");
    }
  });

  it("una dirección que el sitio lee como vacía, por ejemplo una barra sola, tampoco sale", () => {
    for (const v of ["/", " // ", "///"]) {
      const p = problemasDePagarConGoogle({ ...COMPLETA, VITE_PATROCINIO_URL_MAINNET: v });
      expect(p, v).toHaveLength(1);
      expect(p[0], v).toContain("VITE_PAGAR_CON_GOOGLE=1 necesita VITE_PATROCINIO_URL_MAINNET");
    }
  });

  it("la dirección del portero oficial sale también con una barra al final o con espacios", () => {
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_PATROCINIO_URL_MAINNET: `${PORTERO}/` })).toEqual([]);
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_PATROCINIO_URL_MAINNET: `  ${PORTERO}  ` })).toEqual([]);
  });

  it("una dirección que no es la del portero de la red principal no sale, y no se escribe", () => {
    const ajenas = [
      "http://pm.tinkazo.app",
      "https://p.tinkazo.app",
      "https://otro-portero.example",
      "https://pm.tinkazo.app/v1/patrocinio",
      "https://pm.tinkazo.app:8443",
      "https://pm.tinkazo.app?x=1",
      "https://usuario@pm.tinkazo.app",
      "ftp://pm.tinkazo.app",
    ];
    for (const v of ajenas) {
      const p = problemasDePagarConGoogle({ ...COMPLETA, VITE_PATROCINIO_URL_MAINNET: v });
      expect(p, v).toHaveLength(1);
      expect(p[0], v).toContain("no es la del portero de la red principal");
      expect(p[0], v).not.toContain(v);
    }
  });

  it("con el pago con el saldo prendido no sale, y nombra las dos banderas", () => {
    const p = problemasDePagarConGoogle({ ...COMPLETA, VITE_PAGO_CON_SALDO: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_PAGAR_CON_GOOGLE=1");
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
  });

  it("con la compra con QR prendida tampoco", () => {
    const p = problemasDePagarConGoogle({ ...COMPLETA, VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_COMPRA_QR=1");
  });

  it("lee la venta como el control del modo premios: solo un 1 la prende", () => {
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_PAGO_CON_SALDO: "0", VITE_COMPRA_QR: "", VITE_ALTA_PAGO: "1" })).toEqual([]);
    expect(problemasDePagarConGoogle({ ...COMPLETA, VITE_PAGO_CON_SALDO: "true", VITE_COMPRA_QR: " 1" })).toEqual([]);
  });

  it("lo que falta se dice junto, cada problema una vez y en el mismo orden", () => {
    const p = problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: "1", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(6);
    expect(new Set(p).size).toBe(6);
    expect(p[0]).toContain("VITE_VOTO_POR_CONTENIDO=1");
    expect(p[1]).toContain("VITE_RAMPA=premios");
    expect(p[2]).toContain("VITE_PAGOS=1");
    expect(p[3]).toContain("VITE_PATROCINIO_URL_MAINNET");
    expect(p[4]).toContain("VITE_PAGO_CON_SALDO=1");
    expect(p[5]).toContain("VITE_COMPRA_QR=1");
  });

  it("un valor que no es 1, 0 ni vacío no sale: dice que acepta 1 o 0 y no escribe el valor", () => {
    for (const v of ["true", "TRUE", "on", "si", "sí", "yes", "2", "01", " 1", "1 ", "uno", "1,0"]) {
      const p = problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: v });
      expect(p, JSON.stringify(v)).toHaveLength(1);
      expect(p[0], JSON.stringify(v)).toContain("VITE_PAGAR_CON_GOOGLE solo acepta 1 o 0");
      expect(p[0], JSON.stringify(v)).not.toContain(`=${v}`);
    }
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    expect(problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: secreto }).join(" ")).not.toContain(secreto);
  });

  it("con un valor raro dice solo eso: las combinaciones se miran con un 1 exacto", () => {
    expect(problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: "true", ...TODO_LO_DEMAS })).toHaveLength(1);
  });

  it("no escribe valores de otras variables: ni una dirección ni una llave llegan a la bitácora", () => {
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    const env = { VITE_PAGAR_CON_GOOGLE: "1", VITE_PATROCINIO_URL_MAINNET: secreto, VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_llave" };
    const p = problemasDePagarConGoogle({ ...env, ...TODO_LO_DEMAS, VITE_RETIRO_CUENTA: COBROS });
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(" ")).not.toContain(secreto);
    expect(p.join(" ")).not.toContain("pub_llave");
    expect(p.join(" ")).not.toContain(COBROS);
  });

  it("los mensajes no llevan punto y coma, comillas angulares ni signos de exclamación", () => {
    const todos = [
      ...problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: "1", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1" }),
      ...problemasDePagarConGoogle({ VITE_PAGAR_CON_GOOGLE: "true" }),
    ];
    expect(todos.length).toBe(7);
    for (const m of todos) expect(m).not.toMatch(/[;«»!¡]/);
  });

  it("no pisa los otros controles: cada uno dice lo suyo", () => {
    const env = { ...COMPLETA, VITE_VOTO_POR_CONTENIDO: "", VITE_PAGO_CON_SALDO: "1" };
    expect(problemasDePremios(env)).toHaveLength(1);
    expect(problemasDelVoto(env)).toEqual([]);
    expect(problemasDePagarConGoogle(env)).toHaveLength(2);
    expect(problemasDelRetiro(env, DEL_PORTERO)).toEqual([]);
  });

  it("la lectura del sitio y la del build coinciden: lo que el build deja pasar vale 1 solo con un 1 exacto", () => {
    for (const v of [undefined, "", "   ", "0", "1", "true", "on", "si", " 1", "1 ", "01", "2"]) {
      const env = v === undefined ? sin("VITE_PAGAR_CON_GOOGLE") : { ...COMPLETA, VITE_PAGAR_CON_GOOGLE: v };
      const dejaPasar = problemasDePagarConGoogle(env).length === 0;
      const sitio = pagarConGoogle({ pagarConGoogle: v, rampa: "premios", votoPorContenido: "1" });
      expect(sitio, String(v)).toBe(v === "1");
      if (!dejaPasar) expect(sitio, String(v)).toBe(false);
    }
  });

  it("lo que el build deja pasar con la bandera prendida es lo que el sitio toma como prendido", () => {
    expect(problemasDePagarConGoogle(COMPLETA)).toEqual([]);
    expect(pagarConGoogle({ pagarConGoogle: "1", rampa: COMPLETA.VITE_RAMPA, votoPorContenido: COMPLETA.VITE_VOTO_POR_CONTENIDO })).toBe(true);
  });
});

describe("el control de pagar con Google, armado como lo arma el build", () => {
  const control = (viteConfig.plugins as unknown as ControlDelBuild[]).find((p) => p?.name === "tinkazo:modo-premios") as ControlDelBuild;
  const NOMBRES = [
    "VITE_PAGAR_CON_GOOGLE",
    "VITE_VOTO_POR_CONTENIDO",
    "VITE_RAMPA",
    "VITE_PAGOS",
    "VITE_PATROCINIO_URL_MAINNET",
    "VITE_PAGO_CON_SALDO",
    "VITE_COMPRA_QR",
  ];
  const completo: Record<string, string> = {
    VITE_PAGAR_CON_GOOGLE: "1",
    VITE_RAMPA: "premios",
    VITE_VOTO_POR_CONTENIDO: "1",
    VITE_PAGOS: "1",
    VITE_PATROCINIO_URL_MAINNET: PORTERO,
  };

  /** Pone el entorno del build: lo que no se dice queda vacío, aunque la máquina tenga esas variables en su `.env.local`. */
  function entorno(env: Record<string, string>): void {
    for (const k of NOMBRES) vi.stubEnv(k, env[k] ?? "");
  }
  const correr = (): void => control.config({}, { mode: "production", command: "build" });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("está entre los plugins del build", () => {
    expect(control).toBeTruthy();
    expect(control.name).toBe("tinkazo:modo-premios");
  });

  it("sin nada configurado, el build sale como hoy", () => {
    entorno({});
    expect(() => correr()).not.toThrow();
  });

  it("con la combinación completa, el build sale", () => {
    entorno(completo);
    expect(() => correr()).not.toThrow();
  });

  it("sin el voto por contenido, el build no sale y dice qué falta", () => {
    entorno({ ...completo, VITE_VOTO_POR_CONTENIDO: "" });
    expect(() => correr()).toThrow(/VITE_PAGAR_CON_GOOGLE=1 necesita VITE_VOTO_POR_CONTENIDO=1/);
  });

  it("sin el portero de la red principal, el build no sale", () => {
    entorno({ ...completo, VITE_PATROCINIO_URL_MAINNET: "" });
    expect(() => correr()).toThrow(/VITE_PAGAR_CON_GOOGLE=1 necesita VITE_PATROCINIO_URL_MAINNET/);
  });

  it("con otra dirección que la del portero oficial, el build no sale", () => {
    entorno({ ...completo, VITE_PATROCINIO_URL_MAINNET: "https://p.tinkazo.app" });
    expect(() => correr()).toThrow(/no es la del portero de la red principal/);
  });

  it("con un valor raro, el build no sale y no escribe el valor", () => {
    entorno({ ...completo, VITE_PAGAR_CON_GOOGLE: "verdadero" });
    expect(() => correr()).toThrow(/VITE_PAGAR_CON_GOOGLE solo acepta 1 o 0/);
    try {
      correr();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("verdadero");
    }
  });

  it("con el pago con el saldo prendido, el build no sale, lo diga el control que lo diga", () => {
    entorno({ ...completo, VITE_PAGO_CON_SALDO: "1" });
    expect(() => correr()).toThrow(/VITE_PAGO_CON_SALDO=1/);
  });

  it("con el modo premios mal escrito, el build no sale", () => {
    entorno({ ...completo, VITE_RAMPA: "recibir" });
    expect(() => correr()).toThrow(/VITE_PAGAR_CON_GOOGLE=1 necesita VITE_RAMPA=premios/);
  });

  it("con la bandera apagada y todo lo demás sin poner, el build no la menciona", () => {
    entorno({ VITE_RAMPA: "premios", VITE_VOTO_POR_CONTENIDO: "1", VITE_PAGOS: "1" });
    expect(() => correr()).not.toThrow();
  });
});

describe("vite.config.ts frena el build con pagar con Google", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));

  it("suma el control de pagar con Google al del modo premios y al del voto, con la misma lectura del entorno", () => {
    expect(config).toMatch(/import \{[^}]*\bproblemasDePagarConGoogle\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    expect(control).toContain("problemasDePagarConGoogle(env)");
    expect(control).toContain("problemasDePremios(env)");
    expect(control).toContain("problemasDelVoto(env)");
    expect(control.match(/loadEnv\(/g)).toHaveLength(1);
    expect(control).toContain('apply: "build"');
  });
});

describe("VITE_PAGAR_CON_GOOGLE en .env.example", () => {
  const lineas = readFileSync(new URL("../../.env.example", import.meta.url), "utf8").split(/\r?\n/);

  it("está vacía y con su comentario encima", () => {
    const i = lineas.indexOf("VITE_PAGAR_CON_GOOGLE=");
    expect(i).toBeGreaterThan(0);
    expect(lineas[i - 1]).toMatch(/^#/);
  });

  it("el comentario dice con qué va y con qué no", () => {
    const i = lineas.indexOf("VITE_PAGAR_CON_GOOGLE=");
    const comentario = lineas.slice(Math.max(0, i - 5), i).join(" ");
    for (const nombre of ["VITE_RAMPA=premios", "VITE_VOTO_POR_CONTENIDO=1", "VITE_PAGOS=1", "VITE_PATROCINIO_URL_MAINNET"]) {
      expect(comentario, nombre).toContain(nombre);
    }
    expect(comentario).toContain("VITE_PAGO_CON_SALDO=1");
    expect(comentario).toContain("VITE_COMPRA_QR=1");
  });
});
