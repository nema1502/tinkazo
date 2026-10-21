import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SERVICIO,
  abrir,
  acortar,
  alAcortar,
  borrarCorto,
  cifrar,
  cortoGuardado,
  descifrar,
  esRuta,
  olvidarMemoria,
  puedeBorrar,
  rutaDe,
} from "./enlace-corto";
import { eventoUrl } from "./protocol/evento";
import { PROOF_VERSION, proofUrl, type Proof } from "./protocol/proof";

const ORIGEN = "https://tinkazo.app";

/** Un `localStorage` de mentira: el de Node no está sin una bandera. */
class Almacen {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

/** El servicio de enlaces cortos, en memoria, con lo mismo que contesta el de verdad. */
function servicioFalso() {
  const guardado = new Map<string, { datos: Uint8Array; borrar: string }>();
  const pedidos: Array<{ url: string; metodo: string; init?: RequestInit }> = [];
  let n = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, init });
    if (metodo === "POST") {
      const id = `Ab${String(n++).padStart(6, "0")}`;
      const borrar = `permiso-${id}`;
      guardado.set(id, { datos: new Uint8Array(init?.body as Uint8Array), borrar });
      return new Response(JSON.stringify({ id, borrar }), { status: 201 });
    }
    const id = u.split("/").pop() ?? "";
    const fila = guardado.get(id);
    if (metodo === "DELETE") {
      if (!fila) return new Response("{}", { status: 404 });
      const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/, "");
      if (token !== fila.borrar) return new Response("{}", { status: 403 });
      guardado.delete(id);
      return new Response(null, { status: 204 });
    }
    return fila ? new Response(new Uint8Array(fila.datos), { status: 200 }) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, guardado, pedidos };
}

const comprobante: Proof = {
  v: PROOF_VERSION,
  names: ["María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas"],
  round: 32254977,
  prize: "Polera",
  signature: "ab".repeat(48),
};

let largo = "";
beforeEach(async () => {
  vi.stubGlobal("localStorage", new Almacen());
  olvidarMemoria();
  largo = await proofUrl(comprobante, ORIGEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** El id y la clave de un enlace corto. */
const partes = (corto: string): { id: string; clave: string } => {
  const m = /\/c\/([0-9A-Za-z]{8})#([A-Za-z0-9_-]{22})$/.exec(corto);
  return { id: m?.[1] ?? "", clave: m?.[2] ?? "" };
};

describe("enlace corto: ida y vuelta", () => {
  it("acortar da <origen>/c/<id>#<clave>, y abrir devuelve la ruta y el fragmento del largo", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(c?.corto).toMatch(/^https:\/\/tinkazo\.app\/c\/[0-9A-Za-z]{8}#[A-Za-z0-9_-]{22}$/);
    expect(c?.borrar).toBe(`permiso-${c?.id}`);
    const { id, clave } = partes(c?.corto ?? "");
    olvidarMemoria();
    const r = await abrir(id, clave, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ ruta: largo.slice(ORIGEN.length) });
  });

  it("un evento entero también va y vuelve, aunque su enlace largo pese decenas de KB", async () => {
    const s = servicioFalso();
    // Letras pseudoaleatorias (fijas): con nombres en serie el enlace comprime demasiado.
    let x = 7919;
    const letra = (): string => {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      return "abcdefghijklmnopqrstuvwxyz"[(x >>> 16) % 26] as string;
    };
    const sorteos = Array.from({ length: 12 }, (_, i) => {
      const names = Array.from({ length: 150 }, () => Array.from({ length: 12 }, letra).join(""));
      return { ...comprobante, names, round: comprobante.round + i, ganadores: [names[0] as string] };
    });
    const ev = await eventoUrl("Meetup", sorteos, ORIGEN);
    expect(ev.length).toBeGreaterThan(8_000);
    const c = await acortar(ev, { fetch: s.f, origen: ORIGEN });
    expect(c).not.toBeNull();
    const { id, clave } = partes(c?.corto ?? "");
    const r = await abrir(id, clave, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ ruta: ev.slice(ORIGEN.length) });
  }, 30_000);
});

describe("enlace corto: lo que se manda", () => {
  it("es [1][IV][cifrado] por POST a /v1, sin Content-Type, y adentro va {v:1,u:ruta}", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const post = s.pedidos.find((p) => p.metodo === "POST");
    expect(post?.url).toBe(`${SERVICIO}/v1`);
    expect(new Headers(post?.init?.headers).has("Content-Type")).toBe(false);
    const cuerpo = new Uint8Array(post?.init?.body as Uint8Array);
    expect(cuerpo[0]).toBe(1);
    const ruta = largo.slice(ORIGEN.length);
    const json = JSON.stringify({ v: 1, u: ruta });
    // Versión, IV de 12 bytes, el texto y la etiqueta de 16 bytes de AES-GCM.
    expect(cuerpo.length).toBe(1 + 12 + new TextEncoder().encode(json).length + 16);
    const { clave } = partes(c?.corto ?? "");
    const k = Uint8Array.from(atob(clave.replace(/-/g, "+").replace(/_/g, "/") + "=="), (x) => x.charCodeAt(0));
    expect(k.length).toBe(16);
    expect(await descifrar(new Uint8Array(cuerpo), k)).toBe(json);
  });

  it("el servicio no ve la ruta: los bytes no la traen en claro", async () => {
    const s = servicioFalso();
    await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const cuerpo = new Uint8Array(s.pedidos[0]?.init?.body as Uint8Array);
    const texto = new TextDecoder("latin1").decode(cuerpo);
    expect(texto).not.toContain("verificar.html");
    expect(texto).not.toContain(largo.slice(largo.indexOf("#") + 1, largo.indexOf("#") + 30));
  });

  it("dos claves nuevas dan dos enlaces distintos, y con otra clave no se abre", async () => {
    const s = servicioFalso();
    const a = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    olvidarMemoria();
    vi.stubGlobal("localStorage", new Almacen());
    const b = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(a?.corto).not.toBe(b?.corto);
    const otra = partes(b?.corto ?? "").clave;
    expect(await abrir(partes(a?.corto ?? "").id, otra, { fetch: s.f, origen: ORIGEN })).toEqual({ error: "roto" });
  });
});

describe("enlace corto: solo lleva a un comprobante o a un evento de este sitio", () => {
  it("rutaDe acepta verificar y evento, sin el dominio ni la consulta", () => {
    expect(rutaDe("https://tinkazo.app/verificar.html#zAbC_-9")).toBe("/verificar.html#zAbC_-9");
    expect(rutaDe("https://tinkazo.app/verificar.html?lang=en#rXy")).toBe("/verificar.html#rXy");
    expect(rutaDe("http://localhost:4656/evento.html#zQQ")).toBe("/evento.html#zQQ");
    expect(rutaDe("/verificar.html#zAA")).toBe("/verificar.html#zAA");
  });

  it.each([
    "https://api.drand.sh/52db/public/32254977",
    "https://tinkazo.app/verificar.html",
    "https://tinkazo.app/lista.html#zAbC",
    "https://tinkazo.app/index.html#zAbC",
    "javascript:alert(1)//verificar.html#zA",
    "https://tinkazo.app/verificar.html#z<script>",
    "https://tinkazo.app/verificar.html#",
    "no es un enlace",
  ])("rutaDe rechaza %s", (enlace) => {
    expect(rutaDe(enlace)).toBeNull();
  });

  it.each([
    "//evil.example/verificar.html#zA",
    "https://evil.example/verificar.html#zA",
    "javascript:alert(1)",
    "/verificar.html",
    "/lista.html#zAA",
    "/verificar.html#zA b",
    "/verificar.html#zA\n",
    "/../verificar.html#zA",
    "/c/verificar.html#zA",
    42,
    null,
  ])("esRuta rechaza %s", (u) => {
    expect(esRuta(u)).toBe(false);
  });

  it.each([
    "//evil.example/verificar.html#zA",
    "https://evil.example/verificar.html#zA",
    "javascript:alert(1)",
    "/lista.html#zAAA",
  ])("abrir no lleva a %s aunque venga bien cifrado", async (u) => {
    const s = servicioFalso();
    const clave = crypto.getRandomValues(new Uint8Array(16));
    s.guardado.set("Malo0001", { datos: await cifrar(JSON.stringify({ v: 1, u }), clave), borrar: "x" });
    let b = "";
    for (const x of clave) b += String.fromCharCode(x);
    const c = btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await abrir("Malo0001", c, { fetch: s.f, origen: ORIGEN })).toEqual({ error: "roto" });
  });

  it("abrir rechaza otra versión del contenido", async () => {
    const s = servicioFalso();
    const clave = crypto.getRandomValues(new Uint8Array(16));
    s.guardado.set("Malo0002", { datos: await cifrar(JSON.stringify({ v: 2, u: "/verificar.html#zAA" }), clave), borrar: "x" });
    let b = "";
    for (const x of clave) b += String.fromCharCode(x);
    const c = btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await abrir("Malo0002", c, { fetch: s.f, origen: ORIGEN })).toEqual({ error: "roto" });
  });

  it("un id o una clave con otra forma no salen a la red", async () => {
    const s = servicioFalso();
    expect(await abrir("../v1", "a".repeat(22), { fetch: s.f })).toEqual({ error: "roto" });
    expect(await abrir("Ab000000", "corta", { fetch: s.f })).toEqual({ error: "roto" });
    expect(s.pedidos).toHaveLength(0);
  });

  it("dice si no existe, y si la red no contesta", async () => {
    const s = servicioFalso();
    expect(await abrir("Ab999999", "a".repeat(22), { fetch: s.f })).toEqual({ error: "no-existe" });
    const caido = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await abrir("Ab999999", "a".repeat(22), { fetch: caido })).toEqual({ error: "red" });
    const error500 = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await abrir("Ab999999", "a".repeat(22), { fetch: error500 })).toEqual({ error: "red" });
  });
});

describe("enlace corto: si el servicio falla, se comparte el largo", () => {
  it("si fetch falla, acortar da null sin tirar", async () => {
    const caido = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(acortar(largo, { fetch: caido, origen: ORIGEN })).resolves.toBeNull();
  });

  it("si tarda más que la espera, da null a tiempo", async () => {
    const nunca = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const t0 = Date.now();
    await expect(acortar(largo, { fetch: nunca, origen: ORIGEN, espera: 80 })).resolves.toBeNull();
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it.each([
    ["un cupo lleno", () => new Response(JSON.stringify({ error: "cupo-ip" }), { status: 429 })],
    ["un error del servicio", () => new Response("{}", { status: 503 })],
    ["un id con otra forma", () => new Response(JSON.stringify({ id: "../x", borrar: "a" }), { status: 201 })],
    ["sin permiso para borrar", () => new Response(JSON.stringify({ id: "Ab000001" }), { status: 201 })],
    ["algo que no es JSON", () => new Response("<html>", { status: 201 })],
  ])("con %s, null", async (_, respuesta) => {
    const f = (async () => respuesta()) as typeof fetch;
    await expect(acortar(largo, { fetch: f, origen: ORIGEN })).resolves.toBeNull();
    expect(cortoGuardado(largo)).toBeNull();
  });

  it("un enlace que no es de Tinkazo no sale a la red", async () => {
    const s = servicioFalso();
    await expect(acortar("https://api.drand.sh/x/public/1", { fetch: s.f, origen: ORIGEN })).resolves.toBeNull();
    expect(s.pedidos).toHaveLength(0);
  });
});

describe("enlace corto: este equipo se acuerda", () => {
  it("el mismo enlace largo no crea dos cortos: ni dos pedidos a la vez, ni después", async () => {
    const s = servicioFalso();
    const [a, b] = await Promise.all([acortar(largo, { fetch: s.f, origen: ORIGEN }), acortar(largo, { fetch: s.f, origen: ORIGEN })]);
    expect(a?.corto).toBe(b?.corto);
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(c?.corto).toBe(a?.corto);
    // Y después de recargar (sin memoria), sale de lo guardado.
    olvidarMemoria();
    const d = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(d).toEqual(a);
    expect(s.pedidos.filter((p) => p.metodo === "POST")).toHaveLength(1);
  });

  it("lo guardado no trae el enlace largo, solo su huella", async () => {
    const s = servicioFalso();
    await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const guardado = (localStorage as unknown as Almacen).getItem("tinkazo.cortos") ?? "";
    expect(guardado).not.toContain(largo.slice(largo.indexOf("#") + 1));
    expect(guardado).not.toContain("verificar.html");
  });

  it("avisa a quien escucha cuando sale un corto", async () => {
    const s = servicioFalso();
    const vistos: string[] = [];
    alAcortar((ruta, c) => vistos.push(`${ruta} ${c.id}`));
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(vistos).toContain(`${largo.slice(ORIGEN.length)} ${c?.id}`);
  });

  it("abrir el propio enlace no le saca el permiso de borrarlo", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const { id, clave } = partes(c?.corto ?? "");
    olvidarMemoria();
    await abrir(id, clave, { fetch: s.f, origen: ORIGEN });
    expect(puedeBorrar(largo)).toBe(true);
  });

  it("abierto desde otro equipo, se recuerda para volver a compartirlo, pero sin permiso de borrar", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const { id, clave } = partes(c?.corto ?? "");
    vi.stubGlobal("localStorage", new Almacen());
    olvidarMemoria();
    await abrir(id, clave, { fetch: s.f, origen: ORIGEN });
    expect(cortoGuardado(largo)?.corto).toBe(c?.corto);
    expect(puedeBorrar(largo)).toBe(false);
    expect(await acortar(largo, { fetch: s.f, origen: ORIGEN })).toMatchObject({ corto: c?.corto });
    expect(s.pedidos.filter((p) => p.metodo === "POST")).toHaveLength(1);
  });
});

describe("enlace corto: borrarlo", () => {
  it("manda DELETE con el permiso, lo olvida y después ya no abre", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(puedeBorrar(largo)).toBe(true);
    expect(await borrarCorto(largo, { fetch: s.f })).toBe(true);
    const del = s.pedidos.find((p) => p.metodo === "DELETE");
    expect(del?.url).toBe(`${SERVICIO}/v1/${c?.id}`);
    expect(new Headers(del?.init?.headers).get("Authorization")).toBe(`Bearer permiso-${c?.id}`);
    expect(cortoGuardado(largo)).toBeNull();
    const { id, clave } = partes(c?.corto ?? "");
    expect(await abrir(id, clave, { fetch: s.f, origen: ORIGEN })).toEqual({ error: "no-existe" });
  });

  it("si el servicio dice que no, sigue guardado; sin permiso, no sale a la red", async () => {
    const s = servicioFalso();
    await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const prohibido = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    expect(await borrarCorto(largo, { fetch: prohibido })).toBe(false);
    expect(puedeBorrar(largo)).toBe(true);
    const otro = await proofUrl({ ...comprobante, round: 1 }, ORIGEN);
    expect(await borrarCorto(otro, { fetch: s.f })).toBe(false);
    expect(s.pedidos.filter((p) => p.metodo === "DELETE")).toHaveLength(0);
  });
});
