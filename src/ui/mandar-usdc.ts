import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { type NetworkName, network } from "../stellar/config";
import { esDeRed } from "../stellar/errores";
import { passphraseDe } from "../stellar/oficiales";
import { esDireccionG } from "../stellar/pagos";
import { mandarPago } from "../stellar/pagos-envio";
import { type CuentaMirada, type LecturaDeCuenta, mirarCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { abrirDialogo, botonPrincipal, lineaDeEstado } from "./dialogo";
import { con } from "./monedas-vista";

/**
 * Mandar mis dólares digitales: de la cuenta de la persona a otra cuenta de Stellar (otra suya, o una app que los
 * cambie a bolivianos).
 *
 * La dirección y la nota se pegan (vienen de la otra app: es lo único que no es un botón) y el monto se elige con
 * botones: Todo, La mitad, y de a 1 dólar. Antes de dejar mandar se mira la cuenta de destino: si no puede recibir el
 * USDC de Circle, no se manda nada. El pago lo arma la página (un pago clásico, como el de un premio) y, con una cuenta
 * de Google o de correo, va por `signAndSubmit`, que la puerta de firmas confirma porque es la transacción que la
 * página acaba de armar. Con una billetera propia la firma la billetera y la página la manda. Tinkazo no cobra ni
 * guarda nada.
 */

const STROOPS = 10_000_000n;
const UN_DOLAR = STROOPS;
/** El máximo de una nota numérica de Stellar (un entero sin signo de 64 bits). */
const MAX_NOTA_ID = 18_446_744_073_709_551_615n;
/** Lo que cabe en una nota de texto, en bytes. */
const NOTA_MAX_BYTES = 28;
const COMISION = "1000";
const VALE_S = 600;

/* ------------------------------------------------------------------ lo puro */

/** La nota que pidió la app que recibe: ninguna, un número (como la piden muchos exchanges) o un texto corto. */
export type Nota = { tipo: "ninguna" } | { tipo: "id"; valor: string } | { tipo: "texto"; valor: string };

/** Lo pegado como nota, o `null` si no entra en una nota de Stellar. */
export function leerNota(crudo: string): Nota | null {
  const s = crudo.trim();
  if (s === "") return { tipo: "ninguna" };
  if (/^\d{1,20}$/.test(s) && BigInt(s) <= MAX_NOTA_ID) return { tipo: "id", valor: s };
  if (new TextEncoder().encode(s).length <= NOTA_MAX_BYTES) return { tipo: "texto", valor: s };
  return null;
}

/** Lo pegado como dirección, o `null` si no es una cuenta de Stellar (una `G…` con su control). */
export function leerDireccion(crudo: string): string | null {
  const s = crudo.trim();
  return esDireccionG(s) ? s : null;
}

/** La mitad de lo que hay, sin pasarse. */
export const mitadDe = (saldo: bigint): bigint => saldo / 2n;

/** Sumar o restar 1 dólar: nunca más que todo, ni menos que 1 dólar (o todo, si hay menos de 1). */
export function deAUnDolar(monto: bigint, signo: 1 | -1, saldo: bigint): bigint {
  const piso = saldo < UN_DOLAR ? saldo : UN_DOLAR;
  const siguiente = monto + BigInt(signo) * UN_DOLAR;
  if (siguiente > saldo) return saldo;
  if (siguiente < piso) return piso;
  return siguiente;
}

const siete = (s: bigint): string => `${s / STROOPS}.${(s % STROOPS).toString().padStart(7, "0")}`;

const stroopsDeHorizon = (m: string): bigint | null => {
  const x = /^(\d{1,13})(?:\.(\d{1,7}))?$/.exec(m);
  return x ? BigInt(x[1] as string) * STROOPS + BigInt((x[2] ?? "").padEnd(7, "0")) : null;
};

/** El USDC de Circle de la cuenta: saldo y lugar que le queda, o `null` si no tiene la línea autorizada. */
export function usdcDe(c: CuentaMirada, red: NetworkName): { saldo: bigint; lugar: bigint } | null {
  const usdc = usdcDeLaRed(red);
  const l = c.saldos.find((s) => s.code === usdc.code && s.issuer === usdc.issuer);
  if (!l || !l.autorizada) return null;
  const saldo = stroopsDeHorizon(l.saldo);
  const limite = stroopsDeHorizon(l.limite);
  if (saldo === null || limite === null) return null;
  return { saldo, lugar: limite - saldo };
}

/** ¿La cuenta de destino puede recibir este monto? */
export const puedeRecibir = (l: LecturaDeCuenta, red: NetworkName, monto: bigint): boolean => {
  if (typeof l !== "object") return false;
  const u = usdcDe(l, red);
  return u !== null && u.lugar >= monto;
};

export interface DatosDelEnvio {
  red: NetworkName;
  origen: string;
  destino: string;
  /** En stroops (siete decimales). */
  monto: bigint;
  nota: Nota;
}

/** Arma el pago sin firmarlo: un `payment` de USDC de Circle con la nota pedida, con la secuencia de la cuenta. */
export async function armarEnvio(d: DatosDelEnvio, secuencia: string): Promise<string> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino || d.monto <= 0n) throw new Error("mandar: datos inválidos");
  const usdc = usdcDeLaRed(d.red);
  const { Account, Asset, Memo, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const b = new TransactionBuilder(new Account(d.origen, secuencia), { fee: COMISION, networkPassphrase: passphraseDe(d.red) }).addOperation(
    Operation.payment({ destination: d.destino, asset: new Asset(usdc.code, usdc.issuer), amount: siete(d.monto) }),
  );
  if (d.nota.tipo === "id") b.addMemo(Memo.id(d.nota.valor));
  else if (d.nota.tipo === "texto") b.addMemo(Memo.text(d.nota.valor));
  return b.setTimeout(VALE_S).build().toXDR();
}

export type Preparado = { ok: true; xdr: string } | { ok: false; motivo: "no-recibe" | "sin-saldo" | "sin-red" | "datos" };

/** Mira las dos cuentas y arma el pago si va a entrar entero. No firma ni manda nada. */
export async function prepararEnvio(d: DatosDelEnvio, mirar: (cuenta: string) => Promise<LecturaDeCuenta>): Promise<Preparado> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino || d.monto <= 0n) return { ok: false, motivo: "datos" };
  const [origen, destino] = await Promise.all([mirar(d.origen), mirar(d.destino)]);
  if (origen === "sin-red" || destino === "sin-red") return { ok: false, motivo: "sin-red" };
  const suyo = typeof origen === "object" ? usdcDe(origen, d.red) : null;
  if (!suyo || suyo.saldo < d.monto || typeof origen !== "object") return { ok: false, motivo: "sin-saldo" };
  if (!puedeRecibir(destino, d.red, d.monto)) return { ok: false, motivo: "no-recibe" };
  try {
    return { ok: true, xdr: await armarEnvio(d, origen.secuencia) };
  } catch {
    return { ok: false, motivo: "datos" };
  }
}

/** Cómo terminó: mandado, se está mandando (no se sabe todavía), no lo aprobó en su billetera, o no salió. */
export type ResultadoDelEnvio = "listo" | "en-curso" | "no-aprobado" | "no-salio";

/* ------------------------------------------------------------------ la ventana */

export interface DepsDeMandar {
  red: NetworkName;
  mirar(cuenta: string): Promise<LecturaDeCuenta>;
  /** Lo que hay en el portapapeles, o `null` si el navegador no deja leerlo. */
  pegar(): Promise<string | null>;
  /** Mira las dos cuentas y arma el pago (`prepararEnvio`). */
  preparar(d: DatosDelEnvio): Promise<Preparado>;
  /** Firma y manda lo armado. */
  enviar(xdr: string, origen: string): Promise<ResultadoDelEnvio>;
}

function depsDelSitio(): DepsDeMandar {
  const mirar = (cuenta: string): Promise<LecturaDeCuenta> => mirarCuenta(network.name, cuenta);
  return {
    red: network.name,
    mirar,
    preparar: (d) => prepararEnvio(d, mirar),
    async pegar() {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    },
    async enviar(xdr, origen) {
      const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
      const w = activeWallet();
      if (!w?.address || w.address !== origen) return "no-salio";
      if (submitsItself(w)) {
        try {
          await w.signAndSubmit(xdr);
          return "listo";
        } catch (e) {
          // Una co-firma pendiente o un corte: no se sabe todavía, y no se manda de nuevo.
          return e instanceof Error && e.message === "pollar-pending" ? "en-curso" : esDeRed(e) ? "en-curso" : "no-salio";
        }
      }
      let firmado: string;
      try {
        firmado = (await w.signTransaction(xdr, { networkPassphrase: passphraseDe(network.name), address: origen })).signedTxXdr;
      } catch {
        return "no-aprobado";
      }
      const env = await mandarPago(network.name, firmado);
      if (env.ok) return "listo";
      return env.rechazo === "sin-respuesta" ? "en-curso" : "no-salio";
    },
  };
}

const formato = (s: bigint): string => new Intl.NumberFormat(getLang(), { maximumFractionDigits: 7 }).format(Number(s) / 1e7);
const corta = (g: string): string => `${g.slice(0, 4)}…${g.slice(-4)}`;

/**
 * Abre Mandar mis dólares digitales para la cuenta `address`, con `saldo` en stroops (lo que la ventana de los dólares
 * acaba de leer). `deps` reemplaza lo del sitio (en las pruebas).
 */
export function abrirMandar(o: { address: string; saldo: bigint }, parcial: Partial<DepsDeMandar> = {}): void {
  const deps: DepsDeMandar = { ...depsDelSitio(), ...parcial };
  const estado = {
    destino: null as string | null,
    lectura: null as LecturaDeCuenta | null,
    nota: { tipo: "ninguna" } as Nota,
    monto: o.saldo,
    fin: false,
    /** Mandando: hasta saber cómo terminó no se cambia nada. */
    enviando: false,
    abierta: true,
    pegarAMano: false,
  };
  const d = abrirDialogo({
    titulo: t("saldoMandarBtn"),
    onCerrar: () => {
      estado.abierta = false;
    },
  });
  const linea = lineaDeEstado();
  const boton = botonPrincipal(t("saldoMandarOk"));
  d.pie.append(linea, boton);

  const listo = (): boolean => estado.destino !== null && estado.lectura !== null && puedeRecibir(estado.lectura, deps.red, estado.monto) && estado.monto > 0n;

  /** Pinta la ventana. Con `resumen`, la línea de estado dice cuánto y a quién (si ya se puede mandar). */
  function pintar(resumen = false): void {
    if (!estado.abierta) return;
    const nota = estado.nota.tipo === "ninguna" ? t("saldoMandarSinNota") : estado.nota.valor;
    // Mandando, mandado o en camino: lo elegido queda a la vista, pero ya no se cambia.
    const quieto = estado.fin || estado.enviando ? " disabled" : "";
    const campo = (cual: "dir" | "nota", etiqueta: string): string =>
      estado.pegarAMano && !quieto
        ? `<input class="saldo-bs" data-mandar="campo-${cual}" type="text" autocomplete="off" spellcheck="false" aria-label="${esc(etiqueta)}" placeholder="${esc(etiqueta)}">`
        : "";
    d.cuerpo.innerHTML =
      // El saldo de antes de mandar: después de mandado ya no es el que hay.
      (estado.fin ? "" : `<p class="saldo-total">${esc(con(t("saldoTenes"), { n: formato(o.saldo) }))}</p>`) +
      `<section class="saldo-paso">` +
      `<dl class="saldo-datos">` +
      `<div class="saldo-dato"><dt>${esc(t("saldoMandarA"))}</dt><dd>` +
      (estado.destino ? `<code class="saldo-dir" data-mandar="dir">${esc(estado.destino)}</code>` : "") +
      `<button type="button" class="mini" data-mandar="pegar-dir"${quieto}>${esc(t("saldoMandarPegar"))}</button>${campo("dir", t("saldoMandarPegar"))}</dd></div>` +
      `<div class="saldo-dato"><dt>${esc(t("saldoNota"))}</dt><dd><span data-mandar="nota">${esc(nota)}</span>` +
      `<button type="button" class="mini" data-mandar="pegar-nota"${quieto}>${esc(t("saldoMandarNota"))}</button>${campo("nota", t("saldoMandarNota"))}</dd>` +
      `<dd class="saldo-pista">${esc(t("saldoMandarNotaAyuda"))}</dd></div>` +
      `<div class="saldo-dato"><dt>${esc(t("saldoMandarCuanto"))}</dt><dd><b data-mandar="monto">${esc(con(t("saldoMonto"), { n: formato(estado.monto) }))}</b></dd>` +
      `<dd class="saldo-montos">` +
      `<button type="button" class="mini" data-mandar="todo" aria-pressed="${estado.monto === o.saldo}"${quieto}>${esc(t("saldoMandarTodo"))}</button>` +
      `<button type="button" class="mini" data-mandar="mitad" aria-pressed="${estado.monto === mitadDe(o.saldo) && estado.monto !== o.saldo}"${quieto}>${esc(t("saldoMandarMitad"))}</button>` +
      `<button type="button" class="mini" data-mandar="menos" aria-label="${esc(t("saldoMandarMenos"))}"${quieto}>-1</button>` +
      `<button type="button" class="mini" data-mandar="mas" aria-label="${esc(t("saldoMandarMas"))}"${quieto}>+1</button>` +
      `</dd></div></dl></section>`;
    const en = (k: string, f: () => void): void => d.cuerpo.querySelector<HTMLElement>(`[data-mandar="${k}"]`)?.addEventListener("click", f);
    en("pegar-dir", () => void pegar("dir"));
    en("pegar-nota", () => void pegar("nota"));
    en("todo", () => cambiarMonto(o.saldo));
    en("mitad", () => cambiarMonto(mitadDe(o.saldo)));
    en("menos", () => cambiarMonto(deAUnDolar(estado.monto, -1, o.saldo)));
    en("mas", () => cambiarMonto(deAUnDolar(estado.monto, 1, o.saldo)));
    for (const cual of ["dir", "nota"] as const) {
      d.cuerpo.querySelector<HTMLInputElement>(`[data-mandar="campo-${cual}"]`)?.addEventListener("change", (ev) => void usar(cual, (ev.target as HTMLInputElement).value));
    }
    boton.disabled = estado.fin ? false : !listo();
    if (resumen && !estado.fin && listo() && estado.destino) linea.textContent = con(t("saldoMandarResumen"), { n: formato(estado.monto), corta: corta(estado.destino) });
  }

  function cambiarMonto(m: bigint): void {
    if (estado.fin || estado.enviando) return;
    estado.monto = m;
    linea.classList.remove("ok");
    if (estado.destino && estado.lectura !== null && !puedeRecibir(estado.lectura, deps.red, m)) linea.textContent = t("saldoMandarNoRecibe");
    pintar(true);
  }

  async function pegar(cual: "dir" | "nota"): Promise<void> {
    if (estado.fin || estado.enviando) return;
    const texto = await deps.pegar();
    if (!estado.abierta) return;
    if (texto === null) {
      // El navegador no deja leer el portapapeles: un campo donde pegarlo.
      estado.pegarAMano = true;
      pintar();
      d.cuerpo.querySelector<HTMLInputElement>(`[data-mandar="campo-${cual}"]`)?.focus();
      return;
    }
    await usar(cual, texto);
  }

  async function usar(cual: "dir" | "nota", texto: string): Promise<void> {
    // Mandando, mandado o en camino: ya no se cambia nada.
    if (estado.fin || estado.enviando) return;
    linea.classList.remove("ok");
    if (cual === "nota") {
      const n = leerNota(texto);
      if (n === null) linea.textContent = t("saldoMandarNotaMala");
      else {
        estado.nota = n;
        linea.textContent = "";
      }
      pintar(n !== null);
      return;
    }
    const dir = leerDireccion(texto);
    estado.lectura = null;
    if (dir === null || dir === o.address) {
      estado.destino = null;
      linea.textContent = t("saldoMandarNoRecibe");
      pintar();
      return;
    }
    estado.destino = dir;
    linea.textContent = t("saldoMandarMirando");
    pintar();
    const l = await deps.mirar(dir);
    if (!estado.abierta || estado.destino !== dir) return;
    estado.lectura = l;
    linea.textContent = l === "sin-red" ? t("saldoError") : puedeRecibir(l, deps.red, estado.monto) ? "" : t("saldoMandarNoRecibe");
    pintar(true);
  }

  boton.addEventListener("click", () => {
    if (boton.disabled) return;
    if (estado.fin) {
      d.cerrar();
      return;
    }
    void mandar();
  });

  async function mandar(): Promise<void> {
    if (!listo() || !estado.destino) return;
    boton.disabled = true;
    linea.classList.remove("ok");
    linea.textContent = t("saldoMandarEnCurso");
    estado.enviando = true;
    pintar();
    try {
      await enviarLoElegido({ red: deps.red, origen: o.address, destino: estado.destino, monto: estado.monto, nota: estado.nota });
    } finally {
      estado.enviando = false;
    }
    pintar();
  }

  async function enviarLoElegido(datos: DatosDelEnvio): Promise<void> {
    const p = await deps.preparar(datos).catch(() => ({ ok: false, motivo: "sin-red" }) as const);
    if (!estado.abierta) return;
    if (!p.ok) {
      // Si el destino ya no puede recibir, se vuelve a mirar: Mandar queda apagado hasta que pueda.
      if (p.motivo === "no-recibe") estado.lectura = await deps.mirar(datos.destino).catch(() => "sin-red" as const);
      if (!estado.abierta) return;
      linea.textContent = t(p.motivo === "no-recibe" ? "saldoMandarNoRecibe" : p.motivo === "sin-red" ? "saldoError" : "saldoMandarNoSalio");
      return;
    }
    const r = await deps.enviar(p.xdr, o.address).catch(() => "no-salio" as const);
    if (!estado.abierta) return;
    if (r === "listo" || r === "en-curso") {
      // Mandado, o en camino: no se ofrece mandar de nuevo.
      estado.fin = true;
      boton.textContent = t("acctClose");
      linea.textContent = r === "listo" ? con(t("saldoMandarListo"), { n: formato(datos.monto) }) : t("saldoMandarEnCurso");
      if (r === "listo") linea.classList.add("ok");
      return;
    }
    linea.textContent = t(r === "no-aprobado" ? "saldoActivarNoAprobado" : "saldoMandarNoSalio");
  }

  pintar();
}
