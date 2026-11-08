import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { equipoCifradoValido, validarConfigEquipos } from "../../workers/sala/src/logica";
import { generarClave } from "../sala/cifra";
import { type Dependencias, escucharSala, type Sala } from "../sala/cliente";
import { anotarEquipoEnSala, leerEstadoDeEquipo } from "../sala/equipos";
import { borradorDelPrimerSorteo, guardarEquipoLocal, leerEquipoLocal, prepararPrimerSorteo, sorteoPropioLocal } from "./celular";
import { cifrarEquipo, descifrarEquipo, revisarEquipo } from "./datos";
import { enlaceDeRegistro, leerEnlaceDeRegistro } from "./enlace";
import { aprobarYEnviar } from "./envio";
import { etiquetaConCuenta, etiquetaDe, hayEtiquetas, paraMostrar, ponerEtiquetas } from "./etiquetas";
import { accionSugerida, conCupon, contarPorEstado, estadoEfectivo, etiquetasDeEquipos, leToca, listaDesdeCupones, paraDarCupon } from "./estado";
import { comoPago, cuentasActivas, cuponesEnviados, enviarTransaccion, leerCuenta, type Pago, pagosDeLaCuenta } from "./horizon";
import { CUPON_MONTO, EVENTO_POR_DEFECTO, type Equipo, MAX_NOTA_BYTES, TOPE_OPERACIONES, bytesDe, cuentaCorta, esCuenta, eventoValido, limpiarEquipo, memoCupon } from "./modelo";
import { cuentasQueYaSortearon } from "./sorteos";
import { ErrorDeCupones, armarCupones, leerCupones, tandas } from "./transacciones";

const PASS = "Test SDF Network ; September 2015";
const cuenta = (): string => Keypair.random().publicKey();
const EVENTO = cuenta();

const equipo = (o: Partial<Equipo> & { n: number }): Equipo => ({
  nombre: `Equipo ${o.n}`,
  integrantes: ["Ana", "Beto"],
  cuenta: cuenta(),
  guardado: "aceptado",
  v: o.n,
  revisar: false,
  activa: true,
  ...o,
});

describe("las notas y las cuentas", () => {
  it("la nota del cupón de Space Apps mide justo lo que admite una nota de texto de Stellar", () => {
    expect(memoCupon(EVENTO_POR_DEFECTO)).toBe("tk:cupon:space-apps-scz-2026");
    expect(bytesDe(memoCupon(EVENTO_POR_DEFECTO))).toBe(MAX_NOTA_BYTES);
  });
  it("un evento que no entra en la nota no vale", () => {
    expect(eventoValido(EVENTO_POR_DEFECTO)).toBe(true);
    expect(eventoValido("space-apps-scz-2026x")).toBe(false);
    expect(eventoValido("Space Apps")).toBe(false);
    expect(eventoValido("ab")).toBe(false);
    expect(eventoValido("-malo")).toBe(false);
  });
  it("reconoce una cuenta de Stellar y la acorta", () => {
    const g = cuenta();
    expect(esCuenta(g)).toBe(true);
    expect(esCuenta(`${g}x`)).toBe(false);
    expect(esCuenta("Ana")).toBe(false);
    expect(cuentaCorta(g)).toBe(`${g.slice(0, 4)}…${g.slice(-4)}`);
  });
});

describe("el equipo que se anota", () => {
  it("limpia los nombres, saca los repetidos y pide al menos dos integrantes", () => {
    const r = limpiarEquipo({ nombre: "  Los   Cóndores ", integrantes: ["Ana", " ana ", "Beto​", "", "Carla"] });
    expect(r).toEqual({ ok: true, equipo: { nombre: "Los Cóndores", integrantes: ["Ana", "Beto", "Carla"] } });
    expect(limpiarEquipo({ nombre: "Solo", integrantes: ["Ana"] })).toEqual({ ok: false, motivo: "pocos" });
    expect(limpiarEquipo({ nombre: " ", integrantes: ["Ana", "Beto"] })).toEqual({ ok: false, motivo: "nombre" });
    expect(limpiarEquipo({ nombre: "x".repeat(41), integrantes: ["Ana", "Beto"] })).toEqual({ ok: false, motivo: "largo" });
  });
  it("hasta cinco integrantes", () => {
    const r = limpiarEquipo({ nombre: "Siete", integrantes: ["a1", "b2", "c3", "d4", "e5", "f6", "g7"] });
    expect(r.ok && r.equipo.integrantes).toHaveLength(5);
  });
});

describe("el cifrado de los datos del equipo", () => {
  it("ida y vuelta con la clave del QR, con tildes y emojis", async () => {
    const k = generarClave();
    const e = { nombre: "Los Cóndores 🦙", integrantes: ["José Ñandú", "Zoë", "Ana María"] };
    const d = await cifrarEquipo(k, e);
    expect(d).not.toContain("Cóndores");
    expect(await descifrarEquipo(k, d)).toEqual(e);
  });
  it("con otra clave o con bytes rotos no se lee", async () => {
    const d = await cifrarEquipo(generarClave(), { nombre: "A", integrantes: ["Ana", "Beto"] });
    expect(await descifrarEquipo(generarClave(), d)).toBeNull();
    expect(await descifrarEquipo(generarClave(), "AAAA")).toBeNull();
  });
  it("lo cifrado, aun en el peor caso (cuarenta y cinco emojis de cuatro bytes), lo acepta la sala", async () => {
    const k = generarClave();
    const peor = { nombre: "🦙".repeat(40), integrantes: Array.from({ length: 5 }, () => "🦙".repeat(30)) };
    const d = await cifrarEquipo(k, peor);
    expect(equipoCifradoValido(d)).toBe(true);
    expect(d).not.toContain("🦙");
  });
  it("la sala no acepta lo que no es un equipo cifrado", () => {
    for (const x of ["", "hola mundo!", "A".repeat(2000), "AAAA", 5, null]) expect(equipoCifradoValido(x)).toBe(false);
  });
  it("un enlace o una palabra fea en el equipo: el enlace se descarta y la palabra lo deja para revisar", () => {
    expect(revisarEquipo({ nombre: "Los Cóndores", integrantes: ["Ana", "Beto"] })).toEqual({ equipo: { nombre: "Los Cóndores", integrantes: ["Ana", "Beto"] }, revisar: false });
    expect(revisarEquipo({ nombre: "visitá tinkazo.app", integrantes: ["Ana", "Beto"] })).toBeNull();
    expect(revisarEquipo({ nombre: "Equipo", integrantes: ["Ana", "pendejo"] })?.revisar).toBe(true);
    // Un integrante con un enlace se descarta; el equipo sigue.
    expect(revisarEquipo({ nombre: "Equipo", integrantes: ["Ana", "www.malo.com", "Beto"] })?.equipo.integrantes).toEqual(["Ana", "Beto"]);
  });
});

describe("la configuración que acepta la sala", () => {
  const ok = { modo: "sorteo", evento: EVENTO_POR_DEFECTO, cuenta: EVENTO };
  it("acepta los dos modos y descarta lo que sobra", () => {
    expect(validarConfigEquipos(ok)).toEqual(ok);
    expect(validarConfigEquipos({ ...ok, modo: "cupon", sobra: 1 })).toEqual({ ...ok, modo: "cupon" });
  });
  it("rechaza un modo que no existe (la seña ya no está), un evento largo o una cuenta mala", () => {
    for (const mal of [{ ...ok, modo: "sena" }, { ...ok, evento: "a".repeat(20) }, { ...ok, evento: "Space Apps" }, { ...ok, cuenta: "G123" }, { ...ok, cuenta: undefined }, null, "x"]) {
      expect(validarConfigEquipos(mal)).toBeNull();
    }
  });
});

describe("la transacción de cupones", () => {
  it("un pago de 1 stroop de XLM a cada cuenta, con la nota del evento", async () => {
    const destinos = Array.from({ length: 5 }, cuenta);
    const t = await armarCupones({ origen: EVENTO, secuencia: "100", destinos, evento: EVENTO_POR_DEFECTO, passphrase: PASS });
    expect(t.memo).toBe("tk:cupon:space-apps-scz-2026");
    const l = await leerCupones(t.xdr, PASS);
    expect(l.origen).toBe(EVENTO);
    expect(l.memo).toBe(t.memo);
    expect(l.operaciones.map((o) => o.destino)).toEqual(destinos);
    for (const o of l.operaciones) expect(o).toMatchObject({ monto: CUPON_MONTO, nativo: true });
  });
  it("entran justo 100 operaciones: la 101 no", async () => {
    const cien = Array.from({ length: TOPE_OPERACIONES }, cuenta);
    const t = await armarCupones({ origen: EVENTO, secuencia: "1", destinos: cien, evento: EVENTO_POR_DEFECTO, passphrase: PASS });
    const l = await leerCupones(t.xdr, PASS);
    expect(l.operaciones).toHaveLength(100);
    // La comisión del SDK es por operación: 100 operaciones a 1.000 stroops son 0,01 XLM como tope, no 1 XLM.
    expect(l.comision).toBe(100_000);
    await expect(armarCupones({ origen: EVENTO, secuencia: "1", destinos: [...cien, cuenta()], evento: EVENTO_POR_DEFECTO, passphrase: PASS })).rejects.toMatchObject({ motivo: "demasiadas" });
  });
  it("no arma una vacía, con una cuenta repetida o con una cuenta que no es", async () => {
    const a = cuenta();
    const base = { origen: EVENTO, secuencia: "1", evento: EVENTO_POR_DEFECTO, passphrase: PASS };
    await expect(armarCupones({ ...base, destinos: [] })).rejects.toBeInstanceOf(ErrorDeCupones);
    await expect(armarCupones({ ...base, destinos: [a, a] })).rejects.toMatchObject({ motivo: "repetidas" });
    await expect(armarCupones({ ...base, destinos: [a, "GMALA"] })).rejects.toMatchObject({ motivo: "cuenta" });
  });
  it("parte la lista en tandas de a 100", () => {
    const xs = Array.from({ length: 230 }, (_, i) => i);
    expect(tandas(xs).map((t) => t.length)).toEqual([100, 100, 30]);
    expect(tandas([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ Horizon */

const registro = (o: { id: number; de: string; a: string; memo?: string | null; monto?: string; nativo?: boolean; ok?: boolean; tipo?: string }): Record<string, unknown> => ({
  type: o.tipo ?? "payment",
  paging_token: String(o.id),
  transaction_successful: o.ok ?? true,
  transaction_hash: `hash${o.id}`,
  created_at: "2026-11-14T10:00:00Z",
  from: o.de,
  to: o.a,
  amount: o.monto ?? CUPON_MONTO,
  asset_type: o.nativo === false ? "credit_alphanum4" : "native",
  transaction: o.memo === null ? { memo_type: "none" } : { memo_type: "text", memo: o.memo ?? memoCupon(EVENTO_POR_DEFECTO) },
});

const pagina = (registros: Record<string, unknown>[], siguiente?: string): Response =>
  new Response(JSON.stringify({ _embedded: { records: registros }, _links: siguiente ? { next: { href: siguiente } } : {} }), { status: 200 });

describe("los cupones, leídos de Horizon", () => {
  const a = cuenta();
  const b = cuenta();
  const c = cuenta();

  it("un cupón es un pago de 1 stroop de XLM de la cuenta del evento con la nota del evento", () => {
    const pagos = [
      registro({ id: 10, de: EVENTO, a }),
      registro({ id: 11, de: EVENTO, a: b, monto: "0.0000002" }),
      registro({ id: 12, de: EVENTO, a: c, memo: "otra nota" }),
      registro({ id: 13, de: cuenta(), a: c }),
      registro({ id: 14, de: EVENTO, a: c, nativo: false }),
      registro({ id: 15, de: EVENTO, a: c, memo: null }),
    ].map((r) => comoPago(r as never) as Pago);
    const m = cuponesEnviados(pagos, EVENTO, EVENTO_POR_DEFECTO);
    expect([...m.keys()]).toEqual([a]);
    expect(m.get(a)).toEqual({ orden: 10n, hash: "hash10" });
  });
  it("si recibió dos cupones, vale el primero", () => {
    const pagos = [registro({ id: 30, de: EVENTO, a }), registro({ id: 20, de: EVENTO, a })].map((r) => comoPago(r as never) as Pago);
    expect(cuponesEnviados(pagos, EVENTO, EVENTO_POR_DEFECTO).get(a)?.orden).toBe(20n);
  });
  it("un pago fallido o que no es un pago no cuenta", () => {
    expect(comoPago(registro({ id: 1, de: EVENTO, a, ok: false }) as never)).toBeNull();
    expect(comoPago(registro({ id: 1, de: EVENTO, a, tipo: "create_account" }) as never)).toBeNull();
  });
  it("lee los pagos de la cuenta del evento, del más viejo al más nuevo, y sigue las páginas", async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("page2")) return pagina([registro({ id: 1, de: EVENTO, a: b })]);
      return pagina(
        Array.from({ length: 200 }, (_, i) => registro({ id: 500 - i, de: EVENTO, a })),
        "https://h.test/page2",
      );
    });
    const pagos = await pagosDeLaCuenta(EVENTO, { fetch: f as never, horizon: "https://h.test" });
    expect(pagos).toHaveLength(201);
    expect(pagos?.[0]?.orden).toBe(1n);
    expect(pagos?.at(-1)?.orden).toBe(500n);
    expect(String(f.mock.calls[0]?.[0])).toContain(`/accounts/${EVENTO}/payments?order=desc&limit=200&join=transactions`);
  });
  it("sin respuesta de Horizon no se afirma nada (null), y una cuenta que no existe no tiene pagos", async () => {
    expect(await pagosDeLaCuenta(EVENTO, { fetch: (async () => new Response("", { status: 503 })) as never })).toBeNull();
    expect(await pagosDeLaCuenta(EVENTO, { fetch: (async () => { throw new Error("red"); }) as never })).toBeNull();
    expect(await pagosDeLaCuenta(EVENTO, { fetch: (async () => new Response("", { status: 404 })) as never })).toEqual([]);
  });
});

describe("si las cuentas ya están activas", () => {
  it("una cuenta que no existe todavía se dice, sin fallar", async () => {
    const viva = cuenta();
    const nueva = cuenta();
    const rara = cuenta();
    const f = async (url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      if (u.endsWith(viva)) return new Response(JSON.stringify({ sequence: "55", balances: [{ asset_type: "native", balance: "10.5" }] }), { status: 200 });
      if (u.endsWith(nueva)) return new Response("{}", { status: 404 });
      return new Response("", { status: 500 });
    };
    const m = await cuentasActivas([viva, nueva, rara, viva], { fetch: f as never, horizon: "https://h.test" });
    expect(m.get(viva)).toBe(true);
    expect(m.get(nueva)).toBe(false);
    expect(m.get(rara)).toBeNull();
    expect(m.size).toBe(3);
    expect(await leerCuenta(viva, { fetch: f as never })).toEqual({ existe: true, secuencia: "55", xlm: 10.5 });
  });
});

describe("mandar la transacción a la red", () => {
  const f = (estado: number, cuerpo: unknown) => (async () => new Response(JSON.stringify(cuerpo), { status: estado })) as never;
  it("entra", async () => {
    expect(await enviarTransaccion("XDR", { fetch: f(200, { hash: "abc", successful: true }) })).toEqual({ ok: true, hash: "abc" });
  });
  it("traduce lo que la red contesta", async () => {
    const mal = (r: unknown) => enviarTransaccion("XDR", { fetch: f(400, { extras: { result_codes: r } }) });
    expect(await mal({ transaction: "tx_failed", operations: ["op_success", "op_no_destination"] })).toEqual({ ok: false, motivo: "sin-destino" });
    expect(await mal({ transaction: "tx_insufficient_balance" })).toEqual({ ok: false, motivo: "sin-saldo" });
    expect(await mal({ transaction: "tx_bad_seq" })).toEqual({ ok: false, motivo: "secuencia" });
    expect(await mal({ transaction: "tx_too_late" })).toEqual({ ok: false, motivo: "tarde" });
    expect(await mal({ transaction: "tx_bad_auth" })).toEqual({ ok: false, motivo: "rechazada" });
    expect(await enviarTransaccion("XDR", { fetch: f(503, {}) })).toEqual({ ok: false, motivo: "red" });
  });
});

describe("aprobar y mandar", () => {
  const billetera = (o: { address: string; sale?: boolean; pasa?: string | null; firma?: () => Promise<{ signedTxXdr: string }>; seEnviaSola?: boolean }) =>
    ({
      kind: "external",
      label: "Freighter",
      address: o.address,
      connect: async () => o.address,
      disconnect: async () => undefined,
      networkPassphrase: async () => (o.pasa === undefined ? PASS : o.pasa),
      signTransaction: o.firma ?? (async (x: string) => ({ signedTxXdr: `firmada:${x}` })),
      ...(o.seEnviaSola ? { submitsItself: true } : {}),
    }) as never;

  it("con la billetera de la cuenta del evento aprueba y manda", async () => {
    const enviar = vi.fn(async () => ({ ok: true as const, hash: "H" }));
    const r = await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: EVENTO }), passphrase: PASS, enviar });
    expect(r).toEqual({ tipo: "enviado", hash: "H" });
    expect(enviar).toHaveBeenCalledWith("firmada:XDR");
  });
  it("con Pollar no firma nada: devuelve el código para Stellar Lab", async () => {
    const firma = vi.fn(async () => ({ signedTxXdr: "x" }));
    const r = await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: EVENTO, seEnviaSola: true, firma }), passphrase: PASS });
    expect(r).toEqual({ tipo: "a-mano", xdr: "XDR", porque: "pollar" });
    expect(firma).not.toHaveBeenCalled();
  });
  it("si la billetera es otra cuenta, o no hay billetera, tampoco firma", async () => {
    expect(await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: cuenta() }), passphrase: PASS })).toEqual({ tipo: "a-mano", xdr: "XDR", porque: "otra-cuenta" });
    expect(await aprobarYEnviar("XDR", EVENTO, { billetera: null, passphrase: PASS })).toEqual({ tipo: "a-mano", xdr: "XDR", porque: "sin-billetera" });
  });
  it("una billetera en otra red no firma; si la persona cancela, se dice", async () => {
    expect(await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: EVENTO, pasa: "Public Global Stellar Network ; September 2015" }), passphrase: PASS })).toEqual({ tipo: "fallo", motivo: "otra-red" });
    const cancela = async (): Promise<{ signedTxXdr: string }> => {
      throw new Error("wallet-rejected");
    };
    expect(await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: EVENTO, firma: cancela }), passphrase: PASS })).toEqual({ tipo: "fallo", motivo: "cancelada" });
  });
  it("si la red no la acepta, dice por qué", async () => {
    const r = await aprobarYEnviar("XDR", EVENTO, { billetera: billetera({ address: EVENTO }), passphrase: PASS, enviar: async () => ({ ok: false, motivo: "sin-destino" }) });
    expect(r).toEqual({ tipo: "fallo", motivo: "sin-destino" });
  });
});

/* ------------------------------------------------------------ los estados */

describe("el estado de un equipo", () => {
  const sorteo = { id: "7", contrato: "CAAA" };
  const cupon = { orden: 5n, hash: "h" };

  it("el cupón recibido manda sobre todo", () => {
    expect(estadoEfectivo("cupon", "aceptado", { cupon })).toBe("cupon");
    expect(estadoEfectivo("sorteo", "solicitud", { cupon })).toBe("cupon");
  });
  it("en el modo con sorteo propio, un equipo aceptado que ya sorteó pasa a 'sorteo'", () => {
    expect(estadoEfectivo("sorteo", "aceptado", { yaSorteo: sorteo })).toBe("sorteo");
    expect(estadoEfectivo("sorteo", "aceptado", undefined)).toBe("aceptado");
  });
  it("quien todavía no fue aceptado sigue en solicitud aunque ya haya sorteado", () => {
    expect(estadoEfectivo("sorteo", "solicitud", { yaSorteo: sorteo })).toBe("solicitud");
  });
  it("en el modo de reserva sortear no cambia nada", () => {
    expect(estadoEfectivo("cupon", "aceptado", { yaSorteo: sorteo })).toBe("aceptado");
  });
  it("nunca vuelve para atrás: lo que la sala ya dice 'sorteo' queda así aunque la cadena no se haya podido leer", () => {
    expect(estadoEfectivo("sorteo", "sorteo", undefined)).toBe("sorteo");
  });
});

describe("a quién le toca el cupón", () => {
  const sorteo = { id: "1", contrato: "C" };
  const e1 = equipo({ n: 1 });
  const e2 = equipo({ n: 2 });
  const e3 = equipo({ n: 3, guardado: "solicitud" });
  const e4 = equipo({ n: 4, activa: false });
  const e5 = equipo({ n: 5, revisar: true });
  const todos = [e1, e2, e3, e4, e5];

  it("en el modo de reserva, a todos los anotados y activos que no lo tienen (menos los que esperan revisión)", () => {
    const ev = new Map([[e1.cuenta, { cupon: { orden: 1n, hash: "h" } }]]);
    const { listos, inactivos } = paraDarCupon("cupon", [e1, e2, equipo({ n: 6, guardado: "aceptado" }), e4, e5], ev);
    expect(listos.map((e) => e.n)).toEqual([2, 6]);
    expect(inactivos.map((e) => e.n)).toEqual([4]);
  });
  it("con sorteo propio, solo a los aceptados que ya sortearon", () => {
    const ev = new Map([
      [e1.cuenta, { yaSorteo: sorteo }],
      [e3.cuenta, { yaSorteo: sorteo }],
      [e4.cuenta, { yaSorteo: sorteo }],
      [e5.cuenta, { yaSorteo: sorteo }],
    ]);
    const { listos, inactivos } = paraDarCupon("sorteo", todos, ev);
    expect(listos.map((e) => e.n)).toEqual([1]);
    expect(inactivos.map((e) => e.n)).toEqual([4]);
    expect(leToca("sorteo", e2, ev.get(e2.cuenta))).toBe(false);
    expect(leToca("sorteo", e3, ev.get(e3.cuenta))).toBe(false);
  });
  it("el que ya tiene cupón no vuelve a recibirlo", () => {
    const ev = new Map([[e1.cuenta, { yaSorteo: sorteo, cupon: { orden: 3n, hash: "h" } }]]);
    expect(paraDarCupon("sorteo", [e1], ev).listos).toEqual([]);
  });
  it("cuenta cuántos hay en cada punto", () => {
    const ev = new Map([
      [e1.cuenta, { yaSorteo: sorteo }],
      [e2.cuenta, { cupon: { orden: 2n, hash: "h" } }],
    ]);
    expect(contarPorEstado("sorteo", [e1, e2, e3, equipo({ n: 9 })], ev)).toEqual({ solicitud: 1, aceptado: 1, sorteo: 1, cupon: 1 });
  });
  it("sugiere una sola cosa a la vez: aceptar, después los cupones, después la lista", () => {
    const ya = { yaSorteo: sorteo };
    expect(accionSugerida("sorteo", [e3], new Map())).toBe("aceptar");
    expect(accionSugerida("sorteo", [e1], new Map([[e1.cuenta, ya]]))).toBe("cupones");
    expect(accionSugerida("sorteo", [e1], new Map())).toBe("ninguna");
    const con = new Map([
      [e1.cuenta, { cupon: { orden: 1n, hash: "a" } }],
      [e2.cuenta, { cupon: { orden: 2n, hash: "b" } }],
    ]);
    expect(accionSugerida("cupon", [e1, e2], con)).toBe("lista");
    expect(accionSugerida("cupon", [e1], new Map([[e1.cuenta, { cupon: { orden: 1n, hash: "a" } }]]))).toBe("ninguna");
  });
});

describe("la lista que se sella sale de los cupones", () => {
  it("una cuenta por línea, en el orden en que recibieron el cupón (no en el que se anotaron)", () => {
    const e1 = equipo({ n: 1, nombre: "Primeros en anotarse" });
    const e2 = equipo({ n: 2, nombre: "Segundos" });
    const e3 = equipo({ n: 3, nombre: "Sin cupón" });
    const e4 = equipo({ n: 4, nombre: "Terceros" });
    const ev = new Map([
      [e2.cuenta, { cupon: { orden: 100n, hash: "a" } }],
      [e1.cuenta, { cupon: { orden: 300n, hash: "b" } }],
      [e4.cuenta, { cupon: { orden: 200n, hash: "c" } }],
    ]);
    const { lineas, etiquetas } = listaDesdeCupones([e1, e2, e3, e4], ev);
    expect(lineas).toEqual([e2.cuenta, e4.cuenta, e1.cuenta]);
    expect(etiquetas.get(e2.cuenta)).toBe("Segundos");
    expect(etiquetas.has(e3.cuenta)).toBe(false);
    expect(conCupon([e1, e2, e3, e4], ev).map((e) => e.n)).toEqual([2, 4, 1]);
  });
  it("la lista es canónica: sin líneas cortas ni repetidas, tal como la lee el protocolo", async () => {
    const { canonicalList } = await import("../protocol/canonical");
    const es = [equipo({ n: 1 }), equipo({ n: 2 }), equipo({ n: 3 })];
    const ev = new Map(es.map((e, i) => [e.cuenta, { cupon: { orden: BigInt(i), hash: "h" } }]));
    const { lineas } = listaDesdeCupones(es, ev);
    expect(canonicalList(lineas.join("\n"))).toEqual(lineas);
  });
  it("dos equipos con el mismo nombre se distinguen en pantalla", () => {
    const m = etiquetasDeEquipos([equipo({ n: 1, nombre: "Cóndores" }), equipo({ n: 2, nombre: "cóndores" }), equipo({ n: 3, nombre: "Pumas" })]);
    expect([...m.values()]).toEqual(["Cóndores", "cóndores (2)", "Pumas"]);
  });
  it("las etiquetas solo cambian lo que es de un equipo", () => {
    const g = cuenta();
    expect(hayEtiquetas()).toBe(false);
    expect(paraMostrar(["Ana", g])).toEqual(["Ana", g]);
    ponerEtiquetas(new Map([[g, "Los Cóndores"]]));
    expect(hayEtiquetas()).toBe(true);
    expect(etiquetaDe(g)).toBe("Los Cóndores");
    expect(etiquetaDe("Ana")).toBe("Ana");
    expect(etiquetaConCuenta(g)).toBe(`Los Cóndores (${cuentaCorta(g)})`);
    expect(etiquetaConCuenta("Ana")).toBe("Ana");
    expect(paraMostrar(["Ana", g])).toEqual(["Ana", "Los Cóndores"]);
    ponerEtiquetas(new Map());
    expect(hayEtiquetas()).toBe(false);
  });
});

/* ---------------------------------------------- "ya sorteó", leído del contrato */

describe("qué equipos ya sortearon con su cuenta", () => {
  const a = cuenta();
  const b = cuenta();
  const c = cuenta();
  const crudo = (id: string, organizer: string, sealedAt: number, contract = "C1") => ({ id, organizer, sealedAt, contract, listHash: "", count: 2, numWinners: 1, round: 1, prize: "p", drawn: true });
  const contratos = [
    { contractId: "C1", rpcUrl: "r1" },
    { contractId: "C0", rpcUrl: "r0", ultimoId: 9 },
  ];

  it("marca a los equipos que selló un sorteo con su cuenta, en el contrato vigente y en los anteriores", async () => {
    const escanear = vi.fn(async (contrato: string) =>
      contrato === "C1" ? { todos: [crudo("3", a, 200), crudo("4", cuenta(), 210)], truncated: false } : { todos: [crudo("2", b, 100, "C0")], truncated: false },
    );
    const r = await cuentasQueYaSortearon([a, b, c], { escanear, contratos });
    expect(r?.truncado).toBe(false);
    expect([...(r?.porCuenta.keys() ?? [])].sort()).toEqual([a, b].sort());
    expect(r?.porCuenta.get(b)).toMatchObject({ id: "2", contrato: "C0" });
    // Cada contrato se recorre una vez para todos los equipos, no una por equipo.
    expect(escanear).toHaveBeenCalledTimes(2);
  });
  it("si la cuenta sorteó varias veces, queda la primera", async () => {
    const escanear = async () => ({ todos: [crudo("9", a, 300), crudo("5", a, 100)], truncated: false });
    const r = await cuentasQueYaSortearon([a], { escanear, contratos: [{ contractId: "C1", rpcUrl: "r" }] });
    expect(r?.porCuenta.get(a)?.id).toBe("5");
  });
  it("avisa si algún contrato tiene más sorteos de los que se leen", async () => {
    const escanear = async () => ({ todos: [], truncated: true });
    expect((await cuentasQueYaSortearon([a], { escanear, contratos }))?.truncado).toBe(true);
  });
  it("sin respuesta no se afirma nada: null", async () => {
    const cae = async (): Promise<never> => {
      throw new Error("rpc");
    };
    expect(await cuentasQueYaSortearon([a], { escanear: cae, contratos })).toBeNull();
    expect(await cuentasQueYaSortearon([a], { escanear: async () => null, contratos })).toBeNull();
    expect(await cuentasQueYaSortearon([a], { escanear: async () => ({ todos: [], truncated: false }), contratos: [] })).toBeNull();
  });
  it("un contrato anterior que ya no tiene instancia se salta, mientras otro conteste", async () => {
    const escanear = async (contrato: string) => (contrato === "C1" ? { todos: [crudo("1", a, 5)], truncated: false } : null);
    expect((await cuentasQueYaSortearon([a], { escanear, contratos }))?.porCuenta.has(a)).toBe(true);
  });
});

/* ------------------------------------------------------------ el celular */

describe("el celular del equipo", () => {
  const memoria = (): Pick<Storage, "getItem" | "setItem"> & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it("el enlace del QR lleva la sala y la clave, y la clave va después del #", () => {
    const s = { id: "AbCd1234", clave: generarClave(), servicio: "https://s.tinkazo.app" };
    const u = new URL(enlaceDeRegistro(s, "https://tinkazo.app"));
    expect(u.pathname).toBe("/equipos.html");
    expect(u.searchParams.get("sala")).toBe(s.id);
    expect(u.search).not.toContain(s.clave);
    expect(u.hash).toBe(`#${s.clave}`);
    expect(leerEnlaceDeRegistro(u.search, u.hash, "tinkazo.app")).toEqual(s);
  });
  it("un servicio de otro lado solo se acepta en localhost", () => {
    const s = { id: "AbCd1234", clave: generarClave(), servicio: "http://127.0.0.1:8792" };
    const u = new URL(enlaceDeRegistro(s, "http://localhost:5173"));
    expect(leerEnlaceDeRegistro(u.search, u.hash, "localhost")?.servicio).toBe("http://127.0.0.1:8792");
    expect(leerEnlaceDeRegistro(u.search, u.hash, "tinkazo.app")?.servicio).toBe("https://s.tinkazo.app");
    expect(leerEnlaceDeRegistro("?sala=malo", "#x", "tinkazo.app")).toBeNull();
    expect(leerEnlaceDeRegistro("?sala=AbCd1234", "", "tinkazo.app")).toBeNull();
  });
  it("recuerda el equipo que anotó, solo para esa sala", () => {
    const al = memoria();
    const e = { cuenta: cuenta(), nombre: "Cóndores", integrantes: ["Ana", "Beto"], sala: "AbCd1234" };
    guardarEquipoLocal(e, al);
    expect(leerEquipoLocal("AbCd1234", al)).toEqual(e);
    expect(leerEquipoLocal("OtraSala1", al)).toBeNull();
  });
  it("sugiere el primer sorteo: los integrantes de lista y '¿Quién presenta primero?' de premio, editable", () => {
    expect(borradorDelPrimerSorteo({ nombre: "X", integrantes: ["Ana", "Beto", "Carla"] }, "¿Quién presenta primero?")).toEqual({ texto: "Ana\nBeto\nCarla", premio: "¿Quién presenta primero?", nw: "1" });
    const al = memoria();
    expect(prepararPrimerSorteo({ nombre: "X", integrantes: ["Ana", "Beto"] }, "Who presents first?", al)).toBe(true);
    expect(JSON.parse(al.m.get("tinkazo.borrador") ?? "")).toEqual({ texto: "Ana\nBeto", premio: "Who presents first?", nw: "1" });
    expect(al.m.get("tinkazo.abrir")).toBe("app");
  });
  it("encuentra el sorteo que esta cuenta selló desde este navegador, con su comprobante", () => {
    const g = cuenta();
    const al = memoria();
    al.m.set(
      "tinkazo.history.testnet",
      JSON.stringify([
        { organizer: cuenta(), id: "1", proof: "https://tinkazo.app/verificar.html#ajeno", sealedAt: 50 },
        { organizer: g, id: "2", proof: "https://tinkazo.app/verificar.html#viejo", sealedAt: 100 },
        { organizer: g, id: "3", proof: "https://tinkazo.app/verificar.html#nuevo", sealedAt: 200 },
        { organizer: g, sealedAt: 300 },
        { organizer: g, id: "4", sinSello: true, proof: "x", sealedAt: 400 },
      ]),
    );
    expect(sorteoPropioLocal(g, "testnet", al)).toEqual({ id: "3", proof: "https://tinkazo.app/verificar.html#nuevo", sealedAt: 200 });
    expect(sorteoPropioLocal(g, "mainnet", al)).toBeNull();
    expect(sorteoPropioLocal(cuenta(), "testnet", al)).toBeNull();
  });
});

describe("la sala, vista desde el celular y desde la pantalla", () => {
  const SALA: Sala = { id: "AbCd1234", token: "T".repeat(22), clave: generarClave(), vence: Date.now() + 1000, servicio: "https://s.test" };

  it("anota el equipo con su cuenta en claro y los datos cifrados", async () => {
    const g = cuenta();
    const f = vi.fn(async () => new Response(JSON.stringify({ n: 3, estado: "solicitud" }), { status: 201 }));
    const r = await anotarEquipoEnSala("https://s.test", "AbCd1234", g, "CIFRADO", { fetch: f as never });
    expect(r).toEqual({ ok: true, n: 3, estado: "solicitud" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://s.test/v1/sala/AbCd1234/equipos");
    expect(JSON.parse(String(init.body))).toEqual({ cuenta: g, d: "CIFRADO" });
  });
  it("traduce lo que contesta la sala", async () => {
    const con = (estado: number, cuerpo: unknown = {}) => ({ fetch: (async () => new Response(JSON.stringify(cuerpo), { status: estado })) as never });
    const g = cuenta();
    expect(await anotarEquipoEnSala("s", "i", g, "d", con(404))).toEqual({ ok: false, motivo: "cerrada" });
    expect(await anotarEquipoEnSala("s", "i", g, "d", con(409))).toEqual({ ok: false, motivo: "sin-registro" });
    expect(await anotarEquipoEnSala("s", "i", g, "d", con(429, { error: "llena" }))).toEqual({ ok: false, motivo: "llena" });
    expect(await anotarEquipoEnSala("s", "i", g, "d", con(429, { error: "rapido" }))).toEqual({ ok: false, motivo: "rapido" });
    expect(await anotarEquipoEnSala("s", "i", g, "d", { fetch: (async () => { throw new Error("x"); }) as never })).toEqual({ ok: false, motivo: "red" });
  });
  it("lee en qué punto está el equipo", async () => {
    const f = (estado: number, cuerpo: unknown) => ({ fetch: (async () => new Response(JSON.stringify(cuerpo), { status: estado })) as never });
    const g = cuenta();
    expect(await leerEstadoDeEquipo("s", "i", g, f(200, { n: 2, estado: "sorteo" }))).toEqual({ n: 2, estado: "sorteo" });
    expect(await leerEstadoDeEquipo("s", "i", g, f(404, {}))).toBeNull();
    expect(await leerEstadoDeEquipo("s", "i", g, f(500, {}))).toBe("red");
    expect(await leerEstadoDeEquipo("s", "i", g, f(200, { n: 2, estado: "inventado" }))).toBe("red");
  });
  it("un aviso del socket que llega antes que la primera consulta no tapa a los equipos anteriores", async () => {
    const llegaron: number[] = [];
    const g = cuenta();
    const fila = (n: number) => ({ n, cuenta: g, d: "D", estado: "solicitud", v: n });
    let soltar: (r: Response) => void = () => undefined;
    const lenta = new Promise<Response>((r) => (soltar = r));
    let socket: { listeners: Record<string, ((e: unknown) => void)[]> } | null = null;
    const dep: Dependencias = {
      fetch: (async (url: string) => (String(url).includes("/equipos") ? lenta : new Response("[]"))) as never,
      socket: () => {
        const listeners: Record<string, ((e: unknown) => void)[]> = {};
        socket = { listeners };
        return { send: () => undefined, close: () => undefined, addEventListener: (t: string, f: (e: unknown) => void) => void (listeners[t] ??= []).push(f) } as never;
      },
    };
    const esc = escucharSala(SALA, { alNombre: () => undefined, alEquipo: (e) => void llegaron.push(e.n) }, dep);
    // El equipo 5 llega por el socket antes de que conteste la consulta, que trae del 1 al 5.
    (socket as unknown as { listeners: Record<string, ((e: unknown) => void)[]> }).listeners.message?.forEach((f) => f({ data: JSON.stringify({ t: "equipo", ...fila(5) }) }));
    soltar(new Response(JSON.stringify([1, 2, 3, 4, 5].map(fila))));
    await vi.waitFor(() => expect([...llegaron].sort()).toEqual([1, 2, 3, 4, 5]));
    esc.parar();
  });
  it("la pantalla recibe los equipos, cada versión una sola vez, y los quitados", async () => {
    const vistos: number[] = [];
    const quitados: number[] = [];
    const g = cuenta();
    const lista = [{ n: 1, cuenta: g, d: "D", estado: "aceptado", v: 1 }];
    let socket: { listeners: Record<string, ((e: unknown) => void)[]>; send: () => void; close: () => void; addEventListener: (t: string, f: (e: unknown) => void) => void } | null = null;
    const dep: Dependencias = {
      fetch: (async (url: string) => (String(url).includes("/equipos") ? new Response(JSON.stringify(lista)) : new Response("[]"))) as never,
      socket: () => {
        const listeners: Record<string, ((e: unknown) => void)[]> = {};
        socket = { listeners, send: () => undefined, close: () => undefined, addEventListener: (t, f) => void (listeners[t] ??= []).push(f) };
        return socket as never;
      },
    };
    const esc = escucharSala(
      SALA,
      { alNombre: () => undefined, alEquipo: (e) => void vistos.push(e.v), alEquipoQuitado: (n) => void quitados.push(n) },
      dep,
    );
    await vi.waitFor(() => expect(vistos).toEqual([1]));
    const mandar = (m: unknown): void => socket?.listeners.message?.forEach((f) => f({ data: JSON.stringify(m) }));
    mandar({ t: "equipo", v: 1, n: 1, cuenta: g, d: "D", estado: "aceptado" });
    mandar({ t: "equipo", v: 2, n: 1, cuenta: g, d: "D", estado: "sorteo" });
    mandar({ t: "equipo-quitado", n: 1 });
    expect(vistos).toEqual([1, 2]);
    expect(quitados).toEqual([1]);
    esc.parar();
  });
});

/* ------------------------------------------------------------ las palabras */

describe("los textos de los equipos no dicen lo que Tinkazo no puede decir", () => {
  it("nada que huela a apuesta, ni el punto medio, ni tecnicismos ante la persona (es y en)", async () => {
    const { readFileSync } = await import("node:fs");
    const { TEXTOS_EQUIPOS } = await import("./textos");
    const datos = JSON.parse(readFileSync("scripts/lib/palabras-prohibidas.json", "utf8")) as {
      apuesta: { es: string[]; en: string[] };
      vocabulario: { reglas: Array<{ id: string; es: string[]; en: string[] }> };
    };
    const sinTildes = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const patron = (p: string): RegExp => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${sinTildes(p)})(?![\p{L}\p{N}])`, "iu");
    const reglas = [
      ...[...datos.apuesta.es, ...datos.apuesta.en].map((p) => ({ id: "apuesta", re: patron(p) })),
      ...datos.vocabulario.reglas.filter((r) => r.id === "punto-medio" || r.id === "tecnicismos").flatMap((r) => [...r.es, ...r.en].map((p) => ({ id: r.id, re: patron(p) }))),
    ];
    const malos: string[] = [];
    for (const l of ["es", "en"] as const) {
      for (const [k, v] of Object.entries(TEXTOS_EQUIPOS[l])) {
        const texto = sinTildes(v);
        for (const r of reglas) if (r.re.test(texto)) malos.push(`${l} ${k} (${r.id}): ${v}`);
      }
    }
    expect(malos).toEqual([]);
  });
  it("las dos lenguas tienen las mismas claves", async () => {
    const { TEXTOS_EQUIPOS } = await import("./textos");
    expect(Object.keys(TEXTOS_EQUIPOS.es).sort()).toEqual(Object.keys(TEXTOS_EQUIPOS.en).sort());
  });
});
