import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUENTA_POR_DEFECTO,
  PUERTA_DEL_PREMIO_EN,
  type ModoDeRampa,
  cuentasDelPiloto,
  demoDeRampa,
  entornoDeCuenta,
  minimoDePrueba,
  modoDeRampa,
  monedasActivas,
  pagarConGoogle,
  planDelEquipo,
  practicaDeRampa,
  registroDeRampa,
  urlDeCuenta,
  votoPorContenido,
} from "./cuenta-config";

const PLANES = Keypair.random().publicKey();

describe("la carga de saldo (VITE_RAMPA)", () => {
  it("pollar prende la ventana entera; recibir solo traer y mandar; meru es otro nombre de recibir", () => {
    expect(modoDeRampa({ rampa: " Pollar " })).toBe("pollar");
    expect(modoDeRampa({ rampa: "recibir" })).toBe("recibir");
    expect(modoDeRampa({ rampa: "RECIBIR" })).toBe("recibir");
    expect(modoDeRampa({ rampa: "meru" })).toBe("recibir");
  });
  it("premios, con espacios o mayúsculas, es su propio modo y no cambia los demás", () => {
    expect(modoDeRampa({ rampa: "premios" })).toBe("premios");
    expect(modoDeRampa({ rampa: "  Premios " })).toBe("premios");
    expect(modoDeRampa({ rampa: "PREMIOS" })).toBe("premios");
    expect(modoDeRampa({ rampa: "pollar" })).toBe("pollar");
    expect(modoDeRampa({ rampa: "recibir" })).toBe("recibir");
    expect(modoDeRampa({ rampa: "meru" })).toBe("recibir");
  });
  it("vacía o con cualquier otra cosa, apagada", () => {
    for (const r of [undefined, "", " ", "apagada", "stereum", "1", "true", "si", "pollar,recibir"]) expect(modoDeRampa({ rampa: r }), String(r)).toBe("apagada");
  });
  it("premios mezclado con otro valor, o escrito casi igual, queda apagada", () => {
    for (const r of ["premios,recibir", "premios pollar", "premio", "premios.", "pre mios", "premiosx"]) expect(modoDeRampa({ rampa: r }), r).toBe("apagada");
  });
  it("leída del entorno, sin nada puesto, apagada", () => {
    expect(modoDeRampa()).toBe("apagada");
    expect(cuentasDelPiloto()).toEqual([]);
    expect(minimoDePrueba()).toBeNull();
    expect(demoDeRampa()).toBe(false);
    expect(registroDeRampa()).toBe(false);
    expect(practicaDeRampa()).toBe(false);
  });
});

describe("las cuentas del piloto (VITE_RAMPA_CUENTAS)", () => {
  const ANA = Keypair.random().publicKey();
  const NORA = Keypair.random().publicKey();
  it("vacía, no hay lista: ninguna cuenta", () => {
    for (const c of [undefined, "", " ", ",", " , ,"]) expect(cuentasDelPiloto({ rampaCuentas: c }), String(c)).toEqual([]);
  });
  it("se lee con comas y con espacios, sin repetir", () => {
    expect(cuentasDelPiloto({ rampaCuentas: ANA })).toEqual([ANA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA},${NORA}` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: ` ${ANA} ,  ${NORA} ` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA} ${NORA}` })).toEqual([ANA, NORA]);
    expect(cuentasDelPiloto({ rampaCuentas: `${ANA},\n${NORA},${ANA}` })).toEqual([ANA, NORA]);
  });
  it("lo que no es una dirección se descarta", () => {
    const otraLetra = ANA[30] === "X" ? "Y" : "X";
    const rota = `${ANA.slice(0, 30)}${otraLetra}${ANA.slice(31)}`;
    expect(cuentasDelPiloto({ rampaCuentas: `GABC,${rota},${NORA},hola` })).toEqual([NORA]);
  });
});

describe("las banderas que valen solo en localhost", () => {
  const LOCALES = ["localhost", "127.0.0.1", "LOCALHOST"];
  const AJENOS = ["tinkazo.app", "www.tinkazo.app", "tinkazo-git-rama-x.vercel.app", "localhost.evil.com", ""];
  it("VITE_RAMPA_MINIMO: un número de bolivianos, y solo en localhost", () => {
    for (const host of LOCALES) expect(minimoDePrueba({ rampaMinimo: "50", host }), host).toBe(50);
    expect(minimoDePrueba({ rampaMinimo: " 120 ", host: "localhost" })).toBe(120);
    for (const host of AJENOS) expect(minimoDePrueba({ rampaMinimo: "50", host }), host).toBeNull();
  });
  it("VITE_RAMPA_MINIMO: lo que no es un monto entero y positivo no hace nada", () => {
    for (const m of [undefined, "", "0", "-5", "abc", "12.5", "1e3", "Infinity"]) expect(minimoDePrueba({ rampaMinimo: m, host: "localhost" }), String(m)).toBeNull();
  });
  it("VITE_RAMPA_DEMO: con 1 y solo en localhost", () => {
    for (const host of LOCALES) expect(demoDeRampa({ rampaDemo: "1", host }), host).toBe(true);
    for (const host of AJENOS) expect(demoDeRampa({ rampaDemo: "1", host }), host).toBe(false);
    for (const d of [undefined, "", "0", "no"]) expect(demoDeRampa({ rampaDemo: d, host: "localhost" }), String(d)).toBe(false);
  });
  it("VITE_RAMPA_PRACTICA: con 1 y solo en localhost", () => {
    for (const host of LOCALES) expect(practicaDeRampa({ rampaPractica: "1", host }), host).toBe(true);
    for (const host of AJENOS) expect(practicaDeRampa({ rampaPractica: "1", host }), host).toBe(false);
    expect(practicaDeRampa({ rampaPractica: "0", host: "localhost" })).toBe(false);
  });
});

describe("el registro de la carga (VITE_RAMPA_REGISTRO)", () => {
  it("nace apagado y se prende con 1", () => {
    expect(registroDeRampa({})).toBe(false);
    expect(registroDeRampa({ rampaRegistro: "0" })).toBe(false);
    expect(registroDeRampa({ rampaRegistro: "1" })).toBe(true);
    expect(registroDeRampa({ rampaRegistro: "1", host: "tinkazo.app" })).toBe(true);
  });
});

describe("las monedas (VITE_MONEDAS) y dónde está el Worker", () => {
  it("nacen apagadas, y apagadas no hay Worker", () => {
    expect(monedasActivas({})).toBe(false);
    expect(urlDeCuenta({ host: "tinkazo.app" })).toBeNull();
    expect(urlDeCuenta({ monedas: "0", host: "tinkazo.app" })).toBeNull();
  });
  it("prendidas, en tinkazo.app y www.tinkazo.app vale el dominio del proyecto", () => {
    expect(monedasActivas({ monedas: "1" })).toBe(true);
    for (const host of ["tinkazo.app", "www.tinkazo.app", "TINKAZO.APP"]) expect(urlDeCuenta({ monedas: "1", host }), host).toBe(CUENTA_POR_DEFECTO);
  });
  it("en localhost y en las vistas previas hace falta VITE_CUENTA_URL", () => {
    for (const host of ["localhost", "127.0.0.1", "tinkazo-git-rama-x.vercel.app", "evil-tinkazo.app", "tinkazo.app.evil.com", ""]) {
      expect(urlDeCuenta({ monedas: "1", host }), host).toBeNull();
    }
    expect(urlDeCuenta({ monedas: "1", host: "localhost", url: "http://localhost:8794/" })).toBe("http://localhost:8794");
  });
});

describe("el plan del equipo (VITE_PLAN_EQUIPO)", () => {
  const prendido = { monedas: "1", plan: "1", cuentaPlanes: PLANES, host: "tinkazo.app" };
  it("apagado por defecto: sin la bandera no se ofrece, tenga lo que tenga", () => {
    expect(planDelEquipo({ ...prendido, plan: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, plan: "0" })).toBeNull();
    expect(planDelEquipo({ ...prendido, plan: "apagada" })).toBeNull();
  });
  it("prendido, con una cuenta de planes de verdad y el Worker a mano, se ofrece", () => {
    expect(planDelEquipo(prendido)).toEqual({ cuenta: PLANES });
  });
  it("sin cuenta de planes, con una mal escrita, o sin Worker, no se ofrece", () => {
    expect(planDelEquipo({ ...prendido, cuentaPlanes: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, cuentaPlanes: "GABC" })).toBeNull();
    // Una letra cambiada de verdad: la cuenta es al azar, y si ya tenía una X ahí, va una Y.
    const otraLetra = PLANES[30] === "X" ? "Y" : "X";
    expect(planDelEquipo({ ...prendido, cuentaPlanes: `${PLANES.slice(0, 30)}${otraLetra}${PLANES.slice(31)}` })).toBeNull();
    expect(planDelEquipo({ ...prendido, monedas: undefined })).toBeNull();
    expect(planDelEquipo({ ...prendido, host: "localhost" })).toBeNull();
  });
});

describe("el voto por contenido (VITE_VOTO_POR_CONTENIDO)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("nace apagado: sin nada puesto, vacío o en 0 no se pide", () => {
    expect(votoPorContenido({})).toBe(false);
    for (const v of [undefined, "", " ", "0"]) expect(votoPorContenido({ votoPorContenido: v }), String(v)).toBe(false);
  });

  it("se pide solo con un 1 exacto", () => {
    expect(votoPorContenido({ votoPorContenido: "1" })).toBe(true);
    expect(votoPorContenido({ votoPorContenido: "1", host: "tinkazo.app" })).toBe(true);
  });

  it("cualquier otro valor lo deja apagado, aunque parezca un sí", () => {
    for (const v of ["true", "TRUE", "on", "si", "sí", "encendida", "yes", " 1", "1 ", "01", "2", "11", "1.0", "uno"]) {
      expect(votoPorContenido({ votoPorContenido: v }), JSON.stringify(v)).toBe(false);
    }
  });

  it("leída del entorno del build: apagada sin nada puesto, prendida con 1 y apagada con otro valor", () => {
    expect(votoPorContenido()).toBe(false);
    expect(entornoDeCuenta().votoPorContenido).toBeUndefined();
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    expect(entornoDeCuenta().votoPorContenido).toBe("1");
    expect(votoPorContenido()).toBe(true);
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "true");
    expect(votoPorContenido()).toBe(false);
  });

  it("pedirlo no cambia ninguna otra lectura de la configuración", () => {
    const base = { rampa: "premios", monedas: "1", host: "tinkazo.app" };
    const con = { ...base, votoPorContenido: "1" };
    expect(modoDeRampa(con)).toBe(modoDeRampa(base));
    expect(monedasActivas(con)).toBe(monedasActivas(base));
    expect(urlDeCuenta(con)).toBe(urlDeCuenta(base));
    expect(cuentasDelPiloto(con)).toEqual(cuentasDelPiloto(base));
    expect(planDelEquipo(con)).toEqual(planDelEquipo(base));
    expect(minimoDePrueba(con)).toBe(minimoDePrueba(base));
    expect(demoDeRampa(con)).toBe(demoDeRampa(base));
    expect(practicaDeRampa(con)).toBe(practicaDeRampa(base));
    expect(registroDeRampa(con)).toBe(registroDeRampa(base));
  });
});

describe("qué modos cuida la puerta del premio (PUERTA_DEL_PREMIO_EN)", () => {
  // Un Record obliga a decidir cada modo: sumar uno nuevo a ModoDeRampa rompe los tipos hasta que se lo ponga acá.
  const CUIDA: Record<ModoDeRampa, boolean> = { premios: true, recibir: true, apagada: true, pollar: false };
  const cuidado = (rampa: string | undefined): boolean => PUERTA_DEL_PREMIO_EN.includes(modoDeRampa({ rampa }));

  it("cuida premios, recibir y apagada, y deja afuera pollar, donde la venta paga con el saldo", () => {
    for (const modo of Object.keys(CUIDA) as ModoDeRampa[]) expect(PUERTA_DEL_PREMIO_EN.includes(modo), modo).toBe(CUIDA[modo]);
    expect([...PUERTA_DEL_PREMIO_EN].sort()).toEqual(["apagada", "premios", "recibir"]);
  });

  it("no repite modos ni nombra uno que no existe", () => {
    expect(new Set(PUERTA_DEL_PREMIO_EN).size).toBe(PUERTA_DEL_PREMIO_EN.length);
    for (const modo of PUERTA_DEL_PREMIO_EN) expect(Object.keys(CUIDA), modo).toContain(modo);
  });

  it("está congelada: nadie la cambia en ejecución", () => {
    expect(Object.isFrozen(PUERTA_DEL_PREMIO_EN)).toBe(true);
    expect(() => (PUERTA_DEL_PREMIO_EN as ModoDeRampa[]).push("pollar")).toThrow();
    expect(PUERTA_DEL_PREMIO_EN.includes("pollar")).toBe(false);
  });

  it("con lo que se escribe en VITE_RAMPA: sin la variable o con una desconocida también se cuida", () => {
    for (const r of [undefined, "", "apagada", "algo raro", "premios", " Premios ", "recibir", "meru"]) expect(cuidado(r), String(r)).toBe(true);
    for (const r of ["pollar", " POLLAR "]) expect(cuidado(r), r).toBe(false);
  });
});

describe("quién lee VITE_VOTO_POR_CONTENIDO", () => {
  const RAIZ = fileURLToPath(new URL("../", import.meta.url));
  const PERMITIDOS = ["stellar/cuenta-config.ts", "stellar/premios-build.ts"];
  const sinComentarios = (codigo: string): string => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  /**
   * Una lectura: el nombre suelto, no un texto que nombra un valor («VITE_VOTO_POR_CONTENIDO=1 no va junto con…»). Solo
   * un `=` solo lo descarta: `===` pegado al nombre sigue siendo una lectura.
   */
  const lee = (codigo: string): boolean => /\bVITE_VOTO_POR_CONTENIDO\b(?!=(?!=))/.test(sinComentarios(codigo));

  it("solo la configuración de la cuenta y el control del build: el resto pregunta por votoPorContenido", () => {
    const archivos = readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
      .map((ruta) => ruta.split(sep).join("/"))
      .filter((ruta) => ruta.endsWith(".ts") && !ruta.endsWith(".test.ts"));
    const lecturas = archivos.filter((ruta) => lee(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(archivos.length).toBeGreaterThan(50);
    expect(lecturas.sort()).toEqual(PERMITIDOS);
  });

  it("la prueba reconoce una lectura, y no un comentario ni un texto que nombra un valor", () => {
    expect(lee("const x = e.VITE_VOTO_POR_CONTENIDO;")).toBe(true);
    expect(lee("// VITE_VOTO_POR_CONTENIDO\n/** `VITE_VOTO_POR_CONTENIDO` */\nconst a = 1;")).toBe(false);
    expect(lee('p.push("VITE_VOTO_POR_CONTENIDO=1 no va junto");')).toBe(false);
  });

  it("una comparación pegada al nombre, sin espacios, también es una lectura", () => {
    expect(lee('const x = e.VITE_VOTO_POR_CONTENIDO==="1";')).toBe(true);
  });
});

describe("pagar con Google (VITE_PAGAR_CON_GOOGLE)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const PEDIDA = { pagarConGoogle: "1", rampa: "premios", votoPorContenido: "1" };

  it("nace apagada: sin nada puesto, vacía o en 0 no se pide", () => {
    expect(pagarConGoogle({})).toBe(false);
    for (const v of [undefined, "", " ", "0"]) {
      expect(pagarConGoogle({ ...PEDIDA, pagarConGoogle: v }), String(v)).toBe(false);
    }
  });

  it("se pide solo con un 1 exacto, el modo premios y el voto por contenido", () => {
    expect(pagarConGoogle(PEDIDA)).toBe(true);
    expect(pagarConGoogle({ ...PEDIDA, rampa: " Premios ", host: "tinkazo.app" })).toBe(true);
  });

  it("cualquier otro valor la deja apagada, aunque parezca un sí", () => {
    for (const v of ["true", "TRUE", "on", "si", "sí", "encendida", "yes", " 1", "1 ", "01", "2", "11", "1.0", "uno"]) {
      expect(pagarConGoogle({ ...PEDIDA, pagarConGoogle: v }), JSON.stringify(v)).toBe(false);
    }
  });

  it("sin el voto por contenido, o con un voto que no vale, queda apagada", () => {
    for (const v of [undefined, "", "0", "true", " 1"]) {
      expect(pagarConGoogle({ ...PEDIDA, votoPorContenido: v }), String(v)).toBe(false);
    }
  });

  it("con otro modo de la rampa que premios, queda apagada", () => {
    for (const rampa of [undefined, "", "pollar", "recibir", "meru", "apagada", "premio", "premios,recibir"]) {
      expect(pagarConGoogle({ ...PEDIDA, rampa }), String(rampa)).toBe(false);
    }
  });

  it("leída del entorno del build: apagada sin nada puesto, prendida con las tres y apagada con otro valor", () => {
    expect(pagarConGoogle()).toBe(false);
    expect(entornoDeCuenta().pagarConGoogle).toBeUndefined();
    vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "1");
    vi.stubEnv("VITE_RAMPA", "premios");
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    expect(entornoDeCuenta().pagarConGoogle).toBe("1");
    expect(pagarConGoogle()).toBe(true);
    vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "true");
    expect(pagarConGoogle()).toBe(false);
    vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "1");
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    expect(pagarConGoogle()).toBe(false);
  });

  it("pedirla no cambia ninguna otra lectura de la configuración", () => {
    const base = { rampa: "premios", monedas: "1", votoPorContenido: "1", host: "tinkazo.app" };
    const con = { ...base, pagarConGoogle: "1" };
    expect(modoDeRampa(con)).toBe(modoDeRampa(base));
    expect(votoPorContenido(con)).toBe(votoPorContenido(base));
    expect(monedasActivas(con)).toBe(monedasActivas(base));
    expect(urlDeCuenta(con)).toBe(urlDeCuenta(base));
    expect(cuentasDelPiloto(con)).toEqual(cuentasDelPiloto(base));
    expect(planDelEquipo(con)).toEqual(planDelEquipo(base));
    expect(minimoDePrueba(con)).toBe(minimoDePrueba(base));
    expect(demoDeRampa(con)).toBe(demoDeRampa(base));
    expect(practicaDeRampa(con)).toBe(practicaDeRampa(base));
    expect(registroDeRampa(con)).toBe(registroDeRampa(base));
    expect(PUERTA_DEL_PREMIO_EN).toEqual(["premios", "recibir", "apagada"]);
  });
});

describe("quién lee VITE_PAGAR_CON_GOOGLE y quién usa pagarConGoogle", () => {
  const RAIZ = fileURLToPath(new URL("../", import.meta.url));
  const PERMITIDOS = ["stellar/cuenta-config.ts", "stellar/premios-build.ts"];
  const sinComentarios = (codigo: string): string => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  /** Una lectura: el nombre suelto, no un texto que nombra un valor («VITE_PAGAR_CON_GOOGLE=1 necesita…»). */
  const lee = (codigo: string): boolean => /\bVITE_PAGAR_CON_GOOGLE\b(?!=)/.test(sinComentarios(codigo));
  /** Un uso de la función: la llamada o el nombre importado, no un comentario. */
  const usa = (codigo: string): boolean => /\bpagarConGoogle\b/.test(sinComentarios(codigo));
  const fuentes = (): string[] =>
    readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
      .map((ruta) => ruta.split(sep).join("/"))
      .filter((ruta) => ruta.endsWith(".ts") && !ruta.endsWith(".test.ts"));

  it("solo la configuración de la cuenta y el control del build: el resto pregunta por pagarConGoogle", () => {
    const archivos = fuentes();
    expect(archivos.length).toBeGreaterThan(50);
    expect(archivos.filter((ruta) => lee(readFileSync(join(RAIZ, ruta), "utf8"))).sort()).toEqual(PERMITIDOS);
  });

  it("la definen la configuración de la cuenta y la usan solo la billetera, el formulario de Pagar premio y la ventana del saldo", () => {
    const usos = fuentes().filter((ruta) => usa(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(usos).toEqual(["stellar/cuenta-config.ts", "stellar/wallet-pollar.ts", "ui/pagar-premio.ts", "ui/saldo.ts"]);
  });

  it("la prueba reconoce una lectura, y no un comentario ni un texto que nombra un valor", () => {
    expect(lee("const x = e.VITE_PAGAR_CON_GOOGLE;")).toBe(true);
    expect(lee("// VITE_PAGAR_CON_GOOGLE\n/** `VITE_PAGAR_CON_GOOGLE` */\nconst a = 1;")).toBe(false);
    expect(lee('p.push("VITE_PAGAR_CON_GOOGLE=1 necesita el voto");')).toBe(false);
    expect(usa("if (pagarConGoogle()) hacer();")).toBe(true);
    expect(usa("// pagarConGoogle\nconst a = 1;")).toBe(false);
  });
});
