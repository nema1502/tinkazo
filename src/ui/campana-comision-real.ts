import { mirarLaComisionEnLaRed, estadoPorRpc, pruebaDeSecuencia } from "../campana/comision-red";
import { network } from "../stellar/config";
import { comisionDelBuild } from "../stellar/comision-config";
import { entornoDelBuild } from "../stellar/venta-piloto";
import type { DepsDeComision, PedidoDePagoDeComision, ResultadoDelPagoDeComision } from "./campana-comision";

/**
 * Lo de verdad del cobro de una campaña: la red principal, la cuenta de Google que vota a mano, el servicio de comisiones y
 * los candados del navegador. Todo lo pesado entra con `import()` recién cuando se usa, así el panel no baja el SDK de
 * Stellar ni la billetera al abrirse. Fuera de la red principal, o sin las tres variables del build, la comisión está apagada.
 */

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** El pago con la cuenta de Google, por el camino del retiro: una transacción con dos pagos (el cobro y el costo exacto). */
async function pagarConLaCuenta(p: PedidoDePagoDeComision): Promise<ResultadoDelPagoDeComision> {
  const [mandar, pollar, sdk] = await Promise.all([import("./mandar-usdc"), import("../stellar/wallet-pollar"), import("@stellar/stellar-sdk")]);
  const sitio = mandar.depsDelSitio();
  // El costo que vale es el de la configuración: si no es el del cobro, o no es una cuenta de Google, no se paga.
  const costo = (await sitio.costo?.(p.origen)) ?? null;
  if (costo === null || costo.stroops !== p.costo || costo.destino !== p.cobros) return { tipo: "ahora-no" };
  // La billetera guarda una sola marca de retiro por navegador: con otro retiro en camino no se arma nada.
  const viva = pollar.leerMarcaDeLaCuenta(pollar.MARCA_DEL_RETIRO);
  if (viva !== null && viva * 1000 > Date.now()) return { tipo: "ocupada" };
  const datos = { red: network.name, origen: p.origen, destino: p.cuenta, monto: p.sale, nota: { tipo: "id", valor: p.nota }, costo } as const;
  const preparado = await sitio.preparar(datos);
  if (!preparado.ok) {
    if (preparado.motivo === "sin-saldo") return { tipo: "sin-saldo" };
    return preparado.motivo === "sin-red" ? { tipo: "sin-mirar" } : { tipo: "ahora-no" };
  }
  const armada = sdk.TransactionBuilder.fromXDR(preparado.xdr, network.networkPassphrase);
  if (!("sequence" in armada)) return { tipo: "ahora-no" };
  const secuencia = BigInt(armada.sequence);
  // Antes de mandar: una sola respuesta de la red tiene que mostrar la cuenta justo en la secuencia con que se armó el pago y
  // sin un pago con esta nota. Si Horizon contesta atrasado, un segundo pago saldría con la misma secuencia que el primero.
  const prueba = await pruebaDeSecuencia(p.origen, secuencia - 1n, p.nota);
  if (prueba.tipo === "ya-hay-pago") return { tipo: "ya-hay-pago" };
  if (prueba.tipo !== "al-dia") return { tipo: "sin-mirar" };
  const hash = hex(armada.hash());
  p.alMandar(secuencia.toString(), hash);
  const r = await sitio.enviar(preparado.xdr, p.origen, datos);
  if (r === "listo") return { tipo: "listo", hash };
  if (r === "en-curso") {
    const hasta = pollar.leerMarcaDeLaCuenta(pollar.MARCA_DEL_RETIRO);
    return { tipo: "en-curso", hasta: hasta === null ? null : hasta * 1000 };
  }
  return r === "no-coincide-tope" ? { tipo: "recargar" } : { tipo: "no-salio" };
}

/** Si el servicio de comisiones atiende un retiro de esta cuenta con el costo del cobro. */
async function porteroDeLaComision(cuenta: string, costo: bigint): Promise<"atiende" | "no" | "sin-respuesta"> {
  const [{ configDelPortero }, { mirarPagos }] = await Promise.all([import("../stellar/patrocinio-config"), import("../stellar/pago-portero")]);
  const url = configDelPortero().url;
  if (!url) return "no";
  const lectura = await mirarPagos(url, cuenta);
  if (lectura.tipo === "sin-respuesta") return "sin-respuesta";
  if (lectura.tipo === "sin-pagos") return "no";
  const { pagos } = lectura;
  if (!pagos.retiro || pagos.costoRetiro !== costo) return "no";
  // Con otro pago de la cuenta en el aire, ahora no se puede: se vuelve a mirar en un rato.
  return pagos.enCurso === null ? "atiende" : "sin-respuesta";
}

/**
 * Entrar con otra cuenta desde el panel de la campaña. Con una cuenta del proveedor abierta (Google o correo), primero se
 * cierra esa sesión: si no, elegir Google devolvía la misma cuenta de antes y el panel volvía a ofrecer cargar y pagar con la
 * cuenta de correo. Con las demás billeteras se abre la ventana como siempre. `abrir` es la ventana de entrar (`openPicker`).
 */
export async function cambiarDeCuentaReal(abrir: () => Promise<void>): Promise<void> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
  const w = activeWallet();
  if (w !== null && submitsItself(w)) {
    const { cerrarSesion } = await import("./wallet-ui");
    await cerrarSesion().catch(() => undefined);
  }
  await abrir();
}

export function depsDeComisionReales(): DepsDeComision {
  return {
    comision: () => (network.name === "mainnet" ? comisionDelBuild(entornoDelBuild()) : null),
    billetera: async () => {
      const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
      const w = activeWallet();
      if (w === null || !submitsItself(w) || w.votaPorContenido?.() !== true) return "otra";
      // La cuenta del proveedor dice por dónde entró (`label`, que sale de la marca que se guarda al entrar y se lee al
      // retomar): la que entró con correo no es de Google, y la sala no activa sus campañas.
      return w.label === "Email" ? "correo" : "google";
    },
    mirarRed: (b, umbral) => mirarLaComisionEnLaRed(b, umbral),
    saldo: async (cuenta) => {
      const { saldoDeLaCuenta } = await import("./pagar-premio");
      return (await saldoDeLaCuenta(network.name, cuenta)) ?? "sin-red";
    },
    portero: porteroDeLaComision,
    pagar: pagarConLaCuenta,
    confirmar: async (hash) => {
      const e = await estadoPorRpc(hash);
      return e === "entro" ? true : e === "fallo" ? false : null;
    },
    puedeVolverALista: async (origen, secuencia, nota) => {
      const { mirarCuenta } = await import("../stellar/usdc-cuenta");
      const cuenta = await mirarCuenta(network.name, origen);
      if (typeof cuenta !== "object") return false;
      const ahora = BigInt(cuenta.secuencia);
      // La cuenta no llegó a la secuencia del pago: ese pago no entró y ya venció.
      if (ahora < BigInt(secuencia)) return true;
      // Llegó, y entonces solo se vuelve a ofrecer si el listado consistente de la cuenta no muestra el pago.
      return (await pruebaDeSecuencia(origen, ahora, nota)).tipo === "al-dia";
    },
    cargar: (cuenta, alCerrar, falta) => void import("./pagar-premio").then((m) => m.cargarEnSaldo(cuenta, alCerrar, falta)),
    candado: async (nombre, f) => {
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      return locks ? locks.request(nombre, { mode: "exclusive" }, f) : f();
    },
  };
}
