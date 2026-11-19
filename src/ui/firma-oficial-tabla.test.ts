import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidirAcceso } from "../stellar/acceso-oficial";
import { banderasDeAlta, pagoConSaldoActivo } from "../stellar/alta-config";
import type { Diagnostico } from "../stellar/chequeo-red";
import { cobroPorUso } from "../stellar/cobro-oficial";
import { leerCupo } from "../stellar/patrocinador";
import { ACCESO_LIBRE, type AccesoEnLaVista, activarPermitido } from "./cuenta-lista-estado";
import { accesoDelServidor, modoDelAcceso } from "./cuenta-lista-acceso";
import { panelDe, patrocinioQueFrena } from "./red-acciones";

/**
 * La tabla del modo Oficial con una cuenta de Google o de correo (la billetera de Pollar, que firma y manda sola): cada
 * firma le cuesta créditos a Tinkazo aunque el portero después la rechace. Para cada combinación de banderas del build
 * (todas apagadas, solo `VITE_ALTA`, solo `VITE_ALTA_LIBRE`, las dos) y cada manera en que puede estar el portero (con
 * la cuenta sin acceso, sin lo oficial, sin contestar, sin estar configurado), ninguno de los que firman pide una firma:
 * activar, sellar, sortear y pagar con la propia cuenta. La única excepción es la del plan B1 del diseño:
 * `VITE_ALTA_LIBRE` sola deja activar, y nada más.
 *
 * Y para que la tabla no pase por no firmar nunca: con el acceso confirmado y sorteos que alcancen, el sello se firma.
 * La red, la billetera y el portero son de mentira.
 */

const URL = "https://pm.tinkazo.app";
const HASH = "cd".repeat(32);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const h = vi.hoisted(() => ({ billetera: null as unknown }));
const getTransaction = vi.fn();
const sendTransaction = vi.fn();
const signAndSubmit = vi.fn(async () => HASH);
const signUnsponsored = vi.fn(async (_xdr: string) => "XDR_FIRMADO");

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      return { ...real.network, name: "mainnet" };
    },
  };
});
vi.mock("../stellar/wallet", () => ({ activeWallet: () => h.billetera }));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera, xlmBalance: async () => 500 }));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => true }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: CUENTA }) }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({ hash: () => Buffer.from(HASH, "hex"), toXDR: () => "XDR_FIRMADO", timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) } }),
  },
  scValToNative: (v: unknown) => v,
}));

const pollar = () => ({ submitsItself: true, address: CUENTA, signAndSubmit, signUnsponsored });
const tx = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const intento = () => ({ organizer: CUENTA, listHash: "aa".repeat(32), round: 1, count: 80, numWinners: 1, meta: "x", desde: 1 });
const LIBERA = Date.UTC(2026, 11, 1);

/** Las banderas del build, como las escribe Vercel. */
const BANDERAS: ReadonlyArray<{ nombre: string; env: Record<string, string> }> = [
  { nombre: "todas apagadas", env: { VITE_ALTA: "", VITE_ALTA_LIBRE: "" } },
  { nombre: "solo VITE_ALTA", env: { VITE_ALTA: "1", VITE_ALTA_LIBRE: "" } },
  { nombre: "solo VITE_ALTA_LIBRE", env: { VITE_ALTA: "", VITE_ALTA_LIBRE: "1" } },
  { nombre: "las dos", env: { VITE_ALTA: "1", VITE_ALTA_LIBRE: "1" } },
];

/** El cuerpo de `/cupo` como lo arma el portero de la red principal (`servicio.ts`): sin acceso, cero sellos. */
const cupo = (oficial: unknown, quedan: number) => ({
  prendido: true,
  rige: "portero",
  red: "mainnet",
  sellos: { usados: 0, max: 100, quedan },
  sorteos: { usados: 0, max: 100, quedan: 100 },
  liberaEn: LIBERA,
  ...(oficial === undefined ? {} : { oficial }),
});

type Portero = "sin-acceso" | "sin-sorteos" | "sin-lo-oficial" | "no-contesta" | "sin-configurar";
const PORTEROS: readonly Portero[] = ["sin-acceso", "sin-sorteos", "sin-lo-oficial", "no-contesta", "sin-configurar"];

/** Lo que contesta `/cupo` en cada caso, o `null` si no contesta (o no hay a quién preguntar). */
function cuerpoDe(p: Portero | "con-acceso"): unknown {
  switch (p) {
    case "sin-acceso":
      return cupo({ acceso: false }, 0);
    case "sin-sorteos":
      return cupo({ acceso: true, sorteos: { quedan: 0, proximoVence: null } }, 0);
    case "sin-lo-oficial":
      return cupo(undefined, 50);
    case "con-acceso":
      return cupo({ acceso: true, sorteos: { quedan: 3, proximoVence: null } }, 3);
    default:
      return null;
  }
}

/** Qué dice el servidor de las altas del acceso, en el paso de la cuenta, en cada caso. */
const estadosDelPaso = (p: Portero): AccesoEnLaVista["estado"][] => (p === "sin-acceso" ? ["ninguno", "revisando"] : p === "sin-sorteos" ? ["ninguno", "revisando", "error"] : ["revisando", "error"]);

function poner(env: Record<string, string>, p: Portero | "con-acceso") {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", p === "sin-configurar" ? "" : URL);
  const cuerpo = cuerpoDe(p);
  const f = vi.fn(async (u: string) => {
    if (String(u).includes("/cupo")) {
      if (cuerpo === null) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ hash: HASH, status: "PENDING" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const diagnostico: Diagnostico = {
  nivel: "rojo",
  caso: "sin-patrocinio",
  casos: [{ caso: "sin-patrocinio", nivel: "rojo" }],
  red: "mainnet",
  rpc: null,
  pagador: "patrocinado",
  costoXlm: 0.2,
  rojoXlm: 1,
  ms: 300,
  ledger: 1,
  protocolo: 29,
  inclusionP90: 100,
  saldoXlm: 500,
  restaurar: false,
  sinInternet: false,
  sinChequeo: false,
  motivo: "x",
  hora: 0,
};

beforeEach(async () => {
  h.billetera = pollar();
  getTransaction.mockReset();
  sendTransaction.mockReset();
  signAndSubmit.mockClear();
  signUnsponsored.mockClear();
  getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: 1, returnValue: 7n });
  sendTransaction.mockResolvedValue({ status: "PENDING" });
  const p = await import("../stellar/patrocinador");
  p.olvidarElEstado();
  p.olvidarLaCaida();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const firmas = (): number => signAndSubmit.mock.calls.length + signUnsponsored.mock.calls.length;

describe("en la red principal con una cuenta de Pollar, ninguna firma sin el acceso confirmado", () => {
  for (const b of BANDERAS) {
    for (const p of PORTEROS) {
      it(`${b.nombre}, portero ${p}`, async () => {
        const f = poner(b.env, p);
        const env = { ...b.env, VITE_PATROCINIO_URL_MAINNET: p === "sin-configurar" ? "" : URL };

        // Activar: «Activar» se ofrece solo con el acceso confirmado por el servidor, salvo el plan B1.
        const modo = modoDelAcceso("mainnet", banderasDeAlta(env, "mainnet"));
        const planB1 = b.nombre === "solo VITE_ALTA_LIBRE";
        for (const estado of estadosDelPaso(p)) {
          const acceso: AccesoEnLaVista = { ...ACCESO_LIBRE, modo, estado };
          expect(activarPermitido({ acceso, corre: null }), `activar ${modo} ${estado}`).toBe(planB1);
        }

        // Antes de apretar «Sellar la lista»: o frena el chequeo de la red, o la compuerta del sello no deja seguir.
        const cuerpo = cuerpoDe(p);
        if (cuerpo !== null) {
          const estado = leerCupo(200, cuerpo, "mainnet");
          const conCobro = cobroPorUso({ red: "mainnet", billetera: pollar(), env });
          const frena = patrocinioQueFrena(estado, conCobro) !== null;
          const compuerta = conCobro && decidirAcceso(estado, "sello", 1).que !== "sigue";
          if (p !== "sin-lo-oficial") expect(frena || compuerta, "antes de apretar").toBe(true);
        }

        // Sellar, sortear y pagar con la propia cuenta: el candado de antes de la firma no deja pasar ninguna. La única que
        // pasa es el sorteo de una cuenta con acceso que gastó sus sorteos: el acceso está confirmado y sortear lo ya
        // sellado no gasta sorteos oficiales.
        const { submitElsewhere } = await import("./envio-sdk");
        let esperadas = 0;
        for (const i of [intento(), undefined]) {
          for (const pagarConMiCuenta of [false, true]) {
            const conAcceso = p === "sin-sorteos" && !i && !pagarConMiCuenta;
            const e = await submitElsewhere(tx as never, () => undefined, 5000, i, { pagarConMiCuenta }).then(
              () => null,
              (x: unknown) => x,
            );
            const que = `${i ? "sello" : "sorteo"} pagando con mi cuenta: ${pagarConMiCuenta}`;
            if (conAcceso) {
              expect(e, que).toBeNull();
              esperadas++;
            } else {
              expect(e, que).toMatchObject({ name: "ErrorPortero" });
            }
          }
        }
        expect(firmas()).toBe(esperadas);
        expect(f.mock.calls.filter((c) => !String(c[0]).includes("/cupo"))).toHaveLength(esperadas);

        // Ni la caja de la red ni el sorteo ofrecen pagar con la propia cuenta, aunque haya saldo y grifo.
        const panel = panelDe({ ...diagnostico, patrocinio: { motivo: "cupo-cuenta", que: "sellos", liberaEn: LIBERA } }, { red: "mainnet", intentos: 0, grifo: true, saldoXlm: 500, costoXlm: 0.2, sinPagoPropio: true, cobroPorUso: cobroPorUso({ red: "mainnet", billetera: pollar(), env }) });
        expect([panel.principal, ...panel.secundarias]).not.toContain("sellar-con-mi-cuenta");
        expect([panel.principal, ...panel.secundarias]).not.toContain("cargar-saldo");
        const { sePuedeSortearPagando } = await import("./sortear-propio");
        const { ErrorPortero } = await import("../stellar/patrocinador");
        expect(await sePuedeSortearPagando(new ErrorPortero("cupo-cuenta", 429, { que: "sorteos" }))).toBe(false);
      });
    }
  }
});

describe("con el acceso confirmado, sí", () => {
  for (const b of BANDERAS) {
    it(`${b.nombre}: el sello y el sorteo se firman una vez cada uno, por el portero`, async () => {
      poner(b.env, "con-acceso");
      const { submitElsewhere } = await import("./envio-sdk");
      expect((await submitElsewhere(tx as never, () => undefined, 5000, intento()))?.hash).toBe(HASH);
      (await import("../stellar/patrocinador")).olvidarElEstado();
      expect((await submitElsewhere(tx as never, () => undefined, 5000, undefined))?.hash).toBe(HASH);
      expect(signUnsponsored).toHaveBeenCalledTimes(2);
      expect(signAndSubmit).not.toHaveBeenCalled();
    });
  }

  it("activar con el acceso confirmado por el servidor, solo con VITE_ALTA (sin VITE_ALTA_LIBRE)", () => {
    const env = { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: URL };
    expect(modoDelAcceso("mainnet", banderasDeAlta(env, "mainnet"))).toBe("servidor");
    expect(activarPermitido({ acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "con" }, corre: null })).toBe(true);
    expect(modoDelAcceso("mainnet", banderasDeAlta({ ...env, VITE_ALTA_LIBRE: "1" }, "mainnet"))).toBe("servidor");
  });
});
/**
 * Pagar un paquete con el saldo de la cuenta (`VITE_PAGO_CON_SALDO`) es una firma nueva de una cuenta de Google o de
 * correo en la red principal, y la única que va sin el acceso confirmado: es la que compra el acceso. Por eso tiene sus
 * propias filas: solo existe con la compra y la bandera prendidas en el build y la billetera del proveedor activa, y lo
 * único que pide firmar es el pago de una orden del servidor, con su cuenta, su monto y su nota tal cual. Qué se aprueba
 * de esa firma (una sola operación, de pago, exacta) lo fija `src/stellar/wallet-pollar-pago.test.ts`.
 */
describe("pagar con el saldo de la cuenta: solo con las banderas y la billetera del proveedor, y solo el pago de la orden", () => {
  const ORDEN = { id: "ABCD2345", producto: "alta", usdc: "3", sorteos: 3, destino: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", nota: "tk:o:ABCD2345", memoId: "1", enlace: "web+stellar:pay?x", vence: Date.UTC(2026, 11, 1) };
  const COMPRA = [
    { nombre: "sin la compra", env: {} },
    { nombre: "con la compra", env: { VITE_ALTA_PAGO: "1" } },
  ];
  const SALDO = [
    { nombre: "sin la bandera del saldo", env: {} },
    { nombre: "con la bandera del saldo", env: { VITE_PAGO_CON_SALDO: "1" } },
  ];
  for (const b of BANDERAS)
    for (const c of COMPRA)
      for (const s of SALDO)
        for (const conBilletera of [false, true]) {
          it(`${b.nombre}, ${c.nombre}, ${s.nombre}, ${conBilletera ? "con" : "sin"} la billetera del proveedor`, async () => {
            const env = { ...b.env, ...c.env, ...s.env, VITE_PATROCINIO_URL_MAINNET: URL };
            const pagar = vi.fn(async () => ({ estado: "salio" as const, hash: HASH }));
            const sesion = { token: async () => "tk", sesionViva: () => true, cuenta: () => CUENTA, ...(conBilletera ? { pagar } : {}) };
            const acceso = accesoDelServidor(sesion, {}, banderasDeAlta(env, "mainnet"), pagoConSaldoActivo(env, "mainnet"));
            // Con las dos banderas del acceso juntas el build no sale (`alta-build.ts`); si igual llegara, vale lo de la compra.
            const vale = b.env.VITE_ALTA === "1" && c.env.VITE_ALTA_PAGO === "1" && s.env.VITE_PAGO_CON_SALDO === "1" && conBilletera;
            expect(!!acceso.saldo).toBe(vale);
            if (acceso.saldo) {
              await acceso.saldo.pagar(ORDEN);
              expect(pagar).toHaveBeenCalledTimes(1);
              expect(pagar).toHaveBeenCalledWith({ destino: ORDEN.destino, monto: ORDEN.usdc, nota: ORDEN.nota });
            } else expect(pagar).not.toHaveBeenCalled();
            // Ninguna otra firma: ni el sello ni el sorteo.
            expect(firmas()).toBe(0);
          });
        }
});
