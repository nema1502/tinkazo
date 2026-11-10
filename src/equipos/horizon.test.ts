import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { type MemoriaDeCupones, NOTAS_POR_LECTURA, PAGINAS_POR_LECTURA, VENTANA_DE_CUPONES_S, cuponesEnviados, pagosDeLaCuenta, quedaPorLeer } from "./horizon";
import { CUPON_MONTO, memoCupon } from "./modelo";

/*
 * Los cupones se leen de la cuenta del evento, que es pública: cualquiera le puede mandar pagos. Estas pruebas simulan
 * un Horizon con su paginado (orden, cursor y límite) para ver que la búsqueda no depende de cuántos pagos ajenos
 * reciba la cuenta, y que si no alcanza a leerlo todo lo dice en vez de devolver una lista incompleta.
 */

const cuenta = (): string => Keypair.random().publicKey();
const EVENTO = cuenta();
const EV = "sabado-2026";
const NOTA = memoCupon(EV);
const AHORA = Date.parse("2026-11-14T18:00:00Z");
const HACE = (s: number): string => new Date(AHORA - s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

interface Registro {
  type: string;
  paging_token: string;
  transaction_successful: boolean;
  transaction_hash: string;
  created_at: string;
  from: string;
  to: string;
  amount: string;
  asset_type: string;
}

const pago = (o: { id: number; de: string; a: string; hash: string; hace?: number; monto?: string }): Registro => ({
  type: "payment",
  paging_token: String(o.id),
  transaction_successful: true,
  transaction_hash: o.hash,
  created_at: HACE(o.hace ?? 600),
  from: o.de,
  to: o.a,
  amount: o.monto ?? CUPON_MONTO,
  asset_type: "native",
});

/** Pagos de otra cuenta a la del evento: de a cien por transacción, como los manda quien quiere tapar los cupones. */
const ajenos = (desde: number, n: number, o: { nota?: boolean; hace?: number } = {}): Registro[] => {
  const atacante = cuenta();
  return Array.from({ length: n }, (_, i) => pago({ id: desde + i, de: atacante, a: EVENTO, hash: `ajena${Math.floor((desde + i) / 100)}`, hace: o.hace ?? 300 }));
};

/** Un Horizon de mentira: los pagos de la cuenta del evento con su paginado, y la nota de cada transacción. */
function horizon(registros: Registro[], notas: Record<string, string | null>, falla?: (u: URL) => boolean) {
  const pedidos: URL[] = [];
  const f = async (url: string | URL | Request): Promise<Response> => {
    const u = new URL(String(url));
    pedidos.push(u);
    if (falla?.(u)) return new Response("", { status: 503 });
    const tx = /^\/transactions\/(\w+)$/.exec(u.pathname);
    if (tx) {
      const n = notas[tx[1] as string];
      return new Response(JSON.stringify(n === undefined || n === null ? { memo_type: "none" } : { memo_type: "text", memo: n }), { status: 200 });
    }
    if (u.pathname !== `/accounts/${EVENTO}/payments`) return new Response("", { status: 404 });
    const desc = u.searchParams.get("order") === "desc";
    const cursor = u.searchParams.get("cursor");
    const limite = Number(u.searchParams.get("limit"));
    const orden = [...registros].sort((a, b) => Number(a.paging_token) - Number(b.paging_token));
    if (desc) orden.reverse();
    const lista = orden.filter((r) => cursor === null || (desc ? Number(r.paging_token) < Number(cursor) : Number(r.paging_token) > Number(cursor)));
    return new Response(JSON.stringify({ _embedded: { records: lista.slice(0, limite) } }), { status: 200 });
  };
  const paginasPedidas = (): number => pedidos.filter((u) => u.pathname.endsWith("/payments")).length;
  const notasPedidas = (): string[] => pedidos.filter((u) => u.pathname.startsWith("/transactions/")).map((u) => u.pathname.slice(14));
  return { f, pedidos, paginasPedidas, notasPedidas };
}

const opciones = (h: ReturnType<typeof horizon>, extra: { paginas?: number; notas?: number; memoria?: Map<string, MemoriaDeCupones> } = {}) => ({
  fetch: h.f as never,
  horizon: "https://h.test",
  ahora: () => AHORA,
  memoria: extra.memoria ?? new Map<string, MemoriaDeCupones>(),
  ...(extra.paginas !== undefined ? { paginas: extra.paginas } : {}),
  ...(extra.notas !== undefined ? { notas: extra.notas } : {}),
});

describe("los cupones no se pierden entre pagos ajenos", () => {
  const [a, b] = [cuenta(), cuenta()];

  it("con más de mil pagos ajenos en el medio, se ven el cupón viejo y el nuevo", async () => {
    // Antes se miraban solo los últimos mil pagos: el cupón de `a` quedaba afuera sin aviso.
    const registros = [pago({ id: 10, de: EVENTO, a, hash: "tanda1", hace: 3_600 }), ...ajenos(100, 1_500), pago({ id: 5_000, de: EVENTO, a: b, hash: "tanda2", hace: 60 })];
    const h = horizon(registros, { tanda1: NOTA, tanda2: NOTA });
    const pagos = await pagosDeLaCuenta(EVENTO, opciones(h));
    expect(pagos).not.toBeNull();
    const cupones = cuponesEnviados(pagos ?? [], EVENTO, EV);
    expect([...cupones.keys()].sort()).toEqual([a, b].sort());
    expect(cupones.get(a)?.orden).toBe(10n);
    // Sin pedir la nota de las transacciones ajenas: solo las de la cuenta del evento.
    expect(h.notasPedidas().sort()).toEqual(["tanda1", "tanda2"]);
    // Y sin unir las transacciones a cada pago: pesan mucho.
    expect(h.pedidos.every((u) => !u.searchParams.has("join"))).toBe(true);
  });

  it("un pago que entra de otra cuenta con la nota copiada no es un cupón", async () => {
    const copia = cuenta();
    const registros = [pago({ id: 1, de: copia, a: EVENTO, hash: "copiada" }), pago({ id: 2, de: EVENTO, a, hash: "tanda" })];
    const h = horizon(registros, { copiada: NOTA, tanda: NOTA });
    const pagos = await pagosDeLaCuenta(EVENTO, opciones(h));
    expect(pagos?.map((p) => p.hash)).toEqual(["tanda"]);
    const cupones = cuponesEnviados(pagos ?? [], EVENTO, EV);
    expect([...cupones.keys()]).toEqual([a]);
    expect(cupones.has(EVENTO)).toBe(false);
    expect(h.notasPedidas()).toEqual(["tanda"]);
  });

  it("un pago de la cuenta del evento con otra nota tampoco lo es", async () => {
    const h = horizon([pago({ id: 1, de: EVENTO, a, hash: "otra" })], { otra: "tk:cupon:otro-evento" });
    const pagos = await pagosDeLaCuenta(EVENTO, opciones(h));
    expect(cuponesEnviados(pagos ?? [], EVENTO, EV).size).toBe(0);
  });
});

describe("si no alcanza a leer todo, lo dice", () => {
  const a = cuenta();

  it("con más pagos que el tope de una revisión: null (la pantalla avisa), y la próxima sigue donde quedó", async () => {
    const registros = [pago({ id: 1, de: EVENTO, a, hash: "tanda", hace: 7_200 }), ...ajenos(10, 2_990)];
    const h = horizon(registros, { tanda: NOTA });
    const op = opciones(h, { paginas: 5 });
    const resultados: Array<unknown> = [];
    let pagos = await pagosDeLaCuenta(EVENTO, op);
    resultados.push(pagos);
    for (let i = 0; i < 10 && pagos === null; i++) {
      pagos = await pagosDeLaCuenta(EVENTO, op);
      resultados.push(pagos);
    }
    // Las primeras revisiones no alcanzan: no devuelven una lista a medias.
    expect(resultados[0]).toBeNull();
    expect(resultados[1]).toBeNull();
    expect(pagos).not.toBeNull();
    expect([...cuponesEnviados(pagos ?? [], EVENTO, EV).keys()]).toEqual([a]);
    // Cada pago se leyó una vez: 3.000 pagos son 15 páginas, y una más para ver que no llegó nada nuevo.
    expect(h.paginasPedidas()).toBeLessThanOrEqual(17);
  });

  it("el tope por defecto es explícito: diez páginas de 200 por revisión", async () => {
    expect(PAGINAS_POR_LECTURA).toBe(10);
    const h = horizon(ajenos(1, 2_400), {});
    expect(await pagosDeLaCuenta(EVENTO, opciones(h))).toBeNull();
    expect(h.paginasPedidas()).toBe(PAGINAS_POR_LECTURA);
  });

  it("si Horizon se corta a mitad, null; la próxima revisión retoma sin perder lo leído", async () => {
    const registros = [pago({ id: 1, de: EVENTO, a, hash: "tanda", hace: 7_200 }), ...ajenos(10, 900)];
    let cortar = true;
    const h = horizon(registros, { tanda: NOTA }, (u) => cortar && u.searchParams.get("cursor") !== null);
    const op = opciones(h);
    expect(await pagosDeLaCuenta(EVENTO, op)).toBeNull();
    cortar = false;
    const pagos = await pagosDeLaCuenta(EVENTO, op);
    expect([...cuponesEnviados(pagos ?? [], EVENTO, EV).keys()]).toEqual([a]);
  });

  it("dice si el null es porque falta leer (la pantalla sigue enseguida) o porque Horizon no contestó", async () => {
    const registros = [pago({ id: 1, de: EVENTO, a, hash: "tanda", hace: 7_200 }), ...ajenos(10, 900)];
    let cortar = false;
    const h = horizon(registros, { tanda: NOTA }, () => cortar);
    const op = opciones(h, { paginas: 2 });
    expect(quedaPorLeer(EVENTO, op)).toBe(false);
    expect(await pagosDeLaCuenta(EVENTO, op)).toBeNull();
    expect(quedaPorLeer(EVENTO, op)).toBe(true);
    cortar = true;
    expect(await pagosDeLaCuenta(EVENTO, op)).toBeNull();
    expect(quedaPorLeer(EVENTO, op)).toBe(false);
    cortar = false;
    let pagos = await pagosDeLaCuenta(EVENTO, op);
    for (let i = 0; i < 5 && pagos === null; i++) pagos = await pagosDeLaCuenta(EVENTO, op);
    expect(pagos).not.toBeNull();
    expect(quedaPorLeer(EVENTO, op)).toBe(false);
  });

  it("con más notas propias que las de una revisión, también falta leer", async () => {
    const equipos = Array.from({ length: NOTAS_POR_LECTURA + 1 }, () => cuenta());
    const h = horizon(equipos.map((e, i) => pago({ id: i + 1, de: EVENTO, a: e, hash: `t${i}` })), Object.fromEntries(equipos.map((_, i) => [`t${i}`, NOTA])));
    const op = opciones(h);
    expect(await pagosDeLaCuenta(EVENTO, op)).toBeNull();
    expect(quedaPorLeer(EVENTO, op)).toBe(true);
  });

  it("si no se pudo leer la nota de una tanda, no se la saltea: null", async () => {
    const h = horizon([pago({ id: 1, de: EVENTO, a, hash: "tanda" })], { tanda: NOTA }, (u) => u.pathname.startsWith("/transactions/"));
    expect(await pagosDeLaCuenta(EVENTO, opciones(h))).toBeNull();
  });

  it("con más tandas propias que notas por revisión, sigue en la próxima", async () => {
    const equipos = Array.from({ length: NOTAS_POR_LECTURA + 5 }, () => cuenta());
    const registros = equipos.map((e, i) => pago({ id: i + 1, de: EVENTO, a: e, hash: `t${i}` }));
    const h = horizon(registros, Object.fromEntries(equipos.map((_, i) => [`t${i}`, NOTA])));
    const op = opciones(h);
    expect(await pagosDeLaCuenta(EVENTO, op)).toBeNull();
    const pagos = await pagosDeLaCuenta(EVENTO, op);
    expect(cuponesEnviados(pagos ?? [], EVENTO, EV).size).toBe(equipos.length);
  });
});

describe("cuánto mira", () => {
  const a = cuenta();

  it("no baja más allá de la vida de un registro: una cuenta con mucha historia vieja no corta la búsqueda", async () => {
    const viejos = Array.from({ length: 5_000 }, (_, i) => pago({ id: i + 1, de: cuenta(), a: EVENTO, hash: `v${i}`, hace: VENTANA_DE_CUPONES_S + 3_600 }));
    const registros = [...viejos, pago({ id: 9_000, de: EVENTO, a, hash: "tanda", hace: 120 })];
    const h = horizon(registros, { tanda: NOTA });
    const pagos = await pagosDeLaCuenta(EVENTO, opciones(h));
    expect([...cuponesEnviados(pagos ?? [], EVENTO, EV).keys()]).toEqual([a]);
    expect(h.paginasPedidas()).toBeLessThanOrEqual(2);
  });

  it("después de la primera lectura, solo pide lo nuevo, hacia adelante", async () => {
    const registros = [pago({ id: 1, de: EVENTO, a, hash: "tanda1" }), ...ajenos(10, 500)];
    const h = horizon(registros, { tanda1: NOTA, tanda2: NOTA });
    const op = opciones(h);
    await pagosDeLaCuenta(EVENTO, op);
    const antes = h.pedidos.length;
    const b = cuenta();
    registros.push(pago({ id: 2_000, de: EVENTO, a: b, hash: "tanda2", hace: 5 }));
    const pagos = await pagosDeLaCuenta(EVENTO, op);
    const nuevos = h.pedidos.slice(antes).filter((u) => u.pathname.endsWith("/payments"));
    expect(nuevos.map((u) => [u.searchParams.get("order"), u.searchParams.get("cursor")])).toEqual([["asc", "509"]]);
    expect([...cuponesEnviados(pagos ?? [], EVENTO, EV).keys()].sort()).toEqual([a, b].sort());
  });

  it("una cuenta del evento sin pagos ni cuenta todavía: lista vacía", async () => {
    const vacia = horizon([], {});
    expect(await pagosDeLaCuenta(EVENTO, opciones(vacia))).toEqual([]);
    const sinCuenta = horizon([], {});
    expect(await pagosDeLaCuenta(cuenta(), opciones(sinCuenta))).toEqual([]);
  });

  it("dos revisiones a la vez no se pisan: la segunda sigue donde quedó la primera", async () => {
    const registros = [pago({ id: 1, de: EVENTO, a, hash: "tanda" }), ...ajenos(10, 300)];
    const h = horizon(registros, { tanda: NOTA });
    const op = opciones(h);
    const [uno, dos] = await Promise.all([pagosDeLaCuenta(EVENTO, op), pagosDeLaCuenta(EVENTO, op)]);
    expect(uno?.map((p) => p.hash)).toEqual(["tanda"]);
    expect(dos?.map((p) => p.hash)).toEqual(["tanda"]);
    expect(h.notasPedidas()).toEqual(["tanda"]);
  });
});
