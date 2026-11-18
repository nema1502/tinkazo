/**
 * Entrar con Google desde el celular de una campaña, sin cargar la herramienta. Solo se pide con `import()` lo que hace
 * falta, y recién cuando hace falta: la billetera de Google (`stellar/wallet-pollar`). Nada de esto toca la herramienta
 * ni el paso de la cuenta de quien organiza.
 *
 * El token de la sesión no se guarda, no se anota y no se escribe en ningún error ni en la consola: se pide cada vez que
 * se usa. Los errores que salen de acá son siempre una `FallaDeEntrada` y nunca copian el mensaje del proveedor.
 */

import { stripInvisibles } from "../invisibles";
import { cuentaValida } from "../sala/campana";
import type { FallaDeEntrada, SesionDelCelular } from "./celular";
import { marcarInvitada, marcarVentana, soltarVentana } from "./invitada";

/** Lo máximo que se espera a que el proveedor retome una sesión guardada, para que la página no quede esperando. */
export const ESPERA_RETOMAR_MS = 3_000;
/** Cuánto se espera el token: con datos lentos la sesión tarda en quedar verificada, y decir que venció sería falso. */
export const ESPERA_TOKEN_MS = 20_000;
/** Desde acá un error de la entrada es que el proveedor no terminó de crear la cuenta: la ventana vence a los 120 segundos. */
export const ESPERA_DE_CUENTA_MS = 100_000;
/** Cada cuánto se vuelve a mirar el nombre del perfil, y cuántas veces: 5 segundos en total. */
export const MIRADA_DEL_NOMBRE_MS = 500;
export const MIRADAS_DEL_NOMBRE = 10;
/** Lo máximo que una entrada espera a que termine una sesión que ya se estaba retomando, antes de abrir la ventana de Google. */
export const ESPERA_DEL_RESTAURO_MS = 4_000;
/** Después de una falla del proveedor, no se vuelve a llamar durante este tiempo. */
export const FRENO_DE_ENTRADA_MS = 30_000;
/** Una segunda falla de Google dentro de este tiempo se dice como falla de la cuenta: nadie insiste en un bucle. */
export const VENTANA_DE_REPETICION_MS = 120_000;
const LARGO_DEL_NOMBRE = 30;

/** El nombre con que sale una persona en la pantalla del stand: la primera palabra y la inicial de la última. */
export function nombreParaLaPantalla(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const palabras = stripInvisibles(nombre).trim().split(/\s+/u).filter((palabra) => palabra !== "");
  const primera = palabras[0];
  if (primera === undefined) return null;
  const ultima = palabras[palabras.length - 1] ?? primera;
  const inicial = Array.from(ultima)[0] ?? "";
  const corto = palabras.length === 1 ? primera : `${primera} ${inicial.toLocaleUpperCase()}.`;
  return Array.from(corto).slice(0, LARGO_DEL_NOMBRE).join("");
}

export interface SesionDeGoogle {
  /** La sesión que ya hay en este navegador, sin abrir ninguna ventana. Una sesión de correo no sirve y se cierra. */
  retomar: () => Promise<SesionDelCelular | null>;
  /** Entra con Google desde el toque. Rechaza con un Error cuyo message es una FallaDeEntrada. */
  entrar: () => Promise<SesionDelCelular>;
  /** El token de la sesión, verificado por el proveedor, o null. Se pide cada vez y no se guarda. */
  token: () => Promise<string | null>;
  /** Si la sesión de esta cuenta sigue abierta en esta página. */
  sigueLaSesion: (cuenta: string) => Promise<boolean>;
  salir: () => Promise<void>;
}

type ModuloDeGoogle = typeof import("../stellar/wallet-pollar");

/** Una falla del proveedor. El mensaje se compara con las constantes del módulo y nunca se copia. */
function fallaDeEntrada(error: unknown, duracionMs: number, m: ModuloDeGoogle): FallaDeEntrada {
  const mensaje = error instanceof Error ? error.message : "";
  if (mensaje === m.ENTRADA_BLOQUEADA) return "ventana";
  if (mensaje === m.ENTRADA_CERRADA) return "cerrada";
  return duracionMs >= ESPERA_DE_CUENTA_MS ? "cuentas" : "google";
}

/** El nombre del perfil: puede tardar en llegar, así que se mira de nuevo cada medio segundo hasta 5 segundos. */
async function esperarNombre(billetera: ModuloDeGoogle["pollarWallet"]): Promise<string | null> {
  for (let mirada = 0; mirada <= MIRADAS_DEL_NOMBRE; mirada += 1) {
    const nombre = nombreParaLaPantalla(billetera.profile()?.name);
    if (nombre !== null) return nombre;
    if (mirada < MIRADAS_DEL_NOMBRE) {
      await new Promise<void>((resolver) => {
        setTimeout(resolver, MIRADA_DEL_NOMBRE_MS);
      });
    }
  }
  return null;
}

/** Espera un trabajo, pero no más de `ms`: si el trabajo gana, el reloj se apaga y no queda nada colgado. */
async function esperarHasta(trabajo: Promise<void>, ms: number): Promise<void> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      trabajo,
      new Promise<void>((resolver) => {
        reloj = setTimeout(resolver, ms);
      }),
    ]);
  } finally {
    clearTimeout(reloj);
  }
}

export function sesionDeGoogle(o: {
  local: Storage | null;
  pestana: Storage | null;
  ahora: () => number;
  /** Si este navegador guardó alguna vez una entrada con el proveedor de cuentas. Sin marca no hay sesión que retomar. */
  hayMarca: () => boolean;
}): SesionDeGoogle {
  /** Si el almacenamiento falla, se toma como que no hay marca: sin ella no hay sesión que retomar. */
  const hayLaMarca = (): boolean => {
    try {
      return o.hayMarca();
    } catch {
      return false;
    }
  };
  /** La entrada que está abierta ahora: tocar dos veces comparte una sola ventana de Google. */
  let enCurso: Promise<SesionDelCelular> | null = null;
  /** Cuándo falló la última entrada por Google o por la cuenta, y cuándo la última por Google. */
  let ultimaFalla: number | null = null;
  let ultimaDeGoogle: number | null = null;
  /** Lo que se le dijo a la persona en la última falla: el freno repite eso y no inventa otra cosa. */
  let ultimaDicha: FallaDeEntrada = "google";
  /** La sesión que `retomar` está retomando, si sigue en marcha: `entrar` la espera para no abrir una segunda ventana. */
  let retomando: Promise<void> | null = null;

  /** Anota una falla y dice cuál mostrar: una segunda falla de Google en dos minutos pasa a ser de la cuenta. */
  function registrar(falla: FallaDeEntrada): FallaDeEntrada {
    if (falla !== "google" && falla !== "cuentas") return falla;
    const ahora = o.ahora();
    ultimaFalla = ahora;
    if (falla === "cuentas") {
      ultimaDicha = "cuentas";
      return falla;
    }
    const repetida = ultimaDeGoogle !== null && ahora - ultimaDeGoogle < VENTANA_DE_REPETICION_MS;
    ultimaDeGoogle = ahora;
    ultimaDicha = repetida ? "cuentas" : "google";
    return ultimaDicha;
  }

  async function entrarDeVerdad(): Promise<SesionDelCelular> {
    const empezo = o.ahora();
    // Con el proveedor recién fallado no se vuelve a llamar: el toque siguiente solo gastaría otra cuenta. Se repite lo que
    // ya se le dijo: decir que la cuenta no se pudo crear, cuando ni se intentó, sería falso.
    if (ultimaFalla !== null && empezo - ultimaFalla < FRENO_DE_ENTRADA_MS) throw new Error(ultimaDicha);
    let m: ModuloDeGoogle;
    try {
      m = await import("../stellar/wallet-pollar");
    } catch {
      // El módulo no bajó (corte de red o versión nueva): no se copia el error del navegador.
      throw new Error("google");
    }
    // Si la sesión guardada todavía se está retomando, se espera un poco: si resulta que había una, no se abre otra ventana.
    if (retomando) await esperarHasta(retomando, ESPERA_DEL_RESTAURO_MS);
    const hay = m.pollarWallet.address;
    if (cuentaValida(hay)) {
      // Ya hay una sesión (la retomó el proveedor después de los 3 segundos): no se abre otra ventana de Google.
      if (m.pollarWallet.label !== "Email") return { cuenta: hay, nombre: await esperarNombre(m.pollarWallet) };
      // Una sesión de correo de la herramienta no sirve para este sorteo: se cierra recién ahora que la persona tocó Entrar.
      await m.pollarWallet.disconnect();
    }
    // Las marcas van antes de `connect`: la ventana se abre adentro y copia el `sessionStorage` en ese instante.
    if (o.local) marcarInvitada(o.local, empezo);
    if (o.pestana) marcarVentana(o.pestana, empezo);
    let cuenta: string;
    try {
      cuenta = await m.pollarWallet.connect();
    } catch (error) {
      throw new Error(registrar(fallaDeEntrada(error, o.ahora() - empezo, m)));
    } finally {
      if (o.pestana) soltarVentana(o.pestana);
    }
    if (!cuentaValida(cuenta)) throw new Error(registrar("google"));
    ultimaFalla = null;
    ultimaDeGoogle = null;
    return { cuenta, nombre: await esperarNombre(m.pollarWallet) };
  }

  return {
    retomar: async () => {
      // Sin la marca del proveedor no hay nada que retomar: no se baja la billetera ni se hace esperar a nadie.
      if (!hayLaMarca()) return null;
      let reloj: ReturnType<typeof setTimeout> | undefined;
      try {
        const sinRespuesta = new Promise<null>((resolver) => {
          reloj = setTimeout(() => resolver(null), ESPERA_RETOMAR_MS);
        });
        const trabajo = import("../stellar/wallet-pollar").then(async (m) => ({
          m,
          cuenta: await m.pollarWallet.restore(),
        }));
        // Si pierde la carrera y falla después, nadie lo espera: que no sea un error suelto.
        trabajo.catch(() => undefined);
        retomando = trabajo.then(() => undefined, () => undefined);
        const listo = await Promise.race([trabajo, sinRespuesta]);
        if (listo === null || !cuentaValida(listo.cuenta)) return null;
        // Una sesión de correo de la herramienta no sirve para este sorteo, pero tampoco se cierra por abrir el enlace: quien
        // organiza la perdería sin tocar nada. Se cierra solo si la persona toca Entrar.
        if (listo.m.pollarWallet.label === "Email") return null;
        return { cuenta: listo.cuenta, nombre: nombreParaLaPantalla(listo.m.pollarWallet.profile()?.name) };
      } catch {
        return null;
      } finally {
        clearTimeout(reloj);
      }
    },
    entrar: () => {
      if (enCurso) return enCurso;
      const actual = entrarDeVerdad().finally(() => {
        enCurso = null;
      });
      enCurso = actual;
      return actual;
    },
    token: async () => {
      try {
        const m = await import("../stellar/wallet-pollar");
        return await m.pollarWallet.tokenDeSesion(ESPERA_TOKEN_MS);
      } catch {
        return null;
      }
    },
    sigueLaSesion: async (cuenta) => {
      try {
        const m = await import("../stellar/wallet-pollar");
        return m.pollarWallet.address === cuenta;
      } catch {
        return false;
      }
    },
    salir: async () => {
      const m = await import("../stellar/wallet-pollar");
      await m.pollarWallet.disconnect();
    },
  };
}
