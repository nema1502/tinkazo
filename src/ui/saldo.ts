import { type Lectura, type Pago, pagosEntrantes } from "../../workers/cuenta/src/pagos";
import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { contextoHorizon, revisarCarga } from "../stellar/carga";
import { type ResultadoDeLinea, activarLineaPropia } from "../stellar/linea-propia";
import type { ResultadoDeActivarUsdc } from "../stellar/wallet-pollar";
import { type NetworkName, network } from "../stellar/config";
import { modoDeRampa, practicaDeRampa, urlDeCuenta } from "../stellar/cuenta-config";
import { passphraseDe } from "../stellar/oficiales";
import { stroopsDe } from "../stellar/pagos";
import {
  type BaseDeLlegadas,
  type BilleteraParaRecibir,
  type EntradaParaRecibir,
  type EstadoParaRecibir,
  type LecturaDeCuenta,
  abrePasoDeLaCuenta,
  esLlegada,
  estadoParaRecibir,
  mirarCuenta,
  queLlego,
  usdcDeLaRed,
} from "../stellar/usdc-cuenta";
import { type Dialogo, abrirDialogo, botonPrincipal, copiar, lineaDeEstado } from "./dialogo";
import { con } from "./monedas-vista";
import { pintarQr } from "./qr";

/**
 * «Tus dólares digitales»: el saldo de dólares digitales (USDC) de la cuenta de la persona, y cómo traerlos desde otra
 * app o exchange.
 *
 * Lo primero que hace la ventana es mirar la cuenta en la red (`usdc-cuenta.ts`): la dirección para recibir se muestra
 * solo cuando la cuenta puede recibir. Si no puede, la ventana dice qué falta y ofrece una sola cosa para resolverlo
 * (activar, dejar la cuenta lista, volver a mirar). Cada pantalla lleva un título corto, una línea, los datos que hacen
 * falta y una sola acción principal en el pie. El porqué va plegado en Más detalles.
 *
 * Tinkazo no guarda ni mueve dinero: los dólares están en la cuenta de la persona. «Ya lo mandé» mira los pagos que
 * entraron desde la base guardada en este navegador (`queLlego`) y nunca invita a mandar de nuevo.
 */

/** Lo que la ventana le pide al sitio. En las pruebas, un reemplazo. */
export interface DepsDeSaldo {
  red: NetworkName;
  /** La práctica con dólares digitales de prueba (solo en `localhost`). */
  practica: boolean;
  /** Con qué entró la persona, o `null` si no hay sesión. */
  billetera(): Promise<BilleteraParaRecibir | null>;
  mirar(cuenta: string): Promise<LecturaDeCuenta>;
  /** Solo con Google en la red principal: si la cuenta está lista (creada y protegida), o `null` si no se sabe. */
  proteccion(): Promise<"lista" | "falta" | null>;
  /** Solo con Google: si ya espera un pedido de activar los dólares digitales, o `null` si no se sabe. */
  pendiente(): Promise<boolean | null>;
  /** Solo con Google: si la app pone la reserva al activarlos, o `null` si no se sabe. */
  catalogo(): Promise<"patrocinada" | "no-patrocinada" | null>;
  /** Los pagos de USDC que entraron, del más nuevo al más viejo. */
  pagos(cuenta: string, parar: (acumulados: Pago[]) => boolean): Promise<Lectura<Pago[]>>;
  /**
   * Activa los dólares digitales: con una billetera propia la firma la persona (`linea-propia.ts`); con Google o correo
   * la pide Pollar (`activarUsdc`).
   */
  activar(): Promise<ResultadoDeActivacion>;
  /** Una pausa entre lecturas, después de activar. */
  pausa(ms: number): Promise<void>;
  /** El Worker de las monedas, para la primera carga, o `null` si están apagadas. */
  monedas: string | null;
  /** Abre «Dejá tu cuenta lista». `true` si la persona siguió con la cuenta lista. */
  dejarLista(): Promise<boolean>;
  /** Abre la hoja para pasar al modo Oficial. */
  pasarAOficial(): void;
  /** Abre Mandar mis dólares digitales con el saldo de la cuenta, en stroops. */
  mandar(cuenta: string, saldo: bigint): void;
}

/** Cómo terminó Activar dólares digitales. */
export type ResultadoDeActivacion = ResultadoDeLinea | ResultadoDeActivarUsdc;

/** Después de activar con Google, cuántas veces se mira la línea y cada cuánto (unos 30 segundos). */
const VUELTAS_TRAS_ACTIVAR = 10;
const CADA_MS = 3_000;

const redDeLaFrase = (frase: string | null): NetworkName | "otra" | null => {
  if (frase === null) return null;
  if (frase === passphraseDe("mainnet")) return "mainnet";
  if (frase === passphraseDe("testnet")) return "testnet";
  return "otra";
};

function depsDelSitio(): DepsDeSaldo {
  return {
    red: network.name,
    practica: practicaDeRampa(),
    async billetera() {
      const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
      const w = activeWallet();
      if (!w?.address) return null;
      if (submitsItself(w)) return { tipo: "google" };
      return { tipo: "propia", red: redDeLaFrase(await w.networkPassphrase().catch(() => null)) };
    },
    mirar: (cuenta) => mirarCuenta(network.name, cuenta),
    async proteccion() {
      const { pollarWallet } = await import("../stellar/wallet-pollar");
      const e = await pollarWallet.estadoOficial(true).catch(() => null);
      if (!e || e.activacion === "no-se-sabe" || e.proteccion === "no-se-sabe") return null;
      return e.activacion === "lista" && e.proteccion === "lista" ? "lista" : "falta";
    },
    async pendiente() {
      const { pollarWallet } = await import("../stellar/wallet-pollar");
      return pollarWallet.pendienteDeActivacion();
    },
    async catalogo() {
      const { pollarWallet } = await import("../stellar/wallet-pollar");
      return pollarWallet.catalogoUsdc();
    },
    pagos: (cuenta, parar) => pagosEntrantes(cuenta, contextoHorizon(), parar),
    async activar() {
      const [{ activeWallet }, { submitsItself, pollarWallet }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
      const w = activeWallet();
      if (!w?.address) return "sin-red";
      if (submitsItself(w)) return pollarWallet.activarUsdc();
      return activarLineaPropia(network.name, w.address, w);
    },
    pausa: (ms) => new Promise((r) => setTimeout(r, ms)),
    monedas: urlDeCuenta(),
    dejarLista: () => import("./cuenta-lista-flujo").then((m) => m.abrirDesdeTusDolares()),
    pasarAOficial: () => void import("./modo-ui").then((m) => m.abrirHojaDeModo()),
    mandar: (cuenta, saldo) => void import("./mandar-usdc").then((m) => m.abrirMandar({ address: cuenta, saldo })),
  };
}

/* ------------------------------------------------------------------ la base de Ya lo mandé */

interface BaseLeida {
  valor: BaseDeLlegadas | null;
  /** Quedó guardada en el navegador antes de ahora: lo que no aparece después de ella, de verdad no es nuevo. */
  confiable: boolean;
}

const basesEnMemoria = new Map<string, BaseLeida>();
const claveDeBase = (red: NetworkName, cuenta: string): string => `tinkazo:saldo-base:${red}:${cuenta}`;

function leerBase(red: NetworkName, cuenta: string): BaseLeida {
  const k = claveDeBase(red, cuenta);
  try {
    const crudo = localStorage.getItem(k);
    const b = crudo ? (JSON.parse(crudo) as Partial<BaseDeLlegadas>) : null;
    if (b && typeof b.ms === "number" && Number.isFinite(b.ms) && (b.ultimoTx === null || (typeof b.ultimoTx === "string" && b.ultimoTx.length <= 128))) {
      return { valor: { ms: b.ms, ultimoTx: b.ultimoTx }, confiable: true };
    }
  } catch {
    /* sin almacenamiento: la de esta página */
  }
  return basesEnMemoria.get(k) ?? { valor: null, confiable: false };
}

function guardarBase(red: NetworkName, cuenta: string, b: BaseDeLlegadas, pisar: boolean): void {
  const k = claveDeBase(red, cuenta);
  let confiable = false;
  try {
    if (!pisar && localStorage.getItem(k)) return;
    localStorage.setItem(k, JSON.stringify(b));
    confiable = true;
  } catch {
    /* sin almacenamiento: queda la de esta página */
  }
  basesEnMemoria.set(k, { valor: b, confiable });
}

/* ------------------------------------------------------------------ la ventana */

type Vista = "inicio" | "traer";

interface Ventana {
  d: Dialogo;
  estadoLinea: HTMLParagraphElement;
  boton: HTMLButtonElement;
  cuenta: string;
  deps: DepsDeSaldo;
  abierta: boolean;
  vista: Vista;
  estado: EstadoParaRecibir | null;
  billetera: BilleteraParaRecibir | null;
  lectura: LecturaDeCuenta | null;
  /** La base de «Ya lo mandé» se está armando: «Ya lo mandé» la espera. */
  armandoBase: Promise<void> | null;
  /** El último pago que llegó, cuando «Ya lo mandé» no vio uno nuevo. */
  ultimo: { monto: bigint; ms: number } | null;
  /** «Ya lo mandé» vio llegar dólares: la principal pasa a Cerrar. */
  llegaron: boolean;
  /** Ya se pidió activar en esta ventana: no se ofrece pedirlo otra vez, solo volver a mirar. */
  activado: boolean;
  accion: (() => void) | null;
}

interface Pantalla {
  titulo?: string;
  linea?: string;
  /** HTML ya escapado. */
  datos?: string;
  plegado?: { resumen: string; textos: string[] };
  principal: { texto: string; accion: () => void };
  secundarios?: Array<{ id: string; texto: string; accion: () => void }>;
  /** Los secundarios antes del plegado (en el inicio, Mandar va antes que Cómo saco mi dinero). */
  secundariosArriba?: boolean;
  /** El saldo arriba. */
  conSaldo?: boolean;
}

const formatoDeMonto = (stroops: bigint): string => new Intl.NumberFormat(getLang(), { maximumFractionDigits: 7 }).format(Number(stroops) / 1e7);

const legible = (monto: string): string => {
  try {
    return formatoDeMonto(stroopsDe(monto));
  } catch {
    return monto;
  }
};

const fechaCorta = (ms: number): string => new Intl.DateTimeFormat(getLang(), { dateStyle: "short", timeStyle: "short" }).format(ms);

/** El saldo de USDC de Circle que se sabe: el de la línea, `0` si no la tiene, `null` si no se pudo leer. */
function saldoUsdc(v: Ventana): string | null {
  const l = v.lectura;
  if (l === null || typeof l !== "object") return null;
  const usdc = usdcDeLaRed(v.deps.red);
  return l.saldos.find((s) => s.code === usdc.code && s.issuer === usdc.issuer)?.saldo ?? "0";
}

const enPractica = (v: Ventana): boolean => v.deps.practica && v.deps.red !== "mainnet";

function textoDelSaldo(v: Ventana, saldo: string): string {
  let cero = true;
  try {
    cero = stroopsDe(saldo) <= 0n;
  } catch {
    cero = true;
  }
  if (cero) return t("cargaTenesNada");
  return con(t(enPractica(v) ? "saldoTenesPrueba" : "saldoTenes"), { n: legible(saldo) });
}

/** Lo que tapa todo: sin resolverlo no hay nada más que hacer en la ventana. */
const bloquea = (e: EstadoParaRecibir, red: NetworkName): boolean =>
  e.estado === "solo-oficial" || e.estado === "no-se-sabe" || e.estado === "otra-red" || e.estado === "billetera-nueva" || e.estado === "creandose" || abrePasoDeLaCuenta(e, red);

function pantallaDe(v: Ventana, e: EstadoParaRecibir): Pantalla {
  const volverAMirar = { texto: t("saldoVolverAMirar"), accion: () => void mirar(v) };
  const cerrar = { texto: t("acctClose"), accion: () => v.d.cerrar() };
  const volver = {
    id: "volver",
    texto: t("clVolver"),
    accion: () => {
      v.vista = "inicio";
      v.estadoLinea.textContent = "";
      pintar(v);
    },
  };

  if (bloquea(e, v.deps.red)) {
    if (e.estado === "solo-oficial") {
      return {
        titulo: t("saldoSoloOficialTitulo"),
        linea: t("saldoSoloOficial"),
        principal: {
          texto: t("modeSwitchToOfficial"),
          accion: () => {
            v.d.cerrar();
            v.deps.pasarAOficial();
          },
        },
      };
    }
    if (abrePasoDeLaCuenta(e, v.deps.red)) {
      return {
        linea: t("cargaCuentaPrimero"),
        principal: {
          texto: t("cargaCuentaPrimeroBtn"),
          accion: () => {
            v.d.cerrar();
            void v.deps.dejarLista().then((lista) => {
              if (lista) abrirSaldo({ address: v.cuenta }, v.deps);
            });
          },
        },
      };
    }
    if (e.estado === "otra-red") return { linea: con(t("saldoOtraRed"), { red: v.deps.red === "mainnet" ? "Mainnet" : "Testnet" }), principal: volverAMirar };
    if (e.estado === "billetera-nueva") return { titulo: t("saldoBilleteraNuevaTitulo"), linea: t("saldoBilleteraNueva"), principal: volverAMirar };
    if (e.estado === "creandose") return { titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoPuedeApp"), principal: volverAMirar };
    return { linea: t("saldoNoSeSabe"), plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoNoSeSabeMas")] }, principal: volverAMirar };
  }

  if (v.vista === "inicio") {
    // Mandar, solo si la cuenta puede recibir (está lista y protegida) y tiene algo para mandar.
    const saldo = saldoUsdc(v);
    let stroops = 0n;
    try {
      stroops = saldo === null ? 0n : stroopsDe(saldo);
    } catch {
      stroops = 0n;
    }
    const mandar =
      e.estado === "puede" && stroops > 0n
        ? [
            {
              id: "mandar",
              texto: t("saldoMandarBtn"),
              accion: () => {
                v.d.cerrar();
                v.deps.mandar(v.cuenta, stroops);
              },
            },
          ]
        : [];
    return {
      conSaldo: true,
      linea: t("saldoLead"),
      secundarios: mandar,
      secundariosArriba: true,
      plegado: { resumen: t("cargaComoSaco"), textos: [t("cargaComoSacoTexto")] },
      principal: {
        texto: t("cargaYaTengo"),
        accion: () => {
          v.vista = "traer";
          v.estadoLinea.textContent = "";
          pintar(v);
        },
      },
    };
  }

  switch (e.estado) {
    case "puede":
      return {
        conSaldo: true,
        titulo: t("saldoRecibirTitulo"),
        linea: t("saldoRecibirOjo"),
        datos: datosParaRecibir(v),
        plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoRecibirComo"), t("saldoDirAyuda")] },
        principal: v.llegaron ? cerrar : { texto: t("saldoYaMande"), accion: () => void yaLoMande(v) },
        secundarios: [volver],
      };
    case "falta-activar": {
      const propia = v.billetera?.tipo === "propia";
      // Sin la línea no hay saldo que mostrar: el título ya dice lo que falta.
      return {
        titulo: t("saldoActivarTitulo"),
        linea: t(propia ? "saldoActivarPropio" : "saldoActivarApp"),
        ...(propia ? { plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoActivarPropioMas")] } } : {}),
        principal: v.activado ? volverAMirar : { texto: t("saldoActivarBtn"), accion: () => void activar(v) },
        secundarios: [volver],
      };
    }
    case "activandose":
      return { titulo: t("saldoActivarTitulo"), linea: t("saldoActivandoEspera"), principal: volverAMirar, secundarios: [volver] };
    case "falta-xlm":
      return { titulo: t("saldoActivarTitulo"), linea: con(t("saldoFaltaXlm"), { n: legible(e.necesita), m: legible(e.tiene) }), principal: volverAMirar, secundarios: [volver] };
    case "no-recibe-mas":
      return { conSaldo: true, titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoRecibeMas"), principal: cerrar, secundarios: [volver] };
    default:
      return { titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoPuedeApp"), principal: cerrar, secundarios: [volver] };
  }
}

function datosParaRecibir(v: Ventana): string {
  const ultimo = v.ultimo ? `<p class="saldo-ultimo" data-saldo="ultimo">${esc(con(t("saldoUltimoLlego"), { cuando: fechaCorta(v.ultimo.ms), n: formatoDeMonto(v.ultimo.monto) }))}</p>` : "";
  return (
    `<dl class="saldo-datos">` +
    `<div class="saldo-dato"><dt>${esc(t("saldoDir"))}</dt><dd><code class="saldo-dir" data-saldo="dir">${esc(v.cuenta)}</code>` +
    `<button type="button" class="mini" data-saldo="copiar" aria-label="${esc(`${t("acctCopy")}: ${t("saldoDir")}`)}">${esc(t("acctCopy"))}</button></dd></div>` +
    `<div class="saldo-dato"><dt>${esc(t("saldoNota"))}</dt><dd>${esc(t("saldoNotaVacia"))}</dd></div></dl>` +
    `<img class="saldo-qr" data-saldo="qr" alt="${esc(t("saldoQrAlt"))}" width="176" height="176">` +
    ultimo
  );
}

function pintar(v: Ventana): void {
  if (!v.abierta) return;
  const e = v.estado;
  if (e === null) {
    // Mientras mira la cuenta: la línea de siempre y la principal apagada, sin dirección.
    v.d.cuerpo.innerHTML = `<section class="saldo-paso"><p class="saldo-lead">${esc(t("saldoLead"))}</p></section>`;
    v.boton.textContent = t("cargaYaTengo");
    v.boton.disabled = true;
    v.accion = null;
    return;
  }
  const p = pantallaDe(v, e);
  const saldo = p.conSaldo ? saldoUsdc(v) : null;
  const otras = p.secundarios?.length
    ? `<div class="saldo-otras">${p.secundarios.map((s) => `<button type="button" class="saldo-link" data-saldo="${esc(s.id)}">${esc(s.texto)}</button>`).join("")}</div>`
    : "";
  v.d.cuerpo.innerHTML =
    (enPractica(v) ? `<p class="saldo-practica">${esc(t("saldoPractica"))}</p>` : "") +
    (saldo !== null ? `<p class="saldo-total" data-saldo="total">${esc(textoDelSaldo(v, saldo))}</p>` : "") +
    `<section class="saldo-paso">` +
    (p.titulo ? `<h3 class="saldo-titulo">${esc(p.titulo)}</h3>` : "") +
    (p.linea ? `<p class="saldo-lead">${esc(p.linea)}</p>` : "") +
    (p.datos ?? "") +
    (p.secundariosArriba ? otras : "") +
    (p.plegado ? `<details class="saldo-mas"><summary>${esc(p.plegado.resumen)}</summary>${p.plegado.textos.map((x) => `<p>${esc(x)}</p>`).join("")}</details>` : "") +
    (p.secundariosArriba ? "" : otras) +
    `</section>`;

  for (const s of p.secundarios ?? []) v.d.cuerpo.querySelector<HTMLButtonElement>(`[data-saldo="${s.id}"]`)?.addEventListener("click", s.accion);
  const copiarBtn = v.d.cuerpo.querySelector<HTMLButtonElement>('[data-saldo="copiar"]');
  copiarBtn?.addEventListener("click", () => void copiar(copiarBtn, v.cuenta, t("acctCopy")));
  const qr = v.d.cuerpo.querySelector<HTMLImageElement>('[data-saldo="qr"]');
  if (qr) void pintarQr(qr, v.cuenta, 176).then((ok) => ok || qr.remove());

  v.boton.textContent = p.principal.texto;
  v.boton.disabled = false;
  v.accion = p.principal.accion;
}

/** Junta lo que hace falta saber de la cuenta y decide. Nunca lanza: lo que falla es `no-se-sabe`. */
async function leerEstado(v: Ventana): Promise<EstadoParaRecibir> {
  const { deps } = v;
  if (deps.red !== "mainnet" && !deps.practica) return { estado: "solo-oficial" };
  try {
    const billetera = await deps.billetera();
    v.billetera = billetera;
    if (!billetera) return { estado: "no-se-sabe" };
    const google = billetera.tipo === "google";
    const [lectura, proteccion] = await Promise.all([deps.mirar(v.cuenta), google && deps.red === "mainnet" ? deps.proteccion() : Promise.resolve(undefined)]);
    v.lectura = lectura;
    const entrada: EntradaParaRecibir = { red: deps.red, practica: deps.practica, billetera, lectura, proteccion };
    if (google && typeof lectura === "object") {
      const usdc = usdcDeLaRed(deps.red);
      if (!lectura.saldos.some((s) => s.code === usdc.code && s.issuer === usdc.issuer)) {
        const [pendiente, catalogo] = await Promise.all([deps.pendiente(), deps.catalogo()]);
        entrada.pendiente = pendiente;
        entrada.catalogo = catalogo;
      }
    }
    return estadoParaRecibir(entrada);
  } catch {
    return { estado: "no-se-sabe" };
  }
}

/** Mira la cuenta y pinta lo que corresponde. Si puede recibir, arma la base de «Ya lo mandé». */
async function mirar(v: Ventana): Promise<void> {
  v.boton.disabled = true;
  v.estadoLinea.classList.remove("ok");
  v.estadoLinea.textContent = t("saldoMirandoCuenta");
  const e = await leerEstado(v);
  if (!v.abierta) return;
  v.estado = e;
  v.estadoLinea.textContent = "";
  if (e.estado === "puede") v.armandoBase ??= armarBase(v);
  pintar(v);
}

/**
 * Activar dólares digitales: un toque, una sola activación. Lo que salió se dice en la línea de estado y, si cambió
 * algo de la cuenta, se vuelve a mirar para mostrar el paso que sigue.
 */
async function activar(v: Ventana): Promise<void> {
  v.boton.disabled = true;
  v.accion = null;
  v.estadoLinea.classList.remove("ok");
  v.estadoLinea.textContent = t(v.billetera?.tipo === "propia" ? "saldoActivarAprobar" : "saldoActivando");
  const r: ResultadoDeActivacion = await v.deps.activar().catch(() => "no-salio" as const);
  if (!v.abierta) return;
  if (r === "no-aprobada" || r === "ahora-no") {
    // No se pidió nada que siga vivo: se puede probar de nuevo.
    pintar(v);
    v.estadoLinea.textContent = t(r === "no-aprobada" ? "saldoActivarNoAprobado" : "saldoActivarAhoraNo");
    return;
  }
  // Lo que se pidió puede seguir vivo: en esta ventana ya no se ofrece pedirlo otra vez (cada pedido nuevo se apila).
  if (r === "hecho" || r === "en-curso" || r === "enviada" || r === "no-patrocina") v.activado = true;
  await mirar(v);
  // Con Google la línea entra después: se mira un rato hasta verla.
  for (let i = 0; r === "hecho" && v.abierta && v.estado?.estado !== "puede" && i < VUELTAS_TRAS_ACTIVAR; i++) {
    await v.deps.pausa(CADA_MS);
    if (v.abierta) await mirar(v);
  }
  if (!v.abierta) return;
  if (v.estado?.estado === "puede" && (r === "activada" || r === "hecho")) {
    v.estadoLinea.textContent = t("saldoActivadoOk");
    v.estadoLinea.classList.add("ok");
  } else if (r === "hecho" || r === "en-curso" || r === "enviada") v.estadoLinea.textContent = t("saldoActivandoEspera");
  else if (r === "no-patrocina") v.estadoLinea.textContent = t("saldoNoPuedeApp");
  else if (r === "no-salio") v.estadoLinea.textContent = t("saldoActivarNoSalio");
}

/** La primera vez que la cuenta puede recibir en este aparato: el pago más nuevo que ya había. No pisa una guardada. */
async function armarBase(v: Ventana): Promise<void> {
  if (leerBase(v.deps.red, v.cuenta).valor) return;
  const r = await v.deps.pagos(v.cuenta, (ps) => ps.some((p) => esLlegada(p, v.cuenta))).catch(() => ({ ok: false }) as const);
  if (!r.ok) {
    v.armandoBase = null;
    return;
  }
  guardarBase(v.deps.red, v.cuenta, { ms: Date.now(), ultimoTx: r.valor.find((p) => esLlegada(p, v.cuenta))?.tx ?? null }, false);
}

/** «Ya lo mandé»: qué llegó desde la base. Nunca invita a mandar de nuevo. */
async function yaLoMande(v: Ventana): Promise<void> {
  v.boton.disabled = true;
  v.estadoLinea.classList.remove("ok");
  v.estadoLinea.textContent = t("saldoMirando");
  await v.armandoBase?.catch(() => undefined);
  const base = leerBase(v.deps.red, v.cuenta);
  const tope = base.valor?.ultimoTx ?? null;
  const parar = tope ? (ps: Pago[]): boolean => ps.some((p) => p.tx === tope) : (ps: Pago[]): boolean => ps.some((p) => esLlegada(p, v.cuenta));
  const [r, lectura] = await Promise.all([v.deps.pagos(v.cuenta, parar).catch(() => ({ ok: false }) as const), v.deps.mirar(v.cuenta).catch(() => "sin-red" as const)]);
  if (!v.abierta) return;
  if (typeof lectura === "object") v.lectura = lectura;
  if (!r.ok) {
    pintar(v);
    v.estadoLinea.textContent = t("saldoError");
    return;
  }
  const l = queLlego(r.valor, v.cuenta, base.valor);
  if (l.tipo === "llegaron") {
    guardarBase(v.deps.red, v.cuenta, { ms: Date.now(), ultimoTx: l.ultimoTx }, true);
    let texto = con(t("saldoLlegaron"), { n: formatoDeMonto(l.monto) });
    if (v.deps.monedas) {
      const c = await revisarCarga(v.cuenta, { horizon: contextoHorizon(), base: v.deps.monedas }).catch(() => null);
      if (c?.estado === "llego" && c.monedas > 0) texto += ` ${con(t("saldoLlegoMonedas"), { n: c.monedas })}`;
    }
    if (!v.abierta) return;
    v.ultimo = null;
    v.llegaron = true;
    pintar(v);
    v.estadoLinea.textContent = texto;
    v.estadoLinea.classList.add("ok");
    return;
  }
  v.ultimo = l.tipo === "ultimo" ? { monto: l.monto, ms: l.ms } : null;
  pintar(v);
  // Sin una base guardada de antes no se sabe si el último es el que acaba de mandar: no se dice que no hay uno nuevo.
  if (l.tipo === "ultimo") v.estadoLinea.textContent = base.confiable ? `${t("saldoNoVemosNuevo")} ${t("saldoEsperaNoMandes")}` : t("saldoEsperaNoMandes");
  else v.estadoLinea.textContent = `${t("saldoNoLlegoTodavia")} ${t("saldoEsperaNoMandes")}`;
}

/**
 * Abre «Tus dólares digitales». Con la bandera apagada no abre nada. `deps` reemplaza lo del sitio (en las pruebas).
 */
export function abrirSaldo(o: { address: string }, deps: Partial<DepsDeSaldo> = {}): void {
  if (modoDeRampa() === "apagada") return;
  const v: Ventana = {
    d: undefined as unknown as Dialogo,
    estadoLinea: lineaDeEstado(),
    boton: botonPrincipal(t("cargaYaTengo")),
    cuenta: o.address,
    deps: { ...depsDelSitio(), ...deps },
    abierta: true,
    vista: "inicio",
    estado: null,
    billetera: null,
    lectura: null,
    armandoBase: null,
    ultimo: null,
    llegaron: false,
    activado: false,
    accion: null,
  };
  v.d = abrirDialogo({
    titulo: t("saldoTitle"),
    onCerrar: () => {
      v.abierta = false;
    },
  });
  v.d.pie.append(v.estadoLinea, v.boton);
  v.boton.addEventListener("click", () => {
    if (!v.boton.disabled) v.accion?.();
  });
  pintar(v);
  void mirar(v);
}
