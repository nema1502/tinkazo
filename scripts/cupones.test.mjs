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
