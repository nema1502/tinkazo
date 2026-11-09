import { passphraseDe } from "../stellar/oficiales";
import type { NetworkName } from "../stellar/config";
import { txUrl } from "../stellar/config";
import { type ActivoDePago, type LecturaDePago, esDireccionG, montoDelPremio, montoDePago, montoLegible, notaDelPremio } from "../stellar/pagos";
import { type DatosDelPago, type Envio, type MotivoDeRechazo, type MotivoSinPago, mandarPago, prepararPago } from "../stellar/pagos-envio";
import { type BusquedaDePago, buscarPago } from "../stellar/pagos-red";
import { type OpcionesDeGanadores, alCambiarDeIdioma, el, textoDePagos as tx } from "./panel-ganadores";

/**
 * "Pagar premio": el pago en USDC de quien organiza a quien ganó, armado acá y firmado en la billetera de quien organiza.
 *
 * Tinkazo no firma ni guarda nada: arma el pago (`pagos-envio.ts`), se lo pasa a la billetera (Freighter, o la cuenta de
 * prueba en testnet) y manda lo firmado. Si la cuenta de quien organiza entró con Google (Pollar), no firma pagos desde
 * acá a propósito (su lista de firmas permitidas es solo la del sello y la del sorteo: `atenderFirmas`, wallet-pollar.ts):
 * se muestra el pago listo para firmarlo afuera.
 *
 * Antes de pedir la firma se mira la red: si la cuenta de quien ganó no existe o no tiene USDC activado, se dice en
 * palabras simples y se ofrece "Avisarle" (copiar un mensaje), en vez de hacer firmar algo que va a fallar.
 *
 * Un premio se paga una sola vez. Antes de armar el pago se busca en la red uno ya hecho con la nota de ese premio: si
 * está, no se arma nada; si la red no deja saberlo, tampoco (no se paga a ciegas). Y si al mandar un pago la red no
 * confirma si entró, el botón queda en pausa hasta que la red diga con certeza que ese pago no está.
 */

/* ------------------------------------------------------------- la secuencia */

/** La billetera con que se firma, vista desde acá. */
export interface Billetera {
  /** La cuenta activa. */
  direccion: string;
  /** Firma dentro de la página (Freighter, la cuenta de prueba). Falso con Pollar: se firma afuera. */
  firmaAdentro: boolean;
  /** La red en que está la billetera, o `null` si no se sabe. */
  red(): Promise<string | null>;
  /** Firma el pago y devuelve el sobre firmado. Lanza si no se firmó. */
  firmar(xdr: string, passphrase: string, cuenta: string): Promise<string>;
}

export interface Dependencias {
  /** Busca en la red el pago de un premio. Sin caché: cada pregunta va a la red. */
  buscar: (b: BusquedaDePago) => Promise<LecturaDePago>;
  preparar: (d: DatosDelPago) => ReturnType<typeof prepararPago>;
  mandar: (red: NetworkName, xdrFirmado: string) => Promise<Envio>;
  billetera: Billetera | null;
  /** Para decir en qué paso va: mirando la red, esperando la firma, mandando. */
  alAvanzar?: (paso: "mirando" | "firmando" | "enviando") => void;
}

export interface PedidoDePago {
  red: NetworkName;
  raffleId: string;
  puesto: number;
  destino: string;
  activo: ActivoDePago;
  /** Lo que escribió la persona. */
  monto: string;
  /** Solo si se firma afuera: la cuenta que va a pagar. Con billetera propia manda la billetera. */
  cuentaQuePaga?: string;
  /** Los pagos anteriores a este instante (Unix, segundos) no son de este sorteo. */
  desde: number;
  /** Las cuentas cuyo pago con esta nota ya cuenta como hecho, además de la que paga. */
  pagadoras?: readonly string[];
}

export type Resultado =
  | { tipo: "monto-malo" }
  | { tipo: "cuenta-mala" }
  | { tipo: "no-se-puede"; motivo: MotivoSinPago; saldo?: string }
  /** El pago está armado y se firma afuera. */
  | { tipo: "afuera"; xdr: string; nota: string; origen: string }
  | { tipo: "otra-red" }
  | { tipo: "no-firmado" }
  | { tipo: "rechazado"; rechazo: MotivoDeRechazo }
  /** No se supo si el pago entró. `busqueda` es lo que hay que mirar en la red antes de volver a ofrecer pagar. */
  | { tipo: "sin-respuesta"; busqueda: BusquedaDePago }
  /** El premio ya tenía su pago en la red: no se armó otro. */
  | { tipo: "ya-pagado"; hash: string; origen: string }
  /** No se pudo mirar en la red si el premio ya estaba pagado: no se armó nada. */
  | { tipo: "sin-consulta" }
  | { tipo: "listo"; hash: string; origen: string };

/** Busca en la red el pago de un premio. Nunca lanza: si la búsqueda falla, no se sabe. */
export async function mirarSiSalio(deps: Pick<Dependencias, "buscar">, b: BusquedaDePago): Promise<LecturaDePago> {
  try {
    return await deps.buscar(b);
  } catch {
    return { tipo: "sin-consulta" };
  }
}

/**
 * Los pasos de un pago, sin pantalla: valida el monto, busca en la red si el premio ya está pagado, mira las cuentas,
 * arma el pago y, si hay billetera que firme acá, lo firma y lo manda. Nunca lanza. No manda nada si algo de antes falla.
 */
export async function pagarUnPremio(deps: Dependencias, p: PedidoDePago): Promise<Resultado> {
  const monto = montoDePago(p.monto);
  if (!monto) return { tipo: "monto-malo" };
  const b = deps.billetera;
  const firmaAdentro = !!b?.firmaAdentro;
  const origen = firmaAdentro ? (b as Billetera).direccion : (p.cuentaQuePaga ?? b?.direccion ?? "");
  if (!esDireccionG(origen)) return { tipo: "cuenta-mala" };

  deps.alAvanzar?.("mirando");
  let busqueda: BusquedaDePago;
  try {
    const pagadoras = [...new Set([...(p.pagadoras ?? []), origen])];
    busqueda = { red: p.red, destino: p.destino, activo: p.activo, nota: notaDelPremio(p.raffleId, p.puesto), pagadoras, desde: p.desde };
  } catch {
    return { tipo: "no-se-puede", motivo: "datos-invalidos" };
  }
  // Un pago con la nota de este premio ya en la red (de otra pestaña, de antes de recargar, o uno que entró sin que
  // la red lo confirmara) hace que no se arme otro. Sin poder saberlo, tampoco se arma.
  const previo = await mirarSiSalio(deps, busqueda);
  if (previo.tipo === "pagado") return { tipo: "ya-pagado", hash: previo.hash, origen: previo.de };
  if (previo.tipo === "sin-consulta") return { tipo: "sin-consulta" };

  const prep = await deps.preparar({ red: p.red, origen, destino: p.destino, activo: p.activo, monto, raffleId: p.raffleId, puesto: p.puesto });
  if (!prep.ok) return { tipo: "no-se-puede", motivo: prep.motivo, ...(prep.saldo !== undefined ? { saldo: prep.saldo } : {}) };
  if (!firmaAdentro) return { tipo: "afuera", xdr: prep.xdr, nota: prep.nota, origen };

  const pass = passphraseDe(p.red);
  const suya = await (b as Billetera).red().catch(() => null);
  if (suya !== null && suya !== pass) return { tipo: "otra-red" };

  deps.alAvanzar?.("firmando");
  let firmado: string;
  try {
    firmado = await (b as Billetera).firmar(prep.xdr, pass, origen);
  } catch {
    return { tipo: "no-firmado" };
  }
  deps.alAvanzar?.("enviando");
  const env = await deps.mandar(p.red, firmado);
  if (env.ok) return { tipo: "listo", hash: env.hash, origen };
  return env.rechazo === "sin-respuesta" ? { tipo: "sin-respuesta", busqueda } : { tipo: "rechazado", rechazo: env.rechazo };
}

/** La billetera activa de la página, si firma pagos acá. Con Pollar, `firmaAdentro` es falso. */
export async function billeteraActiva(): Promise<Billetera | null> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
  const w = activeWallet();
  if (!w?.address) return null;
  const direccion = w.address;
  return {
    direccion,
    firmaAdentro: !submitsItself(w),
    red: () => w.networkPassphrase(),
    firmar: async (xdr, networkPassphrase, address) => (await w.signTransaction(xdr, { networkPassphrase, address })).signedTxXdr,
  };
}

/* ----------------------------------------------------------------- el mensaje */

/** Qué texto va con cada resultado (su clave y lo que se le reemplaza), y si ofrece "Avisarle". */
export function mensajeDe(r: Resultado, c: { quien: string; red: NetworkName; monto: string }): { clave: string; vars: Record<string, string>; avisar: boolean; error: boolean } {
  const v: Record<string, string> = { quien: c.quien, red: c.red, monto: montoLegible(montoDePago(c.monto) ?? c.monto) };
  switch (r.tipo) {
    case "monto-malo":
      return { clave: "pgMontoMal", vars: v, avisar: false, error: true };
    case "cuenta-mala":
      return { clave: "pgCuentaMala", vars: v, avisar: false, error: true };
    case "no-se-puede":
      switch (r.motivo) {
        case "destino-sin-cuenta":
          return { clave: "pgSinCuentaDestino", vars: v, avisar: true, error: true };
        case "destino-sin-linea":
          return { clave: "pgSinLinea", vars: v, avisar: true, error: true };
        case "destino-lleno":
          return { clave: "pgDestinoLleno", vars: v, avisar: false, error: true };
        case "origen-sin-cuenta":
          return { clave: "pgSinCuentaPropia", vars: v, avisar: false, error: true };
        case "origen-sin-linea":
          return { clave: "pgSinLineaPropia", vars: v, avisar: false, error: true };
        case "origen-sin-saldo":
          return { clave: "pgSinSaldo", vars: { ...v, saldo: montoLegible(r.saldo ?? "0") }, avisar: false, error: true };
        case "sin-red":
          return { clave: "pgSinRed", vars: v, avisar: false, error: true };
        default:
          return { clave: "pgCuentaMala", vars: v, avisar: false, error: true };
      }
    case "afuera":
      return { clave: "pgAfuera", vars: v, avisar: false, error: false };
    case "otra-red":
      return { clave: "pgOtraRed", vars: v, avisar: false, error: true };
    case "no-firmado":
      return { clave: "pgNoFirmaste", vars: v, avisar: false, error: true };
    case "rechazado":
      return {
        clave: { "sin-saldo": "pgRechazoSaldo", "sin-linea": "pgSinLinea", "sin-cuenta": "pgSinCuentaDestino", lleno: "pgDestinoLleno", secuencia: "pgRechazoSecuencia", vencido: "pgRechazoVencido", firma: "pgRechazoFirma", otro: "pgRechazoOtro" }[r.rechazo],
        vars: v,
        avisar: r.rechazo === "sin-linea" || r.rechazo === "sin-cuenta",
        error: true,
      };
    case "sin-respuesta":
      return { clave: "pgDuda", vars: v, avisar: false, error: true };
    case "ya-pagado":
      return { clave: "pgYaPagado", vars: v, avisar: false, error: false };
    case "sin-consulta":
      return { clave: "pgSinConsultaPrevia", vars: v, avisar: false, error: true };
    case "listo":
      return { clave: "pgListo", vars: v, avisar: false, error: false };
  }
}

/** Copia al portapapeles. `false` si el navegador no deja. */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- la pantalla */

export interface ContextoDePago {
  red: NetworkName;
  raffleId: string;
  premio: string;
  activo: ActivoDePago;
  /** Se le suma la cuenta que paga, para que el panel reconozca su pago. */
  pagadoras: Set<string>;
  /** Los pagos anteriores a este instante (Unix, segundos) no son de este sorteo. */
  desde: number;
  /** Tras un pago sin respuesta, cuánto se espera antes de mirar en la red si entró (6 s: que alcance a cerrar un ledger). */
  esperaMs?: number;
  /** Para las pruebas: las dependencias de la red y la billetera. */
  dependencias?: () => Promise<Dependencias>;
}

/** Lo que queda de un formulario cerrado, para reabrirlo tal cual si un pago está en camino, en duda o ya hecho. */
interface FormularioGuardado {
  form: HTMLFormElement;
  retener: () => boolean;
  reabrir: () => void;
}

/**
 * El manejador de "Pagar premio" para `montarGanadores`: abre, debajo de la fila, el monto y el botón "Firmar y pagar".
 * Tocar "Pagar premio" otra vez (o "Cancelar") lo cierra. Si el pago de ese premio está en camino, en duda o hecho,
 * reabrir muestra ese mismo formulario y no uno nuevo con el botón disponible.
 */
export function pagarPremioEn(ctx: ContextoDePago): NonNullable<OpcionesDeGanadores["pagar"]> {
  const guardados = new Map<number, FormularioGuardado>();
  return (fila, caja, alTerminar) => {
    if (caja.firstElementChild) {
      caja.replaceChildren();
      return;
    }
    const guardado = guardados.get(fila.puesto);
    if (guardado?.retener()) {
      caja.replaceChildren(guardado.form);
      guardado.reabrir();
      return;
    }
    const form = el("form", "gan-form");
    form.noValidate = true;

    const montoL = el("label", "gan-campo");
    const montoT = el("span", "kicker");
    const monto = el("input");
    monto.type = "text";
    monto.inputMode = "decimal";
    monto.autocomplete = "off";
    monto.value = montoDelPremio(ctx.premio) ?? "";
    const ayuda = el("span", "note gan-ayuda");
    montoL.append(montoT, monto, ayuda);

    // La cuenta que paga solo se pregunta cuando se firma afuera: con Freighter es la de la billetera.
    const cuentaL = el("label", "gan-campo");
    const cuentaT = el("span", "kicker");
    const cuenta = el("input");
    cuenta.type = "text";
    cuenta.autocomplete = "off";
    cuenta.spellcheck = false;
    cuentaL.append(cuentaT, cuenta);
    cuentaL.hidden = true;

    const explica = el("p", "note gan-explica");
    const acciones = el("div", "row");
    const pagar = el("button", "ghost");
    pagar.type = "submit";
    // Tras un pago en duda: vuelve a mirar en la red si entró.
    const volver = el("button", "ghost");
    volver.type = "button";
    volver.hidden = true;
    const cancelar = el("button", "ghost");
    cancelar.type = "button";
    acciones.append(pagar, volver, cancelar);

    const msg = el("p", "gan-msg");
    msg.setAttribute("role", "status");
    const avisar = el("button", "ghost");
    avisar.type = "button";
    avisar.hidden = true;
    const manual = el("textarea", "gan-copia");
    manual.readOnly = true;
    manual.rows = 3;
    manual.hidden = true;

    const afuera = el("details", "gan-afuera");
    const resumen = el("summary");
    const xdr = el("textarea", "gan-copia mono");
    xdr.readOnly = true;
    xdr.rows = 4;
    const copiarXdr = el("button", "ghost");
    copiarXdr.type = "button";
    afuera.append(resumen, xdr, copiarXdr);
    afuera.hidden = true;

    const enlace = el("a", "gan-enlace");
    enlace.target = "_blank";
    enlace.rel = "noopener";
    enlace.hidden = true;

    form.append(montoL, cuentaL, explica, acciones, msg, avisar, manual, afuera, enlace);
    caja.replaceChildren(form);

    // Lo que se está diciendo, para escribirlo de nuevo si cambia el idioma.
    let dicho: { clave: string; vars: Record<string, string> } | null = null;
    let progreso: string | null = null;
    let montoAviso = "";
    const decir = (clave: string | null, vars: Record<string, string> = {}, error = false): void => {
      dicho = clave ? { clave, vars } : null;
      msg.textContent = clave ? tx(clave, vars) : "";
      msg.classList.toggle("bad", error);
    };
    const pintar = (): void => {
      montoT.textContent = tx("pgMontoL");
      ayuda.textContent = tx("pgMontoAyuda");
      cuentaT.textContent = tx("pgCuentaPagaL");
      explica.textContent = tx("pgPaga", { quien: fila.nombre, nota: fila.nota });
      pagar.textContent = cuentaL.hidden ? tx("pgFirmar") : tx("pgArmar");
      volver.textContent = tx("pgVolverAMirar");
      cancelar.textContent = tx("pgCancelar");
      avisar.textContent = tx("pgAvisar");
      resumen.textContent = tx("pgXdrResumen");
      copiarXdr.textContent = tx("pgCopiar");
      if (dicho) msg.textContent = tx(dicho.clave, dicho.vars);
      if (progreso) msg.textContent = tx(progreso);
    };
    alCambiarDeIdioma(pintar, form);
    pintar();
    monto.focus();
    // Mientras no se mandó nada, la cuenta que paga sigue a la billetera; una vez pagado, ese campo ya no se muestra.
    let hecho = false;
    // Con la billetera de quien organiza, paga su cuenta; si se firma afuera (Pollar), se elige la cuenta que paga.
    const preparar = async (): Promise<Dependencias> => {
      const deps = ctx.dependencias ? await ctx.dependencias() : await dependenciasReales();
      cuentaL.hidden = hecho || deps.billetera?.firmaAdentro === true;
      if (!cuenta.value && deps.billetera) cuenta.value = deps.billetera.direccion;
      pintar();
      return deps;
    };
    void preparar().catch(() => undefined);

    // Un pago mandado sin respuesta de la red: hasta saber que no está, no se ofrece pagar otra vez.
    let enDuda: { deps: Dependencias; busqueda: BusquedaDePago } | null = null;
    let mirandoDuda = false;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    let ocupado = false;

    // Un pago mandado o encontrado: queda la confirmación y el enlace, y el botón no vuelve.
    const terminarPagado = (hash: string, origen: string): void => {
      hecho = true;
      ctx.pagadoras.add(origen);
      enlace.href = txUrl(hash, ctx.red);
      enlace.textContent = tx("pgVerPago");
      enlace.hidden = false;
      montoL.hidden = true;
      cuentaL.hidden = true;
      explica.hidden = true;
      acciones.hidden = true;
      pagar.hidden = true;
      alTerminar();
    };

    /** Mira en la red si el pago en duda entró. Solo un "no está" seguro vuelve a habilitar el botón. */
    const mirarDuda = async (): Promise<void> => {
      const duda = enDuda;
      if (!duda || mirandoDuda) return;
      clearTimeout(reloj);
      mirandoDuda = true;
      volver.hidden = true;
      pagar.disabled = true;
      progreso = null;
      decir("pgDudaMirando");
      const l = await mirarSiSalio(duda.deps, duda.busqueda);
      mirandoDuda = false;
      if (enDuda !== duda) return;
      if (l.tipo === "pagado") {
        enDuda = null;
        decir("pgListo");
        terminarPagado(l.hash, l.de);
      } else if (l.tipo === "no-hay") {
        enDuda = null;
        pagar.disabled = false;
        decir("pgDudaNoEsta");
      } else {
        decir("pgDudaSinRed", {}, true);
        volver.hidden = false;
      }
    };
    volver.addEventListener("click", () => void mirarDuda());

    guardados.set(fila.puesto, {
      form,
      retener: () => ocupado || enDuda !== null || hecho,
      reabrir: () => {
        alCambiarDeIdioma(pintar, form);
        pintar();
      },
    });

    const cerrar = (): void => caja.replaceChildren();
    cancelar.addEventListener("click", cerrar);
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cerrar();
    });

    avisar.addEventListener("click", async () => {
      const texto = tx("pgAviso", { monto: montoAviso, cuenta: fila.cuenta });
      if (await copiar(texto)) {
        decir("pgAvisoCopiado");
        manual.hidden = true;
      } else {
        decir("pgAvisoManual");
        manual.value = texto;
        manual.hidden = false;
        manual.select();
      }
    });
    copiarXdr.addEventListener("click", async () => {
      if (await copiar(xdr.value)) copiarXdr.textContent = tx("pgCopiado");
      else xdr.select();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Un toque doble, un Enter en el monto con el botón en pausa o un premio ya pagado no arman otro pago.
      if (ocupado || enDuda || hecho) return;
      ocupado = true;
      pagar.disabled = true;
      avisar.hidden = true;
      manual.hidden = true;
      afuera.hidden = true;
      enlace.hidden = true;
      progreso = null;
      try {
        const deps = await preparar();
        const r = await pagarUnPremio(
          {
            ...deps,
            alAvanzar: (paso) => {
              progreso = paso === "mirando" ? "pgMirando" : paso === "firmando" ? "pgFirmando" : "pgEnviando";
              dicho = null;
              msg.classList.remove("bad");
              msg.textContent = tx(progreso);
            },
          },
          {
            red: ctx.red,
            raffleId: ctx.raffleId,
            puesto: fila.puesto,
            destino: fila.cuenta,
            activo: ctx.activo,
            monto: monto.value,
            desde: ctx.desde,
            pagadoras: [...ctx.pagadoras],
            ...(cuenta.value.trim() ? { cuentaQuePaga: cuenta.value.trim() } : {}),
          },
        );
        progreso = null;
        montoAviso = montoLegible(montoDePago(monto.value) ?? monto.value);
        const m = mensajeDe(r, { quien: fila.nombre, red: ctx.red, monto: monto.value });
        decir(m.clave, m.vars, m.error);
        avisar.hidden = !m.avisar;
        if (r.tipo === "afuera") {
          // El panel reconoce el pago de esa cuenta cuando se haga.
          ctx.pagadoras.add(r.origen);
          xdr.value = r.xdr;
          afuera.hidden = false;
          afuera.open = true;
        } else if (r.tipo === "listo" || r.tipo === "ya-pagado") {
          terminarPagado(r.hash, r.origen);
        } else if (r.tipo === "sin-respuesta") {
          enDuda = { deps, busqueda: r.busqueda };
          alTerminar();
          reloj = setTimeout(() => void mirarDuda(), ctx.esperaMs ?? 6_000);
        }
      } finally {
        ocupado = false;
        pagar.disabled = enDuda !== null || hecho;
      }
    });
  };
}

/** Las dependencias de verdad: la red de Stellar y la billetera activa. */
async function dependenciasReales(): Promise<Dependencias> {
  return {
    buscar: (b) => buscarPago(b),
    preparar: (d) => prepararPago(d),
    mandar: (red, xdr) => mandarPago(red, xdr),
    billetera: await billeteraActiva(),
  };
}
