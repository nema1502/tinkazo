import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app } from "../state";
import { enStand } from "../ensayo-modo";
import { descifrarNombre } from "../sala/cifra";
import { type EstadoDeConexion, type Sala, cerrarSala, crearSala, enlaceDeSala, escucharSala, quitarNombreEnSala } from "../sala/cliente";
import { revisarNombre } from "../sala/filtro";
import { pintarQr, precargarQr } from "./qr";
import { parseNames, setList } from "./participants";
import {
  alAvisarEnStand,
  alPreguntarPorElQr,
  alSalirDelStand,
  nombresParaLaSiguiente,
  otraRonda,
  repintarGuia,
  soltarResultadoDelStand,
} from "./stand";

/**
 * La sala por QR, en la pantalla del stand: la gente escanea, escribe su nombre
 * en el celular y aparece acá, en la lista de la ronda de ejemplo.
 *
 * Para anotarse no hace falta nada, y estos nombres solo alimentan rondas de
 * ejemplo (modo stand): nunca van a un sorteo sellado ni a un comprobante. El
 * registro de equipos con cupón, donde sí hace falta la cuenta de quien anota
 * a su equipo, se lleva en `equipos-sala.ts`. La clave que descifra los nombres la
 * genera esta pestaña y viaja solo en el QR, después del `#`; el servicio
 * (`workers/sala`) guarda bytes que no puede leer. Si no hay señal para crear la
 * sala, o se cae a media feria, el stand sigue escribiendo los nombres en la
 * compu, que es lo que dice el aviso.
 *
 * La sala vive en la pestaña (`sessionStorage`): si la pantalla se recarga,
 * vuelve a pedir los nombres cifrados y sigue. Cerrar la pestaña no cierra la
 * sala: se apaga sola a las 10 h, o con Cerrar el QR.
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
/** El QR que se está cerrando: ya no se ve ni se escucha, y se cierra de verdad cuando vence su Deshacer. */
let cerrando: Sala | null = null;
/** Ya hubo un QR en esta pantalla: el botón para armar otro dice Armar otro QR. */
let yaHuboQr = false;
const entradas = new Map<number, Entrada>();
/** Los que quien atiende dejó pasar con «Mostrar»: sobreviven a una recarga. */
const dejados = new Set<number>();
/** Nombres que se quitaron estando ya en la ronda que se jugó: no entran a la siguiente. */
let quitadosDeLaRonda: string[] = [];
/** Llegadas que todavía no entraron al cuadro: sobreviven al cierre del QR y esperan la ronda siguiente. */
let pendientesDeLaSiguiente: string[] = [];
let escucha: { parar: () => void } | null = null;
let estadoRed: EstadoDeConexion = "conectando";
let mensaje = "";
/** Los que llegaron y esta pantalla no pudo descifrar: de otra clave, o basura. */
const ilegibles = new Set<number>();
/** Quitados que todavía pueden estar esperando el descifrado: no vuelven a entrar al terminar. */
const quitados = new Set<number>();
/** Los de una tanda anterior (Empezar con gente nueva): si su número vuelve a llegar, por ejemplo al recargar, no entra. */
const archivados = new Set<number>();
/** Nombres que ya estaban en el cuadro al volver a una sala: cada renglón se come una sola llegada, para no repetirlo. */
const yaEnElCuadro = new Map<string, number>();
/** Con más ilegibles que esto, alguien está llenando la sala: se avisa que conviene abrir otra. */
const TOPE_ILEGIBLES = 20;

function guardar(): void {
  try {
    if (sala) sessionStorage.setItem(CLAVE, JSON.stringify({ sala, dejados: [...dejados], archivados: [...archivados] }));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento, la sala dura lo que la página */
  }
}

function leerGuardada(): { sala: Sala; dejados: number[]; archivados: number[] } | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null") as {
      sala?: Sala;
      dejados?: number[];
      archivados?: number[];
    } | null;
    if (!x?.sala || typeof x.sala.id !== "string" || typeof x.sala.token !== "string" || typeof x.sala.clave !== "string") return null;
    if (x.sala.vence && x.sala.vence < Date.now()) return null;
    return {
      sala: x.sala,
      dejados: Array.isArray(x.dejados) ? x.dejados : [],
      archivados: Array.isArray(x.archivados) ? x.archivados : [],
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- la lista */

/** La lista de la ronda es el cuadro de texto. Sellada, no se toca: lo que llegue espera a la que sigue. */
function agregarALista(e: Entrada): void {
  if (app.frozen || e.puesta) return;
  // Ya estaba en el cuadro (se volvió a la sala): se marca puesta y no se repite.
  const ya = yaEnElCuadro.get(e.nombre) ?? 0;
  if (ya > 0) {
    yaEnElCuadro.set(e.nombre, ya - 1);
    e.lugar = undefined;
    e.puesta = true;
    return;
  }
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

/** Guarda las llegadas que aún no tienen renglón, sin repetir un nombre ya reservado para la ronda siguiente. */
function juntarPendientes(): void {
  const vistos = new Set(pendientesDeLaSiguiente.map(clave));
  for (const e of entradas.values()) {
    if (e.estado !== "ok" || e.puesta) continue;
    const k = clave(e.nombre);
    if (!vistos.has(k)) pendientesDeLaSiguiente.push(e.nombre);
    vistos.add(k);
    e.puesta = true;
  }
}

/** Lo que cambia en la lista cuando termina una ronda y empieza otra: los que se quitaron salen, los que llegaron entran. */
function paraLaSiguiente(): { quitar: string[]; sumar: string[] } {
  juntarPendientes();
  const sumar = pendientesDeLaSiguiente;
  pendientesDeLaSiguiente = [];
  const quitar = quitadosDeLaRonda;
  quitadosDeLaRonda = [];
  return { quitar, sumar };
}

/* ---------------------------------------------------------- los nombres */

async function llego(n: number, dato: string): Promise<void> {
  const s = sala;
  if (!s || entradas.has(n) || archivados.has(n)) return;
  const claro = await descifrarNombre(s.clave, dato);
  // Se cerró la sala o quitaron este número mientras se descifraba: no hay nada que agregar.
  if (sala !== s || quitados.has(n)) return;
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
  quitados.add(n);
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

/** Quitar un nombre: sale de las fichas y de la lista enseguida, y de la sala a los cinco segundos, salvo Deshacer. */
function quitar(n: number): void {
  const s = sala;
  const e = entradas.get(n);
  if (!s || !e) return;
  const dejado = dejados.has(n);
  alQuitado(n);
  ofrecerDeshacer(
    t("standSalaQuitado").replace("{nombre}", e.nombre),
    () => reponer(n, e, dejado),
    () => void quitarDeVerdad(s, n, e, dejado),
  );
}

/** Vuelve a poner un nombre que se había quitado: en las fichas y, si estaba, en su renglón de la lista. */
function reponer(n: number, e: Entrada, dejado: boolean): void {
  quitados.delete(n);
  if (e.puesta && app.frozen) {
    const i = quitadosDeLaRonda.lastIndexOf(e.nombre);
    if (i >= 0) quitadosDeLaRonda.splice(i, 1);
    else e.puesta = false;
  } else {
    e.puesta = false;
  }
  entradas.set(n, e);
  if (dejado) {
    dejados.add(n);
    guardar();
  }
  if (e.estado === "ok") agregarALista(e);
}

/** Saca el nombre de la sala. Si no se puede, vuelve a la lista y se avisa: si no, aparecería de nuevo al recargar. */
async function quitarDeVerdad(s: Sala, n: number, e: Entrada, dejado: boolean): Promise<void> {
  const bien = await quitarNombreEnSala(s, n);
  if (bien) {
    if (mensaje === t("standSalaErrQuitar")) {
      mensaje = "";
      pintar();
    }
    return;
  }
  if (sala !== s) return;
  reponer(n, e, dejado);
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

/* ------------------------------------------------------------ deshacer */

/** Cuánto dura la oferta de Deshacer. */
const DESHACER_MS = 5_000;

/** Lo último que se puede deshacer: qué se dice, cómo se vuelve atrás y qué se hace si nadie lo deshace. */
interface Deshacible {
  texto: string;
  volver: () => void;
  confirmar: () => void;
  reloj: number;
}

let deshacible: Deshacible | null = null;

/** Ofrece Deshacer por cinco segundos. Si había otra oferta, esa se confirma ahora: solo se deshace lo último. */
function ofrecerDeshacer(texto: string, volver: () => void, confirmar: () => void = () => undefined): void {
  confirmarYa();
  const reloj = window.setTimeout(confirmarYa, DESHACER_MS);
  deshacible = { texto, volver, confirmar, reloj };
  pintarDeshacer();
}

/** Lo que estaba en oferta pasa a ser definitivo, sin esperar. */
function confirmarYa(): void {
  const d = deshacible;
  if (!d) return;
  deshacible = null;
  window.clearTimeout(d.reloj);
  d.confirmar();
  pintarDeshacer();
}

/** Descarta la oferta sin deshacer ni confirmar: la página se va y lo que importa se hace aparte. */
function olvidarOferta(): void {
  if (deshacible) window.clearTimeout(deshacible.reloj);
  deshacible = null;
  pintarDeshacer();
}

/** Deshacer: vuelve atrás lo último, que ya no se confirma. */
function deshacer(): void {
  const d = deshacible;
  if (!d) return;
  deshacible = null;
  window.clearTimeout(d.reloj);
  d.volver();
  pintarDeshacer();
  pintar();
}

/** La línea de Deshacer, debajo de los avisos de la sala. */
function pintarDeshacer(): void {
  const linea = document.getElementById("sala-deshacer");
  const texto = document.getElementById("sala-deshacer-t");
  if (!linea || !texto) return;
  texto.textContent = deshacible?.texto ?? "";
  linea.hidden = deshacible === null;
  // Mientras se puede deshacer, esa es la única acción de la tarjeta: no se arma otro QR por un toque accidental.
  const crear = document.getElementById("sala-crear");
  if (crear) crear.hidden = deshacible !== null;
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
        // La absorción solo evita repetir lo recuperado. Con la escucha en vivo, una llegada nueva siempre escribe su renglón.
        if (e === "en-vivo") yaEnElCuadro.clear();
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
  archivados.clear();
  ilegibles.clear();
  quitados.clear();
  yaEnElCuadro.clear();
  pendientesDeLaSiguiente = [];
  guardar();
}

/** Cuenta los renglones del cuadro antes de volver a escuchar una sala. */
function contarLoQueYaEsta(): void {
  yaEnElCuadro.clear();
  for (const linea of $<HTMLTextAreaElement>("ta").value.split("\n")) {
    const nombre = linea.trim();
    if (nombre) yaEnElCuadro.set(nombre, (yaEnElCuadro.get(nombre) ?? 0) + 1);
  }
}

/** Sigue con una sala que ya tenía nombres: una recarga, o un cierre que no se pudo. */
function seguirConLaSala(s: Sala): void {
  contarLoQueYaEsta();
  sala = s;
  guardar();
  empezarAEscuchar(s);
}

async function crear(): Promise<void> {
  const boton = $<HTMLButtonElement>("sala-crear");
  boton.disabled = true;
  confirmarYa();
  mensaje = t("standSalaCreando");
  pintar();
  void precargarQr();
  try {
    sala = await crearSala();
    yaHuboQr = true;
    mensaje = "";
    guardar();
    empezarAEscuchar(sala);
    ponerGrande(true);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "otro";
    mensaje = t(motivo === "red" ? "standSalaErrRed" : motivo === "cupo-ip" ? "standSalaErrCupoIp" : motivo === "cupo-dia" ? "standSalaErrCupoDia" : "standSalaErrOtro");
  }
  boton.disabled = false;
  pintar();
}

/**
 * Empezar con gente nueva: vacía la lista y las fichas sin cerrar el QR. El mismo QR sigue sirviendo y no se arma otro.
 * Los que estaban quedan archivados: si su número vuelve a llegar, no entra. Se puede deshacer por cinco segundos.
 */
function empezarConGenteNueva(): void {
  if (!sala || (app.frozen && !app.drawn)) return;
  // Con un resultado a la vista primero se suelta: el QR sigue abierto y la lista queda lista para otra gente.
  if (app.frozen && app.drawn && !soltarResultadoDelStand()) return;
  const texto = $<HTMLTextAreaElement>("ta").value;
  const antes = new Map(entradas);
  for (const n of antes.keys()) archivados.add(n);
  entradas.clear();
  setList("");
  guardar();
  pintar();
  ofrecerDeshacer(t("standSalaNuevaMsg"), () => {
    // Las llegadas posteriores siguen en `entradas`: se unen al texto recuperado sin escribir dos veces el mismo nombre.
    const nuevos = [...entradas.values()].filter((e) => e.estado === "ok" && e.puesta);
    const nombres = texto.split("\n").filter((linea) => linea.trim());
    const vistos = new Set(nombres.map(clave));
    for (const e of nuevos) {
      const k = clave(e.nombre);
      if (!vistos.has(k)) nombres.push(e.nombre);
      vistos.add(k);
    }
    const clavesNuevas = new Set(nuevos.map((e) => clave(e.nombre)));
    for (const [n, e] of antes) {
      archivados.delete(n);
      // Con una ronda cerrada, lo recuperado no estaba en esa lista y espera a la siguiente.
      if (e.estado === "ok") e.puesta = app.frozen ? clavesNuevas.has(clave(e.nombre)) : true;
      entradas.set(n, e);
    }
    // El cuadro de una ronda cerrada no se toca: sus nombres son exactamente los que ya entraron en ella.
    if (!app.frozen) setList(nombres.join("\n"));
    guardar();
  });
}

/** El aviso al cerrar: cuántos nombres siguen en la lista. */
function textoDeCerrado(quedan: number): string {
  if (quedan === 0) return t("standSalaCerrado0");
  if (quedan === 1) return t("standSalaCerrado1");
  return t("standSalaCerradoN").replace("{n}", String(quedan));
}

/**
 * Cerrar el QR: deja de verse y de escucharse enseguida, y se cierra de verdad a los cinco segundos, salvo Deshacer.
 * Los nombres que ya están en la lista se quedan: son de la ronda. Lo guardado en la pestaña se borra recién al cerrar
 * de verdad: si la página se recarga antes, el QR vuelve abierto y no queda una sala sin pantalla.
 */
function cerrar(): void {
  const s = sala;
  if (!s) return;
  escucha?.parar();
  escucha = null;
  sala = null;
  cerrando = s;
  yaHuboQr = true;
  pintar();
  const esperan = [...entradas.values()].filter((e) => e.estado === "ok" && !e.puesta).length;
  // La cuenta incluye a quienes ya se anotaron en su celular aunque su renglón todavía espera la ronda siguiente.
  ofrecerDeshacer(textoDeCerrado(parseNames().length + esperan), () => reabrir(s), () => void cerrarDeVerdad(s));
}

/** Deshacer el cierre: el mismo QR vuelve a estar abierto y a escuchar. */
function reabrir(s: Sala): void {
  if (cerrando !== s) return;
  cerrando = null;
  sala = s;
  empezarAEscuchar(s);
}

/**
 * Cierra el QR en el servicio. Lo de esta sala se olvida antes de esperar la respuesta: si mientras tanto se arma otro QR,
 * no se mezclan. Si el servicio no lo cierra y no hay otro abierto, vuelve a estar abierto, con el aviso.
 */
async function cerrarDeVerdad(s: Sala): Promise<void> {
  if (cerrando !== s) return;
  cerrando = null;
  // Cerrar el QR no puede borrar a quien ya vio su alta en el celular: esos nombres pasan a la ronda siguiente.
  juntarPendientes();
  entradas.clear();
  dejados.clear();
  ilegibles.clear();
  quitados.clear();
  archivados.clear();
  yaEnElCuadro.clear();
  guardar();
  const bien = await cerrarSala(s);
  if (bien || sala) return;
  seguirConLaSala(s);
  mensaje = t("standSalaErrCerrar");
  pintar();
}

/* ------------------------------------------------------------- la vista */

let qrDe = "";
let ultimoAviso = "";

/**
 * Con menos de dos personas en la lista, lo que toca es mostrar el QR: es el botón de color. Con dos o más, el de color
 * es Empezar la ronda (`participants.ts` le pone la clase), y el del QR queda como uno más. Nunca dos de color.
 */
function pintarCrear(): void {
  const boton = document.getElementById("sala-crear");
  if (!boton) return;
  // Después de un QR, en el mismo lugar: Armar otro QR.
  const clave = yaHuboQr ? "standSalaOtro" : "standSalaCrear";
  boton.dataset.i = clave;
  boton.textContent = t(clave);
  const toca = !(document.getElementById("btn-freeze")?.classList.contains("primary") ?? false);
  boton.classList.toggle("primary", toca);
  boton.classList.toggle("ghost", !toca);
}

/** Lo que cambia con la lista y con el paso, también sin sala abierta. */
function pintarSegunLaLista(): void {
  pintarCrear();
  pintarEmpezar();
  pintarNueva();
  pintarVerQr();
}

/** Si la pantalla grande del QR está abierta. */
const enGrande = (): boolean => $("stand-sala").classList.contains("grande");

/** Abre o cierra la pantalla grande: el QR, la marca, cuántos hay, Empezar la ronda y los nombres que van llegando. */
function ponerGrande(si: boolean): void {
  $("stand-sala").classList.toggle("grande", si);
  $("sala-grande").textContent = t(si ? "standSalaGrandeCerrar" : "standSalaGrande");
  $("sala-grande").setAttribute("aria-expanded", String(si));
  pintarSegunLaLista();
  pintarListas();
}

/** Empezar la ronda desde la pantalla grande: se cierra y arranca la ronda, o la que sigue si el resultado está a la vista. */
function empezarDesdeLaPantalla(): void {
  ponerGrande(false);
  if (app.frozen && app.drawn) {
    otraRonda();
    return;
  }
  $<HTMLButtonElement>("btn-freeze").click();
}

/** Empezar la ronda, en la pantalla grande: con cuántas personas, cuántas faltan, o Otra ronda con el resultado a la vista. */
function pintarEmpezar(): void {
  const boton = document.getElementById("sala-empezar");
  if (!(boton instanceof HTMLButtonElement)) return;
  if (app.frozen && app.drawn) {
    boton.textContent = t("standOtra");
    boton.disabled = false;
    return;
  }
  if (app.frozen) {
    boton.textContent = t("standEnMarcha");
    boton.disabled = true;
    return;
  }
  const n = parseNames().length;
  const faltan = 2 - n;
  if (faltan > 0) {
    boton.textContent = faltan === 1 ? t("standSalaFalta1") : t("standSalaFaltanN").replace("{n}", String(faltan));
    boton.disabled = true;
    return;
  }
  boton.textContent = t("standSalaEmpezarN").replace("{n}", String(n));
  const empezar = document.getElementById("btn-freeze");
  boton.disabled = empezar instanceof HTMLButtonElement && empezar.disabled;
}

/** Empezar con gente nueva: con un QR abierto, algo en la lista y ninguna ronda en curso. */
function pintarNueva(): void {
  const boton = document.getElementById("sala-nueva");
  if (boton instanceof HTMLButtonElement) {
    const rondaEnCurso = app.frozen !== null && !app.drawn;
    boton.disabled = !sala || rondaEnCurso || parseNames().length === 0;
  }
}

/** Ver el QR en grande, en el final de la ronda: solo con un QR abierto. */
function pintarVerQr(): void {
  const boton = document.getElementById("stand-qr");
  if (boton) boton.hidden = sala === null;
}

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
  pintarSegunLaLista();
  repintarGuia();
  // Sin QR no hay pantalla grande que mostrar: venció, o se cerró desde otra pestaña.
  if (!sala && enGrande()) ponerGrande(false);
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
  pintarListas();
}

/** El número tiene su propio tamaño: la cuenta se lee de lejos sin agrandar también toda la frase. */
function pintarCuenta(cantidad: number): void {
  const el = $("sala-cuenta");
  if (cantidad === 0) {
    el.textContent = t("standSalaVacia");
    return;
  }
  const plantilla = cantidad === 1 ? t("standSalaCuenta1") : t("standSalaCuentaN");
  const partes = plantilla.split(cantidad === 1 ? "1" : "{n}");
  if (partes.length !== 2) {
    el.textContent = plantilla.replace("{n}", String(cantidad));
    return;
  }
  const numero = document.createElement("strong");
  numero.textContent = String(cantidad);
  el.replaceChildren(partes[0] ?? "", numero, partes[1] ?? "");
}

/** La tarjeta sigue el orden de llegada. En grande manda lo último: hasta 30 nombres y una ficha con los que faltan. */
function pintarListas(): void {
  const ok = [...entradas.entries()].filter(([, e]) => e.estado === "ok");
  const revisar = [...entradas.entries()].filter(([, e]) => e.estado === "revisar");
  pintarCuenta(ok.length);
  const panel = $("stand-sala");
  panel.dataset.tramo = ok.length <= 6 ? "hasta-6" : ok.length <= 12 ? "7-12" : ok.length <= 24 ? "13-24" : "25-mas";
  const grande = enGrande();
  const visibles = grande ? ok.slice(-30).reverse() : ok;
  const nombres = $("sala-nombres");
  fila(nombres, visibles, (n) => quitar(n));
  if (grande && ok.length > 30) {
    const li = document.createElement("li");
    li.className = "ss-mas";
    const texto = document.createElement("span");
    texto.className = "ss-nombre";
    texto.textContent = t("standYMas").replace("{n}", String(ok.length - 30));
    li.append(texto);
    nombres.append(li);
  }
  const rev = $("sala-revisar");
  rev.hidden = revisar.length === 0;
  fila($("sala-revisar-lista"), revisar, (n) => quitar(n), "standSalaMostrar", mostrar);
}

/** Una lista de nombres con una cruz por nombre (y Mostrar, si hace falta). Los nombres van con `textContent`: nunca como HTML. */
function fila(ul: HTMLElement, items: [number, Entrada][], alQuitar: (n: number) => void, claveMostrar?: string, alMostrar?: (n: number) => void): void {
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
    q.className = "mini ss-quitar";
    q.textContent = "✕";
    const quitarA = t("standSalaQuitarAria").replace("{nombre}", e.nombre);
    q.setAttribute("aria-label", quitarA);
    q.title = quitarA;
    q.addEventListener("click", () => alQuitar(n));
    li.append(q);
    nuevo.append(li);
  }
  ul.replaceChildren(nuevo);
}

/** Se llama una vez, con la herramienta armada. */
export function initStandSala(): void {
  $("sala-crear").addEventListener("click", () => void crear());
  $("sala-cerrar").addEventListener("click", () => cerrar());
  $("sala-grande").addEventListener("click", () => ponerGrande(!enGrande()));
  nombresParaLaSiguiente(paraLaSiguiente);
  alAvisarEnStand((texto) => {
    mensaje = texto;
    pintar();
  });
  alSalirDelStand(async () => {
    // Hacer un sorteo de verdad: el QR se cierra y se borra lo que tenía, sin esperar más de un instante. Un cierre que
    // esperaba su Deshacer se hace ahora, porque la página se va.
    const s = sala ?? cerrando;
    if (!s) return true;
    olvidarOferta();
    cerrando = null;
    const bien = await Promise.race([cerrarSala(s), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (bien) {
      olvidar();
      return true;
    }
    // No se pudo: el QR y su llave se quedan (se borra solo a las 10 horas), a la vista, y se avisa.
    if (!sala) seguirConLaSala(s);
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
    for (const n of g.dejados) dejados.add(n);
    for (const n of g.archivados) archivados.add(n);
    yaHuboQr = true;
    seguirConLaSala(g.sala);
    pintar();
  });
  // La guía de arriba pregunta si hay un QR abierto.
  alPreguntarPorElQr(() => sala !== null);
  // El botón de color sigue a la lista: al escribir, al cambiar de paso y al entrar al stand.
  document.addEventListener("tinkazo:paso", pintarSegunLaLista);
  document.addEventListener("tinkazo:stand", pintarSegunLaLista);
  document.getElementById("ta")?.addEventListener("input", pintarSegunLaLista);
  // Escribir los nombres a mano: lleva al cuadro, con el foco.
  document.getElementById("stand-a-mano")?.addEventListener("click", () => {
    const cuadro = $<HTMLTextAreaElement>("ta");
    cuadro.focus({ preventScroll: true });
    cuadro.scrollIntoView?.({ block: "center" });
  });
  document.getElementById("sala-empezar")?.addEventListener("click", empezarDesdeLaPantalla);
  document.getElementById("sala-nueva")?.addEventListener("click", empezarConGenteNueva);
  document.getElementById("sala-deshacer-b")?.addEventListener("click", deshacer);
  document.getElementById("stand-qr")?.addEventListener("click", () => ponerGrande(true));
  // Escape cierra la pantalla grande, como Volver.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && enGrande()) ponerGrande(false);
  });
  if (enStand()) pintar();
}
