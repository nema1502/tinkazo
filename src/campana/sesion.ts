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
import type { AccionesDeLaCuenta, FallaDeEntrada, SesionDelCelular } from "./celular";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { marcarInvitada, marcarVentana, soltarVentana } from "./invitada";

/** Lo máximo que se espera a que el proveedor retome una sesión guardada, para que la página no quede esperando. */
export const ESPERA_RETOMAR_MS = 3_000;
/** Cada cuánto se mira el nombre mientras se retoma la sesión, dentro de esos mismos 3 segundos. */
export const MIRADA_DE_LA_RETOMADA_MS = 250;
/** Cuánto se espera el token: con datos lentos la sesión tarda en quedar verificada, y decir que venció sería falso. */
export const ESPERA_TOKEN_MS = 20_000;
/** Desde acá un error de la entrada es que el proveedor no terminó de crear la cuenta: la ventana vence a los 120 segundos. */
export const ESPERA_DE_CUENTA_MS = 100_000;
/** Cada cuánto se vuelve a mirar el nombre del perfil, y cuántas veces: 5 segundos en total. */
export const MIRADA_DEL_NOMBRE_MS = 500;
export const MIRADAS_DEL_NOMBRE = 10;
/**
 * Lo máximo que una entrada espera a que termine una sesión que ya se estaba retomando, antes de abrir la ventana de Google.
 * Es corto a propósito: el navegador solo deja abrir la ventana mientras el toque está fresco, y una espera larga la bloquea.
 */
export const ESPERA_DEL_RESTAURO_MS = 1_000;
/** Después de una falla del proveedor, no se vuelve a llamar durante este tiempo. */
export const FRENO_DE_ENTRADA_MS = 30_000;
/** Una segunda falla de Google dentro de este tiempo se dice como falla de la cuenta: nadie insiste en un bucle. */
export const VENTANA_DE_REPETICION_MS = 120_000;
const LARGO_DEL_NOMBRE = 30;
/** Lo que se dice de la cuenta cuando la lectura no pudo ni empezar: que no se sabe. */
const SIN_DATOS_DE_LA_CUENTA: LecturaDelCelular = {
  estado: "no-se-sabe",
  protegida: false,
  correoDeLaSesionConfirmado: false,
  puedeMandar: false,
  correoTapado: null,
  limite: false,
};

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
  /**
   * El nombre corto del perfil cuando llegó después de la sesión: si ya está lo da, y si no espera la sesión verificada
   * (hasta 20 segundos), porque el token y el perfil se completan juntos. Sin nombre o con una falla, null.
   */
  nombreTardio: () => Promise<string | null>;
  /**
   * Cómo está la cuenta de esta sesión (una lectura liviana, sin tocar nada). Con una falla, `no-se-sabe`. Es opcional: la
   * demostración y la vista previa no la tienen, y la página se comporta como antes.
   */
  estadoDeLaCuenta?: (cuenta?: string) => Promise<LecturaDelCelular>;
  /**
   * Lo que la tarjeta Confirmar mi correo hace con la sesión de la cuenta que se le pide. Se baja a pedido (`sesion-confirmar`):
   * la página no carga nada de eso si la cuenta no lo necesita. Opcional, como la lectura.
   */
  accionesDeLaCuenta?: (cuenta: string) => Promise<AccionesDeLaCuenta>;
  /**
   * Si la sesión de este navegador es de `cuenta`: retoma la sesión guardada (son pedidos al servicio de cuentas, por eso se
   * pide solo cuando hace falta, al ir a recibir) y compara. `otra` es la de otra persona en un celular compartido. Sin sesión
   * o con una falla, `no-se-sabe`. Opcional, como la lectura.
   */
  laSesionEs?: (cuenta: string) => Promise<"si" | "otra" | "no-se-sabe">;
  /**
   * Suelta el cliente del proveedor sin cerrar la sesión: dejan de correr sus relojes y de pedirse cosas al servicio de
   * cuentas. La sesión guardada queda, y se vuelve a armar sola cuando algo la pide (el token, la lectura, la tarjeta).
   * Opcional, como la lectura.
   */
  soltar?: () => Promise<void>;
  /**
   * Cuántos segundos faltan para que el servicio de cuentas acepte pedidos de nuevo (lo frenó por límite), o null si no hay un
   * límite vigente. Opcional, como la lectura.
   */
  segundosDeLimite?: () => Promise<number | null>;
  /** Si la sesión de esta cuenta sigue abierta en esta página. */
  sigueLaSesion: (cuenta: string) => Promise<boolean>;
  salir: () => Promise<void>;
  /** Vuelve a poner la marca de invitada por otras 48 horas: la sesión de Google dura más que la marca y hay que renovarla. */
  renovar: () => void;
}

type ModuloDeGoogle = typeof import("../stellar/wallet-pollar");

/** Cuántos segundos faltan para que el servicio de cuentas acepte pedidos de nuevo, según lo que vio la billetera, o null. */
function limiteAhora(m: ModuloDeGoogle): number | null {
  return m.pollarWallet.segundosDeLimite?.() ?? null;
}

/** La entrada frenada por el límite del servicio de cuentas: lleva cuánto esperar. No cuenta como falla de nadie. */
const frenadaPorElLimite = (segundos: number): Error => Object.assign(new Error("limite"), { segundos });

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
  /** Avisa cuando la página se va o se recarga y devuelve cómo dejar de avisar. Sin esto, la marca de la ventana no se suelta sola. */
  alIrse?: (alIrse: () => void) => () => void;
}): SesionDeGoogle {
  /** La marca de invitada se renueva cada vez que se usa una sesión de Google: así nunca vence con la sesión abierta. */
  const renovarInvitada = (): void => {
    if (o.local) marcarInvitada(o.local, o.ahora());
  };
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
      if (m.pollarWallet.label !== "Email") {
        // La sesión ya estaba abierta y no pasa por `connect`: la marca de invitada se renueva igual.
        renovarInvitada();
        return { cuenta: hay, nombre: await esperarNombre(m.pollarWallet) };
      }
      // Una sesión de correo de la herramienta no sirve para este sorteo: se cierra recién ahora que la persona tocó Entrar.
      await m.pollarWallet.disconnect();
    }
    // El servicio de cuentas dijo que no acepta pedidos por un rato: no se abre la ventana ni se llama a nadie, y se dice con la
    // verdad. Ni el freno de 30 segundos ni la regla de la segunda falla cuentan esto: no es una falla de Google ni de la cuenta.
    const espera = limiteAhora(m);
    if (espera !== null) throw frenadaPorElLimite(espera);
    // Las marcas van antes de `connect`: la ventana se abre adentro y copia el `sessionStorage` en ese instante.
    renovarInvitada();
    const pestana = o.pestana;
    if (pestana) marcarVentana(pestana, empezo);
    // Si la página se recarga o se va antes de que Google se abra, la marca no puede quedar tapando la herramienta en esta pestaña.
    const dejarDeAvisar = o.alIrse && pestana ? o.alIrse(() => soltarVentana(pestana)) : () => undefined;
    let cuenta: string;
    try {
      // La marca de la ventana se suelta de esta pestaña apenas Google se abre: la ventana ya se llevó su copia.
      cuenta = await m.pollarWallet.connect({ alAbrirLaVentana: () => {
        if (pestana) soltarVentana(pestana);
      } });
    } catch (error) {
      const falla = fallaDeEntrada(error, o.ahora() - empezo, m);
      // Una ventana frenada o cerrada por la persona se dice como es. Lo demás, con el límite a la vista, fue el límite.
      const frenada = falla === "ventana" || falla === "cerrada" ? null : limiteAhora(m);
      if (frenada !== null) throw frenadaPorElLimite(frenada);
      throw new Error(registrar(falla));
    } finally {
      dejarDeAvisar();
      if (pestana) soltarVentana(pestana);
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
      let mirada: ReturnType<typeof setTimeout> | undefined;
      try {
        // Los 3 segundos son de toda la retomada: la sesión y, si el perfil tarda, también el nombre. Nunca se pasan.
        let vencio = false;
        const sinRespuesta = new Promise<null>((resolver) => {
          reloj = setTimeout(() => {
            vencio = true;
            resolver(null);
          }, ESPERA_RETOMAR_MS);
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
        // Una sesión de Google que sigue viva sin pasar por `connect`: la marca de invitada se renueva acá.
        renovarInvitada();
        // El perfil puede llegar un poco después de la sesión: se mira cada 250 ms hasta que se acaben los 3 segundos.
        let nombre = nombreParaLaPantalla(listo.m.pollarWallet.profile()?.name);
        while (nombre === null && !vencio) {
          await Promise.race([
            new Promise<void>((resolver) => {
              mirada = setTimeout(resolver, MIRADA_DE_LA_RETOMADA_MS);
            }),
            sinRespuesta,
          ]);
          nombre = nombreParaLaPantalla(listo.m.pollarWallet.profile()?.name);
        }
        return { cuenta: listo.cuenta, nombre };
      } catch {
        return null;
      } finally {
        clearTimeout(reloj);
        clearTimeout(mirada);
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
        // Con el cliente soltado después de anotarse, se vuelve a armar acá: hace falta para pedir el token.
        await m.pollarWallet.asegurarLaSesion?.();
        return await m.pollarWallet.tokenDeSesion(ESPERA_TOKEN_MS);
      } catch {
        return null;
      }
    },
    nombreTardio: async () => {
      try {
        const m = await import("../stellar/wallet-pollar");
        const ya = nombreParaLaPantalla(m.pollarWallet.profile()?.name);
        if (ya !== null) return ya;
        // El perfil llega junto con la sesión verificada: sin ella no hay nombre que leer.
        if ((await m.pollarWallet.tokenDeSesion(ESPERA_TOKEN_MS)) === null) return null;
        return nombreParaLaPantalla(m.pollarWallet.profile()?.name);
      } catch {
        return null;
      }
    },
    estadoDeLaCuenta: async (cuenta) => {
      try {
        const m = await import("../stellar/wallet-pollar");
        // La lectura necesita la sesión: si se soltó (después de anotarse, o al recargar), se retoma acá.
        await m.pollarWallet.asegurarLaSesion?.();
        // Con la cuenta de la página, la sesión de otra persona no se lee ni se le atribuye.
        return await m.pollarWallet.cuentaDelCelular(undefined, cuenta);
      } catch {
        return { ...SIN_DATOS_DE_LA_CUENTA };
      }
    },
    // Solo la usa quien recargó ya anotada y toca Recibir: se baja con la tarjeta, no con la página.
    laSesionEs: (cuenta) => import("./sesion-confirmar").then((m) => m.laSesionEs(cuenta), () => "no-se-sabe" as const),
    accionesDeLaCuenta: async (cuenta) => (await import("./sesion-confirmar")).accionesDeLaCuenta(cuenta),
    // Sin soltar queda como estaba: la sesión sigue y nada se rompe.
    soltar: () => import("../stellar/wallet-pollar").then((m) => void m.pollarWallet.soltarElCliente?.(), () => undefined),
    segundosDeLimite: () => import("../stellar/wallet-pollar").then(limiteAhora, () => null),
    sigueLaSesion: async (cuenta) => {
      try {
        const m = await import("../stellar/wallet-pollar");
        // Una sesión que el proveedor ya cerró no sigue, aunque la cuenta siga en la página: ahí hay que entrar de nuevo.
        return m.pollarWallet.address === cuenta && m.pollarWallet.sesionPerdida?.() !== true;
      } catch {
        return false;
      }
    },
    salir: async () => {
      const m = await import("../stellar/wallet-pollar");
      await m.pollarWallet.disconnect();
    },
    renovar: renovarInvitada,
  };
}
