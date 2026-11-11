import { getLang } from "../i18n";
import { type BanderasDeAlta, banderasDeAlta } from "../stellar/alta-config";
import { type ErrorDeAlta, type OpcionesDeAlta, canjear, estado } from "../stellar/alta-api";
import { network } from "../stellar/config";
import { cuponGuardado, guardarCupon, olvidarCupon } from "../stellar/cupon-guardado";
import { estadoDelPatrocinio, olvidarElEstado } from "../stellar/patrocinador";
import type { AccesoDelPaso } from "./cuenta-lista";
import type { ModoDelAcceso } from "./cuenta-lista-estado";

/**
 * De dónde saca «Dejá tu cuenta lista» el acceso al modo Oficial (W3 del cobro por uso), sin pantalla.
 *
 * - Fuera de la red principal, `libre`: el paso ni se abre, y si se abriera sería el de siempre.
 * - En la red principal con `VITE_ALTA_LIBRE=1` (el plan B1), `libre`: se activa sin preguntar.
 * - En la red principal con el acceso por cupón en el build (`VITE_ALTA=1` y la dirección del portero), `servidor`: el
 *   paso le pregunta al portero con el token de la sesión verificada, y activa solo con el acceso confirmado.
 * - Si no, `cerrado`: no hay a quién preguntarle, y no se activa. Ante la duda, a una cuenta de Google o de correo en
 *   Oficial no se le pide ninguna firma.
 */

export function modoDelAcceso(red: string = network.name, b: BanderasDeAlta = banderasDeAlta()): ModoDelAcceso {
  if (red !== "mainnet") return "libre";
  if (b.libre) return "libre";
  return b.alta ? "servidor" : "cerrado";
}

/** Lo que el acceso necesita de la sesión. En la página, la billetera de Pollar. */
export interface SesionDelAcceso {
  /** El token de la sesión verificada, o `null` (`tokenDeSesion` de `wallet-pollar.ts`). */
  token(): Promise<string | null>;
  sesionViva(): boolean;
  /** La cuenta de la sesión, para volver a preguntar el cupo. */
  cuenta(): string | null;
}

/**
 * Sin token no se le pregunta nada al servidor. Con la sesión abierta, el token puede faltar porque Pollar todavía no
 * la revalidó (la red lenta): eso es «probá de nuevo». Con la sesión cerrada, es entrar de nuevo.
 */
function sinToken(s: SesionDelAcceso): ErrorDeAlta {
  let viva = false;
  try {
    viva = s.sesionViva();
  } catch {
    viva = false;
  }
  return { ok: false, clave: viva ? "altaErrServicio" : "clErrSesion", vars: {}, motivo: "sin-token", estado: 0 };
}

function cuentaDe(s: SesionDelAcceso): string | null {
  try {
    return s.cuenta();
  } catch {
    return null;
  }
}

async function tokenDe(s: SesionDelAcceso): Promise<string | null> {
  try {
    return await s.token();
  } catch {
    return null;
  }
}

/** El acceso de verdad: el portero de la red principal (`alta-api.ts`), el cupón de la pestaña y el cupo de la línea. */
export function accesoDelServidor(s: SesionDelAcceso, o: OpcionesDeAlta = {}): AccesoDelPaso {
  return {
    async estado() {
      const tk = await tokenDe(s);
      if (!tk) return sinToken(s);
      const r = await estado(tk, { idioma: getLang(), ...o });
      // El servidor ata el acceso a la cuenta que le dice Pollar, y el sello y el cupo se preguntan con la de esta
      // sesión. Si no son la misma, el acceso no le sirve a esta cuenta: se dice como el 409 del servidor, sin pedir
      // ninguna firma y sin escribir ninguna de las dos cuentas.
      if (r.ok && r.datos.cuenta !== null && cuentaDe(s) !== null && r.datos.cuenta !== cuentaDe(s)) {
        return { ok: false, clave: "altaErrCuentaDeOtro", vars: {}, motivo: "cuenta-de-otro", estado: 0 };
      }
      return r;
    },
    async canjear(codigo: string) {
      const tk = await tokenDe(s);
      if (!tk) return sinToken(s);
      return canjear(tk, codigo, { idioma: getLang(), ...o });
    },
    cuenta: () => cuentaDe(s),
    cuponGuardado: () => cuponGuardado(),
    guardarCupon: (codigo: string) => void guardarCupon(codigo),
    olvidarCupon: () => olvidarCupon(),
    refrescarCupo() {
      // El cupo que se recuerda es de antes del canje o de la activación: se olvida y se pregunta de nuevo. La línea del
      // cupo se entera sola por `tinkazo:patrocinio`.
      olvidarElEstado();
      const g = s.cuenta();
      if (g) void estadoDelPatrocinio(g, { forzar: true }).catch(() => undefined);
    },
  };
}

/** Lo que recibe el paso: el acceso del servidor, o cómo se porta sin él. */
export function fuenteDelAcceso(s: SesionDelAcceso, modo: ModoDelAcceso = modoDelAcceso()): AccesoDelPaso | "libre" | "cerrado" {
  return modo === "servidor" ? accesoDelServidor(s) : modo;
}
