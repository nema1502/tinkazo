import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app, params } from "../state";
import { type Diagnostico, type FuentesDelChequeo, chequearRed, crearChequeo, llamarRpc, simularConRpc, umbralesDe } from "../stellar/chequeo-red";
import { network } from "../stellar/config";
import { grifoDisponible } from "../stellar/grifo";
import { anotar, anotarChequeo, registroParaCopiar, saturacionReciente } from "../stellar/registro-red";
import { limpiarDetalle } from "./anchor";
import { ponerDetalle } from "./detalle-error";
import { type AccionRed, type ContextoDelPanel, NOMBRE_DE_ACCION, type Panel, TEXTO_DE_ACCION, panelDe, respuestaDelBoton } from "./red-acciones";
import { verError } from "./siguiente";
import { canAnchor, currentSession } from "./wallet-ui";

/**
 * La red, a la vista antes de sellar.
 *
 * Esta es la pantalla de `chequeo-red.ts`: mira la red cuando hay cuenta y dos nombres
 * o más, otra vez al apretar "Sellar la lista" si pasaron 60 s, y cuando se toca
 * "¿La red está bien?". Si todo está bien no dice nada. Si anda lenta, avisa en una
 * frase y deja sellar. Si no se puede sellar, la acción del caso **reemplaza** a
 * "Sellar la lista" (una sola acción principal, docs/ux.md), con lo demás en chiquito
 * y el detalle técnico plegado debajo.
 *
 * El orden de preferencia, siempre: volver a probar → sellar con otra fuente de comisión
 * → "Seguir sin sello", que pide confirmar y dice que ese sorteo no se podrá comprobar.
 *
 * Lo que decide qué mostrar vive en `red-acciones.ts` (con pruebas); acá solo se
 * dibuja y se conectan los botones.
 */

/** Cómo se sella desde acá: lo pone `main.ts`, para no importar `freeze.ts` en círculo. */
export interface OpcionesDeSellado {
  /** Seguir sin sello: modo libre con la ronda a 90 s, intentando sellar la misma ronda hasta el último momento. */
  sinSello?: boolean;
  /** Ya se miró la red: que el sellado no vuelva a frenar por lo mismo. */
  saltarChequeo?: boolean;
  /** La comisión la paga la cuenta de la persona, no el patrocinador. */
  pagarConMiCuenta?: boolean;
}

let sellarFn: ((o: OpcionesDeSellado) => Promise<void>) | null = null;

/* ------------------------------------------------------------ el chequeo */

/** Un diagnóstico que no frena: el chequeo mismo no pudo correr. */
function diagnosticoRoto(e: unknown): Diagnostico {
  return {
    nivel: "verde",
    caso: null,
    casos: [],
    red: network.name,
    rpc: null,
    pagador: "propio",
    costoXlm: null,
    rojoXlm: umbralesDe(network.name).red.rojoXlm,
    ms: null,
    ledger: null,
    protocolo: null,
    inclusionP90: null,
    saldoXlm: null,
    restaurar: false,
    sinInternet: false,
    sinChequeo: true,
    motivo: `el chequeo no pudo correr: ${e instanceof Error ? e.message.slice(0, 60) : "?"}`,
    hora: Date.now(),
  };
}

/** Las fuentes de verdad: los RPC, la cuenta, el SDK para armar el sello de muestra. */
async function fuentes(): Promise<FuentesDelChequeo> {
  const [{ rpcRed }, lite, { submitsItself }, sdk] = await Promise.all([import("../stellar/rpc-red"), import("../stellar/wallet-lite"), import("../stellar/wallet-pollar"), import("./chequeo-red-sdk")]);
  const w = lite.activeWallet();
  const rpc = rpcRed();
  const vigente = rpc.actual();
  const propio = !submitsItself(w);
  const origen = w?.address ?? (await sdk.cuentaDeMuestra());
  const muestra = await sdk.armarSelloDeMuestra({ origen, contractId: network.contractId ?? "", passphrase: network.networkPassphrase });
  const direccion = w?.address ?? null;
  return {
    red: network.name,
    passphrase: network.networkPassphrase,
    rpcs: [vigente, ...rpc.lista().filter((u) => u !== vigente)],
    pagador: propio ? "propio" : "patrocinado",
    llamar: (url, metodo) => llamarRpc(url, metodo),
    simular: (url) => simularConRpc(url, muestra.xdr),
    ...(propio && direccion ? { saldo: () => lite.xlmBalance(direccion) } : {}),
    sinInternet: () => typeof navigator !== "undefined" && navigator.onLine === false,
    saturacionReciente: () => saturacionReciente(),
    elegir: (_url, motivo) => void rpc.cambiar(motivo),
  };
}

async function medirDeVerdad(): Promise<Diagnostico> {
  try {
    const d = await chequearRed(await fuentes());
    anotarChequeo("chequeo", d);
    return d;
  } catch (e) {
    // Si el chequeo no puede ni armarse (el SDK no bajó, por ejemplo), no frena nada.
    const d = diagnosticoRoto(e);
    anotar({ red: network.name, paso: "chequeo", nivel: "verde", final: d.motivo });
    return d;
  }
}

const chequeo = crearChequeo(medirDeVerdad);

/* ------------------------------------------------------------- lo que se ve */

type Vista =
  | { tipo: "nada" }
  | { tipo: "panel"; d: Diagnostico; p: Panel }
  | { tipo: "respuesta"; d: Diagnostico; p: Panel }
  | { tipo: "confirmar"; d: Diagnostico; p: Panel }
  | { tipo: "ocupado"; texto: string; p: Panel | null }
  | { tipo: "sin-sello"; estado: "esperando" | "intentando" | "entro" | "vencio"; reintentar?: () => void };

let vista: Vista = { tipo: "nada" };
/** Después de un RPC caído: cuántas veces se volvió a probar. */
let intentos = 0;
/** La acción que lleva el botón de sellar mientras la del caso lo reemplaza. */
let alApretar: (() => void) | null = null;
/** Se está sellando de verdad: el botón es de `freeze.ts`. */
let sellando = false;
/** Quién pidió mirar: si fue "Sellar la lista" y la red vuelve, se sigue sellando. */
let origen: "sellar" | "chequeo" | "boton" = "chequeo";
let reloj: ReturnType<typeof setInterval> | undefined;
let restan = 0;
let ocultar: ReturnType<typeof setTimeout> | undefined;
let vigilando: ReturnType<typeof setInterval> | undefined;
let pidiendo = false;

const botonDeSellar = (): HTMLButtonElement => $<HTMLButtonElement>("btn-freeze");

/** El texto de una clave del diccionario con sus huecos completados. */
const decir = (clave: string, huecos: Record<string, string> = {}): string => Object.entries(huecos).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(clave));
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function detenerReloj(): void {
  if (reloj !== undefined) clearInterval(reloj);
  reloj = undefined;
}

/** La acción del caso reemplaza a "Sellar la lista", o el botón vuelve a ser el de siempre. */
function aplicarAlBoton(): void {
  if (sellando || app.frozen) return;
  const btn = botonDeSellar();
  // Mientras se mira la red o se carga saldo el botón lo dice, y no se toca.
  if (vista.tipo === "ocupado") {
    alApretar = null;
    btn.textContent = vista.texto;
    btn.disabled = true;
    return;
  }
  let accion: AccionRed = "sellar";
  let clave: string | null = null;
  if (vista.tipo === "panel" || vista.tipo === "respuesta") {
    if (vista.p.bloquea) accion = vista.p.principal;
  } else if (vista.tipo === "confirmar") {
    accion = "seguir-sin-sello";
    clave = "redConfirmaSi";
  }
  if (accion === "sellar") {
    alApretar = null;
    btn.dataset.i = "freeze";
    btn.textContent = t("freeze");
    btn.disabled = false;
    return;
  }
  const texto = clave ?? TEXTO_DE_ACCION(accion, network.name);
  btn.dataset.i = texto;
  btn.textContent = t(texto);
  btn.disabled = false;
  alApretar = vista.tipo === "confirmar" ? () => void seguirSinSello() : () => hacer(accion);
}

/** Lo que dice la caja de arriba del botón: la frase del panel, con su segunda frase si la hay. */
function frase(p: Panel, d: Diagnostico, modo: "panel" | "respuesta"): string {
  if (modo === "respuesta") {
    const r = respuestaDelBoton(d, p);
    const base = r.clave === "redRoja" ? decir("redRoja", { motivo: fraseDelCaso(p) }) : t(r.clave);
    return r.aparte ? `${base} ${t(r.aparte)}` : base;
  }
  return `${fraseDelCaso(p)}${p.aparte ? ` ${t(p.aparte)}` : ""}`;
}
function fraseDelCaso(p: Panel): string {
  // El mismo texto cuenta atrás cuando la app vuelve a probar sola.
  return p.frase === "redSinRpc" ? decir("redSinRpc", { t: mmss(restan) }) : t(p.frase);
}

const ICONO = { verde: "✓", amarillo: "!", rojo: "✕" } as const;

function pintar(): void {
  const caja = document.getElementById("red-estado");
  if (!caja) return;
  limpiarDetalle("red-estado");
  if (vista.tipo === "nada") {
    caja.style.display = "none";
    caja.replaceChildren();
    aplicarAlBoton();
    return;
  }
  caja.replaceChildren();
  caja.style.display = "block";

  const linea = document.createElement("p");
  linea.className = "red-frase";
  const ico = document.createElement("span");
  ico.className = "red-ico";
  ico.setAttribute("aria-hidden", "true");
  const texto = document.createElement("span");
  texto.className = "red-texto";
  linea.append(ico, texto);
  caja.append(linea);
  const fila = document.createElement("div");
  fila.className = "row red-sub";

  const sub = (a: AccionRed, clave?: string): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost mini";
    b.dataset.i = clave ?? TEXTO_DE_ACCION(a, network.name);
    b.textContent = t(b.dataset.i);
    b.addEventListener("click", () => hacer(a));
    fila.append(b);
  };

  let nivel: "verde" | "amarillo" | "rojo" = "amarillo";
  switch (vista.tipo) {
    case "panel":
    case "respuesta": {
      nivel = vista.p.nivel === "verde" ? "verde" : vista.p.nivel;
      texto.textContent = vista.p.nivel === "verde" && vista.tipo === "respuesta" ? t("redVerde") : frase(vista.p, vista.d, vista.tipo);
      // Lo secundario va en chiquito. "Seguir sin sello" nunca es la principal si hay otra cosa que hacer.
      for (const a of vista.p.secundarias) sub(a);
      break;
    }
    case "confirmar": {
      nivel = "rojo";
      texto.textContent = t("redConfirma");
      sub("reintentar", "redConfirmaNo");
      break;
    }
    case "ocupado": {
      nivel = "amarillo";
      texto.textContent = vista.texto;
      break;
    }
    case "sin-sello": {
      nivel = vista.estado === "entro" ? "verde" : "amarillo";
      texto.textContent = t(vista.estado === "entro" ? "redSinSelloEntro" : vista.estado === "vencio" ? "redSinSelloNoEntro" : "redSinSelloEspera");
      if (vista.estado === "esperando" || vista.estado === "intentando") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost mini";
        b.dataset.i = vista.estado === "intentando" ? "redSinSelloIntentando" : "redSinSelloReintento";
        b.textContent = t(b.dataset.i);
        b.disabled = vista.estado === "intentando";
        const intentar = vista.reintentar;
        b.addEventListener("click", () => intentar?.());
        fila.append(b);
      }
      break;
    }
  }
  caja.className = `red-estado ${nivel}`;
  ico.textContent = ICONO[nivel];
  if (fila.childElementCount) caja.append(fila);
  // El detalle técnico plegado: para quien tenga que contar qué pasó.
  if (vista.tipo !== "sin-sello" && nivel !== "verde") ponerDetalle(caja, registroParaCopiar(8) || "—");
  aplicarAlBoton();
}

/** Qué se está viendo ahora (después de un `await`, otra parte pudo haberlo cambiado). */
const tipoDeVista = (): Vista["tipo"] => vista.tipo;

/** Cambia lo que se ve. Todo pasa por acá: una sola cosa a la vez. */
function ver(v: Vista): void {
  vista = v;
  if (ocultar !== undefined) clearTimeout(ocultar);
  ocultar = undefined;
  // Un "está bien" no se queda: se va solo.
  if (v.tipo === "respuesta" && v.p.nivel === "verde") ocultar = setTimeout(() => ver({ tipo: "nada" }), 8000);
  pintar();
}

/* ------------------------------------------------------------- las acciones */

async function contextoDe(d: Diagnostico): Promise<ContextoDelPanel> {
  let saldoXlm = d.saldoXlm;
  // Para decidir si "Sellar pagando con mi cuenta" es posible hace falta saber cuánto tiene la cuenta.
  if (saldoXlm === null && d.nivel === "rojo" && (d.caso === "costo-alto" || d.caso === "sin-saldo")) {
    const s = currentSession();
    if (s) {
      try {
        const { xlmBalance } = await import("../stellar/wallet-lite");
        const n = await Promise.race([xlmBalance(s.address), new Promise<number>((r) => setTimeout(() => r(-1), 3000))]);
        saldoXlm = n >= 0 ? n : null;
      } catch {
        saldoXlm = null;
      }
    }
  }
  return { red: network.name, intentos, grifo: grifoDisponible(), saldoXlm, costoXlm: d.costoXlm ?? (network.name === "mainnet" ? 0.2 : 1) };
}

/** Pone en pantalla lo que dice un diagnóstico y arma lo que sigue. */
async function mostrar(d: Diagnostico, como: "panel" | "respuesta"): Promise<Panel> {
  detenerReloj();
  const p = panelDe(d, await contextoDe(d));
  if (p.nivel === "verde" && como === "panel") {
    intentos = 0;
    ver({ tipo: "nada" });
    return p;
  }
  if (!(d.caso === "rpc-caido" && d.nivel === "rojo")) intentos = 0;
  restan = umbralesDe(network.name).comun.reintentarCadaS;
  ver({ tipo: como, d, p });
  if (p.reintentaSola) empezarReloj(d);
  return p;
}

/** "Vuelvo a probar en 0:15": cuenta atrás, y al llegar a cero mira de nuevo. */
function empezarReloj(d: Diagnostico): void {
  detenerReloj();
  reloj = setInterval(() => {
    restan = Math.max(0, restan - 1);
    const t = document.querySelector("#red-estado .red-texto");
    if (t && vista.tipo === "panel" && vista.p.frase === "redSinRpc") t.textContent = fraseDelCaso(vista.p);
    if (restan <= 0) {
      detenerReloj();
      void volverAMirar("automatico", d);
    }
  }, 1000);
}

/** Vuelve a mirar la red (de verdad, sin caché) y sigue según lo que encuentre. */
async function volverAMirar(como: "automatico" | "manual", _antes?: Diagnostico): Promise<void> {
  detenerReloj();
  ver({ tipo: "ocupado", texto: t("redBtnBusy"), p: vista.tipo === "panel" || vista.tipo === "respuesta" ? vista.p : null });
  const d = await chequeo.verificar({ forzar: true });
  if (d.caso === "rpc-caido" && d.nivel === "rojo") intentos++;
  anotarChequeo("reintento", d, { accion: como === "automatico" ? "probar-solo" : "probar-ahora" });
  const p = await mostrar(d, "panel");
  // Volvió la red y la persona había apretado "Sellar la lista": se sigue sellando, sin otro toque.
  if (p.nivel !== "rojo" && origen === "sellar" && sellarFn) {
    origen = "chequeo";
    void sellarFn({ saltarChequeo: true });
  }
}

async function cargarSaldoDePrueba(): Promise<boolean> {
  const s = currentSession();
  if (!s) return false;
  ver({ tipo: "ocupado", texto: t("redCargando"), p: vista.tipo === "panel" || vista.tipo === "respuesta" ? vista.p : null });
  try {
    const lite = await import("../stellar/wallet-lite");
    await lite.fundWithFriendbot(s.address);
    // El saldo tarda un instante en verse.
    const { esperarHasta } = await import("./reintento");
    await esperarHasta(async () => (await lite.xlmBalance(s.address)) >= 1, { cadaMs: 700, hastaMs: 10_000 });
    anotar({ red: network.name, paso: "cargar-saldo", accion: NOMBRE_DE_ACCION["cargar-saldo"], final: "cargado" });
    return true;
  } catch {
    anotar({ red: network.name, paso: "cargar-saldo", accion: NOMBRE_DE_ACCION["cargar-saldo"], final: "no se pudo" });
    return false;
  }
}

function hacer(a: AccionRed): void {
  // Lo que se estaba viendo cuando se tocó, antes de que cualquier acción cambie la pantalla.
  const actual = vista.tipo === "panel" || vista.tipo === "respuesta" || vista.tipo === "confirmar" ? vista : null;
  if (actual && actual.tipo !== "confirmar") {
    anotar({ red: network.name, paso: "boton", caso: actual.p.caso ?? "ninguno", nivel: actual.p.nivel, accion: NOMBRE_DE_ACCION[a] });
  }
  /** Vuelve a mostrar el panel de antes, con lo que no pudo salir. */
  const volver = (aviso: string): void => {
    if (actual) ver({ tipo: "panel", d: actual.d, p: actual.p });
    document.querySelector("#red-estado .red-texto")?.append(` ${aviso}`);
  };
  switch (a) {
    case "sellar":
      void sellarFn?.({ saltarChequeo: true });
      return;
    case "reintentar":
      // Desde "Esperar a la red" se vuelve a empezar la cuenta de intentos.
      if (actual?.tipo === "confirmar") intentos = 0;
      void volverAMirar("manual");
      return;
    case "cargar-saldo":
      void (async () => {
        if (!(await cargarSaldoDePrueba())) return volver(t("friendbotFailed"));
        await volverAMirar("manual");
      })();
      return;
    case "sellar-con-mi-cuenta":
      void (async () => {
        if (actual?.p.cargaPrevia && !(await cargarSaldoDePrueba())) return volver(t("friendbotFailed"));
        anotar({ red: network.name, paso: "pagar-propio", accion: NOMBRE_DE_ACCION[a] });
        ver({ tipo: "nada" });
        await sellarFn?.({ saltarChequeo: true, pagarConMiCuenta: true });
      })();
      return;
    case "seguir-sin-sello":
      // Pide confirmar: sin sello, ese sorteo no se podrá comprobar. Nunca de un solo toque.
      if (actual && actual.tipo !== "confirmar") {
        detenerReloj();
        ver({ tipo: "confirmar", d: actual.d, p: actual.p });
        botonDeSellar().focus({ preventScroll: true });
      }
      return;
  }
}

async function seguirSinSello(): Promise<void> {
  anotar({ red: network.name, paso: "sin-sello", accion: NOMBRE_DE_ACCION["seguir-sin-sello"], final: "confirmado" });
  ver({ tipo: "nada" });
  await sellarFn?.({ sinSello: true, saltarChequeo: true });
}

/* ------------------------------------------------- lo que usa el resto de la página */

/** Mientras haya una acción del caso en el botón de sellar, su clic es de ella. Devuelve si lo atendió. */
export function alApretarSellar(): boolean {
  if (!alApretar) return false;
  const a = alApretar;
  a();
  return true;
}

/** El botón de sellar lleva la acción de un caso: `refreshFreezeLabel` no lo pisa. */
export const hayAccionDeRed = (): boolean => alApretar !== null || vista.tipo === "ocupado" || vista.tipo === "confirmar";

/** `freeze.ts` está sellando de verdad: el botón es suyo. Al terminar sin sellar (un error), vuelve a pintarse. */
export function marcarSellado(v: boolean): void {
  sellando = v;
  if (!v) pintar();
  else {
    detenerReloj();
    alApretar = null;
  }
}

/**
 * Antes de armar el sello. `true` si se puede seguir (verde o amarillo, que además se
 * dice en pantalla), `false` si la red no deja: ya se mostró el motivo y la acción.
 * Un chequeo que se rompe nunca frena.
 */
export async function chequearAntesDeSellar(): Promise<boolean> {
  origen = "sellar";
  let d: Diagnostico;
  try {
    d = await chequeo.verificar();
  } catch {
    return true;
  }
  const p = await mostrar(d, "panel");
  if (p.nivel === "rojo") {
    sellando = false;
    pintar();
    const caja = document.getElementById("red-estado");
    if (caja) verError(caja);
    botonDeSellar().focus({ preventScroll: true });
    return false;
  }
  return true;
}

/** El sello de verdad devolvió un costo por encima de lo que el patrocinador paga. */
export async function mostrarCostoAlto(costoXlm: number, restaurar: boolean): Promise<void> {
  origen = "sellar";
  chequeo.olvidar();
  const base = diagnosticoRoto(new Error("costo-alto"));
  const d: Diagnostico = { ...base, sinChequeo: false, nivel: "rojo", caso: "costo-alto", casos: [{ caso: "costo-alto", nivel: "rojo" }], pagador: "patrocinado", costoXlm, restaurar, motivo: "la simulación del sello de verdad" };
  anotarChequeo("sellar", d, { final: "costo por encima del tope" });
  sellando = false;
  await mostrar(d, "panel");
  const caja = document.getElementById("red-estado");
  if (caja) verError(caja);
}

/** Una cuenta que paga con el patrocinador se quedó sin con qué: el patrocinador no tiene saldo (mainnet, sin grifo). */
export async function mostrarSinSaldo(): Promise<void> {
  origen = "sellar";
  chequeo.olvidar();
  const base = diagnosticoRoto(new Error("sin-saldo"));
  const d: Diagnostico = { ...base, sinChequeo: false, nivel: "rojo", caso: "sin-saldo", casos: [{ caso: "sin-saldo", nivel: "rojo" }], pagador: "patrocinado", costoXlm: chequeo.ultimo()?.costoXlm ?? null, motivo: "no alcanzó la comisión" };
  anotarChequeo("sellar", d, { final: "sin saldo" });
  sellando = false;
  await mostrar(d, "panel");
  const caja = document.getElementById("red-estado");
  if (caja) verError(caja);
}

/** Se selló (o se empezó otro sorteo): la caja de la red se va. */
export function limpiarRed(): void {
  detenerReloj();
  intentos = 0;
  origen = "chequeo";
  if (vista.tipo !== "sin-sello") ver({ tipo: "nada" });
}

/** "Seguir sin sello": lo que se ve mientras se sigue intentando sellar la misma ronda. */
export function verSinSello(estado: "esperando" | "intentando" | "entro" | "vencio", reintentar?: () => void): void {
  sellando = false;
  ver({ tipo: "sin-sello", estado, ...(reintentar ? { reintentar } : {}) });
}

/* ----------------------------------------------------- cuándo se mira la red */

/** Hay con qué mirar: cuenta que sella, dos nombres o más, y nada sellado todavía. */
const puedeMirar = (): boolean => canAnchor() && !params.has("demo") && !app.frozen && (document.getElementById("names")?.childElementCount ?? 0) >= 2;

function mostrarElBoton(): void {
  const fila = document.getElementById("red-fila");
  if (fila) fila.style.display = canAnchor() && !params.has("demo") ? "" : "none";
}

let pendiente: ReturnType<typeof setTimeout> | undefined;
/** Con la cuenta y la lista a la vista, se mira la red un momento después (cuando la pantalla se quedó quieta). */
function programar(): void {
  mostrarElBoton();
  if (pendiente !== undefined) clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    if (sellando || pidiendo || vista.tipo === "confirmar" || vista.tipo === "ocupado" || vista.tipo === "sin-sello") return;
    if (!puedeMirar()) {
      if (vista.tipo !== "nada") ver({ tipo: "nada" });
      return;
    }
    void (async () => {
      const d = await chequeo.verificar();
      if (sellando || pidiendo || !puedeMirar() || tipoDeVista() === "confirmar" || tipoDeVista() === "ocupado") return;
      origen = "chequeo";
      // Solo se muestra si no es verde; el "está bien" es del botón.
      if (d.nivel === "verde" && tipoDeVista() === "respuesta") return;
      await mostrar(d, "panel");
    })();
  }, 900);
}

/** El botón de un toque: dice verde, amarillo o rojo, con la razón. Y deja la red vigilada cada 60 s. */
async function preguntar(): Promise<void> {
  if (pidiendo) return;
  pidiendo = true;
  origen = "boton";
  const boton = $<HTMLButtonElement>("btn-red");
  const texto = $("btn-red-txt");
  boton.disabled = true;
  texto.textContent = t("redBtnBusy");
  try {
    const d = await chequeo.verificar({ forzar: true });
    anotarChequeo("boton", d);
    await mostrar(d, "respuesta");
    // Con la red a la vista, se vuelve a mirar cada 60 s mientras se arma el evento.
    if (vigilando === undefined) {
      vigilando = setInterval(() => {
        if (document.visibilityState === "hidden" || !puedeMirar() || sellando || vista.tipo === "ocupado" || vista.tipo === "confirmar") return;
        void chequeo.verificar({ forzar: true }).then((nuevo) => {
          if (nuevo.nivel !== "verde") void mostrar(nuevo, "panel");
          else if (vista.tipo === "panel") ver({ tipo: "nada" });
        });
      }, umbralesDe(network.name).comun.repetirCadaS * 1000);
    }
  } finally {
    pidiendo = false;
    boton.disabled = false;
    texto.textContent = t("redBtn");
  }
}

/** Se llama una vez, con la herramienta ya armada. */
export function iniciarRed(o: { sellar: (op: OpcionesDeSellado) => Promise<void> }): void {
  sellarFn = o.sellar;
  document.getElementById("btn-red")?.addEventListener("click", () => void preguntar());
  // Cambió la cuenta: lo medido era de otra.
  document.addEventListener("tinkazo:sesion", () => {
    chequeo.olvidar();
    if (vista.tipo !== "sin-sello") ver({ tipo: "nada" });
    programar();
  });
  const names = document.getElementById("names");
  if (names) new MutationObserver(programar).observe(names, { childList: true });
  onLangChange(() => {
    if (vista.tipo !== "nada") pintar();
    const texto = document.getElementById("btn-red-txt");
    if (texto && !pidiendo) texto.textContent = t("redBtn");
  });
  mostrarElBoton();
}
