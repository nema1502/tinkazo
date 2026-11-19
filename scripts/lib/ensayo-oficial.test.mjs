import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RPC_LISTAS } from "../../src/stellar/config.ts";
import { passphraseDe } from "../../src/stellar/oficiales.ts";
import {
  CONTRATO_DE_ENSAYO,
  HUELLA_DE_ENSAYO,
  bloqueDelReporte,
  clasificarFallas,
  decidirVitest,
  entradaDeEnsayo,
  erroresDeTsc,
  filaDelRegistro,
  hoyUtc,
  ponerEntradaDeEnsayo,
  problemasDeLaEntrada,
  rutaDelRespaldo,
  sha256,
  tieneEntradaDeEnsayo,
} from "./ensayo-oficial.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, "..", "..");
const SCRIPT = join(RAIZ, "scripts", "ensayo-entrada-oficial.mjs");
const LISTA_REAL = join(RAIZ, "src", "stellar", "deployments.json");

/** Una lista como la de hoy, sin contrato en mainnet. Las pruebas nunca tocan la lista real. */
const LISTA_DE_PRUEBA = JSON.stringify(
  { $comment: "lista de prueba", testnet: { contractId: "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A", anteriores: [] }, mainnet: null },
  null,
  2,
) + "\n";

describe("la entrada de ensayo", () => {
  it("la dirección es un contrato válido, la de 32 bytes en cero", () => {
    expect(StrKey.isValidContract(CONTRATO_DE_ENSAYO)).toBe(true);
    expect(StrKey.encodeContract(Buffer.alloc(32, 0))).toBe(CONTRATO_DE_ENSAYO);
  });

  it("tiene las siete claves del commit del día, en orden, con 300 y la frase de la red principal", () => {
    const e = entradaDeEnsayo("2026-11-10");
    expect(Object.keys(e)).toEqual(["contractId", "deployedAt", "wasmSha256", "maxWinners", "rpcUrl", "networkPassphrase", "anteriores"]);
    expect(e).toMatchObject({
      contractId: CONTRATO_DE_ENSAYO,
      deployedAt: "2026-11-10",
      maxWinners: 300,
      rpcUrl: "https://mainnet.sorobanrpc.com",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      anteriores: [],
    });
    expect(e.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entradaDeEnsayo().deployedAt).toBe(hoyUtc());
  });

  it("se pone solo donde mainnet es null, y conserva lo demás y el fin de línea", () => {
    const puesta = ponerEntradaDeEnsayo(LISTA_DE_PRUEBA, "2026-11-10");
    const lista = JSON.parse(puesta);
    expect(lista.mainnet).toEqual(entradaDeEnsayo("2026-11-10"));
    expect(lista.testnet).toEqual(JSON.parse(LISTA_DE_PRUEBA).testnet);
    expect(tieneEntradaDeEnsayo(puesta)).toBe(true);
    expect(tieneEntradaDeEnsayo(LISTA_DE_PRUEBA)).toBe(false);
    const crlf = ponerEntradaDeEnsayo(LISTA_DE_PRUEBA.replace(/\n/g, "\r\n"));
    expect(crlf.endsWith("\r\n")).toBe(true);
    expect(crlf.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("no se pone sobre una lista que ya tiene contrato en mainnet", () => {
    const conContrato = JSON.stringify({ testnet: null, mainnet: { contractId: "CB" + "A".repeat(54) } });
    expect(() => ponerEntradaDeEnsayo(conContrato)).toThrow(/mainnet/);
  });
});

describe("la clasificación de las fallas de Vitest", () => {
  const prueba = (ancestorTitles, title, status, failureMessages = []) => ({ ancestorTitles, title, fullName: [...ancestorTitles, title].join(" "), status, failureMessages });
  const REV = "revisión de redacción de los textos visibles";
  const SEO = "el texto de cada elemento de cada página es el de T.es, y cada clave tiene su versión en inglés";
  const informe = {
    testResults: [
      {
        name: `${RAIZ}/src/revision-textos.test.ts`,
        status: "failed",
        message: "",
        assertionResults: [
          prueba([REV], "el texto inicial de precios.html es el del diccionario", "failed", ["AssertionError: expected 'a' to be 'b'\n    at x"]),
          prueba([REV], "las páginas traen en el HTML el texto del diccionario de las claves que cambian con el modo Oficial", "failed", ["AssertionError: precios.html: prFree1\nterminos.html: tmX"]),
          prueba([REV], "las monedas no hablan de «chances»: ni en los textos ni en el sitio", "passed"),
        ],
      },
      {
        name: `${RAIZ}/src/seo.test.ts`,
        status: "failed",
        message: "",
        assertionResults: [
          prueba([SEO], "precios.html", "failed", ["AssertionError: expected [ 'x' ] to deeply equal []"]),
          prueba([SEO], "index.html", "failed", ["Error: Test timed out in 60000ms."]),
          prueba(["mapa del sitio y robots.txt"], "lista todas las páginas públicas, y solo esas", "failed", ["AssertionError: otra cosa"]),
        ],
      },
      {
        name: `${RAIZ}/src/stellar/config-tope.test.ts`,
        status: "failed",
        message: "",
        assertionResults: [prueba(["el tope"], "mainnet es null", "failed", ["AssertionError: expected { contractId: … } to be null"])],
      },
      { name: `${RAIZ}/src/roto.test.ts`, status: "failed", message: "SyntaxError: Unexpected token\n  at algo", assertionResults: [] },
      { name: `${RAIZ}/src/sano.test.ts`, status: "passed", message: "", assertionResults: [prueba(["a"], "b", "passed")] },
    ],
  };

  it("separa las esperadas del commit del día de todo lo demás", () => {
    const { esperadas, inesperadas } = clasificarFallas(informe, RAIZ);
    expect(esperadas.map((f) => `${f.archivo} > ${f.nombre}`)).toEqual([
      `src/revision-textos.test.ts > ${REV} el texto inicial de precios.html es el del diccionario`,
      `src/revision-textos.test.ts > ${REV} las páginas traen en el HTML el texto del diccionario de las claves que cambian con el modo Oficial`,
      `src/seo.test.ts > ${SEO} precios.html`,
    ]);
    expect(inesperadas.map((f) => f.archivo)).toEqual(["src/seo.test.ts", "src/seo.test.ts", "src/stellar/config-tope.test.ts", "src/roto.test.ts"]);
  });

  it("una por tiempo es inesperada aunque sea de un bloque esperado, y un archivo que no cargó también", () => {
    const { inesperadas } = clasificarFallas(informe, RAIZ);
    expect(inesperadas[0]).toMatchObject({ archivo: "src/seo.test.ts", nombre: `${SEO} index.html`, tiempo: true });
    expect(inesperadas[3]).toMatchObject({ archivo: "src/roto.test.ts", suite: true, mensaje: "SyntaxError: Unexpected token" });
  });

  it("las esperadas llevan sus títulos y el mensaje entero sin la pila", () => {
    const { esperadas } = clasificarFallas(informe, RAIZ);
    expect(esperadas[1].mensaje).toBe("AssertionError: precios.html: prFree1");
    expect(esperadas[1].mensajeEntero).toBe("AssertionError: precios.html: prFree1\nterminos.html: tmX");
    expect(esperadas[0].mensajeEntero).toBe("AssertionError: expected 'a' to be 'b'");
    expect(esperadas[2].titulos).toEqual([SEO, "precios.html"]);
  });

  it("el bloque de las páginas nuevas y las tarjetas de seo.test.ts también es esperado", () => {
    const NUEVAS = "el texto escrito en las páginas nuevas y en las tarjetas es el del diccionario";
    const titulo = "sorteo-verificable.html repite en español el texto de T.es, y cada clave tiene su versión en inglés";
    const { esperadas, inesperadas } = clasificarFallas(
      { testResults: [{ name: `${RAIZ}/src/seo.test.ts`, status: "failed", message: "", assertionResults: [prueba([NUEVAS], titulo, "failed", ["AssertionError: x"])] }] },
      RAIZ,
    );
    expect(inesperadas).toEqual([]);
    expect(esperadas.map((f) => f.nombre)).toEqual([`${NUEVAS} ${titulo}`]);
  });
});

describe("la decisión del paso de pruebas", () => {
  const vacio = { esperadas: [], inesperadas: [] };
  const conEsperada = { esperadas: [{ archivo: "src/seo.test.ts", nombre: "x" }], inesperadas: [] };
  const informe = (archivos, total = 10) => ({ numTotalTests: total, testResults: archivos.map((a) => ({ name: `${RAIZ}/${a}` })) });
  const decidir = (datos) => decidirVitest({ raiz: RAIZ, informe: informe(["src/a.test.ts"]), texto: "", ...datos });

  it("todo en verde y Vitest en 0 queda en verde", () => {
    expect(decidir({ codigo: 0, clasificadas: vacio }).inesperadas).toEqual([]);
  });

  it("solo esperadas y Vitest en 1 queda en verde: es el código de siempre con las esperadas", () => {
    const r = decidir({ codigo: 1, clasificadas: conEsperada });
    expect(r.inesperadas).toEqual([]);
    expect(r.esperadas).toHaveLength(1);
  });

  it("Vitest en 1 sin ninguna roja en el informe es una inesperada", () => {
    const r = decidir({ codigo: 1, clasificadas: vacio });
    expect(r.inesperadas).toHaveLength(1);
    expect(r.inesperadas[0].nombre).toMatch(/salió con 1/);
  });

  it("un error sin atrapar es una inesperada aunque haya esperadas", () => {
    const texto = "\x1b[31m⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯\x1b[39m\nError: algo\nVitest caught 1 unhandled error during the test run.";
    const r = decidir({ codigo: 1, clasificadas: conEsperada, texto });
    expect(r.inesperadas).toHaveLength(1);
    expect(r.inesperadas[0].nombre).toMatch(/fuera de una prueba/);
  });

  it("un informe sin pruebas es una inesperada, también con Vitest en 0", () => {
    const r = decidir({ codigo: 0, clasificadas: vacio, informe: { numTotalTests: 0, testResults: [] }, texto: "No test files found, exiting with code 1" });
    expect(r.inesperadas.map((f) => f.nombre)).toContain("no corrió ninguna prueba");
  });

  it("un archivo pedido con --pruebas que no corrió es una inesperada; uno que corrió o una carpeta que lo contiene, no", () => {
    const base = { codigo: 0, clasificadas: vacio, informe: informe(["src/equipos/a.test.ts"]) };
    expect(decidir({ ...base, pedidas: ["src/equipos/a.test.ts"] }).inesperadas).toEqual([]);
    expect(decidir({ ...base, pedidas: ["src/equipos"] }).inesperadas).toEqual([]);
    const r = decidir({ ...base, pedidas: ["src/equipos/b.test.ts"] });
    expect(r.inesperadas.map((f) => f.nombre)).toEqual(["no corrió src/equipos/b.test.ts"]);
  });
});

describe("el bloque de una falla en la salida del reportero", () => {
  const salida = [
    "\x1b[31m FAIL \x1b[39m src/x.test.ts > otra > una",
    "AssertionError: otra cosa",
    "⎯⎯⎯⎯⎯⎯⎯[1/3]⎯",
    "",
    " FAIL  src/revision-textos.test.ts > revisión > las páginas traen",
    "AssertionError: El HTML tiene que llevar el texto en: expected [ …(2) ] to deeply equal []",
    "",
    "+ [",
    '+   "precios.html, data-i=\\"nextBody\\"",',
    "+ ]",
    "⎯⎯⎯⎯⎯⎯⎯[2/3]⎯",
    " FAIL  src/a.test.ts > b > c",
    " FAIL  src/a.test.ts > b > d",
    "Error: igual en las dos",
    "⎯⎯⎯⎯⎯⎯⎯[3/3]⎯",
  ].join("\r\n");

  it("trae la diferencia que el informe JSON no guarda", () => {
    const bloque = bloqueDelReporte(salida, "src/revision-textos.test.ts", ["revisión", "las páginas traen"]);
    expect(bloque).toContain('precios.html, data-i=\\"nextBody\\"');
    expect(bloque).not.toContain("⎯");
    expect(bloque).not.toContain("otra cosa");
    expect(bloqueDelReporte(salida, "src/revision-textos.test.ts", ["revisión", "las páginas traen"], 2)).toBe(
      "AssertionError: El HTML tiene que llevar el texto en: expected [ …(2) ] to deeply equal []\n\n(… 3 renglones más en la salida de Vitest)",
    );
  });

  it("con varias fallas juntas bajo un error, cada una lleva ese error; sin el renglón, null", () => {
    expect(bloqueDelReporte(salida, "src/a.test.ts", ["b", "c"])).toBe("Error: igual en las dos");
    expect(bloqueDelReporte(salida, "src/a.test.ts", ["b", "d"])).toBe("Error: igual en las dos");
    expect(bloqueDelReporte(salida, "src/a.test.ts", ["b", "e"])).toBeNull();
  });
});

describe("los errores de tsc", () => {
  it("lee las dos formas de renglón, con y sin colores", () => {
    const salida = [
      "src/stellar/config-tope.test.ts(37,23): error TS2352: Conversion of type '{ x: 1 }' to type '{ mainnet: null; }' may be a mistake.",
      "\x1b[96msrc/a.ts\x1b[0m:\x1b[93m4\x1b[0m:\x1b[93m2\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2322: \x1b[0mType 'string' is not assignable to type 'number'.",
      "Found 2 errors.",
    ].join("\r\n");
    expect(erroresDeTsc(salida)).toEqual([
      { archivo: "src/stellar/config-tope.test.ts", linea: 37, codigo: "TS2352", mensaje: "Conversion of type '{ x: 1 }' to type '{ mainnet: null; }' may be a mistake." },
      { archivo: "src/a.ts", linea: 4, codigo: "TS2322", mensaje: "Type 'string' is not assignable to type 'number'." },
    ]);
  });
});

describe("el guion del ensayo, sobre una lista temporal", () => {
  let dir;
  let lista;
  let hijo;
  let marca;
  const entorno = () => ({ ...process.env, TINKAZO_ENSAYO_CARPETA: join(dir, "respaldos") });
  /** Una orden que anota si la lista tenía la entrada y después sale con `codigo` o espera `esperar` ms. */
  const orden = (codigo, esperar = 0) => `node "${hijo}" "${lista}" "${marca}" ${codigo} ${esperar}`;
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, "--archivo", lista, ...args], { encoding: "utf8", env: entorno() });
  /**
   * Deja la lista y el respaldo como los deja una corrida que se cortó de golpe. El proceso queda en 0, que el guion
   * toma por muerto: el número de uno recién terminado lo puede volver a usar Windows enseguida, y la prueba fallaba
   * por eso con la máquina cargada.
   */
  function cortadaDeGolpe(archivoDelEstado = lista) {
    const r = rutaDelRespaldo(archivoDelEstado, join(dir, "respaldos"));
    mkdirSync(r.carpeta, { recursive: true });
    writeFileSync(r.respaldo, LISTA_DE_PRUEBA);
    writeFileSync(r.estado, JSON.stringify({ archivo: archivoDelEstado, sha256Original: sha256(Buffer.from(LISTA_DE_PRUEBA)), pid: 0, desde: new Date().toISOString() }));
    writeFileSync(lista, ponerEntradaDeEnsayo(LISTA_DE_PRUEBA));
    return r;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ensayo-oficial-prueba-"));
    lista = join(dir, "deployments.json");
    marca = join(dir, "marca.txt");
    hijo = join(dir, "hijo.mjs");
    writeFileSync(lista, LISTA_DE_PRUEBA);
    writeFileSync(
      hijo,
      [
        'import { readFileSync, writeFileSync } from "node:fs";',
        "const [lista, marca, codigo, esperar] = process.argv.slice(2);",
        `writeFileSync(marca, readFileSync(lista, "utf8").includes("${CONTRATO_DE_ENSAYO}") ? "con entrada" : "sin entrada");`,
        "setTimeout(() => process.exit(Number(codigo)), Number(esperar));",
      ].join("\n"),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("con una orden que falla, la lista tuvo la entrada mientras corría y termina con sus bytes exactos", () => {
    const r = correr("--orden", orden(1));
    expect(readFileSync(marca, "utf8")).toBe("con entrada");
    expect(r.status).toBe(1);
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
    expect(existsSync(rutaDelRespaldo(lista, join(dir, "respaldos")).carpeta)).toBe(false);
  });

  it("con una orden que pasa sale con 0 y escribe el resumen", () => {
    const salida = join(dir, "resumen.json");
    const r = correr("--orden", orden(0), "--salida", salida);
    expect(r.status).toBe(0);
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
    expect(JSON.parse(readFileSync(salida, "utf8"))).toMatchObject({ codigo: 0, pasos: { orden: { codigo: 0 } }, lista: { restaurada: true } });
  });

  it("--restaurar devuelve la lista que dejó una corrida cortada, sin correr nada", () => {
    const r0 = cortadaDeGolpe();
    const r = correr("--restaurar");
    expect(r.status).toBe(0);
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
    expect(existsSync(r0.carpeta)).toBe(false);
    expect(existsSync(marca)).toBe(false);
  });

  it("al arrancar, una corrida cortada se restaura sola antes de ensayar", () => {
    cortadaDeGolpe();
    const r = correr("--orden", orden(0));
    expect(r.stdout).toMatch(/quedó cortada/);
    expect(r.status).toBe(0);
    expect(readFileSync(marca, "utf8")).toBe("con entrada");
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
  });

  it("si la lista cambió mientras corría, no la pisa: sale con 3 y deja los bytes de antes en el respaldo", () => {
    const cambia = join(dir, "cambia.mjs");
    writeFileSync(cambia, 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], "{\\"editada\\": true}\\n");\n');
    const r = correr("--orden", `node "${cambia}" "${lista}"`);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/cambió mientras corría/);
    expect(readFileSync(lista, "utf8")).toBe('{"editada": true}\n');
    expect(readFileSync(rutaDelRespaldo(lista, join(dir, "respaldos")).respaldo, "utf8")).toBe(LISTA_DE_PRUEBA);
  });

  it("al arrancar, una corrida cortada con la lista editada después no la pisa: sale con 3 y deja el respaldo", () => {
    const r0 = cortadaDeGolpe();
    // Alguien puso la dirección real a mano y dejó la huella de ceros: queda una marca del ensayo.
    const editada = readFileSync(lista, "utf8").replace(CONTRATO_DE_ENSAYO, StrKey.encodeContract(Buffer.alloc(32, 5)));
    writeFileSync(lista, editada);
    expect(tieneEntradaDeEnsayo(editada)).toBe(true);
    for (const args of [["--restaurar"], ["--orden", orden(0)]]) {
      const r = correr(...args);
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/alguien la cambió después/);
      expect(readFileSync(lista, "utf8")).toBe(editada);
      expect(readFileSync(r0.respaldo, "utf8")).toBe(LISTA_DE_PRUEBA);
    }
    expect(existsSync(marca)).toBe(false);
  });

  it("el estado del respaldo guarda el sha256 de lo que puso, para reconocerlo si la corrida se corta", () => {
    const { estado } = rutaDelRespaldo(lista, join(dir, "respaldos"));
    const copia = join(dir, "estado-copia.json");
    const copiar = join(dir, "copiar.mjs");
    writeFileSync(copiar, 'import { copyFileSync } from "node:fs";\ncopyFileSync(process.argv[2], process.argv[3]);\n');
    const r = correr("--orden", `node "${copiar}" "${estado}" "${copia}"`);
    expect(r.status).toBe(0);
    const guardado = JSON.parse(readFileSync(copia, "utf8"));
    expect(guardado.sha256Puesto).toBe(sha256(Buffer.from(ponerEntradaDeEnsayo(LISTA_DE_PRUEBA, guardado.desde.slice(0, 10)))));
    expect(guardado.sha256Original).toBe(sha256(Buffer.from(LISTA_DE_PRUEBA)));
  });

  it.runIf(process.platform === "win32")("en Windows reconoce la corrida cortada aunque la unidad llegue escrita de otra forma", () => {
    const otraForma = lista[0] === lista[0].toUpperCase() ? lista[0].toLowerCase() + lista.slice(1) : lista[0].toUpperCase() + lista.slice(1);
    expect(otraForma).not.toBe(lista);
    cortadaDeGolpe(otraForma);
    const r = correr("--orden", orden(0));
    expect(r.stdout).toMatch(/quedó cortada/);
    expect(r.status).toBe(0);
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
  });

  it("con la entrada puesta y sin un respaldo que sirva, no toca nada y sale con 2", () => {
    const puesta = ponerEntradaDeEnsayo(LISTA_DE_PRUEBA);
    writeFileSync(lista, puesta);
    const r = correr("--orden", orden(0));
    expect(r.status).toBe(2);
    expect(existsSync(marca)).toBe(false);
    expect(readFileSync(lista, "utf8")).toBe(puesta);
  });

  it("sobre una lista con un contrato real en mainnet no corre y sale con 2", () => {
    const real = JSON.stringify({ testnet: null, mainnet: { contractId: "CB" + "A".repeat(54) } }, null, 2) + "\n";
    writeFileSync(lista, real);
    const r = correr("--orden", orden(0));
    expect(r.status).toBe(2);
    expect(existsSync(marca)).toBe(false);
    expect(readFileSync(lista, "utf8")).toBe(real);
  });

  /** El paso de pruebas de verdad (sin --orden), con un Vitest aparte que no hereda nada del que corre esta prueba. */
  function conVitest(pruebas) {
    const env = entorno();
    for (const k of Object.keys(env)) if (/^VITEST/i.test(k)) delete env[k];
    env.VITEST_MAX_WORKERS = "1";
    const resumen = join(dir, "resumen-vitest.json");
    const r = spawnSync(process.execPath, [SCRIPT, "--archivo", lista, "--pasos", "vitest", "--pruebas", pruebas, "--salida", resumen], {
      encoding: "utf8",
      env,
      timeout: 150000,
    });
    return { ...r, resumen: existsSync(resumen) ? JSON.parse(readFileSync(resumen, "utf8")) : null };
  }

  it("el paso de pruebas de verdad, con un archivo que pasa, sale con 0 y devuelve la lista", { timeout: 160000 }, () => {
    const r = conVitest("scripts/lib/renta.test.mjs");
    expect(r.status).toBe(0);
    expect(r.resumen.pasos.vitest).toMatchObject({ codigo: 0, inesperadas: [], esperadas: [] });
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
  });

  it("el paso de pruebas de verdad, con una ruta mal escrita, sale con 1 aunque no haya ninguna roja", { timeout: 160000 }, () => {
    const r = conVitest("scripts/lib/no-existe-en-el-ensayo.test.mjs");
    expect(r.status).toBe(1);
    expect(r.resumen.pasos.vitest.inesperadas.length).toBeGreaterThan(0);
    expect(r.stdout).toMatch(/INESPERADA/);
    expect(r.stdout).not.toMatch(/listo para el commit del día/);
    expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
  });

  it.skipIf(process.platform === "win32")(
    "un corte con SIGTERM devuelve la lista (no corre en Windows: ahí matar un proceso no deja correr nada, y lo cubre la corrida cortada)",
    async () => {
      const proceso = spawn(process.execPath, [SCRIPT, "--archivo", lista, "--orden", orden(0, 30000)], { env: entorno(), stdio: "ignore" });
      const termino = new Promise((listo) => proceso.on("exit", (codigo) => listo(codigo)));
      const limite = Date.now() + 20000;
      // La marca puede existir vacía un instante, entre que el hijo la crea y la escribe.
      while (!(existsSync(marca) && readFileSync(marca, "utf8")) && Date.now() < limite) await new Promise((r) => setTimeout(r, 50));
      expect(readFileSync(marca, "utf8")).toBe("con entrada");
      proceso.kill("SIGTERM");
      expect(await termino).toBe(143);
      expect(readFileSync(lista, "utf8")).toBe(LISTA_DE_PRUEBA);
    },
  );
});

describe("la revisión de una entrada de la lista", () => {
  const DOCS = readFileSync(join(RAIZ, "docs", "deployments.md"), "utf8");
  const REAL = JSON.parse(readFileSync(LISTA_REAL, "utf8"));
  const deMainnet = (docs) => ({ red: "mainnet", passphrase: passphraseDe("mainnet"), rpcs: RPC_LISTAS.mainnet, docs });
  const CONTRATO_REAL = StrKey.encodeContract(Buffer.alloc(32, 5));
  const HUELLA_REAL = "5c".repeat(32);
  const FILA = `| 2026-11-20 | mainnet | \`${CONTRATO_REAL}\` | \`${HUELLA_REAL}\` | 641e083 | \`GD6P7X…R526\` | 11687 bytes |`;
  const entrada = (cambios = {}) => ({ ...entradaDeEnsayo("2026-11-20"), contractId: CONTRATO_REAL, wasmSha256: HUELLA_REAL, ...cambios });

  it("una entrada como la del día, con su fila en docs/deployments.md, está bien", () => {
    expect(problemasDeLaEntrada(entrada(), deMainnet(`${DOCS}\n${FILA}\n`))).toEqual([]);
  });

  it("la entrada de ensayo tiene la dirección y la huella inventadas, y ninguna fila", () => {
    const p = problemasDeLaEntrada(entradaDeEnsayo("2026-11-20"), deMainnet(DOCS));
    expect(p).toHaveLength(3);
    expect(p.join("\n")).toMatch(/dirección inventada/);
    expect(p.join("\n")).toMatch(/huella inventada/);
    expect(p.join("\n")).toMatch(/docs\/deployments\.md/);
  });

  it("si solo se cambió la dirección, los 64 ceros siguen dando rojo", () => {
    const p = problemasDeLaEntrada(entrada({ wasmSha256: HUELLA_DE_ENSAYO }), deMainnet(`${DOCS}\n${FILA.replace(HUELLA_REAL, HUELLA_DE_ENSAYO)}\n`));
    expect(p).toEqual(["wasmSha256 es la huella inventada del ensayo (64 ceros)"]);
    expect(tieneEntradaDeEnsayo(JSON.stringify({ mainnet: entrada({ wasmSha256: HUELLA_DE_ENSAYO }) }))).toBe(true);
  });

  it("una huella válida pero equivocada cae por la fila que escribió deploy.sh", () => {
    const p = problemasDeLaEntrada(entrada({ wasmSha256: "5d".repeat(32) }), deMainnet(`${DOCS}\n${FILA}\n`));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/docs\/deployments\.md/);
  });

  it("una huella que difiere solo en el último carácter cae por la fila, que trae la huella entera", () => {
    const casi = HUELLA_REAL.slice(0, 63) + "d";
    expect(casi).not.toBe(HUELLA_REAL);
    const p = problemasDeLaEntrada(entrada({ wasmSha256: casi }), deMainnet(`${DOCS}\n${FILA}\n`));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("docs/deployments.md");
    // El mensaje dice qué fila espera, con la huella entera.
    expect(p[0]).toContain(`| mainnet | \`${CONTRATO_REAL}\` | \`${casi}\` |`);
    // Lo mismo con una fila de testnet que trae los 64 caracteres: se comparan enteros.
    const filaTestnet = FILA.replace("| mainnet |", "| testnet |");
    expect(filaDelRegistro(filaTestnet, "testnet", CONTRATO_REAL, casi)).toBeNull();
    expect(filaDelRegistro(filaTestnet, "testnet", CONTRATO_REAL, HUELLA_REAL)).toBe(filaTestnet);
  });

  it("en la red principal no alcanza una fila con solo el comienzo de la huella; en las filas viejas de testnet sí", () => {
    const corta = FILA.replace(HUELLA_REAL, `${HUELLA_REAL.slice(0, 16)}…`);
    const p = problemasDeLaEntrada(entrada(), deMainnet(`${DOCS}\n${corta}\n`));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/huella entera/);
    const cortaTestnet = corta.replace("| mainnet |", "| testnet |");
    expect(filaDelRegistro(cortaTestnet, "testnet", CONTRATO_REAL, HUELLA_REAL)).toBe(cortaTestnet);
    expect(filaDelRegistro(cortaTestnet, "testnet", CONTRATO_REAL, HUELLA_REAL, { huellaEntera: true })).toBeNull();
  });

  it("la frase de otra red, un RPC que no es de la lista, una fecha mal escrita o la huella en mayúsculas dan rojo", () => {
    const docs = `${DOCS}\n${FILA}\n`;
    expect(problemasDeLaEntrada(entrada({ networkPassphrase: passphraseDe("testnet") }), deMainnet(docs))).toHaveLength(1);
    expect(problemasDeLaEntrada(entrada({ networkPassphrase: "Public Global Stellar Network ; September 2015 " }), deMainnet(docs))).toHaveLength(1);
    expect(problemasDeLaEntrada(entrada({ rpcUrl: "https://soroban-testnet.stellar.org" }), deMainnet(docs))).toHaveLength(1);
    expect(problemasDeLaEntrada(entrada({ deployedAt: "20-11-2026" }), deMainnet(docs))).toHaveLength(1);
    expect(problemasDeLaEntrada(entrada({ wasmSha256: HUELLA_REAL.toUpperCase() }), deMainnet(docs)).join("\n")).toMatch(/minúscula/);
    // Sin frase ni RPC vale lo de siempre de esa red: no es un rojo.
    const { networkPassphrase: _f, rpcUrl: _r, ...sinFraseNiRpc } = entrada();
    expect(problemasDeLaEntrada(sinFraseNiRpc, deMainnet(docs))).toEqual([]);
  });

  it("la entrada de testnet de hoy pasa la misma revisión, con su fila (así se sabe que la revisión lee bien la tabla)", () => {
    expect(filaDelRegistro(DOCS, "testnet", REAL.testnet.contractId, REAL.testnet.wasmSha256)).toMatch(/\| testnet \|/);
    expect(problemasDeLaEntrada(REAL.testnet, { red: "testnet", passphrase: passphraseDe("testnet"), rpcs: RPC_LISTAS.testnet, docs: DOCS })).toEqual([]);
  });
});

describe("la guardia", () => {
  const enEnsayo = process.env.TINKAZO_ENSAYO_OFICIAL === "1";
  const real = JSON.parse(readFileSync(LISTA_REAL, "utf8"));
  const revisar = () =>
    problemasDeLaEntrada(real.mainnet, {
      red: "mainnet",
      passphrase: passphraseDe("mainnet"),
      rpcs: RPC_LISTAS.mainnet,
      docs: readFileSync(join(RAIZ, "docs", "deployments.md"), "utf8"),
    });

  // Durante el ensayo la lista real tiene la entrada a propósito: ahí se saltea.
  it.skipIf(enEnsayo)("la lista real no trae la dirección ni la huella inventadas del ensayo", () => {
    const texto = readFileSync(LISTA_REAL, "utf8");
    expect(texto).not.toContain(CONTRATO_DE_ENSAYO);
    expect(tieneEntradaDeEnsayo(texto)).toBe(false);
  });

  // El día del commit: la entrada real de la red principal tiene que ser la del despliegue.
  it.runIf(real.mainnet !== null && !enEnsayo)(
    "la entrada de mainnet es la del despliegue: su huella, la frase y el RPC de la red principal, y su fila en docs/deployments.md",
    () => {
      expect(revisar()).toEqual([]);
    },
  );

  // Durante el ensayo, la misma revisión reconoce la entrada inventada: así se sabe que el día va a mirar de verdad.
  it.runIf(real.mainnet !== null && enEnsayo)("durante el ensayo, la revisión de la entrada de mainnet reconoce la inventada", () => {
    const p = revisar().join("\n");
    expect(p).toMatch(/dirección inventada/);
    expect(p).toMatch(/huella inventada/);
  });
});
