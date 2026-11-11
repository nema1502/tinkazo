// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang } from "../i18n";
import { CLAVE_CUPON, type AlmacenDeCupon, cuponGuardado, guardarCupon } from "../stellar/cupon-guardado";
import { type ControlDelCupon, type EntornoDelCupon, iniciarCuponDelEnlace as iniciar } from "./cupon-enlace";

/**
 * El cupón del enlace, con un entorno de mentira: lo que se guarda, lo que queda en la dirección, qué franja se ve y
 * qué pasa con la sesión. Sin la página real.
 */

const CODIGO = "K7M29QXA4HTR";
const ES = T.es as Record<string, string>;

interface Mundo {
  env: EntornoDelCupon;
  datos: Map<string, string>;
  dir: { origen: string; ruta: string; busqueda: string; fragmento: string };
  reemplazos: string[];
  estado: { sesion: { pollar: boolean } | null; ocupada: boolean };
  entradas: number;
  copiados: string[];
}

function mundo(o: { fragmento?: string; busqueda?: string; activo?: boolean; enApp?: boolean; sesion?: { pollar: boolean } | null; almacen?: "normal" | "nulo" } = {}): Mundo {
  const datos = new Map<string, string>();
  const almacen: AlmacenDeCupon = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v), removeItem: (k) => void datos.delete(k) };
  const w: Mundo = {
    datos,
    dir: { origen: "https://tinkazo.app", ruta: "/", busqueda: o.busqueda ?? "?red=oficial", fragmento: o.fragmento ?? `#cupon=${CODIGO}` },
    reemplazos: [],
    estado: { sesion: o.sesion ?? null, ocupada: false },
    entradas: 0,
    copiados: [],
    env: undefined as unknown as EntornoDelCupon,
  };
  w.env = {
    activo: o.activo ?? true,
    enApp: o.enApp ?? false,
    almacen: o.almacen === "nulo" ? null : almacen,
    direccion: () => w.dir,
    reemplazar: (url) => {
      w.reemplazos.push(url);
      const i = url.indexOf("#");
      w.dir.fragmento = i < 0 ? "" : url.slice(i);
    },
    sesion: () => w.estado.sesion,
    ocupada: () => w.estado.ocupada,
    entrar: () => void w.entradas++,
    claveDeEntrar: () => "ctaGoogle",
    copiar: async (texto) => {
      w.copiados.push(texto);
      return true;
    },
    insertar: (el) => void document.body.prepend(el),
  };
  return w;
}

const activos: ControlDelCupon[] = [];
const iniciarCuponDelEnlace = (env: EntornoDelCupon): ControlDelCupon => {
  const c = iniciar(env);
  activos.push(c);
  return c;
};

const franja = (): HTMLElement | null => document.getElementById("cupon-franja");
const sesion = (m: Mundo, s: { pollar: boolean } | null): void => {
  m.estado.sesion = s;
  document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: s ? "GAAA" : null }));
};

beforeEach(() => {
  document.body.innerHTML = "<header></header><main></main>";
  delete document.body.dataset.cuponFranja;
});
afterEach(() => {
  for (const c of activos.splice(0)) c.detener();
  vi.useRealTimers();
  setLang("es");
});

describe("el cupón del enlace", () => {
  it("lo guarda normalizado y, sin sesión, muestra la franja con el botón de entrar", () => {
    const m = mundo({ fragmento: "#cupon=k7m2-9qxa-4htr" });
    iniciarCuponDelEnlace(m.env);
    expect(cuponGuardado(m.env.almacen)).toBe(CODIGO);
    expect(franja()?.dataset.modo).toBe("entrar");
    expect(franja()?.textContent).toContain(ES.altaFranja);
    // Sin sesión la dirección no se toca: el código sigue ahí hasta que se entre.
    expect(m.reemplazos).toEqual([]);
    const b = franja()?.querySelector("button");
    expect(b?.textContent).toBe(ES.ctaGoogle);
    b?.click();
    expect(m.entradas).toBe(1);
  });

  it("el código no queda en la dirección después de entrar con Google, y la franja se va", () => {
    const m = mundo();
    iniciarCuponDelEnlace(m.env);
    expect(m.dir.fragmento).toContain(CODIGO);
    sesion(m, { pollar: true });
    expect(m.reemplazos).toEqual(["/?red=oficial"]);
    expect(m.dir.fragmento).toBe("");
    expect(franja()).toBeNull();
    // Pero sigue guardado para la pantalla que lo va a canjear.
    expect(cuponGuardado(m.env.almacen)).toBe(CODIGO);
  });

  it("si la sesión ya estaba abierta al llegar, la dirección se limpia enseguida", () => {
    const m = mundo({ sesion: { pollar: true } });
    iniciarCuponDelEnlace(m.env);
    expect(m.reemplazos).toEqual(["/?red=oficial"]);
    expect(franja()).toBeNull();
  });

  it("uno mal formado no se guarda ni muestra franja, y también sale de la dirección con la sesión", () => {
    const m = mundo({ fragmento: "#cupon=K7M2" });
    iniciarCuponDelEnlace(m.env);
    expect(m.datos.size).toBe(0);
    expect(franja()).toBeNull();
    sesion(m, { pollar: true });
    expect(m.dir.fragmento).toBe("");
  });

  it("en el navegador de una app la dirección no se toca, ni con sesión, y se pide abrir afuera", () => {
    const m = mundo({ enApp: true });
    iniciarCuponDelEnlace(m.env);
    expect(franja()?.dataset.modo).toBe("afuera");
    expect(franja()?.textContent).toContain(ES.altaAbrirAfuera);
    expect(franja()?.querySelector("button")?.textContent).toBe(ES.altaCopiarEnlace);
    sesion(m, { pollar: true });
    expect(m.reemplazos).toEqual([]);
    expect(m.dir.fragmento).toContain(CODIGO);
  });

  it("la página sabe qué franja se ve: en una app, el botón rosa de entrar se esconde (lo que sirve ahí es copiar el enlace)", () => {
    const m = mundo({ enApp: true });
    iniciarCuponDelEnlace(m.env);
    expect(document.body.dataset.cuponFranja).toBe("afuera");
    sesion(m, { pollar: true });
    expect(franja()).toBeNull();
    expect(document.body.dataset.cuponFranja).toBeUndefined();
    const css = readFileSync(resolve(__dirname, "cupon-franja.css"), "utf8");
    expect(css).toMatch(/body\[data-cupon-franja="afuera"\]\s*\[data-cta-entrar\]\s*\{[^}]*display:\s*none/);
  });

  it("fuera de una app la franja de entrar marca la página igual, y se borra con la franja", () => {
    const m = mundo();
    iniciarCuponDelEnlace(m.env);
    expect(document.body.dataset.cuponFranja).toBe("entrar");
    sesion(m, { pollar: true });
    expect(document.body.dataset.cuponFranja).toBeUndefined();
  });

  it("«Copiar el enlace» copia la dirección entera con el código, y vuelve a decir lo de antes", async () => {
    vi.useFakeTimers();
    const m = mundo({ enApp: true });
    iniciarCuponDelEnlace(m.env);
    franja()?.querySelector("button")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.copiados).toEqual([`https://tinkazo.app/?red=oficial#cupon=${CODIGO}`]);
    expect(franja()?.querySelector("button")?.textContent).toBe(ES.errCopiado);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(franja()?.querySelector("button")?.textContent).toBe(ES.altaCopiarEnlace);
  });

  it("con una billetera propia dice que no hace falta cupón, y no lo borra", () => {
    const m = mundo();
    iniciarCuponDelEnlace(m.env);
    sesion(m, { pollar: false });
    expect(franja()?.dataset.modo).toBe("propia");
    expect(franja()?.textContent).toContain(ES.altaConBilleteraPropia);
    expect(cuponGuardado(m.env.almacen)).toBe(CODIGO);
    franja()?.querySelector("button")?.click();
    expect(franja()).toBeNull();
  });

  it("mientras la cuenta se retoma no se muestra la franja de entrar", () => {
    const m = mundo();
    m.estado.ocupada = true;
    iniciarCuponDelEnlace(m.env);
    expect(franja()).toBeNull();
    m.estado.ocupada = false;
    sesion(m, null);
    expect(franja()?.dataset.modo).toBe("entrar");
  });

  it("al cerrar la sesión en esta página, el cupón se olvida; al cargar sin sesión, no", () => {
    const m = mundo({ fragmento: "" });
    guardarCupon(CODIGO, m.env.almacen);
    iniciarCuponDelEnlace(m.env);
    // Volvió de Google sin sesión todavía (la inicial es null): el cupón sigue.
    sesion(m, null);
    expect(cuponGuardado(m.env.almacen)).toBe(CODIGO);
    sesion(m, { pollar: true });
    sesion(m, null);
    expect(cuponGuardado(m.env.almacen)).toBeNull();
    expect(franja()).toBeNull();
  });

  it("si el cupón no se pudo guardar, la dirección se queda como estaba", () => {
    const m = mundo({ almacen: "nulo" });
    iniciarCuponDelEnlace(m.env);
    sesion(m, { pollar: true });
    expect(m.reemplazos).toEqual([]);
    expect(franja()).toBeNull();
  });

  it("la franja cambia de idioma sin recargar", () => {
    const m = mundo();
    iniciarCuponDelEnlace(m.env);
    setLang("en");
    expect(franja()?.textContent).toContain((T.en as Record<string, string>).altaFranja);
  });
});

describe("con la bandera apagada no se mira nada", () => {
  it("ni se guarda, ni se toca la dirección, ni hay franja", () => {
    const m = mundo({ activo: false, sesion: { pollar: true } });
    iniciarCuponDelEnlace(m.env);
    sesion(m, { pollar: true });
    expect(m.datos.has(CLAVE_CUPON)).toBe(false);
    expect(m.reemplazos).toEqual([]);
    expect(m.dir.fragmento).toContain(CODIGO);
    expect(franja()).toBeNull();
  });
});
