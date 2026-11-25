// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrir, cifrar, olvidarMemoria } from "../enlace-corto";
import { cortoDelEnlace } from "./espectador-enlace";

/**
 * El corto con el que entró un celular a la vista del espectador (`cortoDelEnlace`), sin mockear el servicio de
 * enlaces: la cadena real es `c.ts` (`abrir`), lo que este equipo recuerda en `localStorage` y la dirección de la vista.
 * Con la referencia en el fragmento sale de ahí. Sin ella (el QR del panel de la pantalla, o un servicio que no avisa
 * que el enlace cambia) sale de lo recordado. Nunca va a la red ni escribe nada.
 */

const ORIGEN = "https://tinkazo.app";
const ID = "AbCdEfGh";
const SECRETO = "AAAAAAAAAAAAAAAAAAAAAA";
const DATOS = "eyJ2IjoxLCJyIjo1fQ";

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

/** Un servicio de mentira que sirve un contenido cifrado, como lo hace el de enlaces. */
async function servicioConContenido(u: string): Promise<typeof fetch> {
  const bytes = await cifrar(JSON.stringify({ v: 1, u }), new Uint8Array(16));
  return (async () => new Response(new Uint8Array(bytes), { status: 200 })) as typeof fetch;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new Almacen());
  vi.stubGlobal("sessionStorage", new Almacen());
  olvidarMemoria();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el corto con el que entró este celular", () => {
  it("lo que abrió c.ts lo devuelve la vista, aunque el fragmento no traiga la referencia", async () => {
    const f = await servicioConContenido(`/#espectador=${DATOS}`);
    const r = await abrir(ID, SECRETO, { fetch: f, origen: ORIGEN });
    expect("ruta" in r).toBe(true);
    // Lo que hace c.ts sin la referencia: navega a la ruta tal cual, y la vista lee su propio fragmento.
    olvidarMemoria();
    expect(cortoDelEnlace(`#espectador=${DATOS}`, ORIGEN)).toBe(`${ORIGEN}/c/${ID}#${SECRETO}`);
  });

  it("con la referencia en el fragmento sale de ella, también con el almacenamiento vacío o bloqueado", () => {
    const esperado = `${ORIGEN}/c/${ID}#${SECRETO}`;
    expect(cortoDelEnlace(`#espectador=${DATOS}.${ID}.${SECRETO}.3`, ORIGEN)).toBe(esperado);
    const tira = (): never => {
      throw new Error("bloqueado");
    };
    vi.stubGlobal("localStorage", { getItem: tira, setItem: tira, removeItem: tira });
    expect(cortoDelEnlace(`#espectador=${DATOS}.${ID}.${SECRETO}.3`, ORIGEN)).toBe(esperado);
  });

  it("sin la referencia y con el almacenamiento bloqueado, no conoce su corto y no tira", () => {
    const tira = (): never => {
      throw new Error("bloqueado");
    };
    vi.stubGlobal("localStorage", { getItem: tira, setItem: tira, removeItem: tira });
    expect(cortoDelEnlace(`#espectador=${DATOS}`, ORIGEN)).toBeNull();
  });

  it("sin la referencia y sin nada recordado, no conoce su corto", () => {
    expect(cortoDelEnlace(`#espectador=${DATOS}`, ORIGEN)).toBeNull();
  });

  it("un corto recordado de otro origen no se acepta", async () => {
    const f = await servicioConContenido(`/#espectador=${DATOS}`);
    await abrir(ID, SECRETO, { fetch: f, origen: "https://otro.example" });
    olvidarMemoria();
    expect(cortoDelEnlace(`#espectador=${DATOS}`, ORIGEN)).toBeNull();
  });

  it("un fragmento roto o que no es de espectador no da nada", () => {
    expect(cortoDelEnlace("", ORIGEN)).toBeNull();
    expect(cortoDelEnlace("#otra=cosa", ORIGEN)).toBeNull();
    expect(cortoDelEnlace(`#espectador=${DATOS}.corto.roto`, ORIGEN)).toBeNull();
  });

  it("no escribe nada ni sale a la red", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    cortoDelEnlace(`#espectador=${DATOS}.${ID}.${SECRETO}.3`, ORIGEN);
    cortoDelEnlace(`#espectador=${DATOS}`, ORIGEN);
    expect(f).not.toHaveBeenCalled();
    expect((localStorage as unknown as Almacen).m.size).toBe(0);
  });
});
