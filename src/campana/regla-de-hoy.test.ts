import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { ponerEtiquetas, etiquetaConCuenta, etiquetaDe, paraMostrar } from "../equipos/etiquetas";
import { type SalaDeCampana, leerTodasLasAnotadas, resultadoDeSala } from "../sala/campana-org";
import { cuentaDePrueba, lineaDePrueba } from "./cuentas-de-prueba";
import { campanaDeEjemplo } from "./ejemplo";
import { basesAutomaticas, type DatosDeLasBases } from "./crear/bases";
import { type FotoDeTextos, type Foto, compararConLaFoto, compararTextosConLaFoto } from "./foto-de-hoy";
import { premioParaElCuadro, premiosTexto } from "./formato";
import { type DatosDeAnotada, listaYEtiquetas } from "./lista";
import { leerCampana } from "./modelo";
import { type PasoDelPuente, avisosPendientes, botonDelPaso, lineaDelPaso } from "./puente";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CREAR_CAMPANA } from "./textos-crear";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

/**
 * La regla de hoy: lo que hacen las campañas de cuentas antes de que existan las campañas de personas. Cada escena de
 * abajo anota lo que hoy hacen el lector de campañas, el puente del panel, la lista que se sella, las bases, las
 * etiquetas y los pedidos a la sala, y lo compara con lo grabado. Ningún paso que sigue puede cambiar una línea: lo que
 * cambia a propósito se cambia en su propio paso, con su prueba, y se dice.
 *
 * Los archivos grabados son `regla-de-hoy.base.json` y `regla-de-hoy-textos.base.json`. Sin ellos, la prueba deja lo que
 * anotó en el registro (`FOTO64`) y falla.
 */
const FOTO = fileURLToPath(new URL("./regla-de-hoy.base.json", import.meta.url));
const FOTO_DE_TEXTOS = fileURLToPath(new URL("./regla-de-hoy-textos.base.json", import.meta.url));

/** Un texto estable de cualquier valor: los números grandes llevan una n y las claves van en el orden en que se escribieron. */
const texto = (x: unknown): string => JSON.stringify(x, (_clave, valor: unknown) => (typeof valor === "bigint" ? `${valor}n` : valor));

/* ------------------------------------------------------------ el lector de campañas */

const AHORA = Date.UTC(2026, 10, 15, 18, 0);

/** El archivo de una campaña como lo firma Tinkazo: los números grandes como texto y las horas con guion bajo. */
function archivoDe(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  const c = campanaDeEjemplo(AHORA);
  return {
    ...c,
    premios: c.premios.map((p) => p.toString()),
    abre_ms: c.abreMs,
    cierra_ms: c.cierraMs,
    sorteo_ms: c.sorteoMs,
    recibir_hasta_ms: c.recibirHastaMs,
    ...cambios,
  };
}

function escenaDelLector(): string[] {
  const casos: [string, Record<string, unknown>][] = [
    ["ejemplo", {}],
    ["tres premios iguales", { premios: ["400000000", "400000000", "400000000"] }],
    ["premios distintos", { premios: ["500000000", "200000000"] }],
    ["un centavo", { premios: ["100000"] }],
    ["menos de un centavo", { premios: ["99999"] }],
    ["premio en cero", { premios: ["0"] }],
    ["sin premios", { premios: [] }],
    ["once premios", { premios: Array.from({ length: 11 }, () => "400000000") }],
    ["entrada con correo", { entrada: "google-correo" }],
    ["entrada rara", { entrada: "otra" }],
    ["dos pasos con enlace", { pasos: [{ tipo: "enlace", url: "https://example.org/a", texto: { es: "Mirá", en: "Look" } }, { tipo: "texto", url: null, texto: { es: "Hacé algo", en: "Do something" } }] }],
    ["horas desordenadas", { cierra_ms: AHORA - 7_200_000 }],
    ["evento con mayúsculas", { evento: "Evento" }],
    ["otra versión", { v: 2 }],
  ];
  return casos.map(([nombre, cambios]) => `${nombre} | ${texto(leerCampana(archivoDe(cambios)))}`);
}

/* ------------------------------------------------------------ el puente del panel */

const GANADORA = { cuenta: "GAAA", nombre: "Ana", avisada: false, alta: "esperando" } as const;

const PASOS: PasoDelPuente[] = [
  { paso: "nada" },
  { paso: "leyendo" },
  { paso: "en-el-sorteo", n: 3 },
  { paso: "no-leyo" },
  { paso: "pocos", n: 2 },
  { paso: "pocos", n: 5 },
  { paso: "otra-cuenta", fin: "ABCD" },
  { paso: "lista-sellada", soltable: true },
  { paso: "lista-sellada", soltable: false },
  { paso: "otra-red", modo: "prueba" },
  { paso: "version-distinta" },
  { paso: "sin-conexion" },
  { paso: "avisando" },
  { paso: "no-avisamos" },
  { paso: "comprobando" },
  { paso: "avisada" },
  { paso: "sala-borrada" },
  { paso: "otro-sorteo" },
  { paso: "sorteo-pendiente" },
  { paso: "tomada" },
  { paso: "entrar-para-seguir" },
  { paso: "no-comprobo" },
  { paso: "aviso-roto" },
  { paso: "sello-por-confirmar" },
  { paso: "tarde" },
  { paso: "lista-cambio" },
  { paso: "otra-lista" },
  { paso: "ganadoras", n: 1 },
  { paso: "ganadoras", n: 3 },
  { paso: "boton-avisar" },
  { paso: "mandando" },
  { paso: "boton-resultado" },
  { paso: "guardar-sorteo" },
  { paso: "resultado", filas: [GANADORA], otraBilletera: false },
  { paso: "resultado", filas: [{ ...GANADORA, avisada: true }], otraBilletera: false },
  { paso: "resultado", filas: [GANADORA], otraBilletera: true },
  { paso: "resultado", filas: [{ ...GANADORA, alta: { estado: "puede" } }], otraBilletera: false },
  { paso: "resultado", filas: [{ ...GANADORA, alta: { estado: "fallo" } }], otraBilletera: false },
  { paso: "resultado", filas: [{ ...GANADORA, alta: { estado: "fallo", final: true } }], otraBilletera: false },
  { paso: "resultado", filas: [], otraBilletera: false },
];

function escenaDelPuente(): string[] {
  return PASOS.flatMap((p) => {
    const linea = lineaDelPaso(p);
    return [
      `${texto(p)} | linea ${texto(linea)} | boton ${texto(botonDelPaso(p))}`,
      `${texto(p)} | pendiente con el sorteo sin hacer ${avisosPendientes(p, false)} | pendiente con el sorteo hecho ${avisosPendientes(p, true)}`,
    ];
  });
}

/* ------------------------------------------------------------ la lista que se sella */

function escenaDeLaLista(): string[] {
  const persona = (n: number): string => `Persona ${n}`;
  const datos = (n: number, nombre: string, revisar = false, mostrar = false): DatosDeAnotada => ({ n, nombre, revisar, mostrar });
  const cuentas = [5, 3, 1, 4, 2, 6].map(cuentaDePrueba);
  const porCuenta = new Map<string, DatosDeAnotada>([
    [cuentaDePrueba(1), datos(1, "Ana")],
    [cuentaDePrueba(2), datos(2, " ana ")],
    [cuentaDePrueba(3), datos(3, "")],
    [cuentaDePrueba(4), datos(4, "Texto marcado", true, false)],
    [cuentaDePrueba(5), datos(5, "Otro marcado", true, true)],
  ]);
  const armada = listaYEtiquetas(cuentas, porCuenta, persona);
  const corto = (c: string): string => `${c.slice(0, 4)}…${c.slice(-4)}`;
  const mostrar = (a: ReturnType<typeof listaYEtiquetas>): string =>
    a === null ? "null" : `${a.lineas.map(corto).join(",")} | ${[...a.etiquetas].map(([c, e]) => `${corto(c)}=${e}`).join(",")}`;
  return [
    `seis cuentas | ${mostrar(armada)}`,
    `con una cuenta mal formada | ${mostrar(listaYEtiquetas([cuentaDePrueba(1), "GBBB"], new Map(), persona))}`,
    `con una cuenta de 56 letras sin forma de cuenta | ${mostrar(listaYEtiquetas([cuentaDePrueba(1), `G${"B".repeat(55)}`], new Map(), persona))}`,
    `vacía | ${mostrar(listaYEtiquetas([], new Map(), persona))}`,
    `sin datos de nadie | ${mostrar(listaYEtiquetas([cuentaDePrueba(2), cuentaDePrueba(1)], new Map(), persona))}`,
    `cuenta repetida | ${mostrar(listaYEtiquetas([cuentaDePrueba(2), cuentaDePrueba(2), cuentaDePrueba(1)], new Map(), persona))}`,
  ];
}

/* ------------------------------------------------------------ las bases que se escriben solas */

function escenaDeLasBases(): string[] {
  const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";
  const sorteoMs = Date.UTC(2026, 10, 21, 22, 30);
  const datos = (cambio: Partial<DatosDeLasBases>): DatosDeLasBases => ({
    marca: "Alcancía Andina",
    ganan: 3,
    monto: 40,
    sorteoMs,
    zona: "America/La_Paz",
    conRedes: true,
    costo: { es: null, en: null },
    ...cambio,
  });
  const combos: [string, DatosDeLasBases][] = [
    ["tres premios con redes", datos({})],
    ["un premio sin redes", datos({ ganan: 1, conRedes: false, monto: 1000 })],
    ["dos premios con costo de retirar", datos({ ganan: 2, costo: { es: "0,50", en: "0.50" } })],
    ["diez premios con una marca de varias palabras", datos({ marca: "JBL y Compañía", ganan: 10, monto: 5, zona: "America/Santiago" })],
  ];
  return combos.flatMap(([nombre, d]) => {
    const b = basesAutomaticas(d, dic);
    return [`${nombre} | es | ${b.es.split("\n").join(" // ")}`, `${nombre} | en | ${b.en.split("\n").join(" // ")}`];
  });
}

/* ------------------------------------------------------------ cómo se ven los premios y las etiquetas */

function escenaDeLosPremios(): string[] {
  const d = (x: number): bigint => BigInt(Math.round(x * 100)) * 100000n;
  const juegos: [string, bigint[]][] = [
    ["uno", [d(40)]],
    ["uno con centavos", [d(40.5)]],
    ["tres iguales", [d(40), d(40), d(40)]],
    ["dos distintos", [d(50), d(20)]],
    ["tres distintos con centavos", [d(50), d(20.25), d(10)]],
  ];
  return juegos.flatMap(([nombre, premios]) => [
    `${nombre} | es ${premiosTexto(premios, "es")} | en ${premiosTexto(premios, "en")} | con centavos es ${premiosTexto(premios, "es", true)} | en ${premiosTexto(premios, "en", true)}`,
    `${nombre} | para el cuadro ${premios.map(premioParaElCuadro).join(" / ")}`,
  ]);
}

function escenaDeLasEtiquetas(): string[] {
  const [a, b, c] = [1, 2, 3].map(cuentaDePrueba) as [string, string, string];
  const corto = (x: string): string => `${x.slice(0, 4)}…${x.slice(-4)}`;
  try {
    ponerEtiquetas(new Map([[a, "Ana"], [b, "Beto"]]), "personas");
    const con = [
      `etiquetaDe con etiqueta | ${etiquetaDe(a)}`,
      `etiquetaDe sin etiqueta | ${etiquetaDe(c) === c ? "la cuenta tal cual" : etiquetaDe(c)}`,
      `etiquetaConCuenta con etiqueta | ${etiquetaConCuenta(b).replace(corto(b), "<cuenta>")}`,
      `etiquetaConCuenta sin etiqueta | ${etiquetaConCuenta(c) === c ? "la cuenta tal cual" : etiquetaConCuenta(c)}`,
      `paraMostrar con etiquetas | ${paraMostrar([a, b, c]).map((x) => (x === c ? "<cuenta tal cual>" : x)).join(",")}`,
    ];
    ponerEtiquetas(new Map());
    const sin = [
      `paraMostrar sin etiquetas | ${paraMostrar([a, b]).every((x, i) => x === [a, b][i]) ? "las cuentas tal cual" : "cambió"}`,
      `etiquetaDe sin etiquetas | ${etiquetaDe(a) === a ? "la cuenta tal cual" : "cambió"}`,
      `etiquetaConCuenta sin etiquetas | ${etiquetaConCuenta(a) === a ? "la cuenta tal cual" : "cambió"}`,
    ];
    return [...con, ...sin];
  } finally {
    ponerEtiquetas(new Map());
  }
}

/* ------------------------------------------------------------ los textos */

const SOLO_TEXTOS = (tabla: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(tabla).filter((par): par is [string, string] => typeof par[1] === "string"));

/** Las claves del diccionario de la página que usan las campañas y la verificación. */
const ES_DE_CAMPANAS_O_DE_VERIFICAR = /^(?:v[A-Z]|cmp[A-Z]|verif[A-Z]|tmCamp)|^(?:campanaNoPisa|clVentanaLista)$/u;

function losTextos(): FotoDeTextos {
  const delDiccionario = (idioma: "es" | "en"): Record<string, string> =>
    Object.fromEntries(Object.entries(SOLO_TEXTOS(T[idioma] as unknown as Record<string, unknown>)).filter(([clave]) => ES_DE_CAMPANAS_O_DE_VERIFICAR.test(clave)));
  return {
    "textos-sala es": SOLO_TEXTOS(TEXTOS_SALA_CAMPANA.es),
    "textos-sala en": SOLO_TEXTOS(TEXTOS_SALA_CAMPANA.en),
    "textos es": SOLO_TEXTOS(TEXTOS_CAMPANA.es),
    "textos en": SOLO_TEXTOS(TEXTOS_CAMPANA.en),
    "textos-crear es": SOLO_TEXTOS(TEXTOS_CREAR_CAMPANA.es),
    "textos-crear en": SOLO_TEXTOS(TEXTOS_CREAR_CAMPANA.en),
    "diccionario es": delDiccionario("es"),
    "diccionario en": delDiccionario("en"),
  };
}

/* ------------------------------------------------------------ los pedidos a la sala */

const TOKEN = "T".repeat(22);
const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN,
  clave: "C".repeat(22),
  vence: 1_900_000_000_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

interface Llamada {
  metodo: string;
  ruta: string;
  auth: string | undefined;
}

/** Un `fetch` que contesta en orden lo que se le diga y anota cada llamada. */
function conFetch(respuestas: (Response | "caida")[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({
      metodo: init?.method ?? "GET",
      ruta: url.replace("https://s.tinkazo.app/v1/sala/AbCd1234", ""),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    const r = respuestas.shift();
    if (r === undefined || r === "caida") throw new Error("sin red");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });
const estadoDe = (fase: string, total: number, quitadas = 0): Response =>
  json({ fase, total, cierraMs: 5, pase: "sin", quitadas: { repetida: quitadas, evento: 0, pidio: 0, otro: 0 } });
const fila = (n: number, v: number, cuenta: unknown = cuentaDePrueba(n)): Record<string, unknown> => ({ n, cuenta, d: "cifrado", estado: "aceptado", v });

describe("el lector de campañas de hoy", () => {
  it("acepta la campaña de ejemplo con sus premios en centavos y no agrega ningún campo", () => {
    const lectura = leerCampana(archivoDe());
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.campana.premios).toEqual([400000000n]);
    expect(lectura.campana.entrada).toBe("google");
    expect(Object.keys(lectura.campana).sort()).toEqual(
      [
        "abreMs", "anotadas", "bases", "cierraMs", "comprobante", "contrato", "empresa", "entrada", "estado", "evento", "lugar",
        "pasos", "premios", "promo", "recibirHastaMs", "red", "sorteoMs", "v", "zona",
      ].sort(),
    );
  });

  it("rechaza los premios que no llegan a un centavo, en cero o vacíos, y nombra el campo", () => {
    for (const premios of [["0"], ["99999"], [], Array.from({ length: 11 }, () => "400000000")]) {
      const lectura = leerCampana(archivoDe({ premios }));
      expect(lectura.ok, JSON.stringify(premios)).toBe(false);
      if (!lectura.ok) expect(lectura.campo).toBe("premios");
    }
  });

  it("rechaza una entrada que no sea Google o Google con correo", () => {
    const lectura = leerCampana(archivoDe({ entrada: "otra" }));
    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.campo).toBe("entrada");
  });
});

describe("el puente de hoy", () => {
  it("el resultado con ganadoras dice que los celulares ya pueden verlo, y con otra billetera o un fallo final manda a avisar a Tinkazo", () => {
    expect(lineaDelPaso({ paso: "resultado", filas: [GANADORA], otraBilletera: false })).toEqual({ clave: "cpoCelularesResultado", vars: {} });
    expect(lineaDelPaso({ paso: "resultado", filas: [GANADORA], otraBilletera: true })).toEqual({ clave: "cpoAvisaleATinkazo", vars: {} });
    expect(lineaDelPaso({ paso: "resultado", filas: [{ ...GANADORA, alta: { estado: "fallo", final: true } }], otraBilletera: false })).toEqual({
      clave: "cpoAvisaleATinkazo",
      vars: {},
    });
  });

  it("el resultado no lleva un botón del puente, y pasar la lista lleva el de siempre", () => {
    expect(botonDelPaso({ paso: "resultado", filas: [GANADORA], otraBilletera: false })).toBeNull();
    expect(botonDelPaso({ paso: "lista-sellada", soltable: true })).toEqual({ clave: "cpoPasar", accion: "soltarYPasar" });
    expect(botonDelPaso({ paso: "lista-sellada", soltable: false })).toBeNull();
  });
});

describe("la lista y los pedidos de hoy, con cuentas", () => {
  it("la lista de cuentas sale ordenada, sin repetir, con un nombre o Persona y su número", () => {
    const persona = (n: number): string => `Persona ${n}`;
    const cuentas = [3, 1, 2].map(cuentaDePrueba);
    const armada = listaYEtiquetas(cuentas, new Map([[cuentaDePrueba(1), { n: 1, nombre: "Ana", revisar: false, mostrar: false }]]), persona);
    expect(armada?.lineas).toEqual([...cuentas].sort());
    expect(armada?.etiquetas.get(cuentaDePrueba(1))).toBe("Ana");
    expect(armada?.etiquetas.get(cuentaDePrueba(2))).toBe("Persona 2");
  });

  it("una línea que no es una cuenta no se descarta en silencio: la lista no sale", () => {
    expect(listaYEtiquetas([cuentaDePrueba(1), lineaDePrueba(1)], new Map(), (n) => `Persona ${n}`)).toBeNull();
    expect(listaYEtiquetas([cuentaDePrueba(1), "GBBB"], new Map(), (n) => `Persona ${n}`)).toBeNull();
  });

  it("lee tres cuentas con sus pedidos, todos con el token de quien organiza", async () => {
    const m = conFetch([estadoDe("cerrada", 3), json([fila(1, 1), fila(2, 2), fila(3, 3)]), json([]), estadoDe("cerrada", 3), json([])]);
    const filas = await leerTodasLasAnotadas(SALA, { fetch: m.fetch });
    expect(filas?.map((f) => [f.n, f.cuenta, f.v])).toEqual([1, 2, 3].map((n) => [n, cuentaDePrueba(n), n]));
    expect(m.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toEqual([
      "GET /campana/estado",
      "GET /equipos?desde=0",
      "GET /equipos?desde=3",
      "GET /campana/estado",
      "GET /equipos?desde=3",
    ]);
    expect(m.llamadas.every((l) => l.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("con una lista vacía devuelve una lista vacía y no null", async () => {
    const m = conFetch([estadoDe("cerrada", 0), json([]), estadoDe("cerrada", 0), json([])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toEqual([]);
  });

  it("una cuenta mal formada, con la forma de una cuenta pero sin su final de control, hace fallar la lectura", async () => {
    const m = conFetch([estadoDe("cerrada", 1), json([fila(1, 1, `G${"B".repeat(55)}`)])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("una fila que no tiene la forma de una fila, o una cuenta que no es texto, hace fallar la lectura", async () => {
    for (const mala of [{ ...fila(1, 1), n: 0 }, { ...fila(1, 1), d: 5 }, { ...fila(1, 1), estado: null }, fila(1, 1, 7), { ...fila(1, 1), v: -1 }]) {
      const m = conFetch([estadoDe("cerrada", 1), json([mala])]);
      expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch }), JSON.stringify(mala)).toBeNull();
    }
  });

  it("el resultado de cuentas devuelve el sorteo, las ganadoras en orden y el comprobante", async () => {
    const ganadoras = [cuentaDePrueba(2), cuentaDePrueba(1)];
    const m = conFetch([json({ sorteo: "777", ganadoras, comprobante: "/verificar.html?x=1" })]);
    expect(await resultadoDeSala(SALA, { fetch: m.fetch })).toEqual({ sorteo: "777", ganadoras, comprobante: "/verificar.html?x=1" });
    expect(m.llamadas).toEqual([{ metodo: "GET", ruta: "/campana/resultado", auth: undefined }]);
  });

  it("el resultado con una lista de ganadoras vacía se acepta como vacía", async () => {
    const m = conFetch([json({ sorteo: "1", ganadoras: [], comprobante: "/verificar.html" })]);
    expect(await resultadoDeSala(SALA, { fetch: m.fetch })).toEqual({ sorteo: "1", ganadoras: [], comprobante: "/verificar.html" });
  });

  it("el resultado con una cuenta mal formada, o con una línea que no es una cuenta, da red", async () => {
    for (const mala of [`G${"B".repeat(55)}`, "GBBB", 7, null]) {
      const m = conFetch([json({ sorteo: "1", ganadoras: [cuentaDePrueba(1), mala], comprobante: "/verificar.html" })]);
      expect(await resultadoDeSala(SALA, { fetch: m.fetch }), String(mala)).toBe("red");
    }
  });

  it("el resultado distingue la sala sin resultado de la sala que no existe, y cualquier otra falla es red", async () => {
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ error: "sin-resultado" }, 404)]).fetch })).toBe("sin-resultado");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ error: "no-existe" }, 404)]).fetch })).toBe("no-existe");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({}, 500)]).fetch })).toBe("red");
    expect(await resultadoDeSala(SALA, { fetch: conFetch(["caida"]).fetch })).toBe("red");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ sorteo: 1, ganadoras: [], comprobante: "x" })]).fetch })).toBe("red");
  });
});

describe("los textos de hoy", () => {
  it("los textos que el panel dice con cuentas son los de siempre", () => {
    expect(TEXTOS_SALA_CAMPANA.es.cpoPersona).toBe("Persona {n}");
    expect(TEXTOS_SALA_CAMPANA.es.cpoRepetida).toBe("Cuenta repetida");
    expect(TEXTOS_SALA_CAMPANA.es.cpoAvisada).toBe("Le avisamos en su celular.");
    expect(TEXTOS_SALA_CAMPANA.es.cpoPuedeRecibir).toBe("Puede recibir");
    expect(TEXTOS_SALA_CAMPANA.es.cpoCelularesResultado).toBe("Los celulares ya pueden ver quién ganó.");
    expect(TEXTOS_SALA_CAMPANA.en.cpoRepetida).toBe("Duplicate account");
    expect(TEXTOS_SALA_CAMPANA.en.cpoAvisada).toBe("We let them know on their phone.");
  });
});

describe("la foto de hoy", () => {
  it("las escenas de hoy siguen escribiéndose igual", () => {
    const ahora: Foto = {
      lector: escenaDelLector(),
      puente: escenaDelPuente(),
      lista: escenaDeLaLista(),
      bases: escenaDeLasBases(),
      premios: escenaDeLosPremios(),
      etiquetas: escenaDeLasEtiquetas(),
    };
    compararConLaFoto(FOTO, "regla-de-hoy", ahora);
  });

  it("los valores de los textos de las campañas y de la verificación siguen siendo los mismos", () => {
    const ahora = losTextos();
    // Para que la foto no esté vacía: cada sección tiene claves de verdad.
    for (const [seccion, claves] of Object.entries(ahora)) expect(Object.keys(claves).length, seccion).toBeGreaterThan(20);
    compararTextosConLaFoto(FOTO_DE_TEXTOS, "regla-de-hoy-textos", ahora);
  });
});
