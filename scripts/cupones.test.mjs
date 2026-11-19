// Prueba la herramienta de cupones (scripts/cupones.mjs) sin red: el portero es un fetch de mentira y las tarjetas se
// escriben en una carpeta temporal fuera del repositorio.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ALFABETO,
  BASE_POR_DEFECTO,
  LARGO,
  MAX_SORTEOS_POR_CUPON,
  dentroDeUnRepo,
  ejecutar,
  enlaceDe,
  generarCodigos,
  mostrar,
  normalizar,
  normalizarOrden,
  raicesProtegidas,
  tarjetasHtml,
  venceDe,
} from "./cupones.mjs";
import { MAX_SORTEOS_POR_CUPON as MAX_SORTEOS_DEL_PORTERO } from "../workers/patrocinio/src/cupon-codigo.ts";

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, "..");
const VECTORES = JSON.parse(readFileSync(join(RAIZ, "workers/patrocinio/src/cupon-vectores.json"), "utf8"));
const TOKEN = "t".repeat(48);
/** Con la forma de una cuenta; la suma de control la mira el portero. */
const CUENTA = `G${"A".repeat(55)}`;

const temporales = [];
const carpeta = () => {
  const d = mkdtempSync(join(tmpdir(), "tinkazo-cupones-"));
  temporales.push(d);
  return d;
};
afterAll(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

/** Un portero de mentira: anota cada pedido y contesta lo que diga `responder`. */
function portero(responder = () => ({ status: 200, cuerpo: { creados: 0, repetidos: 0 } })) {
  const pedidos = [];
  const fetch = async (url, init = {}) => {
    const pedido = { url: String(url), metodo: init.method ?? "GET", cabeceras: new Headers(init.headers), cuerpo: init.body ? JSON.parse(init.body) : null };
    pedidos.push(pedido);
    const r = responder(pedido);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.cuerpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  return { pedidos, fetch };
}

/** Corre la herramienta con su salida capturada. */
async function correr(argv, { fetch = portero().fetch, env = { TINKAZO_CUPONES_TOKEN: TOKEN }, ahora = Date.UTC(2026, 10, 12, 15) } = {}) {
  const lineas = [];
  const codigo = await ejecutar(argv, { fetch, env, ahora: () => ahora, log: (s) => lineas.push(String(s)), raiz: RAIZ });
  return { codigo, salida: lineas.join("\n") };
}

const crear = (salida, extra = []) => ["crear", "--lote", "space-apps-14nov", "--cantidad", "10", "--sorteos", "3", "--dias", "60", "--vence", "2026-12-14", "--salida", salida, ...extra];

describe("el código", () => {
  it("el alfabeto y el largo son los del vector compartido con el portero y el sitio", () => {
    expect(ALFABETO).toBe(VECTORES.alfabeto);
    expect(ALFABETO).toHaveLength(32);
    expect(ALFABETO).not.toMatch(/[ILOU]/);
    expect(LARGO).toBe(VECTORES.largo);
  });

  it("normalizar y mostrar dan exactamente el vector compartido", () => {
    for (const c of VECTORES.casos) {
      expect(normalizar(c.entrada), JSON.stringify(c.entrada)).toBe(c.normalizado);
      if (c.mostrado) expect(mostrar(c.normalizado)).toBe(c.mostrado);
    }
  });

  it("los códigos salen de crypto, del alfabeto, de 12 y sin repetirse; nunca de Math.random", () => {
    const espia = vi.spyOn(Math, "random");
    const codigos = generarCodigos(300);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
    expect(new Set(codigos).size).toBe(300);
    for (const c of codigos) {
      expect(c).toHaveLength(12);
      expect(normalizar(c)).toBe(c);
    }
  });

  it("cada byte al azar da una letra pareja del alfabeto (32 divide 256)", () => {
    const codigos = generarCodigos(1, (arr) => arr.fill(0x21));
    expect(codigos).toEqual([ALFABETO[1].repeat(12)]);
  });

  it("el enlace lleva Oficial y el código en el fragmento", () => {
    expect(enlaceDe("K7M29QXA4HTR")).toBe("https://tinkazo.app/?red=oficial#cupon=K7M29QXA4HTR");
  });

  it("vence a las 23:59 de Bolivia del día dado; una fecha que no existe no se acepta", () => {
    expect(venceDe("2026-12-14")).toBe(Date.UTC(2026, 11, 15, 3, 59, 59, 999));
    for (const malo of ["2026-02-30", "14/12/2026", "2026-13-01", "", undefined]) expect(() => venceDe(malo), String(malo)).toThrow();
  });
});

describe("las tarjetas", () => {
  const codigos = ["K7M29QXA4HTR", "ZZZZYYYYXXXX", ...generarCodigos(8)];
  const html = tarjetasHtml({ lote: "space-apps-14nov", codigos, sorteos: 3, vence: venceDe("2026-12-14"), usos: 1 });

  it("cada tarjeta lleva el QR del enlace con #cupon= y, en el dorso, el código para escribir", () => {
    for (const c of codigos) {
      expect(html).toContain(`#cupon=${c}`);
      expect(html).toContain(mostrar(c));
    }
    expect(html.match(/<svg/g)).toHaveLength(codigos.length);
  });

  it("ocho por hoja A4, con el frente y el dorso", () => {
    expect(html).toContain("size: A4");
    expect(html.match(/class="hoja frente"/g)).toHaveLength(2);
    expect(html.match(/class="hoja dorso"/g)).toHaveLength(2);
    expect(html.match(/class="tarjeta frente"/g)).toHaveLength(10);
  });

  it("los textos de la tarjeta, en los dos idiomas, sin signos que no van", () => {
    for (const t of [
      "3 sorteos oficiales gratis, que cualquiera puede comprobar.",
      "3 free Live draws anyone can check.",
      "Escaneá el código con la cámara del celular.",
      "Scan the code with your phone&#39;s camera.",
      "Un solo uso, uno por equipo. Vale hasta el 14 de diciembre.",
      "Single use, one per team. Valid until December 14.",
      "Si no se abre: entrá a tinkazo.app/?red=oficial con Google o con tu correo, tocá &quot;Tengo un cupón&quot; y escribí:",
      "If it doesn&#39;t open: go to tinkazo.app/?red=oficial, sign in with Google or email, tap &quot;I have a coupon&quot; and type:",
    ]) {
      expect(html).toContain(t);
    }
    const visible = html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(/[·–—!¡]|rifa|loter|raffle|ticket|boleto|apuesta/i);
  });

  it("con un sorteo, en singular", () => {
    const una = tarjetasHtml({ lote: "x", codigos: ["K7M29QXA4HTR"], sorteos: 1, vence: venceDe("2026-12-14"), usos: 1 });
    expect(una).toContain("1 sorteo oficial gratis, que cualquiera puede comprobar.");
    expect(una).toContain("1 free Live draw anyone can check.");
  });
});

describe("no escribe dentro del repositorio", () => {
  it("la raíz, una carpeta adentro o una que vuelve adentro con .., se niegan", () => {
    const raices = raicesProtegidas(RAIZ);
    for (const d of [RAIZ, join(RAIZ, "cupones"), join(RAIZ, "docs", "..", "cupones-nuevos"), join(RAIZ, "workers", "patrocinio")]) expect(dentroDeUnRepo(d, raices), d).toBe(true);
    if (process.platform === "win32") expect(dentroDeUnRepo(join(RAIZ, "cupones").toUpperCase(), raices)).toBe(true);
    expect(dentroDeUnRepo(carpeta(), raices)).toBe(false);
  });

  it("desde una copia de trabajo, también la raíz del repositorio principal", () => {
    const base = carpeta();
    const principal = join(base, "principal");
    const copia = join(principal, "copias", "w");
    mkdirSync(join(principal, ".git", "worktrees", "w"), { recursive: true });
    mkdirSync(copia, { recursive: true });
    writeFileSync(join(copia, ".git"), `gitdir: ${join(principal, ".git", "worktrees", "w")}\n`);
    const raices = raicesProtegidas(copia);
    expect(raices.map((r) => resolve(r))).toContain(resolve(principal));
    expect(dentroDeUnRepo(join(principal, "cupones"), raices)).toBe(true);
    // Cualquier carpeta de un repositorio de git se niega, aunque no sea este.
    expect(dentroDeUnRepo(join(principal, "otra"), [])).toBe(true);
    expect(dentroDeUnRepo(join(base, "afuera"), [])).toBe(false);
  });

  it("crear con la salida adentro no escribe nada ni le habla al portero", async () => {
    const p = portero();
    const destino = join(RAIZ, ".tmp-cupones-prueba");
    const r = await correr(crear(destino), { fetch: p.fetch });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/fuera del repositorio/);
    expect(existsSync(destino)).toBe(false);
    expect(p.pedidos).toHaveLength(0);
  });
});

describe("crear", () => {
  it("manda los códigos al portero con la clave en la cabecera y escribe el CSV y las tarjetas", async () => {
    const dir = carpeta();
    const p = portero((q) => ({ status: 200, cuerpo: { creados: q.cuerpo.codigos.length, repetidos: 0 } }));
    const r = await correr(crear(dir), { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos).toHaveLength(1);
    const [q] = p.pedidos;
    expect(q.url).toBe(`${BASE_POR_DEFECTO}/v1/admin/cupones`);
    expect(q.metodo).toBe("POST");
    expect(q.cabeceras.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(q.url).not.toContain(TOKEN);
    expect(q.cuerpo).toMatchObject({ lote: "space-apps-14nov", sorteos: 3, dias: 60, usos: 1, vence: Date.UTC(2026, 11, 15, 3, 59, 59, 999) });
    expect(q.cuerpo.codigos).toHaveLength(10);

    const csv = readFileSync(join(dir, "space-apps-14nov.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toBe("codigo,enlace");
    expect(csv.slice(1).map((l) => normalizar(l.split(",")[0]))).toEqual(q.cuerpo.codigos);
    expect(csv[1]).toContain("#cupon=");
    const html = readFileSync(join(dir, "space-apps-14nov-tarjetas.html"), "utf8");
    for (const c of q.cuerpo.codigos) expect(html).toContain(`#cupon=${c}`);
    // Lo que muestra no lleva la clave ni los códigos.
    expect(r.salida).not.toContain(TOKEN);
    for (const c of q.cuerpo.codigos) expect(r.salida).not.toContain(c);
    expect(r.salida).toContain("10 cupones creados");
  });

  it("si el portero no los crea (o no contesta), borra lo que escribió: no quedan tarjetas que no valen", async () => {
    for (const responder of [() => ({ status: 401, cuerpo: { motivo: "clave" } }), () => ({ status: 400, cuerpo: { motivo: "techo" } }), () => new TypeError("fetch failed")]) {
      const dir = carpeta();
      const r = await correr(crear(dir), { fetch: portero(responder).fetch });
      expect(r.codigo).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
      expect(r.salida).not.toContain(TOKEN);
    }
  });

  it("no pisa un lote que ya está en la carpeta", async () => {
    const dir = carpeta();
    writeFileSync(join(dir, "space-apps-14nov.csv"), "lo de antes");
    const p = portero();
    const r = await correr(crear(dir), { fetch: p.fetch });
    expect(r.codigo).toBe(1);
    expect(readFileSync(join(dir, "space-apps-14nov.csv"), "utf8")).toBe("lo de antes");
    expect(p.pedidos).toHaveLength(0);
  });

  it("sin la clave, con lo mal escrito o con un portero que no es https, no hace nada", async () => {
    const p = portero();
    const dir = carpeta();
    expect((await correr(crear(dir), { fetch: p.fetch, env: {} })).codigo).toBe(1);
    expect((await correr(crear(dir), { fetch: p.fetch, env: { TINKAZO_CUPONES_TOKEN: "corta" } })).codigo).toBe(1);
    for (const extra of [["--cantidad", "0"], ["--cantidad", "501"], ["--sorteos", "0"], ["--dias", "400"], ["--vence", "2026-11-01"], ["--lote", "Con Mayusculas"], ["--base", "http://otro.example"], ["--usos", "0"]]) {
      const args = crear(dir);
      const i = args.indexOf(extra[0]);
      if (i >= 0) args.splice(i, 2, ...extra);
      else args.push(...extra);
      expect((await correr(args, { fetch: p.fetch })).codigo, extra.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("un cupón trae como mucho los sorteos que acepta el portero: 50 entra, 51 no", async () => {
    expect(MAX_SORTEOS_POR_CUPON).toBe(MAX_SORTEOS_DEL_PORTERO);
    expect(MAX_SORTEOS_POR_CUPON).toBe(50);
    const p = portero((q) => ({ status: 200, cuerpo: { creados: q.cuerpo.codigos.length, repetidos: 0 } }));
    const conSorteos = (n) => {
      const args = crear(carpeta(), ["--cantidad", "1"]);
      args.splice(args.indexOf("--sorteos"), 2, "--sorteos", String(n));
      return args;
    };
    expect((await correr(conSorteos(51), { fetch: p.fetch })).codigo).toBe(1);
    expect(p.pedidos).toHaveLength(0);
    expect((await correr(conSorteos(50), { fetch: p.fetch })).codigo).toBe(0);
  });

  it("acepta un portero local para probar con wrangler dev", async () => {
    const p = portero((q) => ({ status: 200, cuerpo: { creados: q.cuerpo.codigos.length, repetidos: 0 } }));
    const r = await correr(crear(carpeta(), ["--base", "http://127.0.0.1:8793", "--cantidad", "2"]), { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0].url).toBe("http://127.0.0.1:8793/v1/admin/cupones");
  });
});

describe("estado, anular y admitir", () => {
  it("estado pide el lote y lo muestra", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { lote: "space-apps-14nov", creados: 30, canjeados: 12, cuentas: 11, sorteosUsados: 7, vence: Date.UTC(2026, 11, 15, 3, 59, 59, 999), anulado: false, anulados: 0 } }));
    const r = await correr(["estado", "--lote", "space-apps-14nov"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/cupones?lote=space-apps-14nov`, metodo: "GET" });
    expect(r.salida).toMatch(/creados: 30/);
    expect(r.salida).toMatch(/canjeados: 12/);
    expect(r.salida).toMatch(/14 de diciembre de 2026/);
    const j = await correr(["estado", "--lote", "space-apps-14nov", "--json"], { fetch: p.fetch });
    expect(JSON.parse(j.salida)).toMatchObject({ creados: 30 });
  });

  it("anular un lote, o un código tal como se escribe", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { anulados: 1 } }));
    expect((await correr(["anular", "--lote", "space-apps-14nov-reserva"], { fetch: p.fetch })).codigo).toBe(0);
    expect((await correr(["anular", "--codigo", "k7m2-9qxa-4htr"], { fetch: p.fetch })).codigo).toBe(0);
    expect(p.pedidos.map((q) => [q.url, q.metodo, q.cuerpo])).toEqual([
      [`${BASE_POR_DEFECTO}/v1/admin/cupones/anular`, "POST", { lote: "space-apps-14nov-reserva" }],
      [`${BASE_POR_DEFECTO}/v1/admin/cupones/anular`, "POST", { codigo: "K7M29QXA4HTR" }],
    ]);
    for (const malo of [["anular"], ["anular", "--codigo", "xx"], ["anular", "--lote", "a", "--codigo", "K7M29QXA4HTR"]]) expect((await correr(malo, { fetch: p.fetch })).codigo).toBe(1);
    expect(p.pedidos).toHaveLength(2);
  });

  it("admitir una cuenta con sus sorteos", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: false, altaNueva: true, sorteos: { quedan: 20, proximoVence: null } } }));
    const r = await correr(["admitir", "--cuenta", CUENTA, "--sorteos", "20", "--dias", "60", "--ref", "pruebas-internas"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/altas`, metodo: "POST", cuerpo: { cuenta: CUENTA, sorteos: 20, dias: 60, ref: "pruebas-internas" } });
    expect(r.salida).toMatch(/20 sorteos/);
    for (const malo of [["--cuenta", "GNOESUNACUENTA"], ["--sorteos", "0"], ["--ref", "con espacios"]]) {
      const args = ["admitir", "--cuenta", CUENTA, "--sorteos", "20", "--dias", "60", "--ref", "pruebas-internas"];
      args.splice(args.indexOf(malo[0]), 2, ...malo);
      expect((await correr(args, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(1);
  });

  it("un error del portero sale con su motivo y sin la clave", async () => {
    const p = portero(() => ({ status: 409, cuerpo: { motivo: "ref-usado" } }));
    const r = await correr(["admitir", "--cuenta", CUENTA, "--sorteos", "20", "--dias", "60", "--ref", "x"], { fetch: p.fetch });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/409/);
    expect(r.salida).toMatch(/ref-usado/);
    expect(r.salida).not.toContain(TOKEN);
  });

  it("una orden que no existe da la ayuda", async () => {
    const r = await correr(["otra"]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/crear/);
  });
});

describe("después del sábado: dar, pagada, sueltos, asignar y devuelto", () => {
  const OPERACION = "238542939482828801";

  it("dar suma sorteos a una cuenta del libro con su ref", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: false, sorteos: { quedan: 13, proximoVence: null } } }));
    const r = await correr(["dar", "--cuenta", CUENTA, "--sorteos", "10", "--dias", "365", "--ref", "venta-qr-0001"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos).toHaveLength(1);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/derechos`, metodo: "POST", cuerpo: { cuenta: CUENTA, sorteos: 10, dias: 365, ref: "venta-qr-0001" } });
    expect(p.pedidos[0].cabeceras.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(r.salida).toMatch(/10 sorteos/);
    expect(r.salida).toMatch(/13/);
    expect(r.salida).not.toContain(TOKEN);
    const otra = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: true, sorteos: { quedan: 13, proximoVence: null } } }));
    expect((await correr(["dar", "--cuenta", CUENTA, "--sorteos", "10", "--dias", "365", "--ref", "venta-qr-0001"], { fetch: otra.fetch })).salida).toMatch(/no se sumó nada/);
  });

  it("dar con lo mal escrito no le habla al portero", async () => {
    const p = portero();
    const base = ["dar", "--cuenta", CUENTA, "--sorteos", "10", "--dias", "365", "--ref", "venta-qr-0001"];
    for (const malo of [["--cuenta", "GNOESUNACUENTA"], ["--sorteos", "0"], ["--sorteos", "501"], ["--dias", "3651"], ["--ref", "con espacios"]]) {
      const args = [...base];
      args.splice(args.indexOf(malo[0]), 2, ...malo);
      expect((await correr(args, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect((await correr(base.slice(0, -2), { fetch: p.fetch })).codigo).toBe(1);
    expect(p.pedidos).toHaveLength(0);
  });

  it("pagada marca una orden pagada por fuera, con el método y la ref; la orden se lee como la nota", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: false } }));
    const r = await correr(["pagada", "--orden", "tk:o:abcd-2345", "--metodo", "qr-bs", "--ref", "comprobante-0001"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/ordenes/pagada`, metodo: "POST", cuerpo: { orden: "ABCD2345", metodo: "qr-bs", ref: "comprobante-0001" } });
    expect(r.salida).toMatch(/ABCD2345/);
    expect((await correr(["pagada", "--orden", "ABCD2345", "--metodo", "a-mano", "--ref", "x1"], { fetch: p.fetch })).codigo).toBe(0);
    expect(p.pedidos[1].cuerpo).toEqual({ orden: "ABCD2345", metodo: "a-mano", ref: "x1" });
    for (const malo of [["pagada", "--orden", "ABCD", "--metodo", "qr-bs", "--ref", "x"], ["pagada", "--orden", "ABCD2345", "--metodo", "usdc", "--ref", "x"], ["pagada", "--orden", "ABCD2345", "--ref", "x"], ["pagada", "--orden", "ABCD2345", "--metodo", "qr-bs"]]) {
      expect((await correr(malo, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(2);
  });

  it("la orden se lee como el portero: con el prefijo tk:o: o tk:0:", () => {
    expect(normalizarOrden("tk:o:abcd-2345")).toBe("ABCD2345");
    expect(normalizarOrden("TK:0:abcd2345")).toBe("ABCD2345");
    expect(normalizarOrden("tk:00:abcd2345")).toBeNull();
  });

  it("pagada de una orden que no existe sale con el motivo", async () => {
    const p = portero(() => ({ status: 404, cuerpo: { motivo: "orden" } }));
    const r = await correr(["pagada", "--orden", "ABCD2345", "--metodo", "qr-bs", "--ref", "x"], { fetch: p.fetch });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/404 orden/);
  });

  it("sueltos lista los pagos sin resolver; --json los da tal cual", async () => {
    const suelto = { operacion: OPERACION, tx: "ab".repeat(32), de: CUENTA, activo: "USDC", monto: 20_000_000, cantidad: "2", nota: null, motivo: "sin-nota", estado: "suelto", orden: null, ref: null, ms: Date.UTC(2026, 10, 15, 14, 30) };
    const p = portero(() => ({ status: 200, cuerpo: { sueltos: [suelto] } }));
    const r = await correr(["sueltos"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/sueltos`, metodo: "GET" });
    expect(r.salida).toContain(OPERACION);
    expect(r.salida).toMatch(/2 USDC/);
    expect(r.salida).toMatch(/sin-nota/);
    expect(r.salida).toContain(CUENTA);
    const j = await correr(["sueltos", "--json"], { fetch: p.fetch });
    expect(JSON.parse(j.salida)).toEqual({ sueltos: [suelto] });
    const vacio = await correr(["sueltos"], { fetch: portero(() => ({ status: 200, cuerpo: { sueltos: [] } })).fetch });
    expect(vacio.codigo).toBe(0);
    expect(vacio.salida).toMatch(/No hay pagos sueltos/);
  });

  it("sueltos lista también las órdenes pagadas a medias, y avisa si Horizon no contestó", async () => {
    const parcial = { id: "ABCD2345", producto: "alta", recibido: "1.5", total: "2", minimo: "1.9", creada: Date.UTC(2026, 10, 11, 14), vence: Date.UTC(2026, 10, 14, 14), vencida: true };
    const p = portero(() => ({ status: 200, cuerpo: { sueltos: [], parciales: [parcial], horizon: false } }));
    const r = await correr(["sueltos"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/No hay pagos sueltos/);
    expect(r.salida).toMatch(/1 órdenes pagadas a medias/);
    expect(r.salida).toMatch(/orden ABCD2345 \(alta\): llegaron 1\.5 de 2 USDC/);
    expect(r.salida).toMatch(/venció/);
    expect(r.salida).toMatch(/Horizon no contestó/);
  });

  it("sueltos imprime la nota de un pago ajeno sin caracteres de control", async () => {
    const suelto = { operacion: OPERACION, tx: "ab".repeat(32), de: CUENTA, activo: "USDC", monto: 20_000_000, cantidad: "2", nota: "hola\u001b[2J\rchau", motivo: "nota-desconocida", estado: "suelto", orden: null, ref: null, ms: Date.UTC(2026, 10, 15, 14, 30) };
    const r = await correr(["sueltos"], { fetch: portero(() => ({ status: 200, cuerpo: { sueltos: [suelto] } })).fetch });
    expect(r.salida).toContain('nota "hola?[2J?chau"');
    expect(r.salida).not.toContain("\u001b");
    expect(r.salida).not.toContain("\r");
  });

  it("asignar ata un pago suelto a una orden", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, pagada: true, sobrante: "0.5" } }));
    const r = await correr(["asignar", "--operacion", OPERACION, "--orden", "abcd2345"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/sueltos/asignar`, metodo: "POST", cuerpo: { operacion: OPERACION, orden: "ABCD2345" } });
    expect(r.salida).toMatch(/pagada/);
    expect(r.salida).toMatch(/0\.5/);
    for (const malo of [["asignar", "--operacion", "12a", "--orden", "ABCD2345"], ["asignar", "--operacion", OPERACION], ["asignar", "--operacion", OPERACION, "--orden", "x"]]) {
      expect((await correr(malo, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(1);
  });

  it("devuelto marca devuelto un pago suelto con su ref", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: false } }));
    const r = await correr(["devuelto", "--operacion", OPERACION, "--ref", "devolucion-0001"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/sueltos/asignar`, metodo: "POST", cuerpo: { operacion: OPERACION, devuelto: true, ref: "devolucion-0001" } });
    expect(r.salida).toMatch(/marcada como devuelta/);
    for (const malo of [["devuelto", "--operacion", OPERACION], ["devuelto", "--ref", "x"], ["devuelto", "--operacion", OPERACION, "--ref", "con espacios"]]) {
      expect((await correr(malo, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(1);
    const ya = portero(() => ({ status: 409, cuerpo: { motivo: "ya-resuelto", estado: "asignado" } }));
    const e = await correr(["devuelto", "--operacion", OPERACION, "--ref", "x"], { fetch: ya.fetch });
    expect(e.codigo).toBe(1);
    expect(e.salida).toMatch(/409 ya-resuelto/);
  });

  it("cerrar cierra una orden pagada a medias antes de devolver, y dice cuánto y a quién devolver", async () => {
    const devolver = [
      { operacion: OPERACION, de: CUENTA, cantidad: "1", tx: "ab".repeat(32) },
      { operacion: "250000000000004098", de: `G${"B".repeat(55)}`, cantidad: "0.5", tx: "cd".repeat(32) },
    ];
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, repetido: false, recibido: "1.5", devolver } }));
    const r = await correr(["cerrar", "--orden", "tk:o:abcd-2345", "--ref", "devolucion-0003"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/ordenes/cerrar`, metodo: "POST", cuerpo: { orden: "ABCD2345", ref: "devolucion-0003" } });
    expect(r.salida).toMatch(/Orden ABCD2345 cerrada/);
    expect(r.salida).toMatch(/devolver 1\.5 USDC/);
    expect(r.salida).toContain(`1 USDC a ${CUENTA} (operación ${OPERACION})`);
    expect(r.salida).toContain(`0.5 USDC a G${"B".repeat(55)}`);
    expect(r.salida).toMatch(/lo que llegue después con esa nota queda en sueltos/);
    // Ya cerrada, lo dice; pagada o sin pagos, el motivo del portero y sale con 1.
    const ya = await correr(["cerrar", "--orden", "ABCD2345", "--ref", "x"], { fetch: portero(() => ({ status: 200, cuerpo: { ok: true, repetido: true, recibido: "1.5", devolver } })).fetch });
    expect(ya.salida).toMatch(/ya estaba cerrada/);
    for (const motivo of ["orden-pagada", "sin-pagos"]) {
      const e = await correr(["cerrar", "--orden", "ABCD2345", "--ref", "x"], { fetch: portero(() => ({ status: 409, cuerpo: { motivo } })).fetch });
      expect(e.codigo).toBe(1);
      expect(e.salida).toContain(`409 ${motivo}`);
    }
    for (const malo of [["cerrar", "--orden", "ABCD2345"], ["cerrar", "--ref", "x"], ["cerrar", "--orden", "x", "--ref", "x"], ["cerrar", "--orden", "ABCD2345", "--ref", "con espacios"]]) {
      expect((await correr(malo, { fetch: p.fetch })).codigo, malo.join(" ")).toBe(1);
    }
    expect(p.pedidos).toHaveLength(1);
  });

  it("sin la clave no le habla al portero, y la ayuda nombra las órdenes nuevas", async () => {
    const p = portero();
    for (const args of [["dar", "--cuenta", CUENTA, "--sorteos", "1", "--dias", "1", "--ref", "x"], ["sueltos"], ["devuelto", "--operacion", OPERACION, "--ref", "x"], ["cerrar", "--orden", "ABCD2345", "--ref", "x"]]) {
      expect((await correr(args, { fetch: p.fetch, env: {} })).codigo).toBe(1);
    }
    expect(p.pedidos).toHaveLength(0);
    const r = await correr(["otra"]);
    for (const orden of ["dar", "pagada", "sueltos", "asignar", "devuelto", "cerrar", "piloto"]) expect(r.salida).toContain(`cupones.mjs ${orden}`);
  });
});

describe("piloto: la lista de quienes compran con QR", () => {
  it("sumar y sacar mandan la cuenta y lo que se hace; el resultado se dice sin la clave", async () => {
    const p = portero((q) => ({ status: 200, cuerpo: { ok: true, cuenta: CUENTA, enLista: q.cuerpo?.accion === "sumar", cambio: true, total: q.cuerpo?.accion === "sumar" ? 3 : 2 } }));
    const sumar = await correr(["piloto", "sumar", "--cuenta", CUENTA], { fetch: p.fetch });
    expect(sumar.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/compras/piloto`, metodo: "POST", cuerpo: { cuenta: CUENTA, accion: "sumar" } });
    expect(p.pedidos[0]?.cabeceras.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sumar.salida).toMatch(/Cuenta sumada al piloto\. Son 3\./);
    const sacar = await correr(["piloto", "sacar", "--cuenta", CUENTA], { fetch: p.fetch });
    expect(sacar.codigo).toBe(0);
    expect(p.pedidos[1]).toMatchObject({ cuerpo: { cuenta: CUENTA, accion: "sacar" } });
    expect(sacar.salida).toMatch(/Cuenta sacada del piloto\. Lo que ya tenía en camino sigue\. Son 2\./);
    for (const s of [sumar.salida, sacar.salida]) expect(s).not.toContain(TOKEN);
  });

  it("listar muestra las de administración y las de la variable; --json, tal cual", async () => {
    const otra = `G${"B".repeat(55)}`;
    const cuerpo = { cuentas: [{ cuenta: CUENTA, desde: Date.UTC(2026, 10, 12, 15) }], variable: [otra], total: 2 };
    const p = portero(() => ({ status: 200, cuerpo }));
    const r = await correr(["piloto", "listar"], { fetch: p.fetch });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/compras/piloto`, metodo: "GET" });
    expect(r.salida).toMatch(/En la lista del piloto: 2 cuentas\./);
    expect(r.salida).toContain(`${CUENTA}, sumada el 12 de noviembre`);
    expect(r.salida).toContain(`${otra}, por la variable COMPRAS_QR_PILOTO`);
    const j = await correr(["piloto", "listar", "--json"], { fetch: p.fetch });
    expect(JSON.parse(j.salida)).toEqual(cuerpo);
  });

  it("abierta a todos (COMPRAS_QR_PILOTO = todos): listar lo dice primero, con el freno, y sacar avisa que la lista no frena", async () => {
    const lista = await correr(["piloto", "listar"], { fetch: portero(() => ({ status: 200, cuerpo: { cuentas: [], variable: [], total: 0, todos: true } })).fetch });
    expect(lista.codigo).toBe(0);
    expect(lista.salida.split("\n")[0]).toBe("La compra con QR está abierta a todas las cuentas (COMPRAS_QR_PILOTO = todos): la lista no frena a nadie. El freno es COMPRAS_QR_DIA, las personas nuevas por día.");
    expect(lista.salida).toMatch(/En la lista del piloto: 0 cuentas\./);
    const sacar = await correr(["piloto", "sacar", "--cuenta", CUENTA], { fetch: portero(() => ({ status: 200, cuerpo: { ok: true, cuenta: CUENTA, enLista: true, cambio: true, total: 0, todos: true } })).fetch });
    expect(sacar.codigo).toBe(0);
    expect(sacar.salida).toMatch(/la lista no frena a nadie\. Para frenar a una persona, cambiar la variable\./);
    // Sin todos, nada de eso.
    const cerrada = await correr(["piloto", "listar"], { fetch: portero(() => ({ status: 200, cuerpo: { cuentas: [], variable: [], total: 0 } })).fetch });
    expect(cerrada.salida).not.toMatch(/abierta a todas/);
  });

  it("sin lo que se hace, con otra cosa o sin una cuenta bien escrita, no le habla al portero", async () => {
    const p = portero();
    for (const malo of [["piloto"], ["piloto", "borrar", "--cuenta", CUENTA], ["piloto", "sumar"], ["piloto", "sumar", "--cuenta", "GX"], ["piloto", "--cuenta", CUENTA]]) {
      const r = await correr(malo, { fetch: p.fetch });
      expect(r.codigo, malo.join(" ")).toBe(1);
      expect(r.salida).toMatch(/piloto va con sumar, sacar o listar|--cuenta va como una cuenta/);
    }
    expect(p.pedidos).toHaveLength(0);
    // El techo del portero sale con su motivo.
    const techo = await correr(["piloto", "sumar", "--cuenta", CUENTA], { fetch: portero(() => ({ status: 400, cuerpo: { motivo: "techo", que: "piloto" } })).fetch });
    expect(techo.codigo).toBe(1);
    expect(techo.salida).toMatch(/400 techo \(piloto\)/);
  });
});

describe("compra anular: soltar el recargo y la reserva de una compra con QR que no se pagó", () => {
  const OPERAR = "o".repeat(48);
  const anulada = { ok: true, repetido: false, compra: 12, producto: "alta", motivo: "anulada", cargada: true, reemplazadas: 1 };

  it("por número o por la persona, con la clave de operar en la cabecera y nunca la de cupones", async () => {
    const p = portero(() => ({ status: 200, cuerpo: anulada }));
    const env = { TINKAZO_CUPONES_TOKEN: TOKEN, TINKAZO_OPERAR_TOKEN: OPERAR };
    const r = await correr(["compra", "anular", "--compra", "12", "--ref", "soporte-0001"], { fetch: p.fetch, env });
    expect(r.codigo).toBe(0);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/compras/cerrar`, metodo: "POST", cuerpo: { compra: 12, ref: "soporte-0001" } });
    expect(p.pedidos[0]?.cabeceras.get("Authorization")).toBe(`Bearer ${OPERAR}`);
    expect(r.salida).toMatch(/Compra 12 \(alta\) anulada: su recargo ya no va en las órdenes de esa persona y su reserva de créditos se soltó\./);
    expect(r.salida).toMatch(/Se cerraron 1 órdenes sin pagar/);
    const u = await correr(["compra", "anular", "--usuario", "usr_ana", "--ref", "soporte-0002"], { fetch: p.fetch, env: { ADMIN_TOKEN: OPERAR } });
    expect(u.codigo).toBe(0);
    expect(p.pedidos[1]).toMatchObject({ cuerpo: { usuario: "usr_ana", ref: "soporte-0002" } });
    expect(p.pedidos[1]?.cabeceras.get("Authorization")).toBe(`Bearer ${OPERAR}`);
    for (const s of [r.salida, u.salida]) {
      expect(s).not.toContain(OPERAR);
      expect(s).not.toContain(TOKEN);
    }
  });

  it("ya cerrada lo dice; un rechazo del portero sale con su motivo, qué hacer y código 1", async () => {
    const ya = await correr(["compra", "anular", "--compra", "12", "--ref", "x"], { fetch: portero(() => ({ status: 200, cuerpo: { ...anulada, repetido: true, reemplazadas: 0 } })).fetch, env: { ADMIN_TOKEN: OPERAR } });
    expect(ya.codigo).toBe(0);
    expect(ya.salida).toMatch(/La compra 12 ya estaba cerrada \(anulada\): no se cambió nada\./);
    const conPago = await correr(["compra", "anular", "--compra", "12", "--ref", "x"], { fetch: portero(() => ({ status: 409, cuerpo: { motivo: "orden-con-pago" } })).fetch, env: { ADMIN_TOKEN: OPERAR } });
    expect(conPago.codigo).toBe(1);
    expect(conPago.salida).toMatch(/409 orden-con-pago: una orden de esa compra recibió un pago/);
    for (const [status, motivo] of [[409, "compra-pagada"], [404, "compra"], [502, "red"]]) {
      const e = await correr(["compra", "anular", "--compra", "12", "--ref", "x"], { fetch: portero(() => ({ status, cuerpo: { motivo } })).fetch, env: { ADMIN_TOKEN: OPERAR } });
      expect(e.codigo).toBe(1);
      expect(e.salida).toContain(`${status} ${motivo}`);
    }
    const clave = await correr(["compra", "anular", "--compra", "12", "--ref", "x"], { fetch: portero(() => ({ status: 401, cuerpo: { motivo: "clave" } })).fetch, env: { ADMIN_TOKEN: OPERAR } });
    expect(clave.salida).toMatch(/no es la de operar del portero/);
  });

  it("sin la clave de operar, con la de cupones sola o con lo mal escrito, no le habla al portero", async () => {
    const p = portero();
    const env = { ADMIN_TOKEN: OPERAR };
    const malos = [
      [["compra", "anular", "--compra", "12", "--ref", "x"], { TINKAZO_CUPONES_TOKEN: TOKEN }],
      [["compra", "anular", "--compra", "12", "--ref", "x"], {}],
      [["compra", "anular", "--compra", "12", "--ref", "x"], { ADMIN_TOKEN: "corta" }],
      [["compra"], env],
      [["compra", "borrar", "--compra", "12", "--ref", "x"], env],
      [["compra", "anular", "--ref", "x"], env],
      [["compra", "anular", "--compra", "12", "--usuario", "usr_ana", "--ref", "x"], env],
      [["compra", "anular", "--compra", "0", "--ref", "x"], env],
      [["compra", "anular", "--compra", "doce", "--ref", "x"], env],
      [["compra", "anular", "--usuario", "-ana", "--ref", "x"], env],
      [["compra", "anular", "--compra", "12"], env],
      [["compra", "anular", "--compra", "12", "--ref", "con espacios"], env],
    ];
    for (const [args, e] of malos) expect((await correr(args, { fetch: p.fetch, env: e })).codigo, args.join(" ")).toBe(1);
    expect(p.pedidos).toHaveLength(0);
    const sinClave = await correr(["compra", "anular", "--compra", "12", "--ref", "x"], { fetch: p.fetch, env: { TINKAZO_CUPONES_TOKEN: TOKEN } });
    expect(sinClave.salida).toMatch(/falta la clave de operar: cargala en TINKAZO_OPERAR_TOKEN/);
    expect(sinClave.salida).toContain("cupones.mjs compra anular");
  });
});

describe("compra soltar: soltar de una vez las compras con QR sin cargar", () => {
  const OPERAR = "o".repeat(48);

  it("con la clave de operar y su referencia; dice cuántas y cuántos créditos volvieron", async () => {
    const p = portero(() => ({ status: 200, cuerpo: { ok: true, soltadas: 2, reserva: 1060 } }));
    const r = await correr(["compra", "soltar", "--ref", "pausa-0001"], { fetch: p.fetch, env: { TINKAZO_CUPONES_TOKEN: TOKEN, TINKAZO_OPERAR_TOKEN: OPERAR } });
    expect(r.codigo).toBe(0);
    expect(p.pedidos).toHaveLength(1);
    expect(p.pedidos[0]).toMatchObject({ url: `${BASE_POR_DEFECTO}/v1/admin/compras/soltar`, metodo: "POST", cuerpo: { ref: "pausa-0001" } });
    expect(p.pedidos[0]?.cabeceras.get("Authorization")).toBe(`Bearer ${OPERAR}`);
    expect(r.salida).toMatch(/Se soltaron 2 compras sin cargar: volvieron 1060 créditos\. Las cargadas no se tocaron\./);
    expect(r.salida).not.toContain(OPERAR);
    const ninguna = await correr(["compra", "soltar", "--ref", "pausa-0002"], { fetch: portero(() => ({ status: 200, cuerpo: { ok: true, soltadas: 0, reserva: 0 } })).fetch, env: { ADMIN_TOKEN: OPERAR } });
    expect(ninguna.codigo).toBe(0);
    expect(ninguna.salida).toMatch(/No había compras sin cargar: no se cambió nada\./);
  });

  it("sin la clave de operar, sin referencia o con una compra o una persona al lado, no le habla al portero", async () => {
    const p = portero();
    const env = { ADMIN_TOKEN: OPERAR };
    const malos = [
      [["compra", "soltar", "--ref", "x"], { TINKAZO_CUPONES_TOKEN: TOKEN }],
      [["compra", "soltar"], env],
      [["compra", "soltar", "--ref", "con espacios"], env],
      [["compra", "soltar", "--compra", "12", "--ref", "x"], env],
      [["compra", "soltar", "--usuario", "usr_ana", "--ref", "x"], env],
    ];
    for (const [args, e] of malos) expect((await correr(args, { fetch: p.fetch, env: e })).codigo, args.join(" ")).toBe(1);
    expect(p.pedidos).toHaveLength(0);
    const rechazo = await correr(["compra", "soltar", "--ref", "x"], { fetch: portero(() => ({ status: 503, cuerpo: { motivo: "apagado" } })).fetch, env });
    expect(rechazo.codigo).toBe(1);
    expect(rechazo.salida).toContain("503 apagado");
  });
});
