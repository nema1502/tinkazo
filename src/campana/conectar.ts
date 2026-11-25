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

import { costoDelRetiroTexto } from "../costo-del-retiro";
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
import type { LecturaDelHistorial } from "../stellar/historial";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { cargarCampana, type ResultadoDeCarga } from "./carga";
import type { DepsDelCelular, EstadoPublico, MotivoDeAlta, ResultadoDelAlta, SesionDelCelular } from "./celular";
import type { Campana } from "./modelo";
import { MARCA_DE_CORREO_ENCENDIDA } from "./marca-de-correo";
import { VENTANA_RAPIDA_ENCENDIDA } from "./ventana-rapida";
import type { ComprobacionDelSello } from "./comprobar";
import { leerMemoria } from "./memoria";
import { destinoDeRecibir, enlaceParaMandar } from "./recibir";
import { hayLimiteDeLaRed, loRecordadoDelSello, marcarElLimiteDeLaRed, recordarElSello } from "./sello-memoria";
import type { SesionDeGoogle } from "./sesion";

/** Lo que el celular consulta cada 15 segundos se estira a 30: 150 pestañas visibles suman 18.000 pedidos por hora. */
export const CONSULTA_ESTIRADA_MS = 30_000;
/** Un retraso corto al azar antes de leer la cuenta: 150 celulares que entran juntos no le pegan al servicio en el mismo segundo. */
export const RETRASO_DE_LA_LECTURA_MS = 1_500;
/** Cuánto se espera para repetir la primera carga o la primera consulta, si fallaron. */
export const ESPERA_DE_LA_PRIMERA_MS = 3_000;
/**
 * Cuánto como máximo se demora, al azar, la comprobación del sello. 150 o 300 celulares reciben el resultado a la vez y cada
 * uno que comprueba (`FRACCION_QUE_COMPRUEBA`) baja por primera vez el SDK de Stellar (del orden de 150 kB comprimidos) para leer
 * el sello: unas 75 bajadas repartidas en 45 segundos son unos 2 Mbps en total y no compiten con el festejo, el sondeo de la sala
 * ni lo que hace quien organiza. La línea puede tardar: no es lo que la persona espera ver.
 */
export const RETRASO_DE_LA_COMPROBACION_MS = 45_000;
/**
 * A cuántos celulares les toca comprobar el sello: uno de cada cuatro, al azar. El navegador casi nunca dice que la conexión es
 * mala (en Android da 4g aun con Wi-Fi y Safari no lo da), así que el filtro de conexión no baja las descargas del SDK de
 * Stellar. Con 300 celulares detrás de la misma conexión, la comprobación pasa de unos 300 bajadas a unas 75. La línea no es
 * lo que la persona espera ver: a quien no le toca no se le dice nada, igual que antes de existir esta comprobación.
 */
export const FRACCION_QUE_COMPRUEBA = 0.25;

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

/** Lo que el navegador dice de la conexión (la API de información de red, que no tienen todos los navegadores). */
export interface ConexionDelNavegador {
  saveData?: boolean;
  effectiveType?: string;
}

/** Sin la API, `undefined`: no se sabe, y se comprueba. */
function conexionDelNavegador(): ConexionDelNavegador | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: ConexionDelNavegador }).connection;
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
  /** Lleva a la herramienta a recibir el premio. */
  ir: (direccion: string) => void;
  /** El enlace de esta página, para Copiar el enlace. */
  enlace: () => string;
  /** La dirección del sitio (con su esquema), para armar el enlace entero de Recibir mi premio. */
  origen?: () => string;
  /** Abre el menú de compartir del navegador con un enlace. Donde no hay menú, ausente. */
  compartir?: (enlace: string) => Promise<void>;
  /** Un solo alta a la vez por celular, aunque haya dos pestañas. Sin esto, cada pestaña cuida solo la suya. */
  bloquear?: <T>(nombre: string, trabajo: () => Promise<T>) => Promise<T>;
  /** Para pedir sin la red de verdad. */
  dep?: DependenciasDeCampana;
  /** La configuración del build que dice el costo de retirar. Sin ella, la de este sitio. */
  entorno?: Record<string, unknown>;
  /** El historial público de la red, para la comprobación del sello. Sin esto, el de verdad (se baja recién al hacer falta). */
  leerSello?: (red: NetworkName, hash: string) => Promise<LecturaDelHistorial>;
  /** Para esperar sin el reloj de verdad. */
  esperar?: (ms: number) => Promise<void>;
  /** El número entre 0 y 1 con el que este celular decide si comprueba el sello (comprueba si es menor que `FRACCION_QUE_COMPRUEBA`). Sin esto, el azar de siempre. */
  suerte?: () => number;
  /** Lo que el navegador dice de la conexión. Sin esto, el del navegador. */
  conexion?: () => ConexionDelNavegador | undefined;
}

/** Las dependencias del celular con lo de verdad. */
export function depsConectadas(p: PiezasDelCelular): DepsDelCelular {
  const dep: DependenciasDeCampana = p.dep ?? {};
  const ahora = dep.ahora ?? ((): number => Date.now());
  const azar = dep.azar ?? Math.random;
  const almacenDeLlaves = p.memoria ?? almacenEnMemoria();
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
  /** Con el ahorro de datos prendido o una conexión que no es de las buenas, el celular no baja nada de más. Sin dato, sí. */
  const conexionLimitada = (): boolean => {
    try {
      const c = (p.conexion ?? conexionDelNavegador)();
      return c !== undefined && (c.saveData === true || (typeof c.effectiveType === "string" && c.effectiveType !== "4g"));
    } catch {
      return false;
    }
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
    // Un pase vencido se dice tal cual, aunque la persona haya estado antes: la sala solo reconoce a quien ya anotó cuando
    // lleva un pase vigente, y quien no lo lleva recibiría un rechazo recién al tocar Acepto. Con el QR nuevo entra igual.
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
      // Si el servicio de cuentas frenó el pedido por límite, es eso lo que pasó: se dice con cuánto esperar.
      const espera = (await p.google.segundosDeLimite?.()) ?? null;
      if (espera !== null) return { ok: false, motivo: "limite", segundos: espera };
      // Con la sesión todavía en la página, lo que falta es que el proveedor la confirme: no es una sesión vencida.
      const sigue = cuenta !== null && (await p.google.sigueLaSesion(cuenta));
      return { ok: false, motivo: sigue ? "proveedor" : "sesion" };
    }
    const huella = await huellaDe(token);
    if (huellaRechazada !== null && huella === huellaRechazada) return { ok: false, motivo: "sesion" };
    // Con el token ya en mano el perfil está completo: si el nombre llegó tarde y esta alta salió sin él, se lee ahora.
    const nombreFinal = nombre ?? (await p.google.nombreTardio());
    const d = await cifrarEquipo(p.clave, { nombre: nombreFinal ?? "", integrantes: [] });
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
      // Anotarse con éxito también renueva la marca de invitada: quien participa no es quien organiza, y no debe dejar de serlo.
      p.google.renovar();
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
      if (propio !== "red" && propio !== "terminada" && propio.anotada) {
        p.google.renovar();
        return { ok: true, ya: true };
      }
    }
    return { ok: false, motivo };
  }

  return {
    ...p.base,
    // Las consultas de cada 15 segundos pasan a 30, y cada celular elige su propio ritmo: no pegan todos en el mismo segundo.
    // El del resultado (cada 8 o 15 segundos, con `azar`) ya viene con su ritmo y no se estira, y el reloj de la cuenta regresiva
    // (`exacta`) late cada segundo sin azar.
    cada: (f, ms, modo) => p.base.cada(f, modo === "exacta" ? ms : Math.round((modo === "azar" || ms !== 15_000 ? ms : CONSULTA_ESTIRADA_MS) * (0.8 + azar() * 0.4))),
    campana: p.campana,
    publico: consultarPublico,
    sesion: async () => recordar(await p.google.retomar()),
    nombreTardio: () => p.google.nombreTardio(),
    // Sin la lectura en la sesión (la demostración), la página no lee la cuenta ni cambia nada.
    ...(p.google.estadoDeLaCuenta
      ? {
        cuenta: {
          leer: async (cuenta): Promise<LecturaDelCelular> => {
            await esperar(Math.round(azar() * RETRASO_DE_LA_LECTURA_MS));
            return (p.google.estadoDeLaCuenta as (cuenta?: string) => Promise<LecturaDelCelular>)(cuenta);
          },
          // Para quien recarga ya anotada: antes de ir a recibir se compara la sesión de este navegador con su cuenta.
          ...(p.google.laSesionEs ? { laSesionEs: p.google.laSesionEs } : {}),
          // Sin esto no hay tarjeta de confirmar el correo: la cuenta se lee y nada más.
          ...(p.google.accionesDeLaCuenta ? { confirmar: p.google.accionesDeLaCuenta } : {}),
        },
      }
      : {}),
    entrar: async () => {
      olvidarRechazos();
      return recordar(await p.google.entrar());
    },
    // El toque se cuenta desde que este celular tiene el candado: esperar a que otra pestaña termine no gasta el tiempo del toque.
    anotar: (nombre, alReintentar) =>
      bloquear(`tinkazo.campana.alta.${p.sala}`, () => anotarEnLaSala(nombre, alReintentar, ahora())),
    yo: async (marca) => {
      const cuenta = cuentaActual();
      if (cuenta === null) return "red";
      // La marca de correo confirmado solo sale con la constante encendida, aunque la página la pida.
      return miEstado(p.servicio, p.sala, cuenta, llave(), dep, MARCA_DE_CORREO_ENCENDIDA && marca === true);
    },
    ...(MARCA_DE_CORREO_ENCENDIDA ? { marcaDeCorreo: true } : {}),
    // La ventana rápida del resultado solo con su interruptor encendido, y con el azar que reparte el primer pedido de cada tramo.
    ...(VENTANA_RAPIDA_ENCENDIDA ? { ventanaRapida: true } : {}),
    azar,
    resultado: async () => {
      const r = await resultadoDeCampana(p.servicio, p.sala, dep);
      // El celular ya llega a Terminó por el estado y por `yo`: acá solo le sirve lo que se pudo leer.
      return r === "terminada" ? "red" : r;
    },
    // La comprobación propia del sello se baja recién cuando hay resultado: la página de antes no carga nada de esto. Lo que cuida:
    //  - Una campaña con premios no la hace: su sello se lee también en el servicio de la red que usa quien organiza para sellar el
    //    siguiente premio y pagar, justo después del resultado, y ahí está la plata.
    //  - Con el ahorro de datos prendido o una conexión que no es de las buenas no baja ni lee nada.
    //  - Lo que ya se comprobó (o no se pudo hace poco) y el aviso de demasiados pedidos se recuerdan en el celular
    //    (`sello-memoria.ts`): recargar, volver a abrir el enlace o tener dos pestañas no repite lecturas.
    //  - Solo comprueba uno de cada cuatro celulares (`FRACCION_QUE_COMPRUEBA`): el navegador casi nunca dice que la conexión es
    //    mala, y con cientos de celulares detrás del mismo Wi-Fi la bajada del SDK es lo que pesa. Quien ya lo había comprobado
    //    sigue viendo su línea desde la memoria, sin leer nada.
    //  - Cada celular espera su turno al azar y la lectura se repite una vez si la red falla, con tope (`comprobar.ts`). Cada
    //    lectura es un solo pedido a la red (sin los reintentos de adentro) y no usa el lector que recuerda lo que falló: con
    //    cientos de celulares detrás de la misma conexión, los pedidos de más son lo que hace que la red empiece a limitar.
    comprobar: async ({ comprobante, cuenta, campana }) => {
      if (p.campana.promo !== null || conexionLimitada()) return null;
      const { contratoDePremios } = await import("../stellar/oficiales");
      if (contratoDePremios(p.red, p.campana.contrato) !== null) return null;
      const huella = await huellaDe(`${comprobante}\n${cuenta}`);
      const yaSeSabe = (): ComprobacionDelSello | undefined => {
        const recordado = loRecordadoDelSello(almacenDeLlaves, p.sala, huella, ahora());
        if (recordado === "esta") return "esta";
        return recordado === "no-se-pudo" || hayLimiteDeLaRed(almacenDeLlaves, ahora()) ? null : undefined;
      };
      const antes = yaSeSabe();
      if (antes !== undefined) return antes;
      // Solo a una parte de los celulares les toca comprobar: a los demás no se les pide ni esperar, ni bajar el SDK, ni leer.
      if (!((p.suerte ?? azar)() < FRACCION_QUE_COMPRUEBA)) return null;
      const dormir = p.esperar ?? esperar;
      await dormir(Math.round(azar() * RETRASO_DE_LA_COMPROBACION_MS));
      // Mientras esperaba su turno, otra pestaña pudo leer, o la red pudo pedir que se frene.
      const despues = yaSeSabe();
      if (despues !== undefined) return despues;
      const [{ comprobarConReintento }, leerSello] = await Promise.all([
        import("./comprobar"),
        p.leerSello
          ? Promise.resolve(p.leerSello)
          : import("../stellar/historial").then((m) => (red: NetworkName, hash: string) => m.leerHistorial(red, hash, { intentos: 1, distinguirLimite: true })),
      ]);
      const leer = async (red: string, hash: string): Promise<LecturaDelHistorial> => {
        const lectura = await leerSello(red as NetworkName, hash);
        if (!lectura.ok && lectura.limitado === true) marcarElLimiteDeLaRed(almacenDeLlaves, ahora());
        return lectura;
      };
      const dicho = await comprobarConReintento({ comprobante, cuenta, red: p.red, contrato: p.campana.contrato, campana }, { leer, esperar: dormir, ahora });
      recordarElSello(almacenDeLlaves, p.sala, huella, dicho, ahora());
      return dicho;
    },
    recibir: () => p.ir(destinoDeRecibir(p.red)),
    ...(p.origen ? { enlaceDelPremio: () => enlaceParaMandar(p.red, (p.origen as () => string)()) } : {}),
    ...(p.compartir ? { compartir: p.compartir } : {}),
    // Después de anotarse la página no le pide nada más al proveedor: suelta su cliente y lo vuelve a armar solo si hace falta.
    ...(p.google.soltar ? { soltarSesion: () => void p.google.soltar?.() } : {}),
    salir: async () => {
      actual = null;
      olvidarRechazos();
      await p.google.salir();
    },
    // Sin costo configurado en el build da null y las reglas no dicen nada del costo.
    costoDelRetiro: () => costoDelRetiroTexto(p.base.idioma(), p.entorno),
    enlace: p.enlace,
    memoria: p.memoria,
    sala: p.sala,
  };
}
