import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrir,
  acortar,
  cifrar,
  cortoGuardado,
  dejarLogoEntrante,
  logoDeRuta,
  olvidarMemoria,
  ponerLogoDeRuta,
  rutaDe,
  tomarLogoEntrante,
} from "./enlace-corto";
import { aBase64, deBase64, huellaLogo, type Logo } from "./logo";
import { LOGO_DE_PRUEBA } from "./logo-guardado";
import { PROOF_VERSION, proofUrl, type Proof } from "./protocol/proof";

/**
 * El logo dentro del enlace corto: viaja cifrado en `l`, cambia la llave de lo
 * que se recuerda, nunca frena compartir y un `l` roto no rompe el comprobante.
 */

const ORIGEN = "https://tinkazo.app";

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
}

function servicioFalso() {
  const guardado = new Map<string, Uint8Array>();
  const pedidos: Array<{ metodo: string; tam: number }> = [];
  let n = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    if (metodo === "POST") {
      const id = `Lg${String(n++).padStart(6, "0")}`;
      const datos = new Uint8Array(init?.body as Uint8Array);
      pedidos.push({ metodo, tam: datos.length });
      guardado.set(id, datos);
      return new Response(JSON.stringify({ id, borrar: `permiso-${id}` }), { status: 201 });
    }
    const fila = guardado.get(String(url).split("/").pop() ?? "");
    return fila ? new Response(new Uint8Array(fila), { status: 200 }) : new Response("{}", { status: 404 });
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

/** Un PNG válido de otro color, para probar que otro logo da otro enlace. */
const otroLogo = (): Logo => {
  const bytes = deBase64(LOGO_DE_PRUEBA.b) as Uint8Array;
  // Un byte del relleno comprimido cambia: sigue con cabecera válida, y es otro logo.
  const b = new Uint8Array(bytes);
  b[b.length - 20] = (b[b.length - 20] ?? 0) ^ 1;
  return { t: "image/png", b: aBase64(b) };
};

/** Lo que se descifra de un POST: el JSON que viajó. */
async function contenido(corto: string, s: ReturnType<typeof servicioFalso>): Promise<Record<string, unknown>> {
  const m = /\/c\/([0-9A-Za-z]{8})#([A-Za-z0-9_-]{22})$/.exec(corto) as RegExpExecArray;
  const { descifrar } = await import("./enlace-corto");
  const b64 = (m[2] as string).replace(/-/g, "+").replace(/_/g, "/");
  const clave = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return JSON.parse(await descifrar(new Uint8Array(s.guardado.get(m[1] as string) as Uint8Array), clave)) as Record<string, unknown>;
}

let largo = "";
let ruta = "";
beforeEach(async () => {
  vi.stubGlobal("localStorage", new Almacen());
  vi.stubGlobal("sessionStorage", new Almacen());
  olvidarMemoria();
  largo = await proofUrl(comprobante, ORIGEN);
  ruta = rutaDe(largo) as string;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enlace corto con logo", () => {
  it("sin logo, el contenido es el de siempre: v y u, nada más", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(await contenido(c?.corto ?? "", s)).toEqual({ v: 1, u: ruta });
  });

  it("con logo, viaja cifrado en l, y abrir lo devuelve con la ruta", async () => {
    const s = servicioFalso();
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(await contenido(c?.corto ?? "", s)).toEqual({ v: 1, u: ruta, l: LOGO_DE_PRUEBA });
    olvidarMemoria();
    const m = /\/c\/([0-9A-Za-z]{8})#([A-Za-z0-9_-]{22})$/.exec(c?.corto ?? "") as RegExpExecArray;
    const r = await abrir(m[1] as string, m[2] as string, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ ruta, logo: LOGO_DE_PRUEBA });
  });

  it("lo que viaja no se ve en claro en lo que guarda el servicio", async () => {
    const s = servicioFalso();
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    const crudo = new TextDecoder("latin1").decode(s.guardado.get(c?.id ?? "") as Uint8Array);
    expect(crudo).not.toContain(LOGO_DE_PRUEBA.b.slice(0, 24));
    expect(crudo).not.toContain("image/png");
  });

  it("un logo nuevo da un enlace nuevo; el mismo, el mismo; y sin logo, el de siempre", async () => {
    const s = servicioFalso();
    const sin = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const a = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    ponerLogoDeRuta(ruta, otroLogo());
    const b = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(new Set([sin?.corto, a?.corto, b?.corto]).size).toBe(3);
    // Volver al primero: lo recuerda, no crea otro.
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const otra = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(otra?.corto).toBe(a?.corto);
    // Quitar el logo: el corto de antes, sin logo.
    ponerLogoDeRuta(ruta, null);
    expect((await acortar(largo, { fetch: s.f, origen: ORIGEN }))?.corto).toBe(sin?.corto);
    expect(s.pedidos).toHaveLength(3);
  });

  it("la llave sin logo es la misma de antes: un corto recordado antes del logo sigue sirviendo", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    // Como al recargar la página: sin memoria, solo lo guardado en el navegador.
    olvidarMemoria();
    expect(cortoGuardado(largo)?.corto).toBe(c?.corto);
    const guardado = JSON.parse((localStorage.getItem("tinkazo.cortos") as string)) as Record<string, unknown>;
    expect(Object.keys(guardado)).toHaveLength(1);
  });

  it("pedido dos veces a la vez, con logo, se arma uno solo", async () => {
    const s = servicioFalso();
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const [a, b] = await Promise.all([acortar(largo, { fetch: s.f, origen: ORIGEN }), acortar(largo, { fetch: s.f, origen: ORIGEN })]);
    expect(a?.corto).toBe(b?.corto);
    expect(s.pedidos).toHaveLength(1);
  });

  it("si con el logo pasa de 256 KB, se reintenta sin él: nunca frena compartir", async () => {
    const s = servicioFalso();
    // Un logo del peso máximo (48 KB): su base64 pesa 64 KB.
    const bytes = new Uint8Array(deBase64(LOGO_DE_PRUEBA.b) as Uint8Array);
    const pesado = new Uint8Array(48 * 1024);
    pesado.set(bytes);
    pesado.fill(7, bytes.length);
    const logo: Logo = { t: "image/png", b: aBase64(pesado) };
    // Con la lista de unos 195 KB: solo entra sin logo.
    const justo = `/verificar.html#${"B".repeat(195 * 1024)}`;
    ponerLogoDeRuta(justo, logo);
    const c = await acortar(ORIGEN + justo, { fetch: s.f, origen: ORIGEN });
    expect(c).not.toBeNull();
    expect(s.pedidos).toHaveLength(1);
    expect(await contenido(c?.corto ?? "", s)).toEqual({ v: 1, u: justo });
  });

  it("un logo que no pasa validarLogo no se registra: se acorta sin él", async () => {
    const s = servicioFalso();
    ponerLogoDeRuta(ruta, { t: "image/svg+xml" as never, b: "PHN2Zz4=" });
    expect(logoDeRuta(ruta)).toBeNull();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(await contenido(c?.corto ?? "", s)).toEqual({ v: 1, u: ruta });
  });

  it("un l roto en un enlace armado a mano se ignora y el comprobante abre igual", async () => {
    const s = servicioFalso();
    const llave = crypto.getRandomValues(new Uint8Array(16));
    const rotos: unknown[] = [
      { t: "image/svg+xml", b: "PHN2Zz48c2NyaXB0Pg==" },
      { t: "image/png", b: "esto no es base64" },
      { t: "image/png", b: aBase64(new Uint8Array(70_000)) },
      "texto",
      42,
      null,
      [],
    ];
    for (const [i, l] of rotos.entries()) {
      const id = `Rt${String(i).padStart(6, "0")}`;
      s.guardado.set(id, await cifrar(JSON.stringify({ v: 1, u: ruta, l }), llave));
      const clave = aBase64(llave).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await abrir(id, clave, { fetch: s.f, origen: ORIGEN });
      expect(r, `l roto #${i}`).toMatchObject({ ruta });
      expect("logo" in r ? r.logo : undefined, `l roto #${i}`).toBeUndefined();
    }
  });

  it("un enlace corto de antes (sin l) abre sin logo", async () => {
    const s = servicioFalso();
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    olvidarMemoria();
    const m = /\/c\/([0-9A-Za-z]{8})#([A-Za-z0-9_-]{22})$/.exec(c?.corto ?? "") as RegExpExecArray;
    const r = await abrir(m[1] as string, m[2] as string, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ ruta });
    expect("logo" in r).toBe(false);
  });

  it("quien abre un corto con logo y vuelve a compartir, manda el mismo corto", async () => {
    const s = servicioFalso();
    ponerLogoDeRuta(ruta, LOGO_DE_PRUEBA);
    const c = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    olvidarMemoria();
    const m = /\/c\/([0-9A-Za-z]{8})#([A-Za-z0-9_-]{22})$/.exec(c?.corto ?? "") as RegExpExecArray;
    const r = await abrir(m[1] as string, m[2] as string, { fetch: s.f, origen: ORIGEN });
    expect(r).toMatchObject({ logo: LOGO_DE_PRUEBA });
    // La página de comprobar registra el logo que recibió y comparte.
    olvidarMemoria();
    ponerLogoDeRuta(ruta, "logo" in r ? r.logo : null);
    const otra = await acortar(largo, { fetch: s.f, origen: ORIGEN });
    expect(otra?.corto).toBe(c?.corto);
    expect(s.pedidos).toHaveLength(1);
  });
});

describe("el logo de c.html a verificar.html", () => {
  it("se deja atado a la ruta y se toma solo en esa ruta", () => {
    dejarLogoEntrante(ruta, LOGO_DE_PRUEBA);
    expect(tomarLogoEntrante(ruta)).toEqual(LOGO_DE_PRUEBA);
    // Otro comprobante abierto en la misma pestaña no hereda un logo ajeno.
    expect(tomarLogoEntrante("/verificar.html#otraCosa")).toBeNull();
  });

  it("sin logo, borra lo que había", () => {
    dejarLogoEntrante(ruta, LOGO_DE_PRUEBA);
    dejarLogoEntrante(ruta, undefined);
    expect(tomarLogoEntrante(ruta)).toBeNull();
  });

  it("lo que hay en sessionStorage se vuelve a validar: si lo tocaron, nada", () => {
    sessionStorage.setItem("tinkazo.logo-entrante", JSON.stringify({ r: ruta, l: { t: "image/svg+xml", b: "AAAA" } }));
    expect(tomarLogoEntrante(ruta)).toBeNull();
    sessionStorage.setItem("tinkazo.logo-entrante", "{roto");
    expect(tomarLogoEntrante(ruta)).toBeNull();
  });

  it("sin sessionStorage, abre sin logo y sin error", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => dejarLogoEntrante(ruta, LOGO_DE_PRUEBA)).not.toThrow();
    expect(tomarLogoEntrante(ruta)).toBeNull();
  });

  it("la huella del logo de prueba es la misma al ir y venir", () => {
    dejarLogoEntrante(ruta, LOGO_DE_PRUEBA);
    const l = tomarLogoEntrante(ruta) as Logo;
    expect(huellaLogo(l)).toBe(huellaLogo(LOGO_DE_PRUEBA));
  });
});
