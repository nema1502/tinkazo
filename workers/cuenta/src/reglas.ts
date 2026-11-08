/**
 * Las monedas, el plan del equipo y la tiendita: las reglas, sin nada de Cloudflare ni de la página.
 *
 * Las comparten el Worker (`servidor.ts`), que decide con esto, y el sitio (`src/stellar/cuenta-api.ts`,
 * `src/ui/*`), que toma de acá los tipos, los montos y los textos del pago. Una regla vive en un solo lugar.
 *
 * Las reglas de siempre (docs de negocio de Tinkazo, 6 de noviembre de 2026):
 * - Las monedas son puntos. Se ganan usando Tinkazo, no se compran directamente, no se transfieren, no se cambian
 *   por dinero y nunca compran chances en ningún sorteo. No hay en el Worker ningún camino que haga nada de eso.
 * - El dinero es USDC en la cuenta de la persona. Tinkazo no lo guarda. Lo único que se cobra es el plan del equipo,
 *   y es un pago común a la cuenta de planes que el Worker comprueba contra la red antes de activar nada.
 */

export type Red = "testnet" | "mainnet";

/** Quién emite el USDC en cada red (Circle). Un pago de otro "USDC" no cuenta. */
export const EMISOR_USDC: Record<Red, string> = {
  mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

export const DIA_MS = 86_400_000;
/** Un dólar digital en stroops: la red cuenta con siete decimales. */
export const UN_USDC = 10_000_000n;

/* ------------------------------------------------------------------ las reglas de ganancia */

/**
 * Cómo se ganan monedas. Cada regla tiene tope por cuenta (`max`): ninguna se puede repetir sin fin.
 * `abierta` es si el sitio la puede pedir con `POST /evento`:
 * - `primera_carga` la comprueba el Worker contra la red (un pago de USDC de 1 o más a la cuenta).
 * - `plan` solo se acredita al activar el plan (`activarPlan`), nunca por pedido.
 * - `invitar` está definida pero sin evento: todavía no existe un enlace para invitar a un equipo.
 */
export const REGLAS = {
  primer_sorteo: { monedas: 20, max: 1, abierta: true },
  primera_carga: { monedas: 50, max: 1, abierta: true },
  plan: { monedas: 50, max: 1, abierta: false },
  invitar: { monedas: 10, max: 1, abierta: false },
  comprobar: { monedas: 5, max: 5, abierta: true },
} as const;

export type TipoDeRegla = keyof typeof REGLAS;
export type TipoDeEvento = { [K in TipoDeRegla]: (typeof REGLAS)[K]["abierta"] extends true ? K : never }[TipoDeRegla];

export const TIPOS_DE_EVENTO = (Object.keys(REGLAS) as TipoDeRegla[]).filter((k) => REGLAS[k].abierta) as TipoDeEvento[];

export const esTipoDeEvento = (x: unknown): x is TipoDeEvento => typeof x === "string" && (TIPOS_DE_EVENTO as string[]).includes(x);

/* ------------------------------------------------------------------ el plan del equipo */

/**
 * El plan del equipo: 5 USDC, 30 días, 50 monedas de regalo (una sola vez por cuenta) y, mientras dura, un cupo más
 * alto en el portero (`workers/patrocinio`): 50 sellos y 100 sorteos por mes en lugar de 20 y 40. El portero lo
 * averigua con `GET /v1/cuenta/<cuenta>/plan` y toma de ahí los números: los cupos del plan viven en un solo lugar.
 */
export const PLAN = { usdc: 5, dias: 30, monedas: REGLAS.plan.monedas, cupo: { sellos: 50, sorteos: 100 } } as const;

/** La nota que lleva el pago del plan: liga el pago a la cuenta de quien compra, aunque pague desde otra billetera. */
export const memoDePlan = (cuenta: string): string => `tk:plan:${cuenta.slice(-8)}`;

/**
 * El pago del plan como un enlace de pago (SEP-7): las billeteras que lo entienden lo abren ya lleno.
 * `web+stellar:pay?destination=…&amount=5&asset_code=USDC&asset_issuer=…&memo=…&memo_type=MEMO_TEXT`.
 */
export function enlaceDePago(o: { destino: string; cuenta: string; red: Red }): string {
  const q = new URLSearchParams({
    destination: o.destino,
    amount: String(PLAN.usdc),
    asset_code: "USDC",
    asset_issuer: EMISOR_USDC[o.red],
    memo: memoDePlan(o.cuenta),
    memo_type: "MEMO_TEXT",
  });
  // URLSearchParams escribe los espacios como "+": el memo no los lleva, pero así es el estándar de la consulta.
  return `web+stellar:pay?${q.toString()}`;
}

/* ------------------------------------------------------------------ una cuenta de Stellar */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Si es una dirección de cuenta de Stellar de verdad (empieza con G, 56 caracteres y su suma de control cuadra).
 * Una dirección inventada o con un carácter cambiado no llega a guardar nada.
 */
export function esCuenta(x: unknown): x is string {
  if (typeof x !== "string" || !/^G[A-Z2-7]{55}$/.test(x)) return false;
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const ch of x) {
    valor = (valor << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length !== 35 || bytes[0] !== 6 << 3) return false;
  const suma = (bytes[34] ?? 0) * 256 + (bytes[33] ?? 0);
  return crc16(bytes.slice(0, 33)) === suma;
}

/** Un monto de la red (`"5.0000000"`) en stroops, o null si no es un monto. */
export function aStroops(monto: unknown): bigint | null {
  if (typeof monto !== "string") return null;
  const m = /^(\d{1,15})(?:\.(\d{1,7}))?$/.exec(monto);
  if (!m) return null;
  return BigInt(m[1] as string) * UN_USDC + BigInt((m[2] ?? "").padEnd(7, "0") || "0");
}

/* ------------------------------------------------------------------ la tiendita */

export interface Canjeable {
  codigo: string;
  es: string;
  en: string;
  costo: number;
}

/** Lo que se puede canjear en el stand. Se cambia con la variable `CANJES` del Worker. */
export const CANJES_POR_DEFECTO: readonly Canjeable[] = [
  { codigo: "chocolate", es: "Un chocolate", en: "A chocolate", costo: 20 },
  { codigo: "stickers", es: "Stickers", en: "Stickers", costo: 50 },
  { codigo: "logo-en-el-show", es: "Tu logo en el show", en: "Your logo on the show", costo: 100 },
  { codigo: "nombre-en-el-cartel", es: "Tu nombre en el cartel", en: "Your name on the sign", costo: 200 },
];

const ES_CODIGO = /^[a-z0-9-]{2,32}$/;

/**
 * La lista de canjes de la variable `CANJES` (un JSON: `[{"codigo","es","en","costo"}]`). Si falta o algo no cuadra
 * (un código repetido, un costo que no es un entero de 1 a 10.000), vale la de siempre: un canje mal escrito no
 * deja el stand sin tiendita ni regala nada por un costo cero.
 */
export function leerCanjes(crudo: string | undefined): readonly Canjeable[] {
  if (!crudo?.trim()) return CANJES_POR_DEFECTO;
  try {
    const lista: unknown = JSON.parse(crudo);
    if (!Array.isArray(lista) || lista.length === 0 || lista.length > 20) return CANJES_POR_DEFECTO;
    const vistos = new Set<string>();
    const salida: Canjeable[] = [];
    for (const x of lista as Record<string, unknown>[]) {
      const { codigo, es, en, costo } = x ?? {};
      if (typeof codigo !== "string" || !ES_CODIGO.test(codigo) || vistos.has(codigo)) return CANJES_POR_DEFECTO;
      if (typeof es !== "string" || typeof en !== "string" || !es.trim() || !en.trim() || es.length > 60 || en.length > 60) return CANJES_POR_DEFECTO;
      if (typeof costo !== "number" || !Number.isInteger(costo) || costo < 1 || costo > 10_000) return CANJES_POR_DEFECTO;
      vistos.add(codigo);
      salida.push({ codigo, es, en, costo });
    }
    return salida;
  } catch {
    return CANJES_POR_DEFECTO;
  }
}

/* ------------------------------------------------------------------ lo que se guarda de una cuenta */

export interface Movimiento {
  /** Una regla de ganancia, o `canje:<código>`. */
  tipo: string;
  /** Lo que suma (positivo) o resta (negativo). */
  monedas: number;
  ms: number;
}

export interface CanjeHecho {
  codigo: string;
  costo: number;
  ms: number;
}

export interface PlanDeLaCuenta {
  inicio: number;
  vence: number;
  /** La transacción del último pago que se usó, para el enlace al explorador. */
  tx: string;
  /** Todas las transacciones ya usadas: un pago activa una sola vez. */
  usadas: string[];
}

export interface Cuenta {
  v: 1;
  saldo: number;
  /** Cuántas veces se ganó cada regla. */
  hechos: Partial<Record<TipoDeRegla, number>>;
  /** Los últimos movimientos, el más nuevo primero. */
  historial: Movimiento[];
  /** Los últimos canjes, el más nuevo primero. */
  canjes: CanjeHecho[];
  /** Los últimos identificadores de canje: repetir uno no descuenta dos veces. */
  ids: string[];
  /** Los últimos `tipo:ref` ya acreditados: repetir el mismo resultado no suma dos veces. */
  refs: string[];
  plan?: PlanDeLaCuenta;
}

export const cuentaVacia = (): Cuenta => ({ v: 1, saldo: 0, hechos: {}, historial: [], canjes: [], ids: [], refs: [] });

const GUARDA = 20;
const recientes = <T>(lista: T[], nuevo: T, tope = GUARDA): T[] => [nuevo, ...lista].slice(0, tope);

/** Lo que dice un registro guardado: si no tiene la forma de siempre, se empieza de cero. */
export function leerCuenta(crudo: string | null): Cuenta {
  if (!crudo) return cuentaVacia();
  try {
    const x = JSON.parse(crudo) as Partial<Cuenta>;
    if (x?.v !== 1 || typeof x.saldo !== "number" || !Number.isFinite(x.saldo)) return cuentaVacia();
    return { ...cuentaVacia(), ...x, v: 1 };
  } catch {
    return cuentaVacia();
  }
}

export type Acreditacion = { ok: true; cuenta: Cuenta; monedas: number } | { ok: false; motivo: "ya" | "tope" };

/** Suma lo que vale la regla si la cuenta no llegó a su tope. `ref` evita contar dos veces el mismo resultado. */
export function acreditar(c: Cuenta, tipo: TipoDeRegla, ahora: number, ref?: string): Acreditacion {
  const regla = REGLAS[tipo];
  const clave = ref ? `${tipo}:${ref}` : null;
  if (clave && c.refs.includes(clave)) return { ok: false, motivo: "ya" };
  if ((c.hechos[tipo] ?? 0) >= regla.max) return { ok: false, motivo: regla.max === 1 ? "ya" : "tope" };
  return {
    ok: true,
    monedas: regla.monedas,
    cuenta: {
      ...c,
      saldo: c.saldo + regla.monedas,
      hechos: { ...c.hechos, [tipo]: (c.hechos[tipo] ?? 0) + 1 },
      historial: recientes(c.historial, { tipo, monedas: regla.monedas, ms: ahora }),
      refs: clave ? recientes(c.refs, clave, 30) : c.refs,
    },
  };
}

export type Canje =
  | { ok: true; cuenta: Cuenta; repetido: boolean; canje: CanjeHecho }
  | { ok: false; motivo: "saldo"; saldo: number; falta: number };

/**
 * Descuenta un canje si alcanzan las monedas. Con el mismo `id` (el que manda el aparato de quien organiza) una
 * segunda vez no descuenta: devuelve el canje que ya estaba. Así un doble toque o un reintento por la red caída no cobra dos.
 */
export function canjear(c: Cuenta, item: Canjeable, ahora: number, id?: string): Canje {
  if (id && c.ids.includes(id)) {
    const antes = c.canjes.find((x) => x.codigo === item.codigo) ?? { codigo: item.codigo, costo: item.costo, ms: ahora };
    return { ok: true, cuenta: c, repetido: true, canje: antes };
  }
  if (c.saldo < item.costo) return { ok: false, motivo: "saldo", saldo: c.saldo, falta: item.costo - c.saldo };
  const hecho: CanjeHecho = { codigo: item.codigo, costo: item.costo, ms: ahora };
  return {
    ok: true,
    repetido: false,
    canje: hecho,
    cuenta: {
      ...c,
      saldo: c.saldo - item.costo,
      historial: recientes(c.historial, { tipo: `canje:${item.codigo}`, monedas: -item.costo, ms: ahora }),
      canjes: recientes(c.canjes, hecho),
      ids: id ? recientes(c.ids, id, 30) : c.ids,
    },
  };
}

/** El plan del equipo, si sigue vigente. */
export const planVigente = (c: Cuenta, ahora: number): PlanDeLaCuenta | null => (c.plan && c.plan.vence > ahora ? c.plan : null);

/**
 * Lo que el portero necesita saber de una cuenta: si su plan está activo ahora y, si lo está, hasta cuándo (`vence`,
 * en ms, como en el resto de la API) y qué cupo mensual da. Es lo que contesta `GET /v1/cuenta/<cuenta>/plan`: nada
 * más que eso, porque el recurso es público y el portero lo guarda en memoria.
 */
export type PlanParaElPortero = { activo: true; vence: number; cupo: { sellos: number; sorteos: number } } | { activo: false };

export function planParaElPortero(c: Cuenta, ahora: number): PlanParaElPortero {
  const p = planVigente(c, ahora);
  return p ? { activo: true, vence: p.vence, cupo: { sellos: PLAN.cupo.sellos, sorteos: PLAN.cupo.sorteos } } : { activo: false };
}

export type Activacion = { ok: true; cuenta: Cuenta; monedas: number } | { ok: false; motivo: "ya" };

/**
 * Activa (o renueva) el plan con un pago que no se usó antes. Dura 30 días desde hoy, o desde el vencimiento si el
 * plan sigue vigente: renovar antes no pierde días. Las 50 monedas de regalo se acreditan una sola vez por cuenta.
 */
export function activarPlan(c: Cuenta, tx: string, ahora: number): Activacion {
  if (c.plan?.usadas.includes(tx)) return { ok: false, motivo: "ya" };
  const vigente = planVigente(c, ahora);
  const desde = vigente ? vigente.vence : ahora;
  const plan: PlanDeLaCuenta = {
    inicio: vigente ? vigente.inicio : ahora,
    vence: desde + PLAN.dias * DIA_MS,
    tx,
    usadas: recientes(c.plan?.usadas ?? [], tx, 30),
  };
  const regalo = acreditar({ ...c, plan }, "plan", ahora);
  return regalo.ok ? { ok: true, cuenta: regalo.cuenta, monedas: regalo.monedas } : { ok: true, cuenta: { ...c, plan }, monedas: 0 };
}

/* ------------------------------------------------------------------ cómo se ve desde afuera */

/** Lo que devuelve `GET /v1/monedas/<cuenta>`: el saldo, lo hecho, lo que se puede canjear y el plan. */
export interface VistaDeCuenta {
  cuenta: string;
  saldo: number;
  /** Las reglas que esta cuenta ya cumplió, con cuántas veces. */
  hechos: Partial<Record<TipoDeRegla, number>>;
  historial: Movimiento[];
  canjes: CanjeHecho[];
  catalogo: Canjeable[];
  plan: { inicio: number; vence: number; tx: string } | null;
}

export function vistaDe(cuenta: string, c: Cuenta, catalogo: readonly Canjeable[], ahora: number): VistaDeCuenta {
  const plan = planVigente(c, ahora);
  return {
    cuenta,
    saldo: c.saldo,
    hechos: c.hechos,
    historial: c.historial.slice(0, 10),
    canjes: c.canjes.slice(0, 10),
    catalogo: [...catalogo],
    plan: plan ? { inicio: plan.inicio, vence: plan.vence, tx: plan.tx } : null,
  };
}

/** La cuenta que sale de lo que muestra un QR o se pega: la dirección sola, o un enlace de pago, o `stellar:`. */
export function cuentaDeTexto(texto: string): string | null {
  const t = texto.trim();
  if (esCuenta(t)) return t;
  const m = /(?:^|[:?&=\s/])(G[A-Z2-7]{55})(?![A-Z2-7])/.exec(t);
  return m && esCuenta(m[1]) ? (m[1] as string) : null;
}
