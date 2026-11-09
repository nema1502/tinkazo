import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app } from "../state";
import { enStand } from "../ensayo-modo";
import { descifrarNombre } from "../sala/cifra";
import { type EstadoDeConexion, type Sala, cerrarSala, crearSala, enlaceDeSala, escucharSala, quitarNombreEnSala } from "../sala/cliente";
import { revisarNombre } from "../sala/filtro";
import { pintarQr, precargarQr } from "./qr";
import { setList } from "./participants";
import { alSalirDelStand, nombresParaLaSiguiente } from "./stand";

/**
 * La sala por QR, en la pantalla del stand: la gente escanea, escribe su nombre
 * en el celular y aparece acá, en la lista de la ronda de ejemplo.
 *
 * Solo alimenta rondas de ejemplo (modo stand): estos nombres nunca van a un
 * sorteo sellado ni a un comprobante. La clave que descifra los nombres la
 * genera esta pestaña y viaja solo en el QR, después del `#`; el servicio
 * (`workers/sala`) guarda bytes que no puede leer. Si no hay señal para crear la
 * sala, o se cae a media feria, el stand sigue escribiendo los nombres en la
 * compu, que es lo que dice el aviso.
 *
 * La sala vive en la pestaña (`sessionStorage`): si la pantalla se recarga,
 * vuelve a pedir los nombres cifrados y sigue. Cerrar la pestaña no cierra la
 * sala: se apaga sola a las 10 h, o con «Cerrar la sala».
 */

const CLAVE = "tinkazo.sala";

interface Entrada {
  nombre: string;
  estado: "ok" | "revisar";
  /** Igual a un nombre que ya estaba: espera en «Para revisar». */
  repetido?: boolean;
  /** La línea que ocupaba en la lista al quitarlo: si no se pudo quitar de verdad, vuelve a su lugar. */
  lugar?: number;
  /** Ya está en la lista de la ronda de ahora (o en la que se jugó). Si no, entra a la que sigue. */
  puesta: boolean;
}

let sala: Sala | null = null;
const entradas = new Map<number, Entrada>();
/** Los que quien atiende dejó pasar con «Mostrar»: sobreviven a una recarga. */
const dejados = new Set<number>();
/** Nombres que se quitaron estando ya en la ronda que se jugó: no entran a la siguiente. */
let quitadosDeLaRonda: string[] = [];
let escucha: { parar: () => void } | null = null;
let estadoRed: EstadoDeConexion = "conectando";
let mensaje = "";
/** Los que llegaron y esta pantalla no pudo descifrar: de otra clave, o basura. */
const ilegibles = new Set<number>();
/** Con más ilegibles que esto, alguien está llenando la sala: se avisa que conviene abrir otra. */
const TOPE_ILEGIBLES = 20;

function guardar(): void {
  try {
    if (sala) sessionStorage.setItem(CLAVE, JSON.stringify({ sala, dejados: [...dejados] }));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento, la sala dura lo que la página */
  }
}

function leerGuardada(): { sala: Sala; dejados: number[] } | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null") as { sala?: Sala; dejados?: number[] } | null;
    if (!x?.sala || typeof x.sala.id !== "string" || typeof x.sala.token !== "string" || typeof x.sala.clave !== "string") return null;
    if (x.sala.vence && x.sala.vence < Date.now()) return null;
    return { sala: x.sala, dejados: Array.isArray(x.dejados) ? x.dejados : [] };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- la lista */

/** La lista de la ronda es el cuadro de texto. Sellada, no se toca: lo que llegue espera a la que sigue. */
function agregarALista(e: Entrada): void {
  if (app.frozen || e.puesta) return;
  const ta = $<HTMLTextAreaElement>("ta");
  const lugar = e.lugar;
  e.lugar = undefined;
  if (lugar !== undefined && ta.value.trim()) {
    const lineas = ta.value.replace(/\s+$/, "").split("\n");
    if (lugar <= lineas.length) {
      lineas.splice(lugar, 0, e.nombre);
      setList(lineas.join("\n"));
      e.puesta = true;
      return;
    }
  }
  setList(ta.value.replace(/\s+$/, "") + (ta.value.trim() ? "\n" : "") + e.nombre);
  e.puesta = true;
}

/** El nombre sin distinguir mayúsculas ni espacios de más. */
function clave(nombre: string): string {
  return nombre.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function quitarDeLaLista(nombre: string): number | undefined {
  const ta = $<HTMLTextAreaElement>("ta");
  const lineas = ta.value.split("\n");
  const i = lineas.findIndex((l) => l.trim() === nombre);
  if (i < 0) return undefined;
  lineas.splice(i, 1);
  setList(lineas.join("\n"));
  return i;
}

/** Lo que cambia en la lista cuando termina una ronda y empieza otra: los que se quitaron salen, los que llegaron entran. */
function paraLaSiguiente(): { quitar: string[]; sumar: string[] } {
  const sumar: string[] = [];
  for (const e of entradas.values()) {
    if (e.estado === "ok" && !e.puesta) {
      sumar.push(e.nombre);
      e.puesta = true;
    }
  }
  const quitar = quitadosDeLaRonda;
  quitadosDeLaRonda = [];
  return { quitar, sumar };
}

/* ---------------------------------------------------------- los nombres */

async function llego(n: number, dato: string): Promise<void> {
  const s = sala;
  if (!s || entradas.has(n)) return;
  const claro = await descifrarNombre(s.clave, dato);
  // Se cerró la sala mientras se descifraba: no hay a quién avisarle.
  if (sala !== s) return;
  if (claro === null) {
    // De otra clave, o roto: no se muestra, y tampoco queda ocupando un lugar de los 400 de la sala.
    ilegibles.add(n);
    void quitarNombreEnSala(s, n);
    if (ilegibles.size > TOPE_ILEGIBLES) pintar();
    return;
  }
  const v = revisarNombre(claro);
  if (v.estado === "descartar") {
    // Un enlace, un nombre vacío o de más de 40 caracteres: no se muestra, y tampoco queda en el objeto.
    void quitarNombreEnSala(s, n);
    return;
  }
  const k = clave(v.nombre);
  const repetido = !dejados.has(n) && [...entradas.values()].some((x) => clave(x.nombre) === k);
  const e: Entrada = { nombre: v.nombre, estado: (v.estado === "revisar" || repetido) && !dejados.has(n) ? "revisar" : "ok", puesta: false, repetido };
  entradas.set(n, e);
  if (e.estado === "ok") agregarALista(e);
  pintar();
}

function alQuitado(n: number): void {
  const e = entradas.get(n);
  if (!e) return;
  entradas.delete(n);
  dejados.delete(n);
  if (e.puesta) {
    if (app.frozen) quitadosDeLaRonda.push(e.nombre);
    else e.lugar = quitarDeLaLista(e.nombre);
  }
  pintar();
}

async function quitar(n: number): Promise<void> {
  if (!sala) return;
  const e = entradas.get(n);
  if (!e) return;
  // En la pantalla enseguida; en el objeto, apenas conteste. Si no contesta, el nombre queda cifrado hasta que la sala se cierre.
  const s = sala;
  const estaba = { dejado: dejados.has(n) };
  alQuitado(n);
  const bien = await quitarNombreEnSala(s, n);
  if (bien) {
    if (mensaje === t("standSalaErrQuitar")) {
      mensaje = "";
      pintar();
    }
    return;
  }
  if (sala !== s) return;
  // No se pudo sacar del objeto: si no, volvería a aparecer al recargar. Se muestra de nuevo, y se avisa.
  if (e.puesta && app.frozen) {
    const i = quitadosDeLaRonda.lastIndexOf(e.nombre);
    if (i >= 0) quitadosDeLaRonda.splice(i, 1);
    else e.puesta = false;
  } else {
    e.puesta = false;
  }
  entradas.set(n, e);
  if (estaba.dejado) {
    dejados.add(n);
    guardar();
  }
  if (e.estado === "ok") agregarALista(e);
  mensaje = t("standSalaErrQuitar");
  pintar();
}

function mostrar(n: number): void {
  const e = entradas.get(n);
  if (!e || e.estado === "ok") return;
  e.estado = "ok";
  dejados.add(n);
  guardar();
  agregarALista(e);
  pintar();
}

/* ------------------------------------------------------------ la sala */

function empezarAEscuchar(s: Sala, vistos: number[] = []): void {
  escucha?.parar();
  estadoRed = "conectando";
  escucha = escucharSala(
    s,
    {
      alNombre: (n, d) => void llego(n, d),
      alQuitado: alQuitado,
      alEstado: (e) => {
        estadoRed = e;
        pintar();
      },
      alCerrada: () => {
        // Venció (10 h) o la cerró otra pestaña: no hay más que escuchar.
        mensaje = t("standSalaVencida");
        olvidar();
        pintar();
      },
    },
    {},
    vistos,
  );
}

function olvidar(): void {
  escucha?.parar();
  escucha = null;
  sala = null;
  dejados.clear();
  ilegibles.clear();
  guardar();
}

async function crear(): Promise<void> {
  const boton = $<HTMLButtonElement>("sala-crear");
  boton.disabled = true;
  mensaje = t("standSalaCreando");
  pintar();
  void precargarQr();
  try {
    sala = await crearSala();
    mensaje = "";
    guardar();
    empezarAEscuchar(sala);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "otro";
    mensaje = t(motivo === "red" ? "standSalaErrRed" : motivo === "cupo-ip" ? "standSalaErrCupoIp" : motivo === "cupo-dia" ? "standSalaErrCupoDia" : "standSalaErrOtro");
  }
  boton.disabled = false;
  pintar();
}

async function cerrar(): Promise<void> {
  const s = sala;
  if (!s) return;
  $<HTMLButtonElement>("sala-cerrar").disabled = true;
  const bien = await cerrarSala(s);
  $<HTMLButtonElement>("sala-cerrar").disabled = false;
  if (!bien) {
    mensaje = t("standSalaErrCerrar");
    pintar();
    return;
  }
  // Los nombres que ya están en la lista de la ronda se quedan: son de esta ronda. Lo que no, se va con la sala.
  entradas.clear();
  olvidar();
  mensaje = t("standSalaCerradaMsg");
  pintar();
}

/* ------------------------------------------------------------- la vista */

let qrDe = "";
let ultimoAviso = "";

function pintar(): void {
  const panel = document.getElementById("stand-sala");
  if (!panel) return;
  const abierta = sala !== null;
  $("sala-cerrada").hidden = abierta;
  $("sala-abierta").hidden = !abierta;
  const error = $("sala-error");
  const aviso = mensaje || (sala && ilegibles.size > TOPE_ILEGIBLES ? t("standSalaIlegibles") : "");
  error.textContent = aviso;
  error.hidden = !aviso;
  // Un aviso nuevo se trae al centro de la vista: arriba lo tapa la cabecera y la banda fija del stand, y abajo puede quedar fuera.
  if (aviso && aviso !== ultimoAviso) error.scrollIntoView({ block: "center" });
  ultimoAviso = aviso;
  if (!sala) {
    qrDe = "";
    return;
  }
  const enlace = enlaceDeSala(sala);
  if (qrDe !== enlace) {
    qrDe = enlace;
    const img = $<HTMLImageElement>("sala-qr-img");
    // 300 px: se lee a 2 m con la pantalla en la mesa, y "Ver el QR en grande" lo lleva a toda la pantalla.
    void pintarQr(img, enlace, 300);
  }
  $("sala-estado").textContent = t(estadoRed === "en-vivo" ? "standSalaEnVivo" : estadoRed === "sondeo" ? "standSalaSondeo" : "standSalaConectando");
  $("sala-estado").dataset.estado = estadoRed;
  const ok = [...entradas.entries()].filter(([, e]) => e.estado === "ok");
  const revisar = [...entradas.entries()].filter(([, e]) => e.estado === "revisar");
  $("sala-cuenta").textContent = ok.length === 1 ? t("standSalaCuenta1") : ok.length ? t("standSalaCuentaN").replace("{n}", String(ok.length)) : t("standSalaVacia");
  fila($("sala-nombres"), ok, "standSalaQuitar", (n) => void quitar(n));
  const rev = $("sala-revisar");
  rev.hidden = revisar.length === 0;
  fila($("sala-revisar-lista"), revisar, "standSalaQuitar", (n) => void quitar(n), "standSalaMostrar", mostrar);
}

/** Una lista de nombres con un botón por nombre (y otro, si hace falta). Los nombres van con `textContent`: nunca como HTML. */
function fila(ul: HTMLElement, items: [number, Entrada][], claveQuitar: string, alQuitar: (n: number) => void, claveMostrar?: string, alMostrar?: (n: number) => void): void {
  const nuevo = document.createDocumentFragment();
  for (const [n, e] of items) {
    const li = document.createElement("li");
    const nombre = document.createElement("span");
    nombre.className = "ss-nombre";
    nombre.textContent = e.nombre;
    li.append(nombre);
    if (e.repetido) {
      const r = document.createElement("em");
      r.className = "ss-rep";
      r.textContent = t("standSalaRepetido");
      li.append(r);
    }
    if (claveMostrar && alMostrar) {
      const m = document.createElement("button");
      m.type = "button";
      m.className = "mini";
      m.textContent = t(claveMostrar);
      m.setAttribute("aria-label", `${t(claveMostrar)}: ${e.nombre}`);
      m.addEventListener("click", () => alMostrar(n));
      li.append(m);
    }
    const q = document.createElement("button");
    q.type = "button";
    q.className = "mini";
    q.textContent = t(claveQuitar);
    q.setAttribute("aria-label", `${t(claveQuitar)}: ${e.nombre}`);
    q.addEventListener("click", () => alQuitar(n));
    li.append(q);
    nuevo.append(li);
  }
  ul.replaceChildren(nuevo);
}

/** Se llama una vez, con la herramienta armada. */
export function initStandSala(): void {
  $("sala-crear").addEventListener("click", () => void crear());
  $("sala-cerrar").addEventListener("click", () => void cerrar());
  $("sala-grande").addEventListener("click", () => {
    const panel = $("stand-sala");
    const grande = panel.classList.toggle("grande");
    $("sala-grande").textContent = t(grande ? "standSalaGrandeCerrar" : "standSalaGrande");
    $("sala-grande").setAttribute("aria-expanded", String(grande));
  });
  nombresParaLaSiguiente(paraLaSiguiente);
  alSalirDelStand(async () => {
    // «Hacer un sorteo de verdad»: la sala se cierra y se borra lo que tenía, sin esperar más de un instante.
    if (!sala) return true;
    const bien = await Promise.race([cerrarSala(sala), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (bien) {
      olvidar();
      return true;
    }
    // No se pudo: la sala y su llave se quedan (se borra sola a las 10 horas) y se avisa.
    mensaje = t("standSalaErrSalir");
    pintar();
    return false;
  });
  onLangChange(() => {
    $("sala-grande").textContent = t($("stand-sala").classList.contains("grande") ? "standSalaGrandeCerrar" : "standSalaGrande");
    pintar();
  });
  // La sala sigue donde estaba si se recargó la pantalla en el modo stand.
  document.addEventListener("tinkazo:stand", () => {
    const g = leerGuardada();
    if (!g || sala) return;
    sala = g.sala;
    for (const n of g.dejados) dejados.add(n);
    empezarAEscuchar(sala);
    pintar();
  });
  if (enStand()) pintar();
}
