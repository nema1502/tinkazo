/**
 * La puerta del Worker para `/v1/patrocinio/pago`, sin Cloudflare: lo que contesta antes de llamar al objeto y lo que le pasa.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { leerConfig } from "./config";
import { MAX_CUERPO_PAGO, atenderPagoClasico } from "./pagos-ruta";
import { PorIp } from "./por-ip";
import type { FormaDePago } from "./pagos-lista";
import type { Respuesta } from "./servicio";

const COBROS = Keypair.random().publicKey();
const ORIGEN = "https://tinkazo.app";
const BASE = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_x", CUENTA_COBROS: COBROS, COSTO_RETIRO: "0.50" } as const;
const prendida = leerConfig({ ...BASE, PAGOS_PREMIO: "1", RETIROS: "1" });
const apagada = leerConfig({ ...BASE, PAGOS_PREMIO: "0", RETIROS: "0" });

function pedido(cuerpo: string | null, o: { metodo?: string; origen?: string | null; ip?: string; largo?: number } = {}): Request {
  const h = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": o.ip ?? "190.129.10.20" });
  if (o.origen !== null) h.set("Origin", o.origen ?? ORIGEN);
  if (o.largo !== undefined) h.set("Content-Length", String(o.largo));
  const metodo = o.metodo ?? "POST";
  const conCuerpo = cuerpo !== null && metodo !== "GET" ? { body: cuerpo } : {};
  return new Request("https://pm.tinkazo.app/v1/patrocinio/pago", { method: metodo, headers: h, ...conCuerpo });
}

/** El objeto de mentira: anota lo que le llega y contesta lo que se le diga. */
function espia(r: Respuesta = { estado: 200, cuerpo: { hash: "h", status: "PENDING" } }) {
  const vistos: Array<[FormaDePago, string]> = [];
  return {
    vistos,
    llamar: async (forma: FormaDePago, xdr: string): Promise<Respuesta> => {
      vistos.push([forma, xdr]);
      return r;
    },
  };
}

const correr = async (req: Request, e = espia(), cfg = prendida, porIp = new PorIp()) => {
  const r = await atenderPagoClasico(req, cfg, porIp, e.llamar);
  return r ? { estado: r.status, cuerpo: await r.json().catch(() => null), cabeceras: r.headers } : null;
};

describe("cuándo existe la ruta", () => {
  it("en la red de prueba no existe: devuelve null y el pedido sigue de largo hasta el 404", async () => {
    const e = espia();
    expect(await correr(pedido("{}"), e, leerConfig({ RED: "testnet", PAGOS_PREMIO: "1", RETIROS: "1" }))).toBeNull();
    expect(e.vistos).toHaveLength(0);
  });

  it("con PAGOS_PREMIO y RETIROS apagadas no atiende ni el POST ni el OPTIONS: como hoy, sigue el 404 y el 204 general", async () => {
    const e = espia();
    expect(await correr(pedido(JSON.stringify({ forma: "premio", xdr: "AAAA" })), e, apagada)).toBeNull();
    expect(await correr(pedido(null, { metodo: "OPTIONS" }), e, apagada)).toBeNull();
    expect(await correr(pedido(null, { metodo: "GET" }), e, apagada)).toBeNull();
    expect(e.vistos).toHaveLength(0);
  });

  it("con una sola forma prendida la ruta existe (la otra forma la contesta el portero)", async () => {
    const soloPremio = leerConfig({ ...BASE, PAGOS_PREMIO: "1", RETIROS: "0" });
    const e = espia();
    expect(await correr(pedido(JSON.stringify({ forma: "retiro", xdr: "AAAA" })), e, soloPremio)).toMatchObject({ estado: 200 });
    expect(e.vistos).toEqual([["retiro", "AAAA"]]);
  });

  it("el OPTIONS contesta 204 con las cabeceras de CORS del sitio", async () => {
    const r = await correr(pedido(null, { metodo: "OPTIONS" }));
    expect(r?.estado).toBe(204);
    expect(r?.cabeceras.get("Access-Control-Allow-Origin")).toBe(ORIGEN);
    expect(r?.cabeceras.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });
});

describe("lo que la puerta rechaza antes de llamar al objeto", () => {
  it("un origen ajeno o sin origen da 403 origen", async () => {
    const e = espia();
    const cuerpo = JSON.stringify({ forma: "premio", xdr: "AAAA" });
    expect(await correr(pedido(cuerpo, { origen: "https://otro.example" }), e)).toMatchObject({ estado: 403, cuerpo: { motivo: "origen" } });
    expect(await correr(pedido(cuerpo, { origen: null }), e)).toMatchObject({ estado: 403, cuerpo: { motivo: "origen" } });
    expect(e.vistos).toHaveLength(0);
  });

  it("otro método que POST u OPTIONS da 405", async () => {
    const e = espia();
    expect(await correr(pedido(null, { metodo: "GET" }), e)).toMatchObject({ estado: 405, cuerpo: { motivo: "metodo" } });
    expect(await correr(pedido("{}", { metodo: "PUT" }), e)).toMatchObject({ estado: 405, cuerpo: { motivo: "metodo" } });
    expect(await correr(pedido("{}", { metodo: "DELETE" }), e)).toMatchObject({ estado: 405, cuerpo: { motivo: "metodo" } });
  });

  it("(ataque) un cuerpo de más de 8 KB, que no es JSON, sin forma, con una forma desconocida o sin xdr da 400 cuerpo", async () => {
    const e = espia();
    const malos = [
      JSON.stringify({ forma: "premio", xdr: "A".repeat(MAX_CUERPO_PAGO) }),
      "no es json",
      "[1]",
      "null",
      "7",
      JSON.stringify({ xdr: "AAAA" }),
      JSON.stringify({ forma: "alta-premio", xdr: "AAAA" }),
      JSON.stringify({ forma: "Premio", xdr: "AAAA" }),
      JSON.stringify({ forma: ["premio"], xdr: "AAAA" }),
      JSON.stringify({ forma: "premio" }),
      JSON.stringify({ forma: "premio", xdr: "" }),
      JSON.stringify({ forma: "premio", xdr: 12 }),
      "",
    ];
    for (const m of malos) {
      expect(await correr(pedido(m), e), m.slice(0, 40)).toMatchObject({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(e.vistos).toHaveLength(0);
  });

  it("un Content-Length declarado de más de 8 KB da 400 cuerpo sin leer el cuerpo", async () => {
    const req = pedido(JSON.stringify({ forma: "premio", xdr: "AAAA" }), { largo: MAX_CUERPO_PAGO + 1 });
    const e = espia();
    expect(await correr(req, e)).toMatchObject({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    expect(e.vistos).toHaveLength(0);
  });
});

describe("lo que pasa al objeto y lo que contesta", () => {
  it("le pasa la forma y el sobre tal cual, y devuelve su respuesta con su estado y las cabeceras de CORS", async () => {
    const e = espia({ estado: 409, cuerpo: { motivo: "otro-en-curso", hash: "h", vence: 5, pudoSalir: false } });
    const r = await correr(pedido(JSON.stringify({ forma: "retiro", xdr: "AAAA", otra: "cosa" })), e);
    expect(e.vistos).toEqual([["retiro", "AAAA"]]);
    expect(r).toMatchObject({ estado: 409, cuerpo: { motivo: "otro-en-curso", hash: "h", vence: 5, pudoSalir: false } });
    expect(r?.cabeceras.get("Access-Control-Allow-Origin")).toBe(ORIGEN);
    expect(r?.cabeceras.get("Cache-Control")).toBe("no-store");
  });

  it("acepta una vista previa de Vercel y localhost, como el sello", async () => {
    const cuerpo = JSON.stringify({ forma: "premio", xdr: "AAAA" });
    expect(await correr(pedido(cuerpo, { origen: "https://tinkazo-abc123.vercel.app" }))).toMatchObject({ estado: 200 });
    expect(await correr(pedido(cuerpo, { origen: "http://localhost:5173" }))).toMatchObject({ estado: 200 });
  });

  it("si el objeto lanza, 500 interno con cuerpo y CORS, no el error pelado", async () => {
    const r = await correr(pedido(JSON.stringify({ forma: "premio", xdr: "AAAA" })), {
      vistos: [],
      llamar: async () => {
        throw new Error("algo");
      },
    });
    expect(r).toMatchObject({ estado: 500, cuerpo: { motivo: "interno" } });
    expect(r?.cabeceras.get("Access-Control-Allow-Origin")).toBe(ORIGEN);
  });
});

describe("el contador por dirección es propio", () => {
  it("(ataque) pasado el tope de la hora da 429 cupo-ip, solo a esa dirección, y agotar el de los sellos no lo frena ni al revés", async () => {
    const cfg = leerConfig({ ...BASE, PAGOS_PREMIO: "1", RETIROS: "1", POR_IP_POR_HORA: "2" });
    const deLosSellos = new PorIp();
    const deLosPagos = new PorIp();
    const e = espia();
    const cuerpo = JSON.stringify({ forma: "retiro", xdr: "AAAA" });
    // Los sellos agotan su contador: el de los pagos sigue entero.
    for (let i = 0; i < 5; i++) deLosSellos.toca("190.129.10.20", cfg.porIpPorHora);
    expect(deLosSellos.toca("190.129.10.20", cfg.porIpPorHora)).toBe(false);
    expect(await correr(pedido(cuerpo), e, cfg, deLosPagos)).toMatchObject({ estado: 200 });
    expect(await correr(pedido(cuerpo), e, cfg, deLosPagos)).toMatchObject({ estado: 200 });
    expect(await correr(pedido(cuerpo), e, cfg, deLosPagos)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo-ip" } });
    // Otra dirección no se ve afectada, y los pagos agotados no frenan a los sellos.
    expect(await correr(pedido(cuerpo, { ip: "190.129.10.99" }), e, cfg, deLosPagos)).toMatchObject({ estado: 200 });
    expect(new PorIp().toca("190.129.10.20", cfg.porIpPorHora)).toBe(true);
    expect(e.vistos).toHaveLength(3);
  });
});
