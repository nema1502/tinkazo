import { beforeEach, describe, expect, it } from "vitest";
import { abrir, acortarEspectador, actualizarCorto, descifrar, olvidarMemoria, releerCorto } from "./enlace-corto";

/**
 * El enlace corto del QR de espectadores, que se puede reescribir (`enlace-corto.ts`, `workers/enlaces`): la sala lo
 * crea pidiendo que pueda cambiar, lo reescribe con el permiso que guarda cuando cambia el juego, y el celular lo vuelve
 * a leer sin caché. Todo sigue cifrado con la misma clave, y todas las versiones miden lo mismo: el servicio no ve el
 * juego ni por el largo. Con el servicio de hoy (no sabe cambiar), nada se rompe: el enlace queda como siempre.
 */

const ORIGEN = "https://tinkazo.app";
const RUTA = (juego: string): string => `/#espectador=${Buffer.from(JSON.stringify({ v: 1, g: juego, n: ["Ana", "Beto"] }), "utf8").toString("base64url")}`;
const LARGO = (juego: string): string => `${ORIGEN}${RUTA(juego)}`;

/** El servicio de enlaces, en memoria. `nuevo`: el que sabe cambiar (`?cambia=1`, PUT con versión); si no, el de hoy. */
function servicio(nuevo: boolean) {
  const filas = new Map<string, { datos: Uint8Array; borrar: string; cambia: boolean; version: number }>();
  const pedidos: Array<{ url: string; metodo: string; init?: RequestInit }> = [];
  let n = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, ...(init ? { init } : {}) });
    if (metodo === "POST") {
      const id = `Cd${String(n++).padStart(6, "0")}`;
      const cambia = nuevo && new URL(u).searchParams.get("cambia") === "1";
      filas.set(id, { datos: new Uint8Array(init?.body as Uint8Array), borrar: `permiso-${id}`, cambia, version: 1 });
      return new Response(JSON.stringify(cambia ? { id, borrar: `permiso-${id}`, cambia: true, version: '"1"' } : { id, borrar: `permiso-${id}` }), { status: 201 });
    }
    const id = new URL(u).pathname.split("/").pop() ?? "";
    const fila = filas.get(id);
    if (metodo === "PUT") {
      // El de hoy no deja escribir: el navegador frena el pedido en la consulta previa.
      if (!nuevo) throw new TypeError("Failed to fetch");
      if (!fila) return new Response("{}", { status: 404 });
      const h = new Headers(init?.headers);
      if (h.get("Authorization") !== `Bearer ${fila.borrar}`) return new Response("{}", { status: 403 });
      if (!fila.cambia) return new Response("{}", { status: 409 });
      if (h.get("If-Match") !== null && h.get("If-Match") !== `"${fila.version}"`) return new Response("{}", { status: 412 });
      fila.datos = new Uint8Array(init?.body as Uint8Array);
      fila.version++;
      return new Response(null, { status: 204, headers: { ETag: `"${fila.version}"` } });
    }
    if (!fila) return new Response("{}", { status: 404 });
    const cab: Record<string, string> = { "Cache-Control": fila.cambia ? "no-cache" : "public, max-age=300" };
    if (fila.cambia) {
      cab["X-Enlace-Cambia"] = "1";
      cab.ETag = `"${fila.version}"`;
    }
    return new Response(new Uint8Array(fila.datos), { status: 200, headers: cab });
  }) as typeof fetch;
  return { f, filas, pedidos };
}

const deB64url = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(s, "base64url"));

beforeEach(() => olvidarMemoria());

describe("el enlace del QR de espectadores, que puede cambiar", () => {
  it("se crea pidiendo que pueda cambiar; el servicio nuevo dice que sí y da su versión", async () => {
    const s = servicio(true);
    const c = await acortarEspectador(LARGO("race"), { fetch: s.f, origen: ORIGEN });
    expect(c).not.toBeNull();
    expect(s.pedidos[0]?.url).toBe("https://c.tinkazo.app/v1?cambia=1");
    expect(c?.cambia).toBe(true);
    expect(c?.version).toBe('"1"');
    expect(c?.n).toBe(1);
    expect(c?.corto).toMatch(/^https:\/\/tinkazo\.app\/c\/Cd000000#[A-Za-z0-9_-]{22}$/);
    // Lo guardado es la ruta con su contador, cifrada, y del largo fijo (múltiplo de 256, con holgura).
    const fila = s.filas.get(c?.id ?? "");
    const claro = await descifrar(fila?.datos as Uint8Array<ArrayBuffer>, deB64url(c?.clave ?? ""));
    expect(claro.length).toBe(c?.largo);
    expect((c?.largo ?? 0) % 256).toBe(0);
    expect(JSON.parse(claro)).toEqual({ v: 1, u: RUTA("race"), n: 1 });
  });

  it("con el servicio de hoy, que no sabe cambiar, el enlace queda como siempre", async () => {
    const s = servicio(false);
    const c = await acortarEspectador(LARGO("race"), { fetch: s.f, origen: ORIGEN });
    expect(c?.cambia).toBe(false);
    expect(c?.version).toBeNull();
  });

  it("se reescribe con el mismo permiso y la misma clave: el QR no cambia y el contenido nuevo mide lo mismo", async () => {
    const s = servicio(true);
    const c = await acortarEspectador(LARGO("race"), { fetch: s.f, origen: ORIGEN });
    if (!c) throw new Error("sin enlace");
    const antes = s.filas.get(c.id)?.datos.length;
    const r = await actualizarCorto(c, LARGO("teleferico"), { fetch: s.f });
    expect(r).toEqual({ ok: true, version: '"2"', n: 2, largo: c.largo });
    const put = s.pedidos.find((p) => p.metodo === "PUT");
    expect(put?.url).toBe(`https://c.tinkazo.app/v1/${c.id}`);
    expect(new Headers(put?.init?.headers).get("If-Match")).toBe('"1"');
    expect(new Headers(put?.init?.headers).get("Authorization")).toBe(`Bearer ${c.borrar}`);
    // El servicio ve los mismos bytes de largo: no sabe qué juego se eligió.
    expect(s.filas.get(c.id)?.datos.length).toBe(antes);
    // Quien abre el mismo QR ve el juego nuevo.
    const leido = await releerCorto(c.id, c.clave, { fetch: s.f });
    expect(leido).toEqual({ ruta: RUTA("teleferico"), n: 2, version: '"2"', cambia: true });
    expect(s.pedidos.at(-1)?.init?.cache).toBe("no-store");
  });

  it("una reescritura con una versión vieja no pisa una más nueva", async () => {
    const s = servicio(true);
    const c = await acortarEspectador(LARGO("race"), { fetch: s.f, origen: ORIGEN });
    if (!c) throw new Error("sin enlace");
    expect((await actualizarCorto(c, LARGO("sapo"), { fetch: s.f })).ok).toBe(true);
    // La misma versión de antes (otra pestaña, un reintento lento): el servicio la rechaza.
    expect(await actualizarCorto(c, LARGO("trompo"), { fetch: s.f })).toEqual({ ok: false, motivo: "version" });
    expect((await releerCorto(c.id, c.clave, { fetch: s.f }))?.ruta).toBe(RUTA("sapo"));
  });

  it("con el servicio de hoy reescribir no sale, sin romper nada, y un enlace que no nació para cambiar tampoco", async () => {
    const hoy = servicio(false);
    const c = await acortarEspectador(LARGO("race"), { fetch: hoy.f, origen: ORIGEN });
    if (!c) throw new Error("sin enlace");
    expect(await actualizarCorto({ ...c, version: '"1"' }, LARGO("sapo"), { fetch: hoy.f })).toEqual({ ok: false, motivo: "red" });
    const nuevo = servicio(true);
    nuevo.filas.set("Zz000000", { datos: new Uint8Array(64), borrar: "permiso-Zz000000", cambia: false, version: 1 });
    expect(await actualizarCorto({ id: "Zz000000", borrar: "permiso-Zz000000", clave: c.clave, version: '"1"', largo: c.largo, n: 1 }, LARGO("sapo"), { fetch: nuevo.f })).toEqual({ ok: false, motivo: "no-cambia" });
  });

  it("abrir un enlace que cambia dice que cambia; uno que cambia y lleva a un comprobante no se abre", async () => {
    const s = servicio(true);
    const c = await acortarEspectador(LARGO("race"), { fetch: s.f, origen: ORIGEN });
    if (!c) throw new Error("sin enlace");
    const r = await abrir(c.id, c.clave, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ ruta: RUTA("race"), cambia: true, n: 1 });
    // Un enlace que puede cambiar con un comprobante adentro (armado a mano): se dice roto.
    const { cifrar } = await import("./enlace-corto");
    const clave = new Uint8Array(16).fill(7);
    s.filas.set("Zz111111", { datos: await cifrar(JSON.stringify({ v: 1, u: "/verificar.html#abc" }), clave), borrar: "x", cambia: true, version: 1 });
    expect(await abrir("Zz111111", Buffer.from(clave).toString("base64url"), { fetch: s.f, origen: ORIGEN })).toEqual({ error: "roto" });
  });
});
