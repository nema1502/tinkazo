import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  CANJES_POR_DEFECTO,
  DIA_MS,
  EMISOR_USDC,
  PLAN,
  REGLAS,
  TIPOS_DE_EVENTO,
  aStroops,
  acreditar,
  activarPlan,
  canjear,
  cuentaDeTexto,
  cuentaVacia,
  enlaceDePago,
  esCuenta,
  esTipoDeEvento,
  leerCanjes,
  leerCuenta,
  memoDePlan,
  planParaElPortero,
  planVigente,
} from "./reglas";

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

describe("una cuenta de Stellar", () => {
  it("acepta direcciones de verdad", () => {
    for (let i = 0; i < 20; i++) expect(esCuenta(Keypair.random().publicKey())).toBe(true);
  });
  it("rechaza lo que no es una dirección o tiene un carácter cambiado", () => {
    expect(esCuenta("")).toBe(false);
    expect(esCuenta(123)).toBe(false);
    expect(esCuenta(A.toLowerCase())).toBe(false);
    expect(esCuenta(`${A}A`)).toBe(false);
    // Cambiar un carácter rompe la suma de control.
    const otro = A.slice(0, 20) + (A[20] === "A" ? "B" : "A") + A.slice(21);
    expect(esCuenta(otro)).toBe(false);
    // Una dirección de contrato (C…) o de llave secreta (S…) no es una cuenta.
    expect(esCuenta(`C${A.slice(1)}`)).toBe(false);
    expect(esCuenta(Keypair.random().secret())).toBe(false);
  });
  it("los emisores de USDC de las dos redes son direcciones bien escritas", () => {
    expect(esCuenta(EMISOR_USDC.mainnet)).toBe(true);
    expect(esCuenta(EMISOR_USDC.testnet)).toBe(true);
  });
  it("saca la cuenta de lo que muestra un QR o se pega", () => {
    expect(cuentaDeTexto(`  ${A}\n`)).toBe(A);
    expect(cuentaDeTexto(`stellar:${A}`)).toBe(A);
    expect(cuentaDeTexto(`web+stellar:pay?destination=${A}&amount=5`)).toBe(A);
    expect(cuentaDeTexto("hola")).toBeNull();
    expect(cuentaDeTexto(`G${"A".repeat(55)}`)).toBeNull();
  });
});

describe("los montos", () => {
  it("pasa a stroops con hasta siete decimales", () => {
    expect(aStroops("1")).toBe(10_000_000n);
    expect(aStroops("5.0000000")).toBe(50_000_000n);
    expect(aStroops("0.0000001")).toBe(1n);
    expect(aStroops("12.5")).toBe(125_000_000n);
  });
  it("rechaza lo que no es un monto", () => {
    for (const x of ["", "-1", "1.00000001", "1e3", "abc", "1,5", null, 5, undefined]) expect(aStroops(x), String(x)).toBeNull();
  });
});

describe("las reglas de ganancia", () => {
  it("son las del proyecto, cada una con su tope", () => {
    expect(REGLAS.primer_sorteo).toMatchObject({ monedas: 20, max: 1 });
    expect(REGLAS.primera_carga).toMatchObject({ monedas: 50, max: 1 });
    expect(REGLAS.plan).toMatchObject({ monedas: 50, max: 1 });
    expect(REGLAS.invitar).toMatchObject({ monedas: 10, max: 1 });
    expect(REGLAS.comprobar).toMatchObject({ monedas: 5, max: 5 });
  });
  it("el sitio puede pedir tres; el plan y invitar no se piden", () => {
    expect([...TIPOS_DE_EVENTO].sort()).toEqual(["comprobar", "primer_sorteo", "primera_carga"]);
    expect(esTipoDeEvento("plan")).toBe(false);
    expect(esTipoDeEvento("invitar")).toBe(false);
    expect(esTipoDeEvento("registro")).toBe(false);
    expect(esTipoDeEvento(undefined)).toBe(false);
  });
  it("una regla de una vez suma una vez", () => {
    const r1 = acreditar(cuentaVacia(), "primer_sorteo", 1000);
    expect(r1).toMatchObject({ ok: true, monedas: 20 });
    if (!r1.ok) return;
    expect(r1.cuenta.saldo).toBe(20);
    expect(r1.cuenta.historial[0]).toEqual({ tipo: "primer_sorteo", monedas: 20, ms: 1000 });
    expect(acreditar(r1.cuenta, "primer_sorteo", 2000)).toEqual({ ok: false, motivo: "ya" });
  });
  it("comprobar suma hasta cinco veces y después corta", () => {
    let c = cuentaVacia();
    for (let i = 1; i <= 5; i++) {
      const r = acreditar(c, "comprobar", i);
      expect(r.ok, `vez ${i}`).toBe(true);
      if (r.ok) c = r.cuenta;
    }
    expect(c.saldo).toBe(25);
    expect(acreditar(c, "comprobar", 9)).toEqual({ ok: false, motivo: "tope" });
  });
  it("el mismo resultado comprobado no suma dos veces", () => {
    const r = acreditar(cuentaVacia(), "comprobar", 1, "testnet:12");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(acreditar(r.cuenta, "comprobar", 2, "testnet:12")).toEqual({ ok: false, motivo: "ya" });
    expect(acreditar(r.cuenta, "comprobar", 2, "testnet:13").ok).toBe(true);
  });
  it("el historial guarda solo lo último", () => {
    let c = cuentaVacia();
    for (let i = 0; i < 40; i++) {
      const r = acreditar({ ...c, hechos: {} }, "comprobar", i);
      if (r.ok) c = r.cuenta;
    }
    expect(c.historial).toHaveLength(20);
  });
  it("un registro roto o de otra forma se empieza de cero", () => {
    expect(leerCuenta(null)).toEqual(cuentaVacia());
    expect(leerCuenta("{")).toEqual(cuentaVacia());
    expect(leerCuenta(JSON.stringify({ v: 2, saldo: 5 }))).toEqual(cuentaVacia());
    expect(leerCuenta(JSON.stringify({ v: 1, saldo: "mucho" }))).toEqual(cuentaVacia());
    expect(leerCuenta(JSON.stringify({ v: 1, saldo: 7 })).saldo).toBe(7);
  });
});

describe("la tiendita", () => {
  const chocolate = CANJES_POR_DEFECTO[0]!;
  it("trae lo de siempre: chocolate 20, stickers 50, logo en el show 100, nombre en el cartel 200", () => {
    expect(CANJES_POR_DEFECTO.map((c) => [c.codigo, c.costo])).toEqual([
      ["chocolate", 20],
      ["stickers", 50],
      ["logo-en-el-show", 100],
      ["nombre-en-el-cartel", 200],
    ]);
  });
  it("descuenta lo que cuesta y anota el canje", () => {
    const r = canjear({ ...cuentaVacia(), saldo: 70 }, chocolate, 5000, "id-de-prueba-1");
    expect(r).toMatchObject({ ok: true, repetido: false, canje: { codigo: "chocolate", costo: 20, ms: 5000 } });
    if (!r.ok) return;
    expect(r.cuenta.saldo).toBe(50);
    expect(r.cuenta.historial[0]).toEqual({ tipo: "canje:chocolate", monedas: -20, ms: 5000 });
    expect(r.cuenta.canjes[0]).toEqual({ codigo: "chocolate", costo: 20, ms: 5000 });
  });
  it("sin monedas suficientes dice cuántas faltan y no toca nada", () => {
    const c = { ...cuentaVacia(), saldo: 12 };
    expect(canjear(c, chocolate, 1)).toEqual({ ok: false, motivo: "saldo", saldo: 12, falta: 8 });
  });
  it("el mismo identificador no descuenta dos veces", () => {
    const c0 = { ...cuentaVacia(), saldo: 100 };
    const uno = canjear(c0, chocolate, 1, "id-de-prueba-1");
    if (!uno.ok) throw new Error("debía poder");
    const dos = canjear(uno.cuenta, chocolate, 2, "id-de-prueba-1");
    expect(dos).toMatchObject({ ok: true, repetido: true });
    if (dos.ok) expect(dos.cuenta.saldo).toBe(80);
    // Con otro identificador, es otro canje.
    const tres = canjear(uno.cuenta, chocolate, 3, "id-de-prueba-2");
    if (tres.ok) expect(tres.cuenta.saldo).toBe(60);
  });
  it("lee la lista de la variable, y si algo no cuadra vale la de siempre", () => {
    const ok = JSON.stringify([{ codigo: "taza", es: "Una taza", en: "A mug", costo: 30 }]);
    expect(leerCanjes(ok)).toEqual([{ codigo: "taza", es: "Una taza", en: "A mug", costo: 30 }]);
    const malas = [
      undefined,
      "",
      "no es json",
      "[]",
      "{}",
      JSON.stringify([{ codigo: "taza", es: "x", en: "y", costo: 0 }]),
      JSON.stringify([{ codigo: "taza", es: "x", en: "y", costo: 1.5 }]),
      JSON.stringify([{ codigo: "Taza grande", es: "x", en: "y", costo: 5 }]),
      JSON.stringify([{ codigo: "taza", es: "", en: "y", costo: 5 }]),
      JSON.stringify([
        { codigo: "taza", es: "x", en: "y", costo: 5 },
        { codigo: "taza", es: "x", en: "y", costo: 6 },
      ]),
      JSON.stringify([{ codigo: "taza", es: "x", en: "y", costo: 99_999 }]),
    ];
    for (const mal of malas) expect(leerCanjes(mal), String(mal)).toBe(CANJES_POR_DEFECTO);
  });
});

describe("el plan del equipo", () => {
  it("son 5 USDC, 30 días y 50 monedas", () => {
    expect(PLAN).toEqual({ usdc: 5, dias: 30, monedas: 50, cupo: { sellos: 50, sorteos: 100 } });
  });
  it("para el portero: activo con su cupo hasta el vencimiento, y no activo cuando vence o no hay plan", () => {
    const plan = { inicio: 1_000, vence: 5_000, tx: "t", usadas: ["t"] };
    expect(planParaElPortero({ ...cuentaVacia(), plan }, 4_999)).toEqual({ activo: true, vence: 5_000, cupo: { sellos: 50, sorteos: 100 } });
    expect(planParaElPortero({ ...cuentaVacia(), plan }, 5_000)).toEqual({ activo: false });
    expect(planParaElPortero({ ...cuentaVacia(), plan }, 9_999)).toEqual({ activo: false });
    expect(planParaElPortero(cuentaVacia(), 1)).toEqual({ activo: false });
  });
  it("la nota es tk:plan: más los últimos 8 caracteres de la cuenta", () => {
    expect(memoDePlan(A)).toBe(`tk:plan:${A.slice(-8)}`);
    expect(memoDePlan(A)).toHaveLength(16);
    expect(memoDePlan(A)).not.toBe(memoDePlan(B));
  });
  it("el enlace de pago lleva cuenta, monto, USDC, emisor y nota", () => {
    const destino = Keypair.random().publicKey();
    const enlace = enlaceDePago({ destino, cuenta: A, red: "mainnet" });
    expect(enlace.startsWith("web+stellar:pay?")).toBe(true);
    const q = new URL(enlace.replace("web+stellar:", "https://x/")).searchParams;
    expect(q.get("destination")).toBe(destino);
    expect(q.get("amount")).toBe("5");
    expect(q.get("asset_code")).toBe("USDC");
    expect(q.get("asset_issuer")).toBe(EMISOR_USDC.mainnet);
    expect(q.get("memo")).toBe(memoDePlan(A));
    expect(q.get("memo_type")).toBe("MEMO_TEXT");
    // Los dos puntos de la nota viajan escapados.
    expect(enlace).toContain("memo=tk%3Aplan%3A");
    expect(enlaceDePago({ destino, cuenta: A, red: "testnet" })).toContain(EMISOR_USDC.testnet);
  });
  it("activa por 30 días, regala 50 monedas una vez y anota el pago", () => {
    const r = activarPlan(cuentaVacia(), "tx1", 1_000_000);
    expect(r).toMatchObject({ ok: true, monedas: 50 });
    if (!r.ok) return;
    expect(r.cuenta.saldo).toBe(50);
    expect(r.cuenta.plan).toMatchObject({ inicio: 1_000_000, vence: 1_000_000 + 30 * DIA_MS, tx: "tx1", usadas: ["tx1"] });
    expect(planVigente(r.cuenta, 1_000_000 + 29 * DIA_MS)).not.toBeNull();
    expect(planVigente(r.cuenta, 1_000_000 + 31 * DIA_MS)).toBeNull();
  });
  it("el mismo pago no activa dos veces", () => {
    const r = activarPlan(cuentaVacia(), "tx1", 1);
    if (!r.ok) throw new Error("debía poder");
    expect(activarPlan(r.cuenta, "tx1", 2)).toEqual({ ok: false, motivo: "ya" });
  });
  it("renovar con el plan vigente suma 30 días al vencimiento y no vuelve a regalar monedas", () => {
    const uno = activarPlan(cuentaVacia(), "tx1", 0);
    if (!uno.ok) throw new Error("debía poder");
    const dos = activarPlan(uno.cuenta, "tx2", 10 * DIA_MS);
    expect(dos).toMatchObject({ ok: true, monedas: 0 });
    if (!dos.ok) return;
    expect(dos.cuenta.plan).toMatchObject({ inicio: 0, vence: 60 * DIA_MS, tx: "tx2" });
    expect(dos.cuenta.saldo).toBe(50);
  });
  it("con el plan vencido, uno nuevo arranca de hoy", () => {
    const uno = activarPlan(cuentaVacia(), "tx1", 0);
    if (!uno.ok) throw new Error("debía poder");
    const dos = activarPlan(uno.cuenta, "tx2", 100 * DIA_MS);
    if (!dos.ok) throw new Error("debía poder");
    expect(dos.cuenta.plan).toMatchObject({ inicio: 100 * DIA_MS, vence: 130 * DIA_MS });
  });
});
