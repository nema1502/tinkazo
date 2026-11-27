import "../version-nueva";
import { initialLang } from "../idioma";
import type { Lang } from "../idioma";
import { enNavegadorDeApp } from "../navegador";
import { hayPasskeys } from "../stellar/passkey";
import type { Cobro } from "./cobro";
import { ANFITRIONES_PERMITIDOS } from "./en-el-build";
import { pantallaDe, type Aparato, type Estado } from "./estados";
import type { Flujo, DatosDeEstado } from "./flujo";
import type { Medidas } from "./medidas";
import { texto } from "./textos";

/**
 * La página de la prueba de la llave. Pinta una pantalla por estado (`estados.ts`) y reparte los botones. Primero mira si
 * el anfitrión está en la lista cerrada: si no, pinta que la prueba no está acá y no baja nada más. El kit y todo el recorrido
 * se piden con `import()` recién cuando hacen falta.
 *
 * Expone `window.__pruebaLlave`, solo de lectura, para el recorrido automático.
 */

const lang: Lang = initialLang();
document.documentElement.lang = lang;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`falta #${id}`);
  return el as T;
}

const elTitulo = $<HTMLElement>("titulo");
const elLinea = $<HTMLElement>("linea");
const elPrincipal = $<HTMLButtonElement>("principal");
const elSecundario = $<HTMLButtonElement>("secundario");
const elCopiado = $<HTMLElement>("copiado");
const elCostos = $<HTMLDetailsElement>("costos");

let flujo: Flujo | null = null;
let estadoActual: Estado = "cargando";
/** La página abrió con `?modo=premio`: el plegado de costos muestra recibir y mandar, no sellar y sortear. */
let modoPremio = false;
let temporizador: ReturnType<typeof setTimeout> | undefined;

const aparato = (): Aparato => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "cel" : "compu");

/** Lo que lee el recorrido automático: nada se escribe desde afuera. */
Object.defineProperty(window, "__pruebaLlave", {
  configurable: true,
  value: Object.freeze({
    get estado(): Estado {
      return estadoActual;
    },
    get medidas(): Medidas | null {
      return flujo?.medidas ?? null;
    },
    get enlace(): string {
      return flujo?.enlace ?? "";
    },
    get error(): string {
      return flujo?.error ?? "";
    },
    get conFoco(): boolean {
      return flujo?.conFoco ?? true;
    },
    /** La dirección de la cuenta con la que se entró: lo único que se muestra de la conexión. */
    get contractId(): string {
      return flujo?.contractId ?? "";
    },
  }),
});

/* ------------------------------------------------------------------ el plegado de costos */

function xlm(stroops: number): string {
  return `${(stroops / 10_000_000).toFixed(7)} XLM`;
}

function fila(tabla: HTMLTableSectionElement, etiqueta: string, valor: string): void {
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = etiqueta;
  const td = document.createElement("td");
  td.className = "n";
  td.textContent = valor;
  tr.append(th, td);
  tabla.append(tr);
}

function pintarCostos(m: Medidas | null, codigo: string | undefined): void {
  const pasos: Array<[string, { cobro: Cobro | null } | null]> = !m
    ? []
    : modoPremio
      ? [
          [texto(lang, "costosCrear"), m.cuenta],
          [texto(lang, "costosRecibir"), m.premio],
          [texto(lang, "costosMandar"), m.envios.at(-1) ?? null],
        ]
      : [
          [texto(lang, "costosCrear"), m.cuenta],
          [texto(lang, "costosSellar"), m.sello],
          [texto(lang, "costosSortear"), m.sorteo],
        ];
  const hayAlgo = pasos.some(([, p]) => p !== null) || !!codigo;
  elCostos.hidden = !hayAlgo;
  elCostos.replaceChildren();
  if (!hayAlgo) return;
  const resumen = document.createElement("summary");
  resumen.textContent = texto(lang, "costosTitulo");
  elCostos.append(resumen);
  for (const [nombre, paso] of pasos) {
    const h = document.createElement("p");
    h.textContent = nombre;
    h.style.fontWeight = "600";
    h.style.margin = "12px 0 0";
    elCostos.append(h);
    if (!paso || !paso.cobro) {
      const vacio = document.createElement("p");
      vacio.textContent = texto(lang, "costosSinDatos");
      vacio.style.margin = "0";
      elCostos.append(vacio);
      continue;
    }
    const c = paso.cobro;
    const tabla = document.createElement("table");
    const cuerpo = document.createElement("tbody");
    fila(cuerpo, texto(lang, "costosTotal"), xlm(c.totalStroops));
    fila(cuerpo, texto(lang, "costosInclusion"), xlm(c.inclusionStroops));
    fila(cuerpo, texto(lang, "costosRecursos"), xlm(c.recursosNoReembolsables + c.recursosReembolsables - c.alquiler));
    fila(cuerpo, texto(lang, "costosAlquiler"), xlm(c.alquiler));
    fila(cuerpo, texto(lang, "costosInstrucciones"), String(c.declarado.instrucciones));
    fila(cuerpo, texto(lang, "costosBytes"), String(c.declarado.bytesEscritos));
    tabla.append(cuerpo);
    elCostos.append(tabla);
  }
  const nota = document.createElement("p");
  nota.textContent = texto(lang, "costosNota");
  elCostos.append(nota);
  if (codigo) {
    const p = document.createElement("p");
    p.textContent = `${texto(lang, "fallaCodigo")}: ${codigo}`;
    elCostos.append(p);
  }
}

/* ------------------------------------------------------------------ pintar una pantalla */

function pintar(estado: Estado, datos: DatosDeEstado = {}): void {
  estadoActual = estado;
  const p = pantallaDe(
    estado,
    {
      aparato: aparato(),
      cancelada: datos.cancelada === true,
      ...(datos.ganador !== undefined ? { ganador: datos.ganador } : {}),
      ...(datos.monto !== undefined ? { monto: datos.monto } : {}),
      ...(datos.fin !== undefined ? { fin: datos.fin } : {}),
      ...(datos.direccion !== undefined ? { direccion: datos.direccion } : {}),
      ...(datos.nota !== undefined ? { nota: datos.nota } : {}),
      ...(datos.recibido !== undefined ? { recibido: datos.recibido } : {}),
      ...(datos.destinoDelEnlace !== undefined ? { destinoDelEnlace: datos.destinoDelEnlace } : {}),
      ...(datos.notaEnvio !== undefined ? { notaEnvio: datos.notaEnvio } : {}),
      ...(datos.yaEnviadas !== undefined ? { yaEnviadas: datos.yaEnviadas } : {}),
    },
    lang,
  );
  elTitulo.textContent = p.titulo;
  // Las líneas son constantes de textos.ts: nunca llevan texto de afuera.
  elLinea.innerHTML = p.linea;
  const boton = (el: HTMLButtonElement, b: { texto: string; accion: string } | undefined): void => {
    el.hidden = !b;
    if (b) {
      el.textContent = b.texto;
      el.dataset["accion"] = b.accion;
    } else {
      el.textContent = "";
      delete el.dataset["accion"];
    }
  };
  boton(elPrincipal, p.principal);
  boton(elSecundario, p.secundario);
  elCopiado.textContent = "";
  pintarCostos(flujo?.medidas ?? null, datos.codigo);
  clearTimeout(temporizador);
  if (p.topeMs !== undefined) {
    temporizador = setTimeout(() => {
      if (flujo) flujo.alTope(estado);
    }, p.topeMs);
  }
}

/* ------------------------------------------------------------------ las acciones */

async function copiarEnlace(): Promise<void> {
  try {
    await navigator.clipboard.writeText(location.href);
    elCopiado.textContent = texto(lang, "enlaceCopiado");
  } catch {
    elCopiado.textContent = location.href;
  }
}

async function hacer(accion: string): Promise<void> {
  if (accion === "copiar") return copiarEnlace();
  if (accion === "ir") {
    location.href = "/";
    return;
  }
  if (accion === "sin-destino") {
    // La misma página en el modo premio, sin destino ni nota: nadie edita un enlace a mano.
    const { rutaSinDestino } = await import("./destino");
    location.href = rutaSinDestino(location.pathname, location.search);
    return;
  }
  const f = flujo;
  if (!f) {
    if (accion === "empezar") location.reload();
    return;
  }
  switch (accion) {
    case "crear":
    case "crear-otra":
      return f.crear();
    case "ya-tengo":
    case "reintentar-entrar":
      return f.entrar();
    case "usar":
      return f.usarLlave();
    case "probar-aca":
    case "probar-igual":
    case "empezar":
      f.empezar();
      return;
    case "ya-lo-puse":
      return iniciarFlujo(f);
    case "sellar":
      return f.sellar();
    case "rehacer-cuenta":
      return f.rehacerCuenta();
    case "reintentar":
    case "sortear":
      return f.reintentar();
    case "mirar":
      return f.mirar();
    case "mandar":
      return f.mandar();
    case "costos":
      elCostos.open = true;
      elCostos.scrollIntoView({ block: "center" });
      return;
    case "comprobante":
    case "comprobar":
      if (f.enlace) window.open(f.enlace, "_blank", "noopener");
      return;
    case "otro":
      f.nuevoSorteo();
      return;
    default:
      return;
  }
}

for (const boton of [elPrincipal, elSecundario]) {
  boton.addEventListener("click", () => {
    const accion = boton.dataset["accion"];
    if (accion) void hacer(accion);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") flujo?.alVolver();
});

/* ------------------------------------------------------------------ el arranque */

async function conBloqueo(): Promise<boolean | null> {
  try {
    if (typeof PublicKeyCredential === "undefined" || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return null;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return null;
  }
}

async function iniciarFlujo(f: Flujo): Promise<void> {
  await f.iniciar({
    host: location.hostname,
    hayPasskeys: hayPasskeys(),
    enApp: enNavegadorDeApp(navigator.userAgent),
    conBloqueo: await conBloqueo(),
    punteroGrueso: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  });
}

/** Con `?fuente=historial` o `?fuente=rpc` la cuenta se busca solo ahí. Cualquier otro valor se ignora. Sirve para probar cada fuente. */
function fuenteDeLaBusqueda(): "historial" | "rpc" | null {
  const f = new URLSearchParams(location.search).get("fuente");
  return f === "historial" || f === "rpc" ? f : null;
}

function almacenDelNavegador(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function arrancar(): Promise<void> {
  pintar("cargando");
  if (!ANFITRIONES_PERMITIDOS(location.hostname)) {
    pintar("no-es-aca");
    return;
  }
  if (!hayPasskeys()) {
    pintar("sin-llaves");
    return;
  }
  try {
    // El modo premio se lee de la dirección antes de bajar el kit: un enlace mal escrito no pide nada.
    const { leerPedidoDePremio, pideNota } = await import("./destino");
    const pedido = leerPedidoDePremio(location.search);
    if (!pedido.ok) {
      pintar("enlace-mal", { codigo: pedido.motivo });
      return;
    }
    modoPremio = pedido.premio !== null;
    const [{ Flujo }, { abrirKit }, { RpcDePrueba }, { crearPagador }, { fetchRound }, { decompressG1 }] = await Promise.all([
      import("./flujo"),
      import("./puente-kit"),
      import("./rpc"),
      import("./pagador"),
      import("../protocol/quicknet"),
      import("../protocol/drand"),
    ]);
    const rpc = new RpcDePrueba();
    const f = new Flujo({
      puente: abrirKit({ nombreVisible: texto(lang, "nombreDeLaLlave"), fuente: fuenteDeLaBusqueda() }),
      rpc,
      crearPagador: () => crearPagador({ secuencia: (g) => rpc.secuencia(g) }),
      ahoraS: () => Math.floor(Date.now() / 1000),
      ahoraMs: () => Date.now(),
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
      traerRonda: async (ronda) => (await fetchRound(ronda)).signature,
      aFirma96: async (firma48) => decompressG1(firma48),
      hayFoco: () => document.hasFocus(),
      almacen: almacenDelNavegador(),
      origen: location.origin,
      ...(pedido.premio ? { premio: pedido.premio, pideNota: (cuenta: string) => pideNota(cuenta) } : {}),
    });
    flujo = f;
    f.onEstado((estado, datos) => pintar(estado, datos));
    await iniciarFlujo(f);
  } catch (e) {
    console.error("prueba-llave: no se pudo cargar", e);
    pintar("falla", { codigo: "carga" });
  }
}

void arrancar();
