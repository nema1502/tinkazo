import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  PLAZO_DE_PAGO_S,
  USDC_MAINNET,
  USDC_TESTNET,
  activoDePagos,
  cuentasQuePagan,
  esDireccionG,
  estadoDelPago,
  leerActivo,
  leerNotaDelPremio,
  montoDelPremio,
  montoDePago,
  montoLegible,
  notaDelPremio,
  pagosActivos,
  stroopsDe,
} from "./pagos";

/** Cuentas de verdad de testnet (públicas): las que usan las pruebas de la red. */
const ORG = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const GANA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const EMISOR = "GCQPYIVQSYUCGFCGTZ7KTLEZ62PML72P6XND4V2YQLRFK22QQJRPFIAE";

describe("la bandera de los premios pagados", () => {
  it("se prende con VITE_PAGOS=1 o con VITE_EQUIPOS=1, y por defecto está apagada", () => {
    expect(pagosActivos({})).toBe(false);
    expect(pagosActivos({ VITE_PAGOS: "1" })).toBe(true);
    expect(pagosActivos({ VITE_EQUIPOS: "1" })).toBe(true);
    expect(pagosActivos({ VITE_PAGOS: "0", VITE_EQUIPOS: "" })).toBe(false);
    expect(pagosActivos({ VITE_PAGOS: "true" })).toBe(false);
  });
});

describe("una cuenta de Stellar (G…)", () => {
  it("acepta las de verdad", () => {
    for (const g of [ORG, GANA, EMISOR, USDC_MAINNET.issuer, USDC_TESTNET.issuer]) expect(esDireccionG(g), g).toBe(true);
  });

  it("no acepta una con una letra cambiada: el final de control no cuadra", () => {
    const mala = `${ORG.slice(0, 20)}${ORG[20] === "A" ? "B" : "A"}${ORG.slice(21)}`;
    expect(esDireccionG(mala)).toBe(false);
    expect(esDireccionG(ORG.slice(0, 55) + (ORG[55] === "A" ? "B" : "A"))).toBe(false);
  });

  it("no acepta lo que no es una cuenta: contratos, secretas, cuentas con id, minúsculas, otro largo, otro tipo", () => {
    expect(esDireccionG("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75")).toBe(false);
    expect(esDireccionG(Keypair.random().secret())).toBe(false);
    expect(esDireccionG("M" + ORG.slice(1))).toBe(false);
    expect(esDireccionG(ORG.toLowerCase())).toBe(false);
    expect(esDireccionG(ORG.slice(0, 55))).toBe(false);
    expect(esDireccionG(`${ORG} `)).toBe(false);
    expect(esDireccionG("Ana Mamani")).toBe(false);
    expect(esDireccionG("")).toBe(false);
    expect(esDireccionG(null)).toBe(false);
    expect(esDireccionG(56)).toBe(false);
  });
});

describe("el activo con que se paga", () => {
  it("en mainnet es el USDC de Circle y no se cambia con una variable", () => {
    expect(activoDePagos("mainnet")).toEqual(USDC_MAINNET);
    expect(activoDePagos("mainnet", `TKUSD:${EMISOR}`)).toEqual(USDC_MAINNET);
  });

  it("el USDC de mainnet es el del contrato que se dio", () => {
    expect(new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer).contractId(Networks.PUBLIC)).toBe("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
  });

  it("en testnet es el USDC de prueba de Circle, o el que se configure", () => {
    expect(activoDePagos("testnet", undefined)).toEqual(USDC_TESTNET);
    expect(activoDePagos("testnet", `TKUSD:${EMISOR}`)).toEqual({ code: "TKUSD", issuer: EMISOR });
    expect(activoDePagos("testnet", "TKUSD:GABC")).toEqual(USDC_TESTNET);
    expect(activoDePagos("testnet", "sin-dos-puntos")).toEqual(USDC_TESTNET);
  });

  it("lee CODIGO:EMISOR y rechaza lo demás", () => {
    expect(leerActivo(` USDC:${EMISOR} `)).toEqual({ code: "USDC", issuer: EMISOR });
    expect(leerActivo(`TOOLONGASSETCODE:${EMISOR}`)).toBeNull();
    expect(leerActivo(`US DC:${EMISOR}`)).toBeNull();
    expect(leerActivo(`USDC:${EMISOR}:x`)).toBeNull();
    expect(leerActivo(`:${EMISOR}`)).toBeNull();
    expect(leerActivo(7)).toBeNull();
  });

  it("las cuentas que pagan además de quien selló salen de una lista separada por comas", () => {
    expect(cuentasQuePagan(`${ORG}, ${GANA};${ORG} basura GABC`)).toEqual([ORG, GANA]);
    expect(cuentasQuePagan("")).toEqual([]);
    expect(cuentasQuePagan(undefined)).toEqual([]);
  });
});

describe("la nota del pago de un premio", () => {
  it("es tk:premio:<sorteo>:<puesto>, con el puesto desde 0", () => {
    expect(notaDelPremio(123, 0)).toBe("tk:premio:123:0");
    expect(notaDelPremio("278", 41)).toBe("tk:premio:278:41");
    expect(notaDelPremio(9007199254740993n, 2)).toBe("tk:premio:9007199254740993:2");
  });

  it("cabe siempre en los 28 bytes de una nota de texto, o lanza", () => {
    const larga = notaDelPremio("1234567890123", 1234);
    expect(new TextEncoder().encode(larga).length).toBeLessThanOrEqual(28);
    expect(() => notaDelPremio("123456789012345678", 100)).toThrow();
  });

  it("no acepta un número ni un puesto que no sean enteros sin signo", () => {
    expect(() => notaDelPremio("abc", 0)).toThrow();
    expect(() => notaDelPremio("-1", 0)).toThrow();
    expect(() => notaDelPremio("1.5", 0)).toThrow();
    expect(() => notaDelPremio("", 0)).toThrow();
    expect(() => notaDelPremio(1, -1)).toThrow();
    expect(() => notaDelPremio(1, 1.5)).toThrow();
  });

  it("se lee de vuelta, y solo la forma exacta", () => {
    expect(leerNotaDelPremio("tk:premio:123:0")).toEqual({ raffleId: "123", puesto: 0 });
    expect(leerNotaDelPremio("tk:premio:278:41")).toEqual({ raffleId: "278", puesto: 41 });
    for (const rara of ["tk:premio:123", "tk:premio:123:", "tk:premio:a:1", "TK:PREMIO:1:1", " tk:premio:1:1", "tk:premio:1:1 ", "tk:cupon:space-apps-scz-2026", "tk:premio:1:-1", 5, null]) {
      expect(leerNotaDelPremio(rara), String(rara)).toBeNull();
    }
  });
});

describe("el monto del pago", () => {
  it("se escribe con siete decimales, como lo pide Stellar", () => {
    expect(montoDePago("50")).toBe("50.0000000");
    expect(montoDePago(" 12.5 ")).toBe("12.5000000");
    expect(montoDePago("0.0000001")).toBe("0.0000001");
    expect(montoDePago("100.1234567")).toBe("100.1234567");
    expect(montoDePago("7.10")).toBe("7.1000000");
  });

  it("acepta la coma como decimal", () => {
    expect(montoDePago("12,5")).toBe("12.5000000");
    expect(montoDePago("0,25")).toBe("0.2500000");
  });

  it("no acepta cero, negativos, más de siete decimales, letras, miles ni vacío", () => {
    for (const malo of ["0", "0.0", "0.0000000", "-5", "0.00000001", "50 USDC", "1e3", "1,000.50", "1.2.3", "", "   ", ".5", "5.", "abc", "+5"]) {
      expect(montoDePago(malo), malo).toBeNull();
    }
    expect(montoDePago(50 as unknown)).toBeNull();
  });

  it("el tope es el máximo de Stellar", () => {
    expect(montoDePago("922337203685.4775807")).toBe("922337203685.4775807");
    expect(montoDePago("922337203685.4775808")).toBeNull();
    expect(montoDePago("1000000000000")).toBeNull();
  });

  it("se compara en stroops, sin errores de redondeo", () => {
    expect(stroopsDe("50.0000000")).toBe(500_000_000n);
    expect(stroopsDe("0.0000001")).toBe(1n);
    expect(stroopsDe("12.5")).toBe(125_000_000n);
    expect(stroopsDe("0.1000000") + stroopsDe("0.2000000")).toBe(stroopsDe("0.3000000"));
  });

  it("se lee sin los ceros de sobra", () => {
    expect(montoLegible("50.0000000")).toBe("50");
    expect(montoLegible("12.5000000")).toBe("12.5");
    expect(montoLegible("0.0000001")).toBe("0.0000001");
  });

  it("se propone el que dice el texto del premio, si lo dice claro", () => {
    expect(montoDelPremio("50 USDC")).toBe("50");
    expect(montoDelPremio("Beca de 12,5 USDC")).toBe("12,5");
    expect(montoDelPremio("100 dólares")).toBe("100");
    expect(montoDelPremio("30 USD para el equipo")).toBe("30");
    expect(montoDelPremio("USDC 15")).toBe("15");
    expect(montoDelPremio("$30")).toBe("30");
    expect(montoDelPremio("30$")).toBe("30");
    expect(montoDelPremio("Una polera")).toBeNull();
    expect(montoDelPremio("Entrada 2026")).toBeNull();
    expect(montoDelPremio("Un USDCoin")).toBeNull();
    expect(montoDelPremio("")).toBeNull();
  });
});

describe("el estado del pago de un premio", () => {
  const SORTEO = 1_793_000_000;
  const VENCE = SORTEO + PLAZO_DE_PAGO_S;
  const pagado = { tipo: "pagado", hash: "a".repeat(64), monto: "50.0000000", cuando: SORTEO + 600, de: ORG } as const;

  it("el plazo son siete días", () => {
    expect(PLAZO_DE_PAGO_S).toBe(7 * 24 * 3600);
  });

  it("con un pago, Pagado, y con el enlace a la transacción", () => {
    expect(estadoDelPago(pagado, SORTEO, SORTEO + 60)).toEqual({ tipo: "pagado", hash: pagado.hash, monto: "50.0000000", cuando: SORTEO + 600 });
  });

  it("un pago que llegó tarde sigue siendo Pagado, no Vencido", () => {
    expect(estadoDelPago(pagado, SORTEO, VENCE + 86_400 * 30).tipo).toBe("pagado");
  });

  it("sin pago, Pendiente mientras dura el plazo, hasta el último segundo", () => {
    expect(estadoDelPago({ tipo: "no-hay" }, SORTEO, SORTEO)).toEqual({ tipo: "pendiente", vence: VENCE });
    expect(estadoDelPago({ tipo: "no-hay" }, SORTEO, VENCE - 1)).toEqual({ tipo: "pendiente", vence: VENCE });
    expect(estadoDelPago({ tipo: "no-hay" }, SORTEO, VENCE)).toEqual({ tipo: "pendiente", vence: VENCE });
  });

  it("sin pago y pasado el plazo, Vencido", () => {
    expect(estadoDelPago({ tipo: "no-hay" }, SORTEO, VENCE + 1)).toEqual({ tipo: "vencido", vence: VENCE });
    expect(estadoDelPago({ tipo: "no-hay" }, SORTEO, VENCE + 86_400 * 90)).toEqual({ tipo: "vencido", vence: VENCE });
  });

  it("si la red no contestó nunca se dice Vencido, pase el tiempo que pase", () => {
    expect(estadoDelPago({ tipo: "sin-consulta" }, SORTEO, SORTEO + 1)).toEqual({ tipo: "sin-consulta" });
    expect(estadoDelPago({ tipo: "sin-consulta" }, SORTEO, VENCE + 86_400 * 365)).toEqual({ tipo: "sin-consulta" });
  });
});
