import { describe, expect, it } from "vitest";
import { COTIZACIONES, type CotizacionHecha, centavosParaPagar, centavosQueHay, centavosQueLlegan, cotizacionParaElObjetivo, margenDe, objetivoDeLaCarga, queda } from "./compra-monto";

/** La cuenta de cuánto cargar con el QR: tres casos de ejemplo, el margen, el redondeo, el mínimo y las tres cotizaciones. */

/** Un proveedor de mentira: por cada monto en bolivianos, los dólares que llegan. */
type Proveedor = (bs: number) => number;
const lineal =
  (tasa: number, fijo = 0): Proveedor =>
  (bs) =>
    Math.max(0, (bs - fijo) / tasa);

/** Corre la cuenta contra un proveedor hasta que alcanza o no alcanza, y devuelve lo que se pagaría y cuántas cotizaciones hubo. */
function cotizar(objetivo: number, proveedor: Proveedor, minimoBs = 0): { bs: number | null; llega: number | null; veces: number } {
  const hechas: CotizacionHecha[] = [];
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const r = cotizacionParaElObjetivo(objetivo, hechas, minimoBs);
    if (r.estado === "cotizar") {
      hechas.push({ pagas: r.bs, recibis: proveedor(r.bs) });
      continue;
    }
    if (r.estado === "alcanza") {
      const c = hechas[r.indice] as CotizacionHecha;
      return { bs: c.pagas, llega: c.recibis, veces: hechas.length };
    }
    return { bs: null, llega: null, veces: hechas.length };
  }
  throw new Error("más de diez vueltas");
}

describe("los montos en centavos", () => {
  it("lo que hay que pagar redondea para arriba, lo que se tiene y lo que llega, para abajo", () => {
    expect(centavosParaPagar("8.25")).toBe(825);
    expect(centavosParaPagar("10")).toBe(1000);
    expect(centavosParaPagar("0.5")).toBe(50);
    expect(centavosParaPagar("4.2500001")).toBe(426);
    expect(centavosQueHay("0.2000000")).toBe(20);
    expect(centavosQueHay("0.2099999")).toBe(20);
    expect(centavosQueLlegan(8.45)).toBe(845);
    expect(centavosQueLlegan(5.2)).toBe(520);
    expect(centavosQueLlegan(9.129)).toBe(912);
  });

  it("lo que no es un monto no se cuenta", () => {
    for (const m of ["", "abc", "-1", "1,5", "1.12345678", " ", null, undefined]) {
      expect(centavosParaPagar(m), String(m)).toBeNull();
      expect(centavosQueHay(m), String(m)).toBeNull();
    }
    for (const n of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(centavosQueLlegan(n), String(n)).toBeNull();
  });
});

describe("el margen y el objetivo", () => {
  it("el margen es el 3 % de lo que falta, con un piso de 20 centavos, al centavo para arriba", () => {
    expect(margenDe(500)).toBe(20);
    expect(margenDe(666)).toBe(20);
    expect(margenDe(667)).toBe(21);
    expect(margenDe(880)).toBe(27);
    expect(margenDe(825)).toBe(25);
    expect(margenDe(1000)).toBe(30);
    expect(margenDe(1)).toBe(20);
  });

  it("si el saldo alcanza, falta 0 y no se carga", () => {
    expect(objetivoDeLaCarga("9", "9.0000000")).toEqual({ falta: 0, margen: 0, objetivo: 0 });
    expect(objetivoDeLaCarga("9", "12.5000000")).toEqual({ falta: 0, margen: 0, objetivo: 0 });
    expect(margenDe(0)).toBe(0);
    expect(margenDe(-100)).toBe(0);
  });

  it("sin el saldo leído, cuenta como cero; un precio que no es un monto no da objetivo", () => {
    expect(objetivoDeLaCarga("5", null)).toEqual({ falta: 500, margen: 20, objetivo: 520 });
    expect(objetivoDeLaCarga("cinco", "0")).toBeNull();
    expect(objetivoDeLaCarga("0", "0")).toBeNull();
  });

  it("el total con el recargo del QR, como lo da el servidor: 4 más 4,25 la primera vez", () => {
    expect(objetivoDeLaCarga("8.25", "0")).toEqual({ falta: 825, margen: 25, objetivo: 850 });
    expect(objetivoDeLaCarga("10.5", "0.3200000")).toEqual({ falta: 1018, margen: 31, objetivo: 1049 });
  });
});

describe("tres casos, con una tasa de Bs 12,50 por dólar", () => {
  const FILAS: [string, string, string, { falta: number; margen: number; objetivo: number }, number, number][] = [
    ["primer paquete", "5", "0", { falta: 500, margen: 20, objetivo: 520 }, 65, 20],
    ["10 sorteos", "9", "0.2000000", { falta: 880, margen: 27, objetivo: 907 }, 114, 32],
    ["10 sorteos con saldo", "9", "6.0000000", { falta: 300, margen: 20, objetivo: 320 }, 40, 20],
  ];
  it.each(FILAS)("%s", (_, precio, saldo, objetivo, bs, quedan) => {
    const o = objetivoDeLaCarga(precio, saldo);
    expect(o).toEqual(objetivo);
    const r = cotizar((o as { objetivo: number }).objetivo, lineal(12.5));
    expect(r.bs).toBe(bs);
    expect(r.veces).toBeLessThanOrEqual(COTIZACIONES);
    expect(queda(centavosParaPagar(precio) as number, centavosQueHay(saldo) as number, centavosQueLlegan(r.llega as number) as number)).toBe(quedan);
  });
});

describe("las cotizaciones", () => {
  it("la primera es de lectura, con 12 bolivianos por dólar, al boliviano para arriba", () => {
    expect(cotizacionParaElObjetivo(520, [])).toEqual({ estado: "cotizar", bs: 63 });
    expect(cotizacionParaElObjetivo(850, [])).toEqual({ estado: "cotizar", bs: 102 });
  });

  it("de la tasa real sale el monto que llega justo, y si no llega, uno más", () => {
    expect(cotizacionParaElObjetivo(520, [{ pagas: 63, recibis: 5.04 }])).toEqual({ estado: "cotizar", bs: 65 });
    expect(cotizacionParaElObjetivo(520, [{ pagas: 63, recibis: 5.04 }, { pagas: 65, recibis: 5.2 }])).toEqual({ estado: "alcanza", indice: 1 });
    expect(cotizacionParaElObjetivo(520, [{ pagas: 63, recibis: 5.04 }, { pagas: 65, recibis: 5.19 }])).toEqual({ estado: "cotizar", bs: 66 });
  });

  it("si la de lectura ya es el monto justo y llega, se usa esa", () => {
    expect(cotizacionParaElObjetivo(480, [{ pagas: 58, recibis: 4.8 }])).toEqual({ estado: "alcanza", indice: 0 });
  });

  it("nunca más de tres: con la tercera que no llega, la más barata de las que llegaron, o ninguna", () => {
    const tres = [{ pagas: 63, recibis: 6 }, { pagas: 60, recibis: 5 }, { pagas: 61, recibis: 5.1 }];
    expect(cotizacionParaElObjetivo(520, tres)).toEqual({ estado: "alcanza", indice: 0 });
    const ninguna = [{ pagas: 63, recibis: 4 }, { pagas: 82, recibis: 5 }, { pagas: 83, recibis: 5.1 }];
    expect(cotizacionParaElObjetivo(520, ninguna)).toEqual({ estado: "no-alcanza" });
    expect(cotizacionParaElObjetivo(520, [...ninguna, { pagas: 90, recibis: 6 }]).estado).not.toBe("cotizar");
  });

  it("el mínimo del proveedor manda sobre el monto", () => {
    expect(cotizacionParaElObjetivo(520, [], 100)).toEqual({ estado: "cotizar", bs: 100 });
    // Con el mínimo, la de lectura ya es el monto y llega de sobra: una sola cotización.
    expect(cotizar(520, lineal(12.5), 100)).toEqual({ bs: 100, llega: 8, veces: 1 });
    expect(cotizar(520, lineal(12.5), 50).bs).toBe(65);
  });

  it("nunca un monto que no llegue al objetivo, con proveedores de tasas y comisiones distintas", () => {
    const proveedores: Proveedor[] = [lineal(12.5), lineal(10), lineal(14.2), lineal(12.5, 3), lineal(12.5, 10), lineal(9.7, 1.5), (bs) => (bs < 70 ? bs / 13 : bs / 12), (bs) => Math.floor((bs / 12.7) * 100) / 100];
    for (const p of proveedores) for (const objetivo of [20, 320, 520, 850, 907, 1049, 2500]) for (const minimo of [0, 50, 100]) {
      const r = cotizar(objetivo, p, minimo);
      expect(r.veces, `${objetivo} ${minimo}`).toBeLessThanOrEqual(COTIZACIONES);
      if (r.bs !== null) {
        expect(centavosQueLlegan(r.llega as number), `${objetivo} ${minimo}`).toBeGreaterThanOrEqual(objetivo);
        expect(r.bs, `${objetivo} ${minimo}`).toBeGreaterThanOrEqual(minimo);
        expect(Number.isInteger(r.bs)).toBe(true);
      }
    }
  });

  it("un objetivo de cero o raro no cotiza", () => {
    for (const o of [0, -5, 1.5, Number.NaN]) expect(cotizacionParaElObjetivo(o, []), String(o)).toEqual({ estado: "no-alcanza" });
  });
});
