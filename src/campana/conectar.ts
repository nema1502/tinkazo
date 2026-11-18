/**
 * Conecta las pantallas del celular (`DepsDelCelular`) con lo de verdad: la sala de la campaña, la entrada con Google y la
 * llave de este celular. La página (`participar.ts`) le pasa las piezas ya armadas y esta función solo las une, así todo
 * se prueba sin navegador y sin red.
 *
 * Reglas que se cumplen acá y que importan el sábado:
 *  - El token de la sesión se pide en cada alta, viaja solo en el cuerpo y de ahí no pasa: no se guarda, no se escribe en
 *    la consola ni en ningún error. Lo único que se recuerda de un token rechazado es una huella, para no mandarlo dos veces.
 *  - La dirección no se toca: la clave, la sala y el pase siguen en ella porque volver a cargar y Copiar el enlace dependen
 *    de eso. La clave está en el QR del stand y el pase vence a los pocos minutos: ninguno es un secreto de una persona.
 *  - Con 150 celulares a la vez, las consultas se desparraman en el tiempo y los reintentos del alta tienen tope.
 */

import { cifrarEquipo } from "../equipos/datos";
import { llaveDelCelular } from "../equipos/celular";
import {
  anotarmeEnCampana,
  estadoPublico,
  miEstado,
  resultadoDeCampana,
  type DependenciasDeCampana,
  type SosiegoDelAlta,
} from "../sala/campana";
import type { NetworkName } from "../stellar/config";
import { cargarCampana, type ResultadoDeCarga } from "./carga";
import type { DepsDelCelular, EstadoPublico, MotivoDeAlta, ResultadoDelAlta, SesionDelCelular } from "./celular";
import type { Campana } from "./modelo";
import { leerMemoria } from "./memoria";
import type { SesionDeGoogle } from "./sesion";

/** Lo que el celular consulta cada 15 segundos se estira a 30: 150 pestañas visibles suman 18.000 pedidos por hora. */
export const CONSULTA_ESTIRADA_MS = 30_000;
/** Cuánto se espera para repetir la primera carga o la primera consulta, si fallaron. */
export const ESPERA_DE_LA_PRIMERA_MS = 3_000;

export type BaseDelCelular = Pick<
  DepsDelCelular,
  "tx" | "idioma" | "enApp" | "ahora" | "cada" | "visible" | "alVolver" | "vibrar" | "movimientoReducido"
>;

/** Un almacenamiento en memoria para cuando el navegador bloquea el de verdad: la llave vale mientras la página esté abierta. */
export function almacenEnMemoria(): Pick<Storage, "getItem" | "setItem"> {
  const datos = new Map<string, string>();
  return {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

/** Si este celular ya tenía una llave para esta sala antes de pedirla: leer no crea ninguna. */
export function teniaLlave(sala: string, almacen: Pick<Storage, "getItem">): boolean {
  let creada = false;
  llaveDelCelular(sala, {
    getItem: (clave) => almacen.getItem(clave),
    setItem: () => {
      creada = true;
    },
  });
  return !creada;
}

/** El destino de Recibir mi premio, según la red de esta página. */
export const destinoDeRecibir = (red: NetworkName): string => (red === "mainnet" ? "/?red=oficial&premio=1" : "/?red=prueba&premio=1");

/** Una huella corta del token para saber si es el mismo que ya se rechazó. El token en claro no se guarda. */
async function huellaDe(token: string): Promise<string> {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
    return Array.from(bytes.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // Sin criptografía del navegador (una página sin https): una huella simple alcanza para comparar dos tokens.
    let huella = 2166136261;
    for (let i = 0; i < token.length; i += 1) huella = Math.imul(huella ^ token.charCodeAt(i), 16777619);
    return (huella >>> 0).toString(16);
  }
}

const esperar = (ms: number): Promise<void> =>
  new Promise((resolver) => {
    setTimeout(resolver, ms);
  });

/** Baja la campaña de la sala. Si no hubo respuesta, repite una vez a los 3 segundos: es el momento más probable de falla. */
export async function cargarConUnReintento(
  fetchServicio: typeof fetch,
  servicio: string,
  sala: string,
  evento: string,
  espera: (ms: number) => Promise<void> = esperar,
): Promise<ResultadoDeCarga> {
  const primera = await cargarCampana(fetchServicio, servicio, sala, evento);
  if (primera.ok || primera.estado !== "sin-red") return primera;
  await espera(ESPERA_DE_LA_PRIMERA_MS);
  return cargarCampana(fetchServicio, servicio, sala, evento);
}

export interface PiezasDelCelular {
  base: BaseDelCelular;
  campana: Campana;
  servicio: string;
  sala: string;
  /** La clave del QR, que cifra el nombre. Viene del fragmento de la dirección y no sale de la página. */
  clave: string;
  /** El pase del QR, o null si el enlace no lo trae. */
  pase: string | null;
  google: SesionDeGoogle;
  /** Donde vive la memoria del celular (`localStorage`), o null si el navegador lo bloquea. */
  memoria: Storage | null;
  red: NetworkName;
  /** Si el navegador dice que no hay conexión: sin ella no se pide ni el token. */
  enLinea: () => boolean;
  /** Si hay una marca del proveedor de cuentas en este navegador, de cualquier billetera. */
  hayMarcaDelProveedor: () => boolean;
  /** Lleva a la herramienta a recibir el premio. */
  ir: (direccion: string) => void;
  /** El enlace de esta página, para Copiar el enlace. */
  enlace: () => string;
  /** Un solo alta a la vez por celular, aunque haya dos pestañas. Sin esto, cada pestaña cuida solo la suya. */
  bloquear?: <T>(nombre: string, trabajo: () => Promise<T>) => Promise<T>;
  /** Para pedir sin la red de verdad. */
  dep?: DependenciasDeCampana;
}

/** Las dependencias del celular con lo de verdad. */
export function depsConectadas(p: PiezasDelCelular): DepsDelCelular {
  const dep: DependenciasDeCampana = p.dep ?? {};
  const ahora = dep.ahora ?? ((): number => Date.now());
  const azar = dep.azar ?? Math.random;
  const almacenDeLlaves = p.memoria ?? almacenEnMemoria();
  const habiaLlave = teniaLlave(p.sala, almacenDeLlaves);
  const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: null };
  const bloquear = p.bloquear ?? (<T>(_nombre: string, trabajo: () => Promise<T>): Promise<T> => trabajo());
  /** La sesión de esta página. Con ella `anotar` y `yo` saben la cuenta sin que las pantallas se la pasen. */
  let actual: SesionDelCelular | null = null;
  /** Lo último que la sala rechazó en esta carga: sirve para no repetir un pedido que dará lo mismo. */
  let ultimoFinal: MotivoDeAlta | null = null;
  let soloGoogleDe: string | null = null;
  let huellaRechazada: string | null = null;
  let primeraConsulta = true;

  const recordar = <T extends SesionDelCelular | null>(sesion: T): T => {
    actual = sesion;
    return sesion;
  };
  const olvidarRechazos = (): void => {
    ultimoFinal = null;
    soloGoogleDe = null;
    huellaRechazada = null;
  };
  const cuentaActual = (): string | null =>
    actual?.cuenta ?? leerMemoria(p.memoria, p.sala, ahora())?.cuenta ?? null;
  /** La llave se lee de nuevo cada vez: con dos pestañas abiertas, las dos usan la que quedó guardada. */
  const llave = (): string => llaveDelCelular(p.sala, almacenDeLlaves);

  async function consultarPublico(): Promise<EstadoPublico | "red" | "terminada"> {
    let r = await estadoPublico(p.servicio, p.sala, p.pase, dep);
    if (primeraConsulta) {
      primeraConsulta = false;
      if (r === "red") {
        await esperar(ESPERA_DE_LA_PRIMERA_MS);
        r = await estadoPublico(p.servicio, p.sala, p.pase, dep);
      }
    }
    // Quien ya estuvo acá y tiene su cuenta guardada no se frena por un pase vencido: la sala la reconoce igual, y si no
    // estaba anotada, el alta le dirá que escanee de nuevo.
    if (r !== "red" && r !== "terminada" && r.pase === "vencido" && habiaLlave && p.hayMarcaDelProveedor()) {
      return { ...r, pase: "sin" };
    }
    return r;
  }

  async function anotarEnLaSala(
    nombre: string | null,
    alReintentar: (motivo: "mucha" | "creando") => void,
    inicio: number,
  ): Promise<ResultadoDelAlta> {
    const cuenta = actual?.cuenta ?? null;
    // Lo que la sala ya dijo de esta cuenta no se repite: cada toque más cuenta como un rechazo de su ficha.
    if (cuenta !== null && cuenta === soloGoogleDe) return { ok: false, motivo: "solo-google" };
    if (!p.enLinea()) return { ok: false, motivo: "red" };
    const token = await p.google.token();
    if (!token) {
      // Con la sesión todavía en la página, lo que falta es que el proveedor la confirme: no es una sesión vencida.
      const sigue = cuenta !== null && (await p.google.sigueLaSesion(cuenta));
      return { ok: false, motivo: sigue ? "proveedor" : "sesion" };
    }
    const huella = await huellaDe(token);
    if (huellaRechazada !== null && huella === huellaRechazada) return { ok: false, motivo: "sesion" };
    const d = await cifrarEquipo(p.clave, { nombre: nombre ?? "", integrantes: [] });
    const r = await anotarmeEnCampana(
      p.servicio,
      p.sala,
      { token, d, llave: llave(), p: p.pase },
      dep,
      alReintentar,
      { inicio, sosiego },
    );
    if (r.ok) {
      ultimoFinal = null;
      // La sala anotó otra cuenta que la de esta sesión: no se dice cuál.
      if (r.cuenta !== actual?.cuenta) return { ok: false, motivo: "otro" };
      return { ok: true, ya: r.ya };
    }
    // El tope de intentos de la sala dice lo mismo que el rechazo anterior: la traba es de la sesión o de la cuenta que no se
    // terminó de crear, no de la conexión.
    const previo = ultimoFinal;
    const heredaElMotivo = previo === "solo-google" || previo === "sesion" || previo === "cuentas";
    const motivo = r.porRechazos && heredaElMotivo ? previo : r.motivo;
    ultimoFinal = motivo;
    if (motivo === "solo-google" && cuenta !== null) soloGoogleDe = cuenta;
    if (motivo === "sesion") huellaRechazada = huella;
    const sePudoPerder = motivo === "red" || motivo === "wifi" || motivo === "espera" || motivo === "proveedor" || motivo === "cuentas";
    if (cuenta !== null && sePudoPerder) {
      // La sala pudo anotarla y perderse la respuesta (o pasarse el tope de reingresos de quien ya estaba): se pregunta una vez.
      const propio = await miEstado(p.servicio, p.sala, cuenta, llave(), dep);
      if (propio !== "red" && propio !== "terminada" && propio.anotada) return { ok: true, ya: true };
    }
    return { ok: false, motivo };
  }

  return {
    ...p.base,
    // Las consultas de cada 15 segundos pasan a 30, y cada celular elige su propio ritmo: no pegan todos en el mismo segundo.
    cada: (f, ms) => p.base.cada(f, Math.round((ms === 15_000 ? CONSULTA_ESTIRADA_MS : ms) * (0.8 + azar() * 0.4))),
    campana: p.campana,
    publico: consultarPublico,
    sesion: async () => recordar(await p.google.retomar()),
    entrar: async () => {
      olvidarRechazos();
      return recordar(await p.google.entrar());
    },
    // El toque se cuenta desde que este celular tiene el candado: esperar a que otra pestaña termine no gasta el tiempo del toque.
    anotar: (nombre, alReintentar) =>
      bloquear(`tinkazo.campana.alta.${p.sala}`, () => anotarEnLaSala(nombre, alReintentar, ahora())),
    yo: async () => {
      const cuenta = cuentaActual();
      if (cuenta === null) return "red";
      return miEstado(p.servicio, p.sala, cuenta, llave(), dep);
    },
    resultado: async () => {
      const r = await resultadoDeCampana(p.servicio, p.sala, dep);
      // El celular ya llega a Terminó por el estado y por `yo`: acá solo le sirve lo que se pudo leer.
      return r === "terminada" ? "red" : r;
    },
    recibir: () => p.ir(destinoDeRecibir(p.red)),
    salir: async () => {
      actual = null;
      olvidarRechazos();
      await p.google.salir();
    },
    costoDelRetiro: () => null,
    enlace: p.enlace,
    memoria: p.memoria,
    sala: p.sala,
  };
}
