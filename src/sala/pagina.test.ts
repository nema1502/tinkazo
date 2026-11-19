// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXTOS, paginaCelular } from "../../workers/sala/src/pagina";

/** La página real, con su documento y sus servicios de navegador simulados. Ninguna prueba sale a la red. */
const ID = "AbCd1234";
const CLAVE = "A".repeat(22);
const LLAVE = "B".repeat(22);
const CLAVE_LOCAL = `tk-sala:${ID}`;

class AlmacenFalso implements Storage {
  private readonly datos = new Map<string, string>();

  constructor(private readonly roto = false) {}

  private usar(): void {
    if (this.roto) throw new Error("sin almacenamiento");
  }

  get length(): number {
    this.usar();
    return this.datos.size;
  }

  clear(): void {
    this.usar();
    this.datos.clear();
  }

  getItem(k: string): string | null {
    this.usar();
    return this.datos.get(k) ?? null;
  }

  key(i: number): string | null {
    this.usar();
    return [...this.datos.keys()][i] ?? null;
  }

  removeItem(k: string): void {
    this.usar();
    this.datos.delete(k);
  }

  setItem(k: string, v: string): void {
    this.usar();
    this.datos.set(k, String(v));
  }
}

function conRecuerdo(nombre = "Ana"): AlmacenFalso {
  const almacen = new AlmacenFalso();
  almacen.setItem(CLAVE_LOCAL, JSON.stringify({ llave: LLAVE, nombre, hora: Date.now() }));
  return almacen;
}

function respuesta(status: number, cuerpo: unknown = {}): Response {
  return { status, json: async () => cuerpo } as Response;
}

function montar(almacen: Storage, fetchFalso: typeof fetch, idioma: "es" | "en" = "es"): void {
  window.history.replaceState({}, "", `/${ID}?lang=${idioma}#${CLAVE}`);
  const html = paginaCelular();
  const js = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  // Se pasan explícitamente hasta los globales que usa el script: el almacenamiento y fetch son siempre de mentira.
  new Function("window", "document", "location", "navigator", "localStorage", "fetch", "crypto", "btoa", "atob", "TextEncoder", js)(
    window,
    document,
    window.location,
    window.navigator,
    almacen,
    fetchFalso,
    webcrypto,
    window.btoa.bind(window),
    window.atob.bind(window),
    TextEncoder,
  );
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function enviar(nombre: string): Promise<void> {
  el<HTMLInputElement>("n").value = nombre;
  el<HTMLFormElement>("f").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(el<HTMLButtonElement>("b").disabled).toBe(false));
}

function esperarListo(nombre: string): void {
  expect(el("form").hidden).toBe(true);
  expect(el("hecho").hidden).toBe(false);
  expect(el("hy").textContent).toBe(TEXTOS.es.ya.replace("{nombre}", nombre));
  expect(el("hb").textContent).toBe(TEXTOS.es.listoB);
  expect(el<HTMLButtonElement>("o").textContent).toBe(TEXTOS.es.corregir);
}

function esperarFormulario(mensaje: string): void {
  expect(el("form").hidden).toBe(false);
  expect(el("hecho").hidden).toBe(true);
  expect(el("msg").textContent).toBe(mensaje);
  expect(el("msg").className).toBe("mal");
  expect(el<HTMLButtonElement>("b").disabled).toBe(false);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("los estados de la página del celular", () => {
  it("la primera alta con 201 queda lista y el único botón conserva el nombre al corregir", async () => {
    const almacen = new AlmacenFalso();
    const pedir = vi.fn(async () => respuesta(201, { n: 1 }));
    montar(almacen, pedir as unknown as typeof fetch);
    await enviar("Ana");
    esperarListo("Ana");
    expect(el("sr").hidden).toBe(true);
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(pedir).toHaveBeenNthCalledWith(1, "/v1/sala/AbCd1234/publico");
    expect(JSON.parse(almacen.getItem(CLAVE_LOCAL) ?? "{}").nombre).toBe("Ana");
    const botones = [...el("hecho").querySelectorAll("button")];
    expect(botones).toHaveLength(1);
    expect(botones[0]?.id).toBe("o");
    botones[0]?.click();
    expect(el("form").hidden).toBe(false);
    expect(el<HTMLInputElement>("n").value).toBe("Ana");
  });

  it("si el QR ya se cerró, lo dice al cargar y no deja escribir", async () => {
    const pedir = vi.fn(async () => respuesta(404, { error: "no-existe" }));
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await vi.waitFor(() => expect(el("msg").textContent).toBe(TEXTOS.es.cerrada));
    expect(el("msg").className).toBe("mal");
    expect(el<HTMLInputElement>("n").disabled).toBe(true);
    expect(el<HTMLButtonElement>("b").disabled).toBe(true);
    expect(pedir).toHaveBeenNthCalledWith(1, "/v1/sala/AbCd1234/publico");
  });

  it("con el QR abierto, al cargar no dice nada", async () => {
    const pedir = vi.fn(async () => respuesta(200));
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await vi.waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
    expect(el("msg").textContent).toBe("");
    expect(el<HTMLInputElement>("n").disabled).toBe(false);
  });

  it("sin conexión al cargar, no dice nada y deja escribir", async () => {
    const pedir = vi.fn(async () => {
      throw new TypeError("sin conexión");
    });
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await vi.waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
    expect(el("msg").textContent).toBe("");
    expect(el<HTMLButtonElement>("b").disabled).toBe(false);
  });

  it("una recarga usa el recuerdo, no pide nada y permite corregir ese mismo nombre", () => {
    const pedir = vi.fn(async () => respuesta(201, { n: 1 }));
    montar(conRecuerdo(), pedir as unknown as typeof fetch);
    esperarListo("Ana");
    expect(pedir).not.toHaveBeenCalled();
    el<HTMLButtonElement>("o").click();
    expect(el<HTMLInputElement>("n").value).toBe("Ana");
  });

  it("corregir con 200 muestra y guarda el nombre nuevo", async () => {
    const almacen = conRecuerdo();
    const pedir = vi.fn(async () => respuesta(200, { n: 2, r: [1] }));
    montar(almacen, pedir as unknown as typeof fetch);
    el<HTMLButtonElement>("o").click();
    await enviar("Ana Pérez");
    esperarListo("Ana Pérez");
    const guardado = JSON.parse(almacen.getItem(CLAVE_LOCAL) ?? "{}") as { nombre?: string; llave?: string };
    expect(guardado.nombre).toBe("Ana Pérez");
    expect(guardado.llave).toBe(LLAVE);
  });

  it("un repetido con 409 explica las dos posibilidades y deja el formulario disponible", async () => {
    const pedir = vi.fn(async () => respuesta(409, { error: "repetido" }));
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await enviar("Ana");
    esperarFormulario(TEXTOS.es.repetido);
    expect(el("msg").textContent).toContain("Si ese nombre es el tuyo");
    expect(el("msg").textContent).toContain("Si es de otra persona");
  });

  it("el tope de correcciones con 429 pide ayuda y conserva el nombre escrito", async () => {
    const pedir = vi.fn(async () => respuesta(429, { error: "correcciones" }));
    montar(conRecuerdo(), pedir as unknown as typeof fetch);
    el<HTMLButtonElement>("o").click();
    await enviar("Ana Pérez");
    esperarFormulario(TEXTOS.es.correcciones);
    expect(el<HTMLInputElement>("n").value).toBe("Ana Pérez");
  });

  it("una sala llena deja el formulario disponible con su aviso", async () => {
    const pedir = vi.fn(async () => respuesta(429, { error: "llena" }));
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await enviar("Ana");
    esperarFormulario(TEXTOS.es.llena);
  });

  it("una sala terminada con 404 borra el recuerdo y vuelve al formulario", async () => {
    const almacen = conRecuerdo();
    const pedir = vi.fn(async () => respuesta(404, { error: "no-existe" }));
    montar(almacen, pedir as unknown as typeof fetch);
    el<HTMLButtonElement>("o").click();
    await enviar("Ana Pérez");
    esperarFormulario(TEXTOS.es.cerrada);
    expect(almacen.getItem(CLAVE_LOCAL)).toBeNull();
  });

  it("sin conexión avisa y permite probar otra vez", async () => {
    const pedir = vi.fn(async () => {
      throw new TypeError("sin conexión");
    });
    montar(new AlmacenFalso(), pedir as unknown as typeof fetch);
    await enviar("Ana");
    esperarFormulario(TEXTOS.es.red);
  });

  it("sin almacenamiento la alta sigue y avisa que después no se podrá corregir desde ese celular", async () => {
    const pedir = vi.fn(async () => respuesta(201, { n: 1 }));
    montar(new AlmacenFalso(true), pedir as unknown as typeof fetch);
    expect(el("sr").hidden).toBe(false);
    await enviar("Ana");
    esperarListo("Ana");
    expect(el("sr").hidden).toBe(false);
    expect(el("sr").textContent).toBe(TEXTOS.es.sinRecuerdo);
    expect(el("a").textContent).toBe(TEXTOS.es.aviso);
  });

  it("el recuerdo y los avisos nuevos también se muestran en inglés", () => {
    montar(conRecuerdo(), vi.fn() as unknown as typeof fetch, "en");
    expect(el("hy").textContent).toBe(TEXTOS.en.ya.replace("{nombre}", "Ana"));
    expect(el("hb").textContent).toBe(TEXTOS.en.listoB);
    expect(document.documentElement.lang).toBe("en");
  });
});
