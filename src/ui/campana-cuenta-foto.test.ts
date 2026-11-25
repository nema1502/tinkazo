// @vitest-environment jsdom
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CENTAVO } from "../campana/comision";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import type { SorteoDeCampana } from "../campana/en-curso";
import { type Foto, compararConLaFoto } from "../campana/foto-de-hoy";
import { premioParaElCuadro } from "../campana/formato";
import type { Campana } from "../campana/modelo";
import {
  type PasoDelPuente,
  accionesDelPuente,
  alCambiarElPuente,
  lineaDelPaso,
  pasoDelPuente,
  ponerPaso,
  reiniciarElPuente,
} from "../campana/puente";
import { sustituir } from "../campana/sustituir";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { cifrarEquipo, descifrarEquipo, revisarEquipo } from "../equipos/datos";
import {
  type SalaDeCampana,
  avisarEnSala,
  estadoConToken,
  guardarOrg,
  guardarResultadoEnSala,
  leerOrganizadora,
  leerTodasLasAnotadas,
  ponerSellada,
  resultadoDeSala,
} from "../sala/campana-org";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { DepsDeComision, PedidoDePagoDeComision } from "./campana-comision";
import { type ContextoDelPaso, type DepsDelPaso, crearPaso } from "./campana-pasar";
import { alRevelar, escucharSellos, registrarLasAcciones, retomarAlArrancar } from "./campana-resultado";
import {
  RONDA,
  SALA as SALA_DEL_RESULTADO,
  mundo as mundoDelResultado,
  suelta as sueltaDelResultado,
} from "./campana-resultado-mundo";
import {
  CLAVE,
  SALA,
  type Mundo,
  type Panel,
  alta,
  archivoDe,
  boton,
  botonDeFila,
  botones,
  cerrarTodos,
  elegirArchivo,
  equipoDe,
  filasDe,
  mundo as mundoDelPanel,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";

/**
 * La foto de hoy de una campaña de cuentas, en el mundo del panel y en el del resultado. Recorre el panel de quien
 * organiza (elegir el archivo, abrir, anotar, quitar, cerrar), cada paso del puente en cada vista, el paso de pasar la lista
 * con la sala de verdad (los pedidos, las rutas y los cuerpos) y lo que la herramienta le cuenta a la sala del sello y
 * del resultado. Lo anota todo en líneas y lo compara con `campana-cuenta-foto.base.json`.
 *
 * Los textos que se comparan son los que lee la persona. Ningún paso que viene puede cambiar una línea: si una campaña de
 * cuentas se ve distinta, esta prueba falla y dice cuál. Sin el archivo grabado, deja lo anotado en el registro (`FOTO64`).
 */
const FOTO = join(dirname(fileURLToPath(import.meta.url)), "campana-cuenta-foto.base.json");

/** Las escenas que van anotando las pruebas de abajo: la última las compara con lo grabado. */
const escenas: Foto = {};

const enTexto = (x: unknown): string => JSON.stringify(x, (_clave, valor: unknown) => (typeof valor === "bigint" ? `${valor}n` : valor));

/* ------------------------------------------------------------ lo que se ve en el panel */

/** El texto que se ve de un pedazo de la pantalla: sin lo escondido, sin espacios de más y con los bloques separados. */
function textoVisible(raiz: Element): string {
  const partes: string[] = [];
  const caminar = (nodo: Node): void => {
    if (nodo.nodeType === Node.TEXT_NODE) {
      partes.push(nodo.textContent ?? "");
      return;
    }
    if (!(nodo instanceof HTMLElement)) return;
    if (nodo.hidden || nodo.style.display === "none" || nodo.tagName === "SCRIPT" || nodo.tagName === "STYLE") return;
    for (const hijo of nodo.childNodes) caminar(hijo);
    if (/^(?:P|DIV|LI|UL|H[1-6]|SECTION|BUTTON|DETAILS|SUMMARY|LABEL)$/u.test(nodo.tagName)) partes.push("\n");
  };
  caminar(raiz);
  return partes
    .join("")
    .split("\n")
    .map((linea) => linea.replace(/\s+/gu, " ").trim())
    .filter((linea) => linea !== "")
    .join(" / ");
}

const losBotones = (p: Panel): string[] => botones(p).filter((b) => !b.hidden).map((b) => (b.textContent ?? "").trim());

/** Lo que dice el panel en este momento: la vista, el título, la línea, el aviso, las acciones y todo lo que se ve. */
function verPanel(etapa: string, p: Panel): string {
  const dato = {
    vista: vistaDe(p),
    titulo: texto(p, "#cpo-h"),
    linea: texto(p, "#cpo-linea"),
    aviso: texto(p, "#cpo-aviso"),
    principales: principales(p).map((b) => (b.textContent ?? "").trim()),
    botones: losBotones(p),
    todo: textoVisible(p.raiz),
  };
  return `${etapa} | ${enTexto(dato)}`;
}

/* ------------------------------------------------------------ el cobro de mentira */

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const ORIGEN = cuentaDePrueba(5);
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: cuentaDePrueba(2), costo: d(0.5), cobros: cuentaDePrueba(1) };
/** Una campaña de 120: la comisión es 2,40 y se cargan 122,40. */
const DE_120 = { premios: ["1200000000"] };

interface Cobro {
  saldo: bigint;
  llamadas: string[];
  pedidos: PedidoDePagoDeComision[];
  cargas: string[];
  faltas: (string | undefined)[];
}

/** El cobro prendido en el mundo del panel, con la red, el saldo y el pago de mentira. */
function conCobro(m: Mundo, saldo: bigint): Cobro {
  const colas = new Map<string, Promise<unknown>>();
  const c: Cobro = { saldo, llamadas: [], pedidos: [], cargas: [], faltas: [] };
  const deps: DepsDeComision = {
    comision: () => CONFIG,
    billetera: async () => "google",
    mirarRed: async () => {
      c.llamadas.push("red");
      return { tipo: "no-pagada", suma: 0n };
    },
    saldo: async () => {
      c.llamadas.push("saldo");
      return c.saldo;
    },
    portero: async () => {
      c.llamadas.push("portero");
      return "atiende";
    },
    pagar: async (p) => {
      c.llamadas.push("pagar");
      c.pedidos.push(p);
      p.alMandar("1001", "b".repeat(64));
      return { tipo: "listo", hash: "a".repeat(64) };
    },
    confirmar: async () => null,
    puedeVolverALista: async () => true,
    cargar: (cuenta, _alCerrar, falta) => {
      c.cargas.push(cuenta);
      c.faltas.push(falta);
    },
    candado: (nombre, f) => {
      const antes = colas.get(nombre) ?? Promise.resolve();
      const sigue = antes.then(f, f);
      colas.set(nombre, sigue.catch(() => undefined));
      return sigue as never;
    },
  };
  m.deps.comision = deps;
  return c;
}

/* ------------------------------------------------------------ el recorrido del panel */

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

/**
 * Del archivo a la lista cerrada: elegir, (pagar), abrir, cuatro personas, quitar a una, cerrar. Cada etapa anota lo que se ve.
 */
async function recorridoDelPanel(cobro: "sin" | "con"): Promise<{ lineas: string[]; vistas: string[] }> {
  document.body.innerHTML = "";
  reiniciarElPuente();
  const m = mundoDelPanel();
  m.cuenta = ORIGEN;
  m.deps.cambiarDeCuenta = () => void (m.cuenta = null);
  const dineros = cobro === "con" ? conCobro(m, d(150)) : null;
  const cierres: string[] = [];
  m.deps.alCerrar = (_s, filas, ctx?: ContextoDelPaso) =>
    void cierres.push(
      enTexto({
        n: filas.map((f) => f.n),
        evento: ctx?.campana.evento,
        premios: ctx?.campana.premios.map((x) => `${x}n`),
        mostradas: [...(ctx?.mostradas ?? [])],
        quitas: ctx?.quitasEnCurso(),
      }),
    );
  const lineas: string[] = [];
  const vistas: string[] = [];
  const p = nuevoPanel(m);
  const ver = (etapa: string): void => {
    vistas.push(vistaDe(p));
    lineas.push(verPanel(etapa, p));
  };
  ver("al llegar");

  await elegirArchivo(m, p, archivoDe(DE_120));
  await suelta(6);
  ver("con el archivo elegido");

  if (dineros) {
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    ver("con el pago hecho");
    lineas.push(`pagos | ${enTexto(dineros.pedidos.map((x) => ({ cuenta: x.cuenta === CONFIG.cuenta, cobros: x.cobros === CONFIG.cobros, costo: x.costo, sale: x.sale })))} | llamadas ${enTexto(dineros.llamadas)}`);
  }

  boton(p, "Abrir la inscripción").click();
  await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  await suelta(3);
  ver("con la inscripción abierta");

  await alta(m, 1, "Ana");
  await alta(m, 2, "Nora");
  await alta(m, 3, "Beto");
  await alta(m, 4, "Ana");
  await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(4));
  lineas.push(`lista | ${enTexto(filasDe(p))}`);
  ver("con cuatro personas anotadas");

  botonDeFila(p, 3, "Quitar").click();
  ver("pidiendo el motivo de quitar a Beto");
  botonDeFila(p, 3, "Cuenta repetida").click();
  ver("con Beto en Deshacer");
  await m.correr(5_100);
  await vi.waitFor(() => expect(m.quitadas).toHaveLength(1));
  ver("con Beto quitado");

  boton(p, "Cerrar la lista").click();
  ver("pidiendo confirmar el cierre");
  await m.correr(700);
  principales(p)[0]?.click();
  await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
  await suelta(6);
  ver("con la lista cerrada");

  lineas.push(
    `lo que la sala recibió | fases ${enTexto(m.fases)} | quitadas ${enTexto(m.quitadas)} | creadas ${enTexto(m.creadas.map((c) => ({ evento: c.de.evento, red: c.de.red, anterior: c.de.anterior })))} | qr ${enTexto(m.qrs.map((q) => q.texto))} | borradas ${m.borradas}`,
    `lo que el panel le pasó al paso | ${enTexto(cierres)}`,
  );
  cerrarTodos();
  return { lineas, vistas };
}

describe("el panel de una campaña de cuentas, de punta a punta", () => {
  it("sin cobro: elegir, abrir, anotar, quitar y cerrar dicen y hacen lo de siempre", async () => {
    const r = await recorridoDelPanel("sin");
    expect(r.vistas).toEqual(["elegir", "previa", "abierta", "abierta", "abierta", "abierta", "abierta", "confirmar", "cerrada"]);
    escenas["panel sin cobro"] = r.lineas;
  }, 120_000);

  it("con el cobro prendido: cargar, pagar, abrir y lo demás dicen lo de siempre", async () => {
    const r = await recorridoDelPanel("con");
    expect(r.vistas.slice(0, 3)).toEqual(["elegir", "previa", "previa"]);
    expect(r.vistas[r.vistas.length - 1]).toBe("cerrada");
    escenas["panel con cobro"] = r.lineas;
  }, 120_000);

  it("con el cobro prendido y sin saldo pide cargar antes de abrir", async () => {
    document.body.innerHTML = "";
    const m = mundoDelPanel();
    m.cuenta = ORIGEN;
    const c = conCobro(m, 0n);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe(DE_120));
    await suelta(6);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cargar dólares digitales"]);
    const lineas = [verPanel("sin saldo", p)];
    boton(p, "Cargar dólares digitales").click();
    lineas.push(`carga | cuentas ${enTexto(c.cargas.map((x) => x === ORIGEN))} | falta ${enTexto(c.faltas)}`);
    escenas["panel con cobro sin saldo"] = lineas;
  }, 120_000);
});

/* ------------------------------------------------------------ cada paso del puente en cada vista */

const PASOS_DE_LA_LISTA: PasoDelPuente[] = [
  { paso: "nada" },
  { paso: "leyendo" },
  { paso: "en-el-sorteo", n: 3 },
  { paso: "no-leyo" },
  { paso: "pocos", n: 2 },
  { paso: "pocos", n: 5 },
  { paso: "otra-cuenta", fin: "6XWZ" },
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
];

const GANA = { cuenta: "GANA", nombre: "Ana", avisada: false, alta: "esperando" } as const;
const GNORA = { cuenta: "GNORA", nombre: "Nora", avisada: false, alta: "esperando" } as const;

const PASOS_DEL_RESULTADO: PasoDelPuente[] = [
  { paso: "resultado", otraBilletera: false, filas: [GANA, GNORA] },
  { paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true }, GNORA] },
  { paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true }, { ...GNORA, avisada: true }] },
  { paso: "resultado", otraBilletera: true, filas: [GANA, GNORA] },
  { paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true, alta: { estado: "puede" } }, { ...GNORA, avisada: true, alta: { estado: "apagado" } }] },
  { paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true, alta: { estado: "fallo", motivo: "red" } }, GNORA] },
  { paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true, alta: { estado: "fallo", motivo: "sin-acceso", final: true } }, GNORA] },
  { paso: "resultado", otraBilletera: false, filas: [GANA] },
  { paso: "resultado", otraBilletera: false, filas: [] },
];

/** El panel retomado en la vista de esa fase, con un paso del puente puesto, y lo que se ve. */
async function conElPaso(fase: "cerrada" | "sellada" | "sorteada", paso: PasoDelPuente): Promise<string> {
  document.body.innerHTML = "";
  reiniciarElPuente();
  const m = mundoDelPanel();
  guardarOrg(m.almacen, { sala: SALA, fase });
  m.sala.fase = fase;
  if (fase === "cerrada") {
    m.deps.listaPasada = () => false;
    m.paginas.push([await equipoDe(m, 1, "Ana"), await equipoDe(m, 2, "Nora")]);
  }
  const p = nuevoPanel(m);
  await vi.waitFor(() => expect(vistaDe(p)).toBe(fase));
  await suelta();
  ponerPaso(paso);
  await suelta(3);
  const linea = verPanel(enTexto(paso), p);
  cerrarTodos();
  return linea;
}

describe("cada paso del puente, en la vista que lo dibuja", () => {
  it("con la lista cerrada, cada paso de pasar y de sellar dice y ofrece lo de siempre", async () => {
    const lineas: string[] = [];
    for (const paso of PASOS_DE_LA_LISTA) lineas.push(await conElPaso("cerrada", paso));
    escenas["puente con la lista cerrada"] = lineas;
    // Los pasos que conviene tener a la vista con su texto escrito a mano.
    const por = (paso: string): string => lineas.find((l) => l.startsWith(`{"paso":"${paso}"`)) ?? "";
    expect(por("no-leyo")).toContain("No se pudo leer toda la lista.");
    expect(por("no-leyo")).toContain('"principales":["Probar de nuevo"]');
    expect(por("otra-cuenta")).toContain("Entrá con la cuenta que termina en 6XWZ.");
  }, 120_000);

  it("con la lista sellada, cada paso dice y ofrece lo de siempre", async () => {
    const lineas: string[] = [];
    for (const paso of PASOS_DE_LA_LISTA) lineas.push(await conElPaso("sellada", paso));
    escenas["puente con la lista sellada"] = lineas;
  }, 120_000);

  it("con el sorteo hecho, cada paso y cada forma del resultado dicen y ofrecen lo de siempre", async () => {
    const lineas: string[] = [];
    for (const paso of [...PASOS_DE_LA_LISTA, ...PASOS_DEL_RESULTADO]) lineas.push(await conElPaso("sorteada", paso));
    escenas["puente con el sorteo hecho"] = lineas;
    const resultado = lineas.filter((l) => l.startsWith('{"paso":"resultado"'));
    expect(resultado).toHaveLength(PASOS_DEL_RESULTADO.length);
    expect(resultado[0]).toContain("Los celulares ya pueden ver quién ganó.");
    expect(resultado[0]).toContain('"principales":["Avisar a Ana"]');
    expect(resultado[3]).toContain("Si alguien no puede recibir, avisale a Tinkazo.");
  }, 180_000);

  it("Avisar a le pide al puente avisar a esa ganadora, y la que ya se avisó dice que se le avisó", async () => {
    document.body.innerHTML = "";
    const m = mundoDelPanel();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    const avisar = vi.fn();
    const { registrarAcciones } = await import("../campana/puente");
    registrarAcciones({ avisarA: avisar });
    ponerPaso({ paso: "resultado", otraBilletera: false, filas: [{ ...GANA, avisada: true }, GNORA] });
    boton(p, "Avisar a Nora").click();
    expect(avisar).toHaveBeenCalledWith("GNORA");
    expect(texto(p, "#cpo-ganadoras")).toContain("Le avisamos en su celular.");
  });
});

/* ------------------------------------------------------------ pasar la lista, con la sala de verdad */

const CUENTAS = [1, 2, 3, 4, 5, 6].map(cuentaDePrueba);

interface DatosDeLaSala {
  fase?: string;
  total?: number;
  filas?: { n: number; cuenta: string; nombre: string; v: number }[];
  organizadora?: string | null;
  /** Lo que contesta GET resultado: el cuerpo, o `sin` si todavía no hay, o `ninguno` si no responde. */
  resultado?: { sorteo: string; ganadoras: string[]; comprobante: string } | "sin";
  /** Lo que contesta PUT fase. */
  alSellar?: { estado: number; error?: string };
  alAvisar?: { estado: number; error?: string };
  caida?: boolean;
}

/** Una sala de mentira que contesta como la de verdad cada ruta de una campaña y anota cada pedido que le llega. */
async function salaFalsa(token: string, datos: DatosDeLaSala): Promise<{ fetch: typeof fetch; registro: string[]; datos: DatosDeLaSala }> {
  const cifradas = new Map<number, string>();
  for (const f of datos.filas ?? []) cifradas.set(f.n, await cifrarEquipo(CLAVE, { nombre: f.nombre, integrantes: [] }));
  const registro: string[] = [];
  const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });
  const error = (estado: number, motivo: string): Response => json({ error: motivo }, estado);
  const f = (async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const ruta = `${u.pathname.replace("/v1/sala/AbCd1234", "")}${u.search}`;
    const metodo = init?.method ?? "GET";
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const quien = auth === undefined ? "sin token" : auth === `Bearer ${token}` ? "con el token" : "con otro token";
    registro.push(`${metodo} ${ruta} ${quien}${init?.body === undefined ? "" : ` ${String(init.body)}`}`);
    if (datos.caida) throw new Error("sin red");
    if (metodo === "GET" && ruta === "/campana/estado") {
      const total = datos.total ?? datos.filas?.length ?? 0;
      return json({ fase: datos.fase ?? "cerrada", total, cierraMs: 5, pase: "sin", quitadas: { repetida: 0, evento: 0, pidio: 0, otro: 0 } });
    }
    if (metodo === "GET" && ruta.startsWith("/equipos?desde=")) {
      const desde = Number(ruta.split("=")[1]);
      const filas = (datos.filas ?? []).filter((x) => x.v > desde).sort((a, b) => a.v - b.v);
      return json(filas.map((x) => ({ n: x.n, cuenta: x.cuenta, d: cifradas.get(x.n) ?? "", estado: "aceptado", v: x.v })));
    }
    if (metodo === "GET" && ruta === "/campana") {
      return json({ texto: JSON.stringify(datos.organizadora === undefined || datos.organizadora === null ? {} : { organizadora: datos.organizadora }) });
    }
    if (metodo === "PUT" && ruta === "/campana/fase") {
      const r = datos.alSellar;
      return r && r.estado !== 204 ? error(r.estado, r.error ?? "forma") : new Response(null, { status: 204 });
    }
    if (metodo === "PUT" && ruta === "/campana/resultado") return new Response(null, { status: 204 });
    if (metodo === "GET" && ruta === "/campana/resultado") {
      return datos.resultado === undefined || datos.resultado === "sin" ? error(404, "sin-resultado") : json(datos.resultado);
    }
    if (metodo === "POST" && ruta === "/campana/avisar") {
      const r = datos.alAvisar;
      return r && r.estado !== 204 ? error(r.estado, r.error ?? "forma") : new Response(null, { status: 204 });
    }
    return error(404, "no-existe");
  }) as unknown as typeof fetch;
  return { fetch: f, registro, datos };
}

interface CasoDePasar {
  nombre: string;
  fin: string;
  nombres?: string[];
  total?: number;
  filasMalas?: boolean;
  caida?: boolean;
  organizadora?: string | null;
  cuenta?: string | null;
  premios?: bigint[];
  redDeLaSala?: "mainnet" | "testnet";
  contrato?: string | null;
  quitas?: number[];
}

const CASOS_DE_PASAR: CasoDePasar[] = [
  { nombre: "cuatro personas con un nombre repetido y otro vacío", fin: "pasada", nombres: ["Ana", "Nora", "ana", ""] },
  { nombre: "la cuenta que organiza entra y sella", fin: "pasada", nombres: ["Ana", "Nora", "Beto"], organizadora: cuentaDePrueba(9), cuenta: cuentaDePrueba(9) },
  { nombre: "dos personas para tres premios", fin: "pocos", nombres: ["Ana", "Nora"], premios: [400000000n, 400000000n, 400000000n] },
  { nombre: "una lista vacía", fin: "pocos", nombres: [] },
  { nombre: "la sala no contesta", fin: "no-leyo", nombres: ["Ana", "Nora"], caida: true },
  { nombre: "una cuenta mal formada en la sala", fin: "no-leyo", nombres: ["Ana", "Nora"], filasMalas: true },
  { nombre: "entra otra cuenta", fin: "otra-cuenta", nombres: ["Ana", "Nora"], organizadora: cuentaDePrueba(9), cuenta: null },
  { nombre: "la sala es de otra red", fin: "otra-red", nombres: ["Ana", "Nora"], redDeLaSala: "mainnet" },
  { nombre: "el sitio lee otro contrato", fin: "version-distinta", nombres: ["Ana", "Nora"], contrato: null },
  { nombre: "alguien se está quitando", fin: "en-espera", nombres: ["Ana", "Nora", "Beto"], quitas: [2] },
];

/** Pasa la lista de la sala de mentira al cuadro de mentira y anota lo que hizo: los pasos, los pedidos y lo que quedó en el cuadro. */
async function pasarLaLista(c: CasoDePasar): Promise<{ fin: string; lineas: string[] }> {
  const nombres = c.nombres ?? [];
  const filas = nombres.map((nombre, i) => ({
    n: i + 1,
    cuenta: c.filasMalas === true && i === 0 ? `G${"B".repeat(55)}` : (CUENTAS[i] as string),
    nombre,
    v: i + 1,
  }));
  const sala = await salaFalsa(SALA.token, { fase: "cerrada", filas, total: c.total, organizadora: c.organizadora ?? null, caida: c.caida });
  const pasos: PasoDelPuente[] = [];
  const registro: string[] = [];
  const esperas: number[] = [];
  const entradas = new Map<string, SorteoDeCampana>();
  const cuadro = { lista: "", premio: "", ganadores: 1, fijo: false };
  const CONTRATO = "CCONTRATO";
  const etiquetas: string[] = [];
  const deps: DepsDelPaso = {
    ahora: () => 1_800_000_000_000,
    leer: (s) => leerTodasLasAnotadas(s, { fetch: sala.fetch }),
    descifrar: descifrarEquipo,
    nombreYFiltro: (datos) => {
      const r = revisarEquipo(datos);
      return r ? { nombre: r.equipo.nombre.trim(), revisar: r.revisar } : null;
    },
    organizadora: async (s) => {
      const r = await leerOrganizadora(s, { fetch: sala.fetch });
      return r === null || (typeof r === "string" && r.startsWith("G") && r.length === 56) ? { cuenta: r } : null;
    },
    cuenta: () => (c.cuenta === undefined ? null : c.cuenta),
    red: () => "testnet",
    contrato: () => (c.contrato === undefined ? CONTRATO : c.contrato),
    contratoDeLaRed: () => CONTRATO,
    nombreDelModo: (red) => (red === "mainnet" ? "oficial" : "prueba"),
    listaBloqueada: () => false,
    sorteado: () => false,
    listaDelCuadro: () => cuadro.lista.split("\n").filter((x) => x !== ""),
    huella: (lineas) => `huella:${lineas.length}:${lineas.join(",")}`,
    modoTurnos: () => false,
    ponerModoTurnos: (si) => void registro.push(`turnos ${si}`),
    ponerEtiquetas: (e, de) => void etiquetas.push(`${de ?? "equipos"} ${enTexto([...e])}`),
    setList: (t) => {
      registro.push(`lista ${t === "" ? "vaciada" : "puesta"}`);
      cuadro.lista = t;
    },
    ponerPremio: (t) => void (cuadro.premio = t),
    ponerGanadores: (n) => void (cuadro.ganadores = n),
    fijarPorCampana: (si) => void (cuadro.fijo = si),
    entrada: (red, evento) => entradas.get(`${red}/${evento}`) ?? null,
    guardar: (e) => void entradas.set(`${e.red}/${e.evento}`, e),
    persona: (n) => `Persona ${n}`,
    botonDeSellar: () => "Sellar la lista",
    premioEnEspanol: premioParaElCuadro,
    esperar: async (ms) => void esperas.push(ms),
    poner: (p) => void pasos.push(p),
  };
  const campana = { premios: c.premios ?? [400000000n], red: "testnet", evento: "evento-uno" } as unknown as Campana;
  const ctx: ContextoDelPaso = { campana, mostradas: new Set<number>(), quitasEnCurso: () => c.quitas ?? [] };
  const laSala: SalaDeCampana = { ...SALA, red: c.redDeLaSala ?? "testnet" };
  const fin = await crearPaso(deps).correr(laSala, ctx);
  const corto = (x: string): string => (x.startsWith("G") && x.length > 12 ? `${x.slice(0, 4)}…${x.slice(-4)}` : x);
  const pintar = (p: PasoDelPuente): string => {
    const linea = lineaDelPaso(p);
    return linea === null ? "sin línea" : sustituir(TEXTOS_SALA_CAMPANA.es[linea.clave] ?? `falta ${linea.clave}`, linea.vars);
  };
  return {
    fin,
    lineas: [
      `fin | ${fin}`,
      ...pasos.map((p) => `paso | ${enTexto(p)} | dice ${pintar(p)}`),
      ...sala.registro.map((r) => `pedido | ${r}`),
      `esperas | ${enTexto(esperas)}`,
      `cuadro | ${enTexto({ lista: cuadro.lista.split("\n").map(corto), premio: cuadro.premio, ganadores: cuadro.ganadores, fijo: cuadro.fijo })}`,
      `etiquetas | ${etiquetas.map((e) => e.replace(/G[A-Z2-7]{55}/gu, corto)).join(" || ")}`,
      `lo que se hizo con el cuadro | ${enTexto(registro)}`,
      `entradas | ${enTexto([...entradas.values()].map((e) => ({ ...e, huella: e.huella.length })))}`,
    ],
  };
}

describe("pasar la lista de cuentas al cuadro, con los pedidos a la sala", () => {
  it("cada caso de hoy termina como termina hoy y anota lo mismo", async () => {
    const lineas: string[] = [];
    for (const caso of CASOS_DE_PASAR) {
      const r = await pasarLaLista(caso);
      expect(r.fin, caso.nombre).toBe(caso.fin);
      lineas.push(...r.lineas.map((l) => `${caso.nombre} | ${l}`));
    }
    escenas["pasar la lista"] = lineas;
  }, 120_000);

  it("con cuatro personas pone en el cuadro la lista de cuentas ordenada, el premio escrito y las etiquetas de personas", async () => {
    const r = await pasarLaLista(CASOS_DE_PASAR[0] as CasoDePasar);
    const cuadro = r.lineas.find((l) => l.startsWith("cuadro | ")) ?? "";
    expect(cuadro).toContain(`"premio":${JSON.stringify(premioParaElCuadro(400000000n))}`);
    expect(cuadro).toContain('"ganadores":1');
    expect(cuadro).toContain('"fijo":true');
    expect(r.lineas.find((l) => l.startsWith("etiquetas | "))).toContain("personas");
    const pedidos = r.lineas.filter((l) => l.startsWith("pedido | "));
    expect(pedidos.filter((l) => l.includes("/equipos") || l.includes("/campana/estado")).every((l) => l.includes("con el token"))).toBe(true);
    expect(pedidos.filter((l) => l.includes("GET /campana ")).every((l) => l.includes("sin token"))).toBe(true);
  });
});

/* ------------------------------------------------------------ lo que la herramienta le cuenta a la sala */

const GANA_UNO = cuentaDePrueba(1);
const GANA_DOS = cuentaDePrueba(2);
const COMPROBANTE = "https://tinkazo.app/verificar.html?x=1";

interface Recorrido {
  lineas: string[];
  pasos: PasoDelPuente[];
}

/** El mundo del resultado con la sala de mentira de verdad: cada pedido de la herramienta pasa por el cliente real de la sala. */
type MundoDelResultado = ReturnType<typeof mundoDelResultado>;

async function conLaSala(
  datos: DatosDeLaSala,
  alMontar?: (m: MundoDelResultado) => void,
): Promise<{ m: MundoDelResultado; sala: Awaited<ReturnType<typeof salaFalsa>>; pasos: PasoDelPuente[]; soltar: () => void }> {
  const m = mundoDelResultado();
  const sala = await salaFalsa(SALA_DEL_RESULTADO.token, datos);
  const dep = { fetch: sala.fetch };
  m.d.ponerSellada = (s, sorteo, plazo) => ponerSellada(s, sorteo, dep, plazo);
  m.d.estado = (s) => estadoConToken(s, dep);
  m.d.guardarResultado = (s, sorteo, comprobante) => guardarResultadoEnSala(s, sorteo, comprobante, dep);
  m.d.resultado = (s) => resultadoDeSala(s, dep);
  m.d.avisar = (s, cuenta) => avisarEnSala(s, cuenta, dep);
  m.d.nombreDe = (cuenta) => (cuenta === GANA_UNO ? "Ana" : cuenta === GANA_DOS ? "Beto" : cuenta);
  m.sellado = { raffleId: 777n, names: [GANA_UNO, GANA_DOS], sinSello: false, round: RONDA };
  if (m.entrada) m.entrada = { ...m.entrada, huella: `${GANA_UNO},${GANA_DOS}`, premios: 2 };
  const pasos: PasoDelPuente[] = [];
  const dejar = alCambiarElPuente(() => void pasos.push(pasoDelPuente()));
  alMontar?.(m);
  return {
    m,
    sala,
    pasos,
    soltar: () => {
      dejar();
      m.detener();
    },
  };
}

const pintado = (p: PasoDelPuente): string => {
  const linea = lineaDelPaso(p);
  return linea === null ? "sin línea" : sustituir(TEXTOS_SALA_CAMPANA.es[linea.clave] ?? `falta ${linea.clave}`, linea.vars);
};

function anotar(nombre: string, x: Awaited<ReturnType<typeof conLaSala>>): string[] {
  const corto = (t: string): string => t.replace(/G[A-Z2-7]{55}/gu, (c) => `${c.slice(0, 4)}…${c.slice(-4)}`);
  return [
    ...x.pasos.map((p) => `${nombre} | paso | ${corto(enTexto(p))} | dice ${pintado(p)}`),
    ...x.sala.registro.map((r) => `${nombre} | pedido | ${corto(r)}`),
    `${nombre} | fases | ${enTexto(x.m.fases)}`,
    `${nombre} | entradas guardadas | ${corto(enTexto(x.m.guardadas.map((e) => ({ ...e, huella: e.huella.length }))))}`,
    `${nombre} | altas | ${corto(enTexto(x.m.altas))}`,
    `${nombre} | soltadas | ${x.m.soltadas}`,
  ];
}

async function recorridoDelResultado(): Promise<Recorrido> {
  const lineas: string[] = [];
  const todos: PasoDelPuente[] = [];
  const resultado = { sorteo: "777", ganadoras: [GANA_DOS, GANA_UNO], comprobante: "/verificar.html?x=1" };

  // El recorrido entero: sellar, que la sala diga que sí, revelar, mandar el resultado, leerlo y avisar a una ganadora.
  {
    const x = await conLaSala({ fase: "cerrada", resultado });
    const quitar = escucharSellos(x.m.d);
    registrarLasAcciones(x.m.d);
    document.dispatchEvent(new CustomEvent("tinkazo:sellado"));
    await sueltaDelResultado(10);
    await alRevelar(Promise.resolve(COMPROBANTE), x.m.d);
    await sueltaDelResultado(10);
    accionesDelPuente().avisarA?.(GANA_DOS);
    await sueltaDelResultado(8);
    quitar();
    lineas.push(...anotar("recorrido entero", x));
    todos.push(...x.pasos);
    x.soltar();
  }

  // Con otra billetera: se ve el resultado pero no se avisa al acceso.
  {
    const x = await conLaSala({ fase: "cerrada", resultado }, (m) => {
      m.otraBilletera = true;
      if (m.entrada) m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"], comprobante: "/verificar.html?x=1", resultado: "pendiente" };
      m.fase = "sellada";
    });
    retomarAlArrancar(x.m.d);
    await sueltaDelResultado(10);
    lineas.push(...anotar("con otra billetera", x));
    todos.push(...x.pasos);
    x.soltar();
  }

  // La sala rechaza el sello porque la lista cambió.
  {
    const x = await conLaSala({ fase: "cerrada", alSellar: { estado: 409, error: "lista-distinta" } });
    const quitar = escucharSellos(x.m.d);
    document.dispatchEvent(new CustomEvent("tinkazo:sellado"));
    await sueltaDelResultado(10);
    quitar();
    lineas.push(...anotar("la sala rechaza el sello", x));
    todos.push(...x.pasos);
    x.soltar();
  }

  // La sala todavía no tiene el resultado: se vuelve a mirar y después se ofrece mandarlo a mano.
  {
    const x = await conLaSala({ fase: "sellada", resultado: "sin" }, (m) => {
      if (m.entrada) m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"] };
      m.fase = "sellada";
    });
    await alRevelar(Promise.resolve(COMPROBANTE), x.m.d);
    await x.m.avanzar(10_000);
    lineas.push(...anotar("sin resultado todavía", x));
    todos.push(...x.pasos);
    x.soltar();
  }

  // Se recargó con el resultado ya guardado: las ganadoras salen de la sala.
  {
    const x = await conLaSala({ fase: "sorteada", resultado }, (m) => {
      if (m.entrada) m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"], comprobante: "/verificar.html?x=1", resultado: "hecho" };
      m.fase = "sorteada";
    });
    retomarAlArrancar(x.m.d);
    await sueltaDelResultado(10);
    lineas.push(...anotar("recargada con el resultado", x));
    todos.push(...x.pasos);
    x.soltar();
  }
  return { lineas, pasos: todos };
}

describe("lo que la herramienta le cuenta a la sala de cuentas, con los pedidos de verdad", () => {
  it("sellar, revelar, mandar el resultado, leerlo y avisar a una ganadora dicen y piden lo de siempre", async () => {
    const r = await recorridoDelResultado();
    escenas["resultado"] = r.lineas;
    const recorrido = r.lineas.filter((l) => l.startsWith("recorrido entero | pedido | "));
    expect(recorrido).toHaveLength(4);
    expect(recorrido[0]).toContain('PUT /campana/fase con el token {"fase":"sellada","sorteo":"777"}');
    expect(recorrido[1]).toContain('PUT /campana/resultado con el token {"sorteo":"777","comprobante":"/verificar.html?x=1"}');
    expect(recorrido[2]).toContain("GET /campana/resultado sin token");
    expect(recorrido[3]).toContain('POST /campana/avisar con el token {"cuenta":"');
    const pasos = r.lineas
      .filter((l) => l.startsWith("recorrido entero | paso | "))
      .map((l) => (JSON.parse(l.split(" | ")[2] ?? "{}") as { paso: string }).paso)
      .filter((paso, i, todos) => paso !== todos[i - 1]);
    expect(pasos).toEqual(["avisando", "avisada", "mandando", "resultado"]);
  }, 120_000);
});

describe("la foto de hoy de una campaña de cuentas", () => {
  it("todo lo anotado sigue escribiéndose igual", () => {
    expect(Object.keys(escenas).sort()).toEqual(
      [
        "panel con cobro",
        "panel con cobro sin saldo",
        "panel sin cobro",
        "pasar la lista",
        "puente con el sorteo hecho",
        "puente con la lista cerrada",
        "puente con la lista sellada",
        "resultado",
      ].sort(),
    );
    compararConLaFoto(FOTO, "campana-cuenta-foto", escenas);
  });
});
