import { getLang } from "../i18n";
import { type BanderasDeAlta, banderasDeAlta, pagoConSaldoActivo } from "../stellar/alta-config";
import { type ErrorDeAlta, type OpcionesDeAlta, anularCompra, canjear, cargarCompra, empezarCompra, estado, orden, pago } from "../stellar/alta-api";
import { leerOferta } from "../stellar/alta-oferta";
import { network } from "../stellar/config";
import { cuponGuardado, guardarCupon, olvidarCupon } from "../stellar/cupon-guardado";
import { type PagoPedido, type ResultadoDelPagoConSaldo, VIDA_MAXIMA_S } from "../stellar/pago-con-saldo";
import { estadoDelPatrocinio, olvidarElEstado } from "../stellar/patrocinador";
import { type OpcionesDeSaldo, leerSaldoDeDolares } from "../stellar/saldo-dolares";
import type { PorteroDeLaCompra } from "./compra-motor";
import type { AccesoDelPaso } from "./cuenta-lista";
import type { ModoDelAcceso } from "./cuenta-lista-estado";
import type { PagoConSaldo } from "./pago-saldo";

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
  /**
   * Pagar una orden con el saldo de la cuenta (`pagarOrden` de la billetera del proveedor). Solo cuando la billetera activa
   * es la del proveedor (Google o correo): sin esto, no se ofrece pagar con el saldo.
   */
  pagar?: (p: Omit<PagoPedido, "cuenta">) => Promise<ResultadoDelPagoConSaldo>;
}

/**
 * Pagar con el saldo, para la pantalla de la compra: leer cuánto hay en la cuenta de la sesión (en la red, solo lectura) y
 * pagar una orden con los datos de la orden tal cual. Nada lanza: si la billetera lanzara, no se sabe si salió.
 */
export function pagoConSaldoDe(s: SesionDelAcceso & { pagar: NonNullable<SesionDelAcceso["pagar"]> }, o: OpcionesDeSaldo = {}): PagoConSaldo {
  return {
    async leer() {
      const g = cuentaDe(s);
      return g ? leerSaldoDeDolares(g, o) : { tipo: "sin-red" };
    },
    async pagar(orden) {
      try {
        return await s.pagar({ destino: orden.destino, monto: orden.usdc, nota: orden.nota });
      } catch {
        return { estado: "incierto", vence: Math.floor(Date.now() / 1000) + VIDA_MAXIMA_S + 60 };
      }
    },
  };
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

/**
 * El acceso de verdad: el portero de la red principal (`alta-api.ts`), el cupón de la pestaña y el cupo de la línea.
 * Con la compra en el build (`VITE_ALTA_PAGO`), además lo que se vende, la orden y el pago; sin ella, el paso no tiene
 * cómo pedirlos. Con la compra, `VITE_PAGO_CON_SALDO` (`conSaldo`) y la billetera del proveedor (`s.pagar`), además pagar
 * con el saldo de la cuenta; si falta cualquiera de las tres, no.
 */
export function accesoDelServidor(s: SesionDelAcceso, o: OpcionesDeAlta = {}, b: BanderasDeAlta = banderasDeAlta(), conSaldo: boolean = pagoConSaldoActivo()): AccesoDelPaso {
  const pagar = s.pagar;
  const saldo: Pick<AccesoDelPaso, "saldo"> = b.pago && conSaldo && pagar ? { saldo: pagoConSaldoDe({ ...s, pagar }) } : {};
  const compra: Pick<AccesoDelPaso, "oferta" | "orden" | "pago"> = b.pago
    ? {
        oferta: () => leerOferta({ pago: true, ...o }),
        async orden(producto: string) {
          const tk = await tokenDe(s);
          if (!tk) return sinToken(s);
          return orden(tk, producto, { idioma: getLang(), ...o });
        },
        async pago(id: string) {
          const tk = await tokenDe(s);
          if (!tk) return sinToken(s);
          return pago(tk, id, { idioma: getLang(), ...o });
        },
      }
    : {};
  return {
    ...compra,
    ...saldo,
    // Con la compra con QR en el build, antes de pagar con el saldo se pregunta cómo está la orden. Sin ella, como siempre.
    ...(b.qr ? { preguntarAntesDePagar: true } : {}),
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

/**
 * El portero de la compra con QR (`compra-motor.ts`): las rutas de `/v1/compra/*` y las del paquete, con el token de la
 * sesión verificada en cada pedido. Sin token no se le pregunta nada al servidor, como en el resto del acceso.
 */
export function porteroDeLaCompra(s: SesionDelAcceso, o: OpcionesDeAlta = {}): PorteroDeLaCompra {
  const con = async <T>(f: (tk: string, op: OpcionesDeAlta) => Promise<T>): Promise<T | ErrorDeAlta> => {
    const tk = await tokenDe(s);
    if (!tk) return sinToken(s);
    return f(tk, { idioma: getLang(), ...o });
  };
  return {
    estado: () => con((tk, op) => estado(tk, op)),
    empezar: (producto) => con((tk, op) => empezarCompra(tk, producto, op)),
    cargar: (producto, reemplazar) => con((tk, op) => cargarCompra(tk, producto, { ...op, ...(reemplazar ? { reemplazar: true } : {}) })),
    anular: (producto) => con((tk, op) => anularCompra(tk, producto, op)),
    orden: (producto) => con((tk, op) => orden(tk, producto, op)),
    pago: (id) => con((tk, op) => pago(tk, id, op)),
  };
}
