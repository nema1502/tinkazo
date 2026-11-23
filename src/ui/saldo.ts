import { type Lectura, type Pago, pagosEntrantes } from "../../workers/cuenta/src/pagos";
import { costoDelRetiroTexto } from "../costo-del-retiro";
import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { contextoHorizon, revisarCarga } from "../stellar/carga";
import { type ResultadoDeLinea, activarLineaPropia } from "../stellar/linea-propia";
import type { ResultadoDeActivarUsdc } from "../stellar/wallet-pollar";
import { type NetworkName, network } from "../stellar/config";
import { modoDeRampa, pagarConGoogle, practicaDeRampa, urlDeCuenta, votoPorContenido } from "../stellar/cuenta-config";
import { passphraseDe } from "../stellar/oficiales";
import { stroopsDe } from "../stellar/pagos";
import { montoConCentavos, type RedondeoDeMonto } from "../campana/formato";
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
  tieneFirmanteAjeno,
  usdcDeLaRed,
} from "../stellar/usdc-cuenta";
import { type Dialogo, abrirDialogo, botonPrincipal, copiar, lineaDeEstado } from "./dialogo";
import { type FilaViva, crearFilaViva } from "./fila-viva";
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
 *
 * Con `VITE_RAMPA=premios` la ventana deja ver el saldo y recibir un premio, y nada más: sin Mandar, sin la dirección ni
 * el QR para traer saldo de afuera y sin «Ya lo mandé» (`pantallaDelPremio`). Cada estado dice un título, como mucho una
 * línea y tiene una sola acción principal: lo que no evita un error no se escribe.
 *
 * Con el voto por contenido y el kit votando a mano (`votaPorContenido`), la cuenta de Google también retira con Mandar y
 * la cuenta que ya puede recibir no deja de organizar. Con `VITE_PAGAR_CON_GOOGLE=1` además se prepara la cuenta para
 * recibir y pagar, y «Cargar dólares digitales» muestra la dirección con el QR y «Ya lo mandé» (docs/architecture.md, La
 * cuenta de Google o de correo en la red principal).
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
  /**
   * Solo con Google: si ya espera un pedido de activar los dólares digitales con un voto en curso, o `null` si no se sabe.
   * Uno sin voto (el que abre solo el proveedor) no cuenta: la ventana ofrece activar y el toque lo vota.
   */
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
  /**
   * Solo con Google: si el navegador vota a mano lo que arma la página (la cuenta que ya puede recibir sigue sellando y
   * sorteando, y retira con Mandar). Sin esto, o si falla, no: la cuenta que puede recibir premios no organiza.
   */
  votaPorContenido?(): Promise<boolean>;
  /** Cuánto cuesta cada retiro, como se dice en pantalla (`0,50`), o `null` si no se cobra. Sin esto, el del sitio. */
  costoDelRetiro?(): string | null;
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
    async votaPorContenido() {
      if (!votoPorContenido()) return false;
      const { pollarWallet } = await import("../stellar/wallet-pollar");
      return pollarWallet.votaPorContenido();
    },
    costoDelRetiro: () => costoDelRetiroTexto(),
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

/** Las dos vistas de la ventana: el inicio con el saldo, y «Traé tus dólares digitales» con la dirección para cargar. */
export type Vista = "inicio" | "traer";

interface Ventana {
  d: Dialogo;
  estadoLinea: HTMLParagraphElement;
  /** La fila viva del pie: vive dentro de la línea de estado y ocupa su lugar mientras espera. */
  fila: FilaViva;
  boton: HTMLButtonElement;
  cuenta: string;
  deps: DepsDeSaldo;
  abierta: boolean;
  /** El modo `premios`: ver el saldo y recibir un premio, y nada más. */
  premios: boolean;
  vista: Vista;
  estado: EstadoParaRecibir | null;
  billetera: BilleteraParaRecibir | null;
  /** Con Google: el navegador vota a mano lo que arma la página, así que la cuenta que puede recibir sigue organizando. */
  vota: boolean;
  lectura: LecturaDeCuenta | null;
  /** La base de «Ya lo mandé» se está armando: «Ya lo mandé» la espera. */
  armandoBase: Promise<void> | null;
  /** El último pago que llegó, cuando «Ya lo mandé» no vio uno nuevo. */
  ultimo: { monto: bigint; ms: number } | null;
  /** «Ya lo mandé» vio llegar dólares: la principal pasa a Seguir. */
  llegaron: boolean;
  /** Ya se pidió activar en esta ventana: no se ofrece pedirlo otra vez, solo volver a mirar. */
  activado: boolean;
  /** Un error ocupa el lugar de la línea del paso: se dice en el pie y la línea no se repite arriba. */
  conFallo: boolean;
  accion: (() => void) | null;
  /** Cuánto falta mandar, para decirlo en el título de la dirección. Null si quien abrió no lo sabe. */
  falta: string | null;
  /** Si la ventana mira sola la llegada, y si esa mirada ya está corriendo. */
  vigilar: boolean;
  vigilando: boolean;
  /** Pasaron los cinco minutos de mirar sola sin ver nada: se dice y se ofrece volver a mirar. */
  sinVer: boolean;
  /** La última mirada callada no pudo hablar con la red: se dice, y la mirada sigue. */
  sinRed: boolean;
  /** Lo que dice la fila mientras espera el envío. Después de «Ya lo mandé» sin novedad, lleva también el aviso de no mandar de nuevo. */
  textoEspera: string | null;
}

interface Pantalla {
  titulo?: string;
  linea?: string;
  /** Avisos que ocupan el lugar de la línea (solo el modo premios). */
  avisos?: string[];
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

/** Escribe un texto en la línea de estado. Una línea de texto ocupa el lugar de la fila viva, nunca las dos. */
function decir(v: Ventana, texto: string): void {
  v.fila.limpiar();
  v.estadoLinea.textContent = texto;
}

/** Todo monto de plata de la ventana lleva dos decimales (coma en español, punto en inglés). Ver montoConCentavos. */
const formatoDeMonto = (stroops: bigint, redondeo: RedondeoDeMonto = "abajo"): string => montoConCentavos(stroops, getLang(), redondeo);

const legible = (monto: string, redondeo: RedondeoDeMonto = "abajo"): string => {
  try {
    return formatoDeMonto(stroopsDe(monto), redondeo);
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

/**
 * Lo que se suma al final del plegado de cómo sacar el dinero: cuánto cuesta cada retiro. Solo con una cuenta de Google
 * de Tinkazo, que es la que paga ese costo (con una billetera propia el retiro no pasa por Tinkazo), solo en la red
 * principal (el dinero de práctica de la otra red no se cobra) y solo si hay un costo. Sin una de las tres cosas no suma
 * nada y el plegado queda como estaba.
 */
function textoDelCostoDelRetiro(v: Ventana): string[] {
  if (v.billetera?.tipo !== "google" || v.deps.red !== "mainnet") return [];
  const costo = v.deps.costoDelRetiro?.() ?? null;
  return costo === null ? [] : [con(t("saldoRetiroPorQue"), { c: costo })];
}

/** Lo que tapa todo: sin resolverlo no hay nada más que hacer en la ventana. */
const bloquea = (e: EstadoParaRecibir, red: NetworkName): boolean =>
  e.estado === "solo-oficial" || e.estado === "no-se-sabe" || e.estado === "otra-red" || e.estado === "billetera-nueva" || e.estado === "creandose" || abrePasoDeLaCuenta(e, red);

function pantallaDe(v: Ventana, e: EstadoParaRecibir): Pantalla {
  const volverAMirar = { texto: t("saldoVolverAMirar"), accion: () => void mirar(v) };
  const cerrar = { texto: t("acctClose"), accion: () => v.d.cerrar() };
  // Llegó el envío: la ventana no se cierra sola, y lo que sigue es seguir con el panel.
  const seguir = { texto: t("saldoSeguir"), accion: () => v.d.cerrar() };
  const volverAEsperar = { texto: t("saldoVolverAMirar"), accion: () => void volverAMirarElEnvio(v) };
  const volver = {
    id: "volver",
    texto: t("clVolver"),
    accion: () => {
      v.vista = "inicio";
      decir(v, "");
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
        linea: t(v.premios ? "saldoPremioPrimero" : "cargaCuentaPrimero"),
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

  if (v.premios) return pantallaDelPremio(v, e);

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
      plegado: { resumen: t("cargaComoSaco"), textos: [t("cargaComoSacoTexto"), ...textoDelCostoDelRetiro(v)] },
      principal: {
        texto: t("cargaYaTengo"),
        accion: () => irATraer(v),
      },
    };
  }

  switch (e.estado) {
    case "puede":
      // Llegó el envío: el cuerpo ya no pide mandar. Sin dirección ni QR que inviten a mandar de nuevo; la fila dice cuánto.
      if (v.llegaron) return { conSaldo: true, titulo: t("saldoLlegoT"), principal: seguir };
      return {
        conSaldo: true,
        titulo: tituloDeCargar(v),
        linea: t("saldoRecibirOjo"),
        datos: datosParaRecibir(v),
        plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoRecibirComo"), t("saldoDirAyuda")] },
        principal: v.llegaron ? seguir : v.sinVer ? volverAEsperar : { texto: t("saldoYaMande"), accion: () => void yaLoMande(v) },
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
      return { titulo: t("saldoActivarTitulo"), linea: con(t("saldoFaltaXlm"), { n: legible(e.necesita, "arriba"), m: legible(e.tiene) }), principal: volverAMirar, secundarios: [volver] };
    case "no-recibe-mas":
      return { conSaldo: true, titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoRecibeMas"), principal: cerrar, secundarios: [volver] };
    default:
      return { titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoPuedeApp"), principal: cerrar, secundarios: [volver] };
  }
}

/**
 * Con Google en la red principal, `VITE_PAGAR_CON_GOOGLE=1`, `VITE_RAMPA=premios` y el kit votando a mano: la ventana
 * prepara la cuenta para recibir y para pagar, y deja cargar dólares digitales desde otra app. Si el kit no votó a mano, esa
 * cuenta no podría pagar lo que cargue: la ventana queda como sin la variable.
 */
const conCarga = (v: Ventana): boolean => v.premios && v.billetera?.tipo === "google" && v.deps.red === "mainnet" && v.vota && pagarConGoogle();

/**
 * El modo `premios`: una sola pantalla según el estado de la cuenta, con un título, como mucho una línea y una acción
 * principal. Ver el saldo y recibir un premio (activar la línea del dólar digital con el recorrido de siempre). Mandar y
 * cargar dólares solo aparecen con el voto por contenido y con pagar con Google; sin ellos, ni Mandar, ni la dirección ni el
 * QR para traer saldo de afuera, ni «Ya lo mandé», ni «Ya tengo dólares digitales». Las pantallas que tapan todo
 * (`bloquea`) ya se resolvieron.
 *
 * Un aviso no suma una línea: ocupa su lugar. Dice lo que evita un error: que una cuenta con un acceso que Tinkazo no puso
 * pida el premio en otra, y que mientras la cuenta reciba premios no sirve para organizar (solo cuando de verdad no puede
 * sellar: con el kit votando a mano, sí sirve).
 */
function pantallaDelPremio(v: Ventana, e: EstadoParaRecibir): Pantalla {
  const volverAMirar = { texto: t("saldoVolverAMirar"), accion: () => void mirar(v) };
  const cerrar = { texto: t("acctClose"), accion: () => v.d.cerrar() };
  const seguir = { texto: t("saldoSeguir"), accion: () => v.d.cerrar() };
  const volverAEsperar = { texto: t("saldoVolverAMirar"), accion: () => void volverAMirarElEnvio(v) };
  const volver = {
    id: "volver",
    texto: t("clVolver"),
    accion: () => {
      v.vista = "inicio";
      decir(v, "");
      pintar(v);
    },
  };
  const propia = v.billetera?.tipo === "propia";
  // Solo con Google: una cuenta con otra firma encima, que Tinkazo no puso. Avisa y no esconde Recibir un premio, porque la
  // regla supone cómo nacen las cuentas del proveedor y se midió en una sola cuenta real (`tieneFirmanteAjeno`). Si la regla
  // se equivocara con otras, no puede dejar a todos sin premios.
  const ajena = !propia && v.lectura !== null && typeof v.lectura === "object" && tieneFirmanteAjeno(v.lectura, v.cuenta);
  // Cargar dólares en esa cuenta sí se esconde: lo que se carga lo podría mover ese otro acceso. Quedan Mandar y el aviso.
  const carga = conCarga(v) && !ajena;
  // Con Google, en la red principal y sin el voto a mano, la cuenta que recibe premios no sella ni sortea (la puerta del
  // premio, `wallet-pollar.ts`, que fuera de la red principal no corre).
  const noOrganiza = !propia && !v.vota && v.deps.red === "mainnet";
  const avisos = [...(ajena ? [t("saldoPremioNoApta")] : []), ...(noOrganiza ? [t("saldoPremioNoOrganiza")] : [])];
  /** La línea del estado, o sus avisos en su lugar: nunca las dos cosas. */
  const dice = (linea: string): Pick<Pantalla, "linea" | "avisos"> => (avisos.length > 0 ? { avisos } : { linea });
  switch (e.estado) {
    case "puede": {
      if (carga && v.vista === "traer") {
        // Llegó el envío: el cuerpo ya no pide mandar. Sin dirección ni QR que inviten a mandar de nuevo; la fila dice cuánto.
        if (v.llegaron) return { conSaldo: false, titulo: t("saldoLlegoT"), principal: seguir };
        // Cargar: la dirección de la cuenta con su QR, y «Ya lo mandé». Una sola principal, y Volver.
        return {
          conSaldo: false,
          titulo: tituloDeCargar(v),
          linea: t("saldoCargarOjo"),
          datos: datosParaRecibir(v),
          plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoCargarComo")] },
          principal: v.llegaron ? seguir : v.sinVer ? volverAEsperar : { texto: t("saldoYaMande"), accion: () => void yaLoMande(v) },
          secundarios: [volver],
        };
      }
      const saldo = saldoUsdc(v);
      let stroops = 0n;
      try {
        stroops = saldo === null ? 0n : stroopsDe(saldo);
      } catch {
        stroops = 0n;
      }
      const secundarios: Array<{ id: string; texto: string; accion: () => void }> = [];
      if (carga) {
        secundarios.push({
          id: "cargar",
          texto: t("saldoCargarBtn"),
          accion: () => irATraer(v),
        });
      }
      // Mandar, solo con Google, el voto a mano y algo para mandar: es el retiro, con su costo a la vista.
      const mandar = !propia && v.vota && stroops > 0n;
      if (mandar) {
        secundarios.push({
          id: "mandar",
          texto: t("saldoMandarBtn"),
          accion: () => {
            v.d.cerrar();
            v.deps.mandar(v.cuenta, stroops);
          },
        });
      }
      // Cómo sacar el dinero va plegado. Con Mandar a la vista, solo lo que cuesta; sin Mandar, que todavía no se puede.
      const costo = textoDelCostoDelRetiro(v);
      const comoSaco = propia ? [t("saldoPremioRetirarPropia")] : mandar ? costo : [t("saldoPremioRetirarLuego"), ...costo];
      // La acción de verdad es la principal (cargar, o mandar para quien ganó), y cerrar queda en la X. Sin acciones, Cerrar.
      const [primera, ...resto] = secundarios;
      // Con el saldo arriba, "Tu cuenta está lista" repite lo que ya se ve. Con un acceso ajeno, el título dice qué hacer.
      const titulo = ajena ? t("saldoAjenaTitulo") : saldo !== null ? undefined : t("saldoPremioListoTitulo");
      return {
        conSaldo: true,
        ...(titulo !== undefined ? { titulo } : {}),
        ...dice(t(carga ? "saldoPuedeLinea" : "saldoPremioLlegaSolo")),
        ...(comoSaco.length > 0 ? { plegado: { resumen: t("cargaComoSaco"), textos: comoSaco } } : {}),
        ...(resto.length > 0 ? { secundarios: resto, secundariosArriba: true } : {}),
        principal: primera ? { texto: primera.texto, accion: primera.accion } : cerrar,
      };
    }
    case "falta-activar":
      return {
        titulo: t(carga ? "saldoPrepTitulo" : "saldoPremioRecibirTitulo"),
        ...dice(t(propia ? "saldoPremioActivarPropio" : carga ? "saldoPrepLinea" : "saldoPremioRecibirLinea")),
        ...(propia ? { plegado: { resumen: t("saldoMasDetalles"), textos: [t("saldoActivarPropioMas")] } } : {}),
        principal: v.activado ? volverAMirar : { texto: t(carga ? "saldoPrepBtn" : "saldoPremioRecibirBtn"), accion: () => void activar(v) },
      };
    case "activandose":
      return { titulo: t(carga ? "saldoPrepTitulo" : "saldoPremioRecibirTitulo"), linea: t("saldoActivandoEspera"), principal: volverAMirar };
    case "falta-xlm":
      return { titulo: t("saldoPremioRecibirTitulo"), linea: con(t("saldoFaltaXlm"), { n: legible(e.necesita, "arriba"), m: legible(e.tiene) }), principal: volverAMirar };
    case "no-recibe-mas":
      return { conSaldo: true, titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoRecibeMas"), principal: cerrar };
    default:
      return { titulo: t("saldoNoMandesTitulo"), linea: t("saldoNoPuedeApp"), principal: cerrar };
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

/** Cuánto mide el QR: lo más grande que deja ver también la dirección y el botón sin recorrer, en celular y en laptop. */
function anchoDelQr(): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= 900) return Math.max(176, Math.min(Math.round(h * 0.4), 320));
  return Math.max(120, Math.min(Math.round(w * 0.5), Math.round(h * 0.26)));
}

/** Un error del paso: ocupa el lugar de la línea, va en el pie y se marca como error. */
function fallar(v: Ventana, texto: string): void {
  v.conFallo = true;
  pintar(v);
  v.estadoLinea.classList.remove("ok");
  v.estadoLinea.classList.add("bad");
  decir(v, texto);
}

function pintar(v: Ventana): void {
  if (!v.abierta) return;
  const e = v.estado;
  if (e === null) {
    // Mientras mira la cuenta: la línea de siempre y la principal apagada, sin dirección. En el modo premios la principal es
    // Cerrar y no se apaga: un botón que dice Cerrar y no cierra engaña, y la mirada puede tardar hasta 10 segundos.
    v.d.cuerpo.innerHTML = `<section class="saldo-paso" data-saldo="mirando"><p class="saldo-lead">${esc(t("saldoLead"))}</p></section>`;
    v.boton.textContent = t(v.premios ? "acctClose" : "cargaYaTengo");
    v.boton.disabled = !v.premios;
    v.accion = v.premios ? () => v.d.cerrar() : null;
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
    (p.linea && !v.conFallo ? `<p class="saldo-lead">${esc(p.linea)}</p>` : "") +
    (p.avisos ?? []).map((a) => `<p class="saldo-lead" data-saldo="aviso">${esc(a)}</p>`).join("") +
    (p.datos ?? "") +
    (p.secundariosArriba ? otras : "") +
    (p.plegado ? `<details class="saldo-mas"><summary>${esc(p.plegado.resumen)}</summary>${p.plegado.textos.map((x) => `<p>${esc(x)}</p>`).join("")}</details>` : "") +
    (p.secundariosArriba ? "" : otras) +
    `</section>`;

  for (const s of p.secundarios ?? []) v.d.cuerpo.querySelector<HTMLButtonElement>(`[data-saldo="${s.id}"]`)?.addEventListener("click", s.accion);
  // Al abrir "Más detalles", lo que aparece se ve: el cuerpo se recorre y el texto quedaría debajo del borde.
  const mas = v.d.cuerpo.querySelector<HTMLDetailsElement>("details.saldo-mas");
  mas?.addEventListener("toggle", () => {
    if (mas.open) mas.scrollIntoView?.({ block: "nearest" });
  });
  const copiarBtn = v.d.cuerpo.querySelector<HTMLButtonElement>('[data-saldo="copiar"]');
  copiarBtn?.addEventListener("click", () => void copiar(copiarBtn, v.cuenta, t("acctCopy")));
  const qr = v.d.cuerpo.querySelector<HTMLImageElement>('[data-saldo="qr"]');
  if (qr) void pintarQr(qr, v.cuenta, anchoDelQr()).then((ok) => ok || qr.remove());

  v.boton.textContent = p.principal.texto;
  v.boton.disabled = false;
  v.accion = p.principal.accion;
  if (v.vigilar && v.vista === "traer" && e.estado === "puede" && !v.llegaron && !v.sinVer) void vigilarLlegada(v);
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
    v.vota = google && deps.votaPorContenido ? await deps.votaPorContenido().catch(() => false) : false;
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
  // La primera mirada del modo premios deja Cerrar encendido (`pintar`): mientras tanto no hay otra cosa que apretar.
  v.boton.disabled = !(v.premios && v.estado === null);
  v.conFallo = false;
  v.estadoLinea.classList.remove("ok", "bad");
  v.fila.revisando(t("saldoMirandoCuenta"));
  const e = await leerEstado(v);
  if (!v.abierta) return;
  v.estado = e;
  decir(v, "");
  // En el modo premios no hay «Ya lo mandé», salvo al cargar con pagar con Google: sin eso no se pide el historial de pagos.
  if (e.estado === "puede" && (!v.premios || conCarga(v))) v.armandoBase ??= armarBase(v);
  pintar(v);
}

/**
 * Activar dólares digitales: un toque, una sola activación. Lo que salió se dice en la línea de estado y, si cambió
 * algo de la cuenta, se vuelve a mirar para mostrar el paso que sigue.
 */
async function activar(v: Ventana): Promise<void> {
  v.boton.disabled = true;
  v.accion = null;
  v.conFallo = false;
  v.estadoLinea.classList.remove("ok", "bad");
  v.fila.revisando(t(v.billetera?.tipo === "propia" ? "saldoActivarAprobar" : "saldoActivando"));
  const r: ResultadoDeActivacion = await v.deps.activar().catch(() => "no-salio" as const);
  if (!v.abierta) return;
  if (r === "no-aprobada" || r === "ahora-no") {
    // No se pidió nada que siga vivo: se puede probar de nuevo.
    fallar(v, t(r === "no-aprobada" ? "saldoActivarNoAprobado" : "saldoActivarAhoraNo"));
    return;
  }
  if (r === "no-coincide" || r === "no-coincide-tope") {
    // La regla de la línea no votó el pedido y no se hizo nada. La primera vez se puede probar una vez más. Con el tope de
    // la pestaña ya no se ofrece pedirla otra vez en esta ventana, y se dice que escriba.
    if (r === "no-coincide-tope") v.activado = true;
    fallar(v, `${t("saldoActivarNoCoincide")} ${t(r === "no-coincide" ? "cofirmaOtraVez" : "cofirmaEscribinos")}`);
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
    v.fila.llego(t("saldoActivadoOk"));
  } else if (r === "hecho" || r === "en-curso" || r === "enviada") decir(v, t("saldoActivandoEspera"));
  else if (r === "no-patrocina") fallar(v, t("saldoNoPuedeApp"));
  else if (r === "no-salio") fallar(v, t("saldoActivarNoSalio"));
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

/** El título de la dirección para cargar: con el monto que falta si quien abrió lo sabe, y si no el de siempre. */
const tituloDeCargar = (v: Ventana): string => (v.falta ? con(t("saldoMandaT"), { n: v.falta }) : t("saldoRecibirTitulo"));

/**
 * Entra a la dirección para cargar. Si antes pasaron los cinco minutos sin ver nada, empieza de nuevo: la fila vuelve a decir
 * que espera y, con sinVer apagado, `pintar` relanza la mirada sola. Si la mirada anterior sigue viva (volvió antes de que
 * terminara su pausa), esa misma sigue y solo hace falta que la fila lo diga. No cambia qué se mira ni cada cuánto.
 */
function irATraer(v: Ventana): void {
  v.vista = "traer";
  v.sinVer = false;
  decir(v, "");
  pintar(v);
  if (v.vigilando && !v.llegaron) mostrarEspera(v);
}

/** Lo que dice la fila mientras la ventana mira sola: o que espera el envío, o que la red no contestó. */
function mostrarEspera(v: Ventana): void {
  if (v.sinRed) v.fila.noSalio(t("saldoVigilaSinRed"));
  else v.fila.revisando(v.textoEspera ?? t("saldoEsperando"));
}

/** Pasados los cinco minutos sin ver nada, «Volver a mirar» empieza de nuevo: mira ya y sigue mirando sola. */
async function volverAMirarElEnvio(v: Ventana): Promise<void> {
  v.sinVer = false;
  v.sinRed = false;
  v.textoEspera = null;
  await mirarSiLlego(v, false);
}

/** Cada cuánto mira sola si llegaron dólares, y hasta cuántas veces: unos cinco minutos con la dirección a la vista. */
const VIGILAR_CADA_MS = 6_000;
const VUELTAS_DE_VIGILAR = 50;

/**
 * Con la dirección para cargar a la vista, mira sola si llegaron dólares: quien mandó no tiene que volver a tocar nada. Es
 * la misma cuenta de «Ya lo mandé», callada: mientras no ve nada nuevo no dice nada ni toca el botón.
 */
async function vigilarLlegada(v: Ventana): Promise<void> {
  if (v.vigilando) return;
  v.vigilando = true;
  // Mientras espera, la fila lo dice: no queda una pantalla quieta que parezca colgada.
  mostrarEspera(v);
  try {
    let vueltas = 0;
    while (vueltas < VUELTAS_DE_VIGILAR && v.abierta && !v.llegaron && v.vista === "traer") {
      vueltas++;
      await v.deps.pausa(VIGILAR_CADA_MS);
      // Con «Ya lo mandé» corriendo (el botón apagado) no se mira dos veces a la vez.
      if (!v.abierta || v.llegaron || v.vista !== "traer" || v.boton.disabled) continue;
      await mirarSiLlego(v, true);
    }
    // Cinco minutos sin ver nada: se dice y se ofrece volver a mirar, en lugar de dejar de mirar en silencio.
    if (vueltas >= VUELTAS_DE_VIGILAR && v.abierta && !v.llegaron && v.vista === "traer") {
      v.sinVer = true;
      pintar(v);
      v.fila.noSalio(t("saldoSigueSinVer"));
    }
  } finally {
    v.vigilando = false;
  }
}

/** «Ya lo mandé»: qué llegó desde la base. Nunca invita a mandar de nuevo. */
const yaLoMande = (v: Ventana): Promise<void> => mirarSiLlego(v, false);

/**
 * Mira qué llegó desde la base. `callado` es la mirada que corre sola: no apaga el botón, no dice que está mirando y, si
 * no llegó nada o la red falló, deja la pantalla como estaba.
 */
async function mirarSiLlego(v: Ventana, callado: boolean): Promise<void> {
  if (!callado) {
    v.boton.disabled = true;
    v.estadoLinea.classList.remove("ok", "bad");
    v.fila.revisando(t("saldoMirando"));
  }
  await v.armandoBase?.catch(() => undefined);
  const base = leerBase(v.deps.red, v.cuenta);
  const tope = base.valor?.ultimoTx ?? null;
  const parar = tope ? (ps: Pago[]): boolean => ps.some((p) => p.tx === tope) : (ps: Pago[]): boolean => ps.some((p) => esLlegada(p, v.cuenta));
  const [r, lectura] = await Promise.all([v.deps.pagos(v.cuenta, parar).catch(() => ({ ok: false }) as const), v.deps.mirar(v.cuenta).catch(() => "sin-red" as const)]);
  if (!v.abierta) return;
  if (callado && (v.llegaron || v.boton.disabled)) return;
  if (!r.ok) {
    // La mirada callada no deja la pantalla quieta si la red falla: lo dice y sigue mirando.
    if (callado) {
      v.sinRed = true;
      mostrarEspera(v);
      return;
    }
    if (typeof lectura === "object") v.lectura = lectura;
    pintar(v);
    v.fila.noSalio(t("saldoError"));
    return;
  }
  v.fila.mirada();
  if (v.sinRed) {
    v.sinRed = false;
    if (callado) mostrarEspera(v);
  }
  // Un error de «Ya lo mandé» no se queda en la fila si la mirada sola ya volvió a ver la red: vuelve a decir que espera.
  if (v.vigilando && v.fila.estado() === "no-salio") mostrarEspera(v);
  const l = queLlego(r.valor, v.cuenta, base.valor);
  if (callado && l.tipo !== "llegaron") return;
  if (typeof lectura === "object") v.lectura = lectura;
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
    // La ventana no se cierra sola: el tilde y cuánto llegó quedan a la vista hasta que la persona toque Seguir.
    v.fila.llego(texto);
    return;
  }
  v.ultimo = l.tipo === "ultimo" ? { monto: l.monto, ms: l.ms } : null;
  // Sin una base guardada de antes no se sabe si el último es el que acaba de mandar: no se dice que no hay uno nuevo.
  const sinNovedad =
    l.tipo === "ultimo"
      ? base.confiable
        ? `${t("saldoNoVemosNuevo")} ${t("saldoEsperaNoMandes")}`
        : t("saldoEsperaNoMandes")
      : `${t("saldoNoLlegoTodavia")} ${t("saldoEsperaNoMandes")}`;
  // Con la mirada sola andando, el aviso de no mandar de nuevo ocupa el lugar de la espera: el pago doble se evita igual.
  v.textoEspera = sinNovedad;
  v.sinVer = false;
  pintar(v);
  if (v.vigilando) mostrarEspera(v);
  else v.fila.noSalio(sinNovedad);
}

/** Lo que quien abre la ventana puede pedir además de la cuenta. */
export interface OpcionesDeSaldo {
  /**
   * La vista con que abre. Con `traer` va directo a la dirección para cargar dólares digitales, sin pasar por el inicio
   * (lo usa «Pagar premio» cuando falta saldo). En el modo `premios` la ventana tiene una sola pantalla por estado y la
   * vista no cambia nada: la dirección para cargar llega con la cuenta que organiza con Google.
   */
  vista?: Vista;
  /** Se llama cuando la ventana se cierra, para que quien la abrió vuelva a leer el saldo. */
  alCerrar?: () => void;
  /** Cuánto falta mandar, ya escrito para mostrar (por ejemplo 1,50). Con esto la dirección para cargar lo dice en su título. */
  falta?: string;
  /** Mirar sola si llegaron dólares mientras la dirección está a la vista, sin esperar a que toquen Ya lo mandé. */
  vigilar?: boolean;
}

/**
 * Abre «Tus dólares digitales». Con la bandera apagada no abre nada. `deps` reemplaza lo del sitio (en las pruebas).
 */
export function abrirSaldo(o: { address: string }, deps: Partial<DepsDeSaldo> = {}, opciones: OpcionesDeSaldo = {}): void {
  const modo = modoDeRampa();
  if (modo === "apagada") return;
  const premios = modo === "premios";
  const estadoLinea = lineaDeEstado();
  const v: Ventana = {
    d: undefined as unknown as Dialogo,
    estadoLinea,
    fila: crearFilaViva(estadoLinea, { hace: (n) => con(t("saldoHace"), { n }) }),
    boton: botonPrincipal(t(premios ? "acctClose" : "cargaYaTengo")),
    cuenta: o.address,
    deps: { ...depsDelSitio(), ...deps },
    abierta: true,
    premios,
    vista: opciones.vista ?? "inicio",
    estado: null,
    billetera: null,
    vota: false,
    lectura: null,
    armandoBase: null,
    ultimo: null,
    llegaron: false,
    activado: false,
    conFallo: false,
    accion: null,
    falta: opciones.falta ?? null,
    vigilar: opciones.vigilar === true,
    vigilando: false,
    sinVer: false,
    sinRed: false,
    textoEspera: null,
  };
  v.d = abrirDialogo({
    titulo: t("saldoTitle"),
    onCerrar: () => {
      v.abierta = false;
      v.fila.detener();
      opciones.alCerrar?.();
    },
  });
  v.d.card.classList.add("dlg-saldo");
  v.d.pie.append(v.estadoLinea, v.boton);
  v.boton.addEventListener("click", () => {
    if (!v.boton.disabled) v.accion?.();
  });
  pintar(v);
  void mirar(v);
}
