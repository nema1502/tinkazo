// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import { TEXTOS_COBRO } from "./alta-textos-con-cobro";
import { cargaElCobro } from "./cobro-en-la-pagina";
import { montarCobro } from "./paginas-cobro";

/**
 * La compra en las páginas públicas: lo de `<template data-con-cobro>` entra solo con la compra prendida, y la lista de
 * precios sale entera del servidor (`/v1/alta/precios`), con las mismas piezas que el panel de la compra. Nunca se
 * muestra un precio que no vino del servidor. Las páginas se cargan tal como están escritas, con un servidor de mentira.
 */

// En jsdom, `import.meta.url` no es la ruta del archivo: las páginas se leen desde la raíz del repositorio.
const leer = (f: string): string => readFileSync(resolve(process.cwd(), f), "utf8");
const cuerpo = (f: string): string => /<body>([\s\S]*)<\/body>/.exec(leer(f))?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
const PORTERO = "https://pm.example.org";

const VENTA = { red: "mainnet", pago: true, alta: { usdc: "4", sorteos: 3, dias: 90 }, paquetes: [{ id: "p10", usdc: "10", sorteos: 10, dias: 365 }] };

function servidor(respuesta: unknown, estado = 200) {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ status: estado, json: async () => respuesta }) as unknown as Response);
  return f as typeof f & typeof fetch;
}

const filas = (): string[] => [...document.querySelectorAll<HTMLElement>("[data-paquetes] > li")].map((li) => [...li.children].map((c) => c.textContent?.trim() ?? "").join(" "));
const nota = (): string | null => {
  const p = document.querySelector<HTMLElement>("[data-paquetes-nota]");
  return p && !p.hidden ? (p.textContent ?? "") : null;
};

const ayudaALaVista = (): boolean => {
  const p = document.querySelector<HTMLElement>('#paquetes [data-i="prPaqAyuda"]');
  return !!p && !p.hidden;
};

beforeEach(() => {
  setLang("es");
  Element.prototype.scrollIntoView = vi.fn();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("sin la compra en el build", () => {
  it("las páginas quedan como hoy: nada sale del template y no se le pregunta nada al servidor", async () => {
    document.body.innerHTML = cuerpo("precios.html");
    const f = servidor(VENTA);
    expect(cargaElCobro(document, false)).toBe(false);
    expect(await montarCobro({ pago: false, fetch: f, url: PORTERO })).toBeNull();
    expect(document.querySelector("template[data-con-cobro]")).not.toBeNull();
    expect(document.querySelector("[data-paquetes]")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("si el HTML ya trae la lista (después de prender, con la variable vaciada), dice que no hay paquetes a la venta", async () => {
    document.body.innerHTML = `<ul data-paquetes></ul><p data-paquetes-nota hidden></p>`;
    const f = servidor(VENTA);
    expect(cargaElCobro(document, false)).toBe(true);
    expect(await montarCobro({ pago: false, fetch: f, url: PORTERO })).toBe("nada");
    expect(filas()).toEqual([]);
    expect(nota()).toBe(TEXTOS_COBRO.es.prPaqNada);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("con la compra en el build", () => {
  it("precios.html: la lista es la del servidor, con el primer paquete y los de sumar", async () => {
    document.body.innerHTML = cuerpo("precios.html");
    const f = servidor(VENTA);
    expect(cargaElCobro(document, true)).toBe(true);
    expect(await montarCobro({ pago: true, fetch: f, url: PORTERO })).toBe("vendiendo");
    expect(document.querySelector("template[data-con-cobro]")).toBeNull();
    expect(filas()).toEqual(["Tu primer paquete 3 sorteos oficiales por 4 dólares Para usar en 90 días. Tu cuenta queda activada sin costo extra.", "Sumar sorteos 10 sorteos oficiales por 10 dólares Para usar en 365 días."]);
    expect(nota()).toBeNull();
    expect(ayudaALaVista()).toBe(true);
    // Lo que trae el template sale pintado en el idioma de la página.
    expect(document.querySelector('[data-i="prPaqT"]')?.textContent).toBe(TEXTOS_COBRO.es.prPaqT);
    expect(document.querySelector('[data-i="prPaqAyuda"]')?.textContent).toBe(TEXTOS_COBRO.es.prPaqAyuda);
    expect(document.querySelector<HTMLAnchorElement>('a[data-i="prPaqTerminos"]')?.getAttribute("href")).toBe("/terminos.html#compras");
    // Un solo pedido, abierto: sin sesión ni cookies, y al portero de la red principal.
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PORTERO}/v1/alta/precios`);
    expect(init.method).toBe("GET");
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/Authorization/i);
  });

  it("cada número que se ve sale del servidor, con coma en español y punto en inglés", async () => {
    document.body.innerHTML = cuerpo("precios.html");
    await montarCobro({ pago: true, fetch: servidor({ red: "mainnet", pago: true, alta: null, paquetes: [{ id: "p7", usdc: "7.5", sorteos: 7, dias: 45 }, { id: "p1", usdc: "1", sorteos: 1, dias: 1 }] }), url: PORTERO });
    expect(filas()).toEqual(["Sumar sorteos 7 sorteos oficiales por 7,50 dólares Para usar en 45 días.", "Sumar sorteos 1 sorteo oficial por 1 dólar Para usar en 1 día."]);
    setLang("en");
    expect(filas()).toEqual(["Add draws 7 Live draws for US$7.50 To use within 45 days.", "Add draws 1 Live draw for US$1 To use within 1 day."]);
    // En toda la página no hay otro monto que los de la lista.
    const montos = (document.body.textContent ?? "").match(/US\$\s?[\d.,]+|[\d.,]+ d[oó]lar(es)?/g) ?? [];
    expect(montos.sort()).toEqual(["US$1", "US$7.50"]);
  });

  it("con la venta apagada, con todo pausado o con otra red, ningún precio: dice que no hay paquetes a la venta", async () => {
    for (const r of [
      { ...VENTA, pago: false },
      { ...VENTA, red: "testnet" },
      { red: "mainnet", pago: true, alta: { ...VENTA.alta, pausado: true }, paquetes: [{ ...VENTA.paquetes[0], pausado: true }] },
      { red: "mainnet", pago: true, alta: null, paquetes: [] },
    ]) {
      document.body.innerHTML = cuerpo("precios.html");
      expect(await montarCobro({ pago: true, fetch: servidor(r), url: PORTERO }), JSON.stringify(r)).toBe("nada");
      expect(filas(), JSON.stringify(r)).toEqual([]);
      expect(nota()).toBe(TEXTOS_COBRO.es.prPaqNada);
      // Una sola línea: la de cómo se compra se va, porque ahora no hay qué comprar.
      expect(ayudaALaVista()).toBe(false);
    }
  });

  it("con la compra con QR a la vista, una línea dice lo que se suma pagando con QR, con los números del servidor", async () => {
    const conQr = { ...VENTA, recargoQr: { primera: "4", siguientes: "0.5" } };
    document.body.innerHTML = cuerpo("precios.html");
    expect(await montarCobro({ pago: true, qr: true, fetch: servidor(conQr), url: PORTERO })).toBe("vendiendo");
    const qr = (): string | null => {
      const p = document.querySelector<HTMLElement>("[data-paquetes-qr]");
      return p && !p.hidden ? (p.textContent ?? "") : null;
    };
    expect(qr()).toBe("Pagando con el QR de tu banco, en bolivianos, se suman 4 dólares la primera vez y 0,50 dólares las siguientes. La primera vez incluye verificar tu identidad.");
    setLang("en");
    expect(qr()).toBe("Paying with your bank's QR, in bolivianos, adds US$4 the first time and US$0.50 after that. The first time includes verifying your identity.");
    setLang("es");
    // Sin la compra con QR a la vista, o sin el recargo del servidor, la línea no está.
    document.body.innerHTML = cuerpo("precios.html");
    await montarCobro({ pago: true, qr: false, fetch: servidor(conQr), url: PORTERO });
    expect(qr()).toBeNull();
    document.body.innerHTML = cuerpo("precios.html");
    await montarCobro({ pago: true, qr: true, fetch: servidor(VENTA), url: PORTERO });
    expect(qr()).toBeNull();
  });

  it("lo pausado no se muestra y lo demás sí", async () => {
    document.body.innerHTML = cuerpo("precios.html");
    await montarCobro({ pago: true, fetch: servidor({ ...VENTA, alta: { ...VENTA.alta, pausado: true } }), url: PORTERO });
    expect(filas()).toEqual(["Sumar sorteos 10 sorteos oficiales por 10 dólares Para usar en 365 días."]);
  });

  it("si el servidor no contesta, contesta mal o no hay portero, lo dice y no muestra ningún precio", async () => {
    const casos: [typeof fetch | undefined, string | null][] = [
      [servidor({ motivo: "x" }, 500), PORTERO],
      [servidor({ red: "mainnet", pago: true, alta: { usdc: "-1", sorteos: 3, dias: 90 }, paquetes: [] }), PORTERO],
      [vi.fn(async () => Promise.reject(new Error("sin red"))) as unknown as typeof fetch, PORTERO],
      [servidor(VENTA), null],
      [servidor(VENTA), "http://pm.example.org"],
    ];
    for (const [f, url] of casos) {
      document.body.innerHTML = cuerpo("precios.html");
      expect(await montarCobro({ pago: true, fetch: f, url })).toBe("sin-respuesta");
      expect(filas()).toEqual([]);
      expect(nota()).toBe(TEXTOS_COBRO.es.prPaqSinRespuesta);
      expect(ayudaALaVista()).toBe(false);
    }
  });

  it("terminos.html: lo que se compra entra después de la primera nota, y con #compras la página va ahí", async () => {
    history.replaceState(null, "", "/terminos.html#compras");
    document.body.innerHTML = cuerpo("terminos.html");
    const f = servidor(VENTA);
    expect(cargaElCobro(document, true)).toBe(true);
    expect(await montarCobro({ pago: true, fetch: f, url: PORTERO })).toBeNull();
    const compras = document.getElementById("compras");
    expect(compras?.tagName).toBe("ARTICLE");
    expect(compras?.previousElementSibling?.querySelector('[data-i="tmQ1T"]')).not.toBeNull();
    expect(compras?.querySelector('[data-i="tmCompraT"]')?.textContent).toBe(TEXTOS_COBRO.es.tmCompraT);
    expect(compras?.querySelector('[data-i-html="tmCompraEscribir"] a')?.getAttribute("href")).toBe("mailto:hola@tinkazo.app");
    expect(compras?.scrollIntoView).toHaveBeenCalled();
    // Sin lista de precios, no le pregunta nada al servidor.
    expect(f).not.toHaveBeenCalled();
  });
});

describe("el HTML de las páginas", () => {
  it("precios.html y terminos.html traen lo de la compra en un template, y la lista vacía: ningún precio escrito", () => {
    for (const p of ["precios.html", "terminos.html"]) expect(leer(p), p).toMatch(/<template data-con-cobro>/);
    const precios = /<template data-con-cobro>([\s\S]*?)<\/template>/.exec(leer("precios.html"))?.[1] ?? "";
    expect(precios).toMatch(/<ul[^>]*data-paquetes[^>]*><\/ul>/);
    expect(precios).not.toMatch(/\d\s*(d[oó]lares?|USDC|Bs)\b|US\$\s*\d/);
    expect(leer("terminos.html")).toMatch(/<template data-con-cobro>\s*<article class="nota" id="compras">/);
  });

  it("cada clave del template es de TEXTOS_COBRO y trae su texto en español", () => {
    for (const p of ["precios.html", "terminos.html"]) {
      const tpl = [...leer(p).matchAll(/<template data-con-cobro>([\s\S]*?)<\/template>/g)].map((m) => m[1]).join("");
      const claves = [...tpl.matchAll(/data-i="([^"]+)">([^<]*)</g), ...tpl.matchAll(/data-i-html="([^"]+)">([\s\S]*?)<\/p>/g)];
      expect(claves.length, p).toBeGreaterThan(2);
      for (const [, k, texto] of claves) {
        expect(TEXTOS_COBRO.es[k as string], `${p} ${k}`).toBeDefined();
        expect(texto, `${p} ${k}`).toBe(TEXTOS_COBRO.es[k as string]);
      }
    }
  });
});
