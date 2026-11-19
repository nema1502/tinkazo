// La vigilancia de firmas del portero de mainnet: las firmas que Pollar cobró en el día (`cosign.signature` en los
// movimientos de `billing/credits`) contra las que explican nuestros números (los sellos y sorteos que llegaron al
// portero desde cuentas del libro, y las activaciones), y el patrocinio de la app (`treasury/sponsorship`), que tiene
// que estar todo apagado. Con un Pollar de mentira: ninguna prueba toca la red.
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { SECRETO_POLLAR, T0, codigo, montarAltas } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";
import { FIRMAS_POR_COMPRA } from "./compras";
import { DIA_MS } from "./config";
import { Pollar } from "./pollar";
import { POLLAR_SERVIDOR } from "./servidores";
import { FIRMAS_SIN_EXPLICAR_MAX, MAX_MOVIMIENTOS, contarFirmas, patrocinioEsperado } from "./vigilancia";

const APP = "app_mainnet_inventada";
const HORA = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const firma = (ms: number, extra: Record<string, unknown> = {}) => ({ event: "cosign.signature:STELLAR", amount: -20, createdAt: iso(ms), ...extra });
const resp = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function pollarCon(responder: (url: URL) => Response) {
  const llamadas: string[] = [];
  const anotado: unknown[] = [];
  const p = new Pollar({ secreto: SECRETO_POLLAR, appId: APP, fetch: async (url) => (llamadas.push(url), responder(new URL(url))), reloj: () => T0, registrar: (e, d) => void anotado.push([e, d]) });
  return { p, llamadas, anotado };
}

describe("contarFirmas: las firmas cobradas en los movimientos", () => {
  const desde = T0 - DIA_MS;

  it("cuenta solo los cobros de cosign.signature desde el comienzo de la ventana", () => {
    const movimientos = [
      firma(T0 - HORA),
      firma(T0 - 2 * HORA),
      { event: "cosign.signature", amount: "-20", createdAt: iso(T0 - 3 * HORA) },
      // Otros cobros, una devolución y lo de antes de la ventana no cuentan.
      { event: "wallet.created:STELLAR:COSIGNED", amount: -15, createdAt: iso(T0 - HORA) },
      { event: "account.active:monthly", amount: -10, createdAt: iso(T0 - HORA) },
      firma(T0 - HORA, { amount: 20 }),
      firma(desde - 1),
      { event: "cosign.signatures-otra-cosa", amount: -20, createdAt: iso(T0 - HORA) },
    ];
    expect(contarFirmas(movimientos, desde)).toEqual({ firmas: 3, completo: true });
  });

  it("un movimiento que agrupa varias firmas cuenta las que dice; sin fecha, cuenta (la consulta ya pide desde)", () => {
    expect(contarFirmas([firma(T0 - HORA, { count: 4 }), { event: "cosign.signature:STELLAR", amount: -20 }], desde)).toEqual({ firmas: 5, completo: true });
  });

  it("lo que no se entiende no cuenta, y con la página llena avisa que puede haber más", () => {
    expect(contarFirmas([null, 3, "x", { event: 12 }, { amount: -20 }, firma(T0 - HORA, { count: -2 })], desde)).toEqual({ firmas: 1, completo: true });
    expect(contarFirmas("no es una lista", desde)).toEqual({ firmas: 0, completo: true });
    const llena = Array.from({ length: MAX_MOVIMIENTOS }, (_, i) => firma(T0 - i * 1000));
    expect(contarFirmas(llena, desde)).toEqual({ firmas: MAX_MOVIMIENTOS, completo: false });
  });
});

describe("patrocinioEsperado: todo apagado, salvo lo permitido", () => {
  it("todo apagado es lo esperado; lo que esté prendido se nombra", () => {
    expect(patrocinioEsperado({ sponsor_trustlines: false, sponsor_all_contracts: false })).toEqual({ esperado: true, prendidos: [] });
    expect(patrocinioEsperado({ sponsor_trustlines: true, sponsor_all_contracts: false, sponsor_transfer_native: true })).toEqual({ esperado: false, prendidos: ["sponsor_transfer_native", "sponsor_trustlines"] });
  });

  it("lo que dice PATROCINIO_PERMITIDO puede estar prendido; lo demás prendido se nombra igual", () => {
    const permitido = ["sponsor_transfer_cosigned", "sponsor_trustlines"];
    expect(patrocinioEsperado({ sponsor_trustlines: true, sponsor_transfer_cosigned: true, sponsor_all_contracts: false }, permitido)).toEqual({ esperado: true, prendidos: [] });
    expect(patrocinioEsperado({ sponsor_trustlines: true, sponsor_all_contracts: true }, permitido)).toEqual({ esperado: false, prendidos: ["sponsor_all_contracts"] });
    // Permitido no es obligatorio: apagado también está bien.
    expect(patrocinioEsperado({ sponsor_trustlines: false }, permitido)).toEqual({ esperado: true, prendidos: [] });
  });
});

describe("Pollar: los movimientos y el patrocinio", () => {
  it("los movimientos desde una fecha, con la llave y hasta 200", async () => {
    const movimientos = [firma(T0 - HORA)];
    const { p, llamadas } = pollarCon(() => resp(200, { code: "SERVER_BILLING_CREDITS", success: true, content: { available: 5000, movements: movimientos } }));
    expect(await p.movimientos(T0 - DIA_MS)).toEqual({ ok: true, movimientos });
    const u = new URL(llamadas[0] as string);
    expect(u.origin + u.pathname).toBe(`${POLLAR_SERVIDOR}/v3/billing/credits`);
    expect(u.searchParams.get("since")).toBe(iso(T0 - DIA_MS));
    expect(u.searchParams.get("limit")).toBe(String(MAX_MOVIMIENTOS));
  });

  it("sin la lista de movimientos, o con Pollar caído, no hay lectura", async () => {
    expect(await pollarCon(() => resp(200, { code: "SERVER_BILLING_CREDITS", success: true, content: { available: 1 } })).p.movimientos(T0)).toEqual({ ok: false });
    expect(await pollarCon(() => resp(503, { code: "DOWN", success: false })).p.movimientos(T0)).toEqual({ ok: false });
  });

  it("el patrocinio lee las banderas sponsor_ de treasury/sponsorship, también si vienen adentro de sponsorship", async () => {
    const { p, llamadas } = pollarCon(() => resp(200, { code: "SERVER_SPONSORSHIP", success: true, content: { sponsor_trustlines: false, sponsor_all_contracts: true, otra: true } }));
    expect(await p.patrocinio()).toEqual({ ok: true, banderas: { sponsor_trustlines: false, sponsor_all_contracts: true } });
    expect(llamadas).toEqual([`${POLLAR_SERVIDOR}/v3/treasury/sponsorship`]);
    expect(await pollarCon(() => resp(200, { success: true, content: { sponsorship: { sponsor_trustlines: true } } })).p.patrocinio()).toEqual({ ok: true, banderas: { sponsor_trustlines: true } });
  });

  it("sin ninguna bandera, con otra forma o caído, no hay lectura: no se da por apagado lo que no se vio", async () => {
    for (const r of [resp(200, { success: true, content: {} }), resp(200, { success: true, content: { sponsor_trustlines: "no" } }), resp(200, { success: false, content: { sponsor_trustlines: false } }), resp(403, { code: "FORBIDDEN" })]) {
      expect(await pollarCon(() => r).p.patrocinio()).toEqual({ ok: false });
    }
  });
});

describe("las firmas que explican nuestros números", () => {
  /** Un sello o un sorteo que llegó al portero, de esta cuenta y a esta hora. */
  const uso = (m: ReturnType<typeof montarAltas>, cuenta: string, metodo: "seal" | "draw", creado: number, estado = "ok") =>
    m.sql.exec("INSERT INTO uso (hash, cuenta, metodo, mes, creado, estado, estimado, real, vence) VALUES (?, ?, ?, '2026-11', ?, ?, 1, NULL, 0)", `${metodo}-${creado}-${Math.random()}`, cuenta, metodo, creado, estado);

  it("los sellos y sorteos del día de las cuentas del libro (también los que la red rechazó: se firmaron), y las activaciones", async () => {
    const m = montarAltas();
    const ana = Keypair.random().publicKey();
    const fuera = Keypair.random().publicKey();
    m.cupos.admitir(ana, "cupon", T0 - 10 * DIA_MS);
    uso(m, ana, "seal", T0 - HORA);
    uso(m, ana, "seal", T0 - 2 * HORA, "devuelto");
    uso(m, ana, "draw", T0 - HORA);
    uso(m, ana, "seal", T0 - DIA_MS - 1);
    uso(m, fuera, "seal", T0 - HORA);
    // Una activación de hoy (el alta pasó a abierta) y un alta a mano de una cuenta que ya existía (nadie firmó).
    const beto = m.persona("usr_beto");
    await m.lote([codigo(1)]);
    await m.cupon(beto.token, codigo(1));
    m.mover(HORA);
    m.abiertas.add(beto.cuenta as string);
    await m.estado(beto.token);
    // Un alta que nació con la cuenta ya abierta (en el mismo canje) no tuvo activación.
    const caro = m.persona("usr_caro");
    m.abiertas.add(caro.cuenta as string);
    await m.lote([codigo(2)], { lote: "otro" });
    await m.cupon(caro.token, codigo(2));
    m.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES ('cuenta:X', 'admin', 'admin:x', NULL, NULL, 'abierta', ?, ?)", T0 - HORA, T0 - HORA);
    expect(m.cupos.altaDe("usr_caro")?.estado).toBe("abierta");
    expect(m.cupos.firmasExplicadas(T0 - DIA_MS, { sorteos: true })).toEqual({ sellos: 2, sorteos: 1, activaciones: 1 });
    // Con el sorteo del servidor, el draw lo firma la sorteadora: no es una firma de Pollar.
    expect(m.cupos.firmasExplicadas(T0 - DIA_MS, { sorteos: false })).toEqual({ sellos: 2, sorteos: 0, activaciones: 1 });
    // Pasado el día, nada.
    expect(m.cupos.firmasExplicadas(T0 + 2 * DIA_MS, { sorteos: true })).toEqual({ sellos: 0, sorteos: 0, activaciones: 0 });
  });
});

describe("PuertaAltas.vigilancia, para /v1/patrocinio/estado", () => {
  it("firmasSinExplicar: las cobradas menos las explicadas, y el patrocinio esperado", async () => {
    const m = montarAltas();
    const ana = Keypair.random().publicKey();
    m.cupos.admitir(ana, "admin", T0 - DIA_MS);
    m.sql.exec("INSERT INTO uso (hash, cuenta, metodo, mes, creado, estado, estimado, real, vence) VALUES ('h1', ?, 'seal', '2026-11', ?, 'ok', 1, NULL, 0)", ana, T0 - HORA);
    m.pm.movimientos = [firma(T0 - HORA), firma(T0 - HORA), firma(T0 - 2 * HORA), { event: "wallet.created:STELLAR:COSIGNED", amount: -15, createdAt: iso(T0 - HORA) }];
    expect(await m.puerta.vigilancia()).toEqual({
      firmasSinExplicar: 2,
      firmas: { cobradas: 3, explicadas: 1, sellos: 1, sorteos: 0, activaciones: 0, compras: 0, pagosConSaldo: 0, completo: true, desde: T0 - DIA_MS },
      patrocinioPollar: { esperado: true, prendidos: [] },
    });
    // Nunca negativo: más explicadas que cobradas es cero.
    m.pm.movimientos = [];
    expect(await m.puerta.vigilancia()).toMatchObject({ firmasSinExplicar: 0 });
  });

  it(`más de ${FIRMAS_SIN_EXPLICAR_MAX} sin explicar, o el patrocinio prendido, quedan en la bitácora sin cuentas`, async () => {
    const m = montarAltas();
    m.pm.movimientos = Array.from({ length: FIRMAS_SIN_EXPLICAR_MAX + 1 }, (_, i) => firma(T0 - i * 1000));
    m.pm.patrocinio = { sponsor_trustlines: true, sponsor_all_contracts: false };
    expect(await m.puerta.vigilancia()).toMatchObject({ firmasSinExplicar: FIRMAS_SIN_EXPLICAR_MAX + 1, patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } });
    expect(m.anotado).toContainEqual(["error-firmas", { sinExplicar: FIRMAS_SIN_EXPLICAR_MAX + 1, completo: 1 }]);
    expect(m.anotado).toContainEqual(["error-patrocinio", { prendidos: 1 }]);
    // Con justo el tope, no.
    const n = montarAltas();
    n.pm.movimientos = Array.from({ length: FIRMAS_SIN_EXPLICAR_MAX }, (_, i) => firma(T0 - i * 1000));
    await n.puerta.vigilancia();
    expect(n.anotado.filter(([e]) => e === "error-firmas")).toHaveLength(0);
  });

  it("con Pollar caído, sin lectura: null, nunca cero", async () => {
    const m = montarAltas();
    m.pm.caido = true;
    expect(await m.puerta.vigilancia()).toMatchObject({ firmasSinExplicar: null, firmas: { cobradas: null }, patrocinioPollar: null });
    expect(await montarAltas({}, { sinPollar: true }).puerta.vigilancia()).toMatchObject({ firmasSinExplicar: null, patrocinioPollar: null });
  });

  it("con las altas apagadas no suma nada ni le pregunta a Pollar", async () => {
    const m = montarAltas({ ALTAS: "0" });
    expect(await m.puerta.vigilancia()).toEqual({});
    expect(m.pm.llamadas).toHaveLength(0);
  });
});

describe("la vigilancia con la compra con QR", () => {
  /** La compra con QR abierta y el patrocinio que necesita, permitido. */
  const montar = () => montarPagos({ COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5", PATROCINIO_PERMITIDO: "sponsor_trustlines,sponsor_transfer_cosigned" });
  const conCompra = async (m: ReturnType<typeof montar>, usuario: string) => {
    const p = m.persona(usuario);
    m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
    await m.empezar(p.token, "alta");
    await m.cargar(p.token, "alta");
    const id = (((await m.orden(p.token, "alta")).cuerpo as { orden: { id: string } }).orden).id;
    // Paga con el saldo de su propia cuenta, como la máquina del saldo.
    m.h.sumar({ monto: "6.2500000", nota: `tk:o:${id}`, de: p.cuenta as string, ms: m.hora() });
    expect(await m.pago(p.token, id)).toMatchObject({ cuerpo: { pagada: true } });
    return p;
  };

  it("un día de compras no da alarma: cada compra con movimiento explica hasta 9 firmas y cada pago con el saldo, una", async () => {
    const m = montar();
    await conCompra(m, "usr_ana");
    await conCompra(m, "usr_beto");
    // Caro entró con un cupón y paga el de diez con su saldo, sin QR: es una firma más.
    await m.lote([codigo(1)]);
    const caro = m.persona("usr_caro");
    // En la lista del piloto: con una lista puesta, la orden de alguien de afuera no nace (orden-piloto.test.ts).
    m.cupos.transaccion(() => m.compras.sumarPiloto(caro.cuenta as string, m.hora()));
    await m.cupon(caro.token, codigo(1));
    const id = (((await m.orden(caro.token, "p10")).cuerpo as { orden: { id: string } }).orden).id;
    m.h.sumar({ monto: "5.0000000", nota: `tk:o:${id}`, de: caro.cuenta as string, ms: m.hora() });
    expect(await m.pago(caro.token, id)).toMatchObject({ cuerpo: { pagada: true } });
    m.pm.movimientos = Array.from({ length: 2 * FIRMAS_POR_COMPRA + 1 }, (_, i) => firma(T0 - i * 1000));
    m.pm.patrocinio = { sponsor_trustlines: true, sponsor_transfer_cosigned: true, sponsor_all_contracts: false };
    expect(await m.puerta.vigilancia()).toMatchObject({ firmasSinExplicar: 0, firmas: { compras: 2, pagosConSaldo: 1, explicadas: 2 * FIRMAS_POR_COMPRA + 1 }, patrocinioPollar: { esperado: true, prendidos: [] } });
    expect(m.anotado.filter(([e]) => e === "error-firmas" || e === "error-patrocinio")).toEqual([]);
  });

  it("un día con firmas de más da alarma: más de 10 por encima de lo que explican las compras, y lo no permitido prendido también", async () => {
    const m = montar();
    await conCompra(m, "usr_ana");
    m.pm.movimientos = Array.from({ length: FIRMAS_POR_COMPRA + FIRMAS_SIN_EXPLICAR_MAX + 1 }, (_, i) => firma(T0 - i * 1000));
    m.pm.patrocinio = { sponsor_trustlines: true, sponsor_all_contracts: true };
    expect(await m.puerta.vigilancia()).toMatchObject({ firmasSinExplicar: FIRMAS_SIN_EXPLICAR_MAX + 1, patrocinioPollar: { esperado: false, prendidos: ["sponsor_all_contracts"] } });
    expect(m.anotado).toContainEqual(["error-firmas", { sinExplicar: FIRMAS_SIN_EXPLICAR_MAX + 1, completo: 1 }]);
    expect(m.anotado).toContainEqual(["error-patrocinio", { prendidos: 1 }]);
  });

  it("una compra cargada sin pagar sigue explicando sus aprobaciones los días siguientes, hasta una semana", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    m.cupos.transaccion(() => m.compras.sumarPiloto(ana.cuenta as string, m.hora()));
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    m.mover(3 * DIA_MS);
    expect(m.compras.firmas(m.hora() - DIA_MS)).toEqual({ compras: 1, pagosConSaldo: 0 });
    m.mover(5 * DIA_MS);
    expect(m.compras.firmas(m.hora() - DIA_MS)).toEqual({ compras: 0, pagosConSaldo: 0 });
  });
});
