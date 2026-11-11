import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { problemasDeAlta } from "./alta-build";
import { BANDERAS_APAGADAS, altaActiva, altaLibre, altaPagoActivo, banderasDeAlta, sorteoPorServidor } from "./alta-config";

const TODO = { VITE_ALTA: "1", VITE_ALTA_LIBRE: "1", VITE_ALTA_PAGO: "1", VITE_SORTEO_SERVIDOR: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.example" };

describe("banderasDeAlta", () => {
  it("sin variables, todo apagado en las dos redes", () => {
    expect(banderasDeAlta({}, "mainnet")).toEqual(BANDERAS_APAGADAS);
    expect(banderasDeAlta({}, "testnet")).toEqual(BANDERAS_APAGADAS);
  });

  it("fuera de la red principal, apagadas siempre, tengan lo que tengan las variables", () => {
    expect(banderasDeAlta(TODO, "testnet")).toEqual({ alta: false, libre: false, pago: false, sorteoServidor: false });
    expect(banderasDeAlta(TODO, "otra-cosa")).toEqual(BANDERAS_APAGADAS);
  });

  it("en la red principal con todo puesto, todo prendido menos el plan B1, que con el acceso por cupón no vale", () => {
    expect(banderasDeAlta(TODO, "mainnet")).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: true });
  });

  it("el plan B1 vale solo: junto con VITE_ALTA activaría sin acceso, y vale la menos abierta", () => {
    expect(banderasDeAlta({ VITE_ALTA_LIBRE: "1" }, "mainnet").libre).toBe(true);
    expect(banderasDeAlta({ VITE_ALTA_LIBRE: "1", VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" }, "mainnet").libre).toBe(false);
    // Con VITE_ALTA a medio poner (sin el portero) tampoco: para cerrar vale la bandera como vino.
    expect(banderasDeAlta({ VITE_ALTA_LIBRE: "1", VITE_ALTA: "1" }, "mainnet")).toEqual(BANDERAS_APAGADAS);
  });

  it("solo el valor 1 prende una bandera", () => {
    for (const v of ["true", "si", "on", "0", "", " 1", "1 ", "2"]) {
      const b = banderasDeAlta({ ...TODO, VITE_ALTA: v, VITE_ALTA_LIBRE: v }, "mainnet");
      expect(b.alta, v).toBe(false);
      expect(b.libre, v).toBe(false);
    }
  });

  it("el acceso sin la dirección del portero de la red principal no vale, y arrastra al pago y al sorteo por el servidor", () => {
    for (const url of [undefined, "", "   ", "/"]) {
      expect(banderasDeAlta({ ...TODO, VITE_PATROCINIO_URL_MAINNET: url }, "mainnet"), String(url)).toEqual({ alta: false, libre: false, pago: false, sorteoServidor: false });
    }
  });

  it("el pago y el sorteo por el servidor sin el acceso no cuentan", () => {
    expect(banderasDeAlta({ ...TODO, VITE_ALTA: undefined }, "mainnet")).toEqual({ alta: false, libre: true, pago: false, sorteoServidor: false });
  });

  it("cada bandera es independiente cuando hay acceso", () => {
    const solo = { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.example" };
    expect(banderasDeAlta(solo, "mainnet")).toEqual({ alta: true, libre: false, pago: false, sorteoServidor: false });
    expect(banderasDeAlta({ ...solo, VITE_ALTA_PAGO: "1" }, "mainnet")).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: false });
    expect(banderasDeAlta({ ...solo, VITE_SORTEO_SERVIDOR: "1" }, "mainnet")).toEqual({ alta: true, libre: false, pago: false, sorteoServidor: true });
  });

  it("en este build (Prueba y sin variables) todo está apagado", () => {
    expect([altaActiva(), altaLibre(), altaPagoActivo(), sorteoPorServidor()]).toEqual([false, false, false, false]);
  });
});

describe("problemasDeAlta, lo que frena el build", () => {
  it("sin banderas no hay nada que decir", () => {
    expect(problemasDeAlta({})).toEqual([]);
    expect(problemasDeAlta({ VITE_PATROCINIO_URL_MAINNET: "https://pm.example" })).toEqual([]);
  });

  it("VITE_ALTA=1 sin la dirección del portero de la red principal falla", () => {
    for (const url of [undefined, "", "  ", "/"]) {
      const p = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: url });
      expect(p, String(url)).toHaveLength(1);
      expect(p[0]).toContain("VITE_PATROCINIO_URL_MAINNET");
    }
  });

  it("VITE_ALTA=1 con la dirección del portero de la red principal sale bien", () => {
    expect(problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" })).toEqual([]);
  });

  it("la dirección de Prueba no sirve para Oficial", () => {
    expect(problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_TESTNET: "https://p.example" })).toHaveLength(1);
  });

  it("VITE_ALTA_LIBRE=1 junto con VITE_ALTA=1 falla: juntas activarían sin acceso", () => {
    const p = problemasDeAlta({ VITE_ALTA: "1", VITE_ALTA_LIBRE: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_ALTA_LIBRE");
    expect(p[0]).toContain("VITE_ALTA=1");
    // Cada una por su lado sale bien: el plan B1 es VITE_ALTA_LIBRE sola.
    expect(problemasDeAlta({ VITE_ALTA_LIBRE: "1" })).toEqual([]);
    expect(problemasDeAlta({ VITE_ALTA_LIBRE: "1", VITE_ALTA: "0" })).toEqual([]);
    expect(problemasDeAlta({ VITE_ALTA_LIBRE: "0", VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" })).toEqual([]);
  });

  it("el pago o el sorteo por el servidor sin VITE_ALTA=1 fallan", () => {
    expect(problemasDeAlta({ VITE_ALTA_PAGO: "1" })).toHaveLength(1);
    expect(problemasDeAlta({ VITE_SORTEO_SERVIDOR: "1" })).toHaveLength(1);
    expect(problemasDeAlta({ VITE_ALTA_PAGO: "1", VITE_SORTEO_SERVIDOR: "1" })).toHaveLength(2);
  });

  it("una bandera con otro valor que 1 o 0 frena el build, sin escribir el valor: con true, on o « 1» quedaba apagada sin aviso", () => {
    for (const k of ["VITE_ALTA", "VITE_ALTA_LIBRE", "VITE_ALTA_PAGO", "VITE_SORTEO_SERVIDOR"]) {
      for (const v of ["true", "on", " 1", "1 ", "si", "2"]) {
        const p = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app", [k]: v });
        expect(p.some((x) => x.includes(k) && x.includes("solo acepta 1 o 0")), `${k}=${JSON.stringify(v)}`).toBe(true);
        expect(p.join(" "), `${k}=${JSON.stringify(v)}`).not.toContain(`=${v}`);
      }
    }
    for (const v of ["", "0", "   "]) expect(problemasDeAlta({ VITE_ALTA: v }), JSON.stringify(v)).toEqual([]);
  });

  it("con VITE_ALTA=1, la dirección del portero de la red principal tiene que ser https, sin ruta y la de Oficial (el token de la sesión viaja ahí)", () => {
    for (const url of ["http://pm.tinkazo.app", "https://p.tinkazo.app", "https://pm.tinkazo.app/v1", "https://pm.tinkazo.app?x=1", "https://usuario:clave@pm.tinkazo.app", "https://pm.tinkazo.ap", "https://otro.ejemplo", "no es una direccion"]) {
      const p = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: url });
      expect(p, url).toHaveLength(1);
      expect(p[0]).toContain("VITE_PATROCINIO_URL_MAINNET");
      expect(p[0]).not.toContain(url);
    }
    for (const url of ["https://pm.tinkazo.app", "https://pm.tinkazo.app/", " https://pm.tinkazo.app "]) expect(problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: url }), url).toEqual([]);
    // Sin VITE_ALTA, la dirección no se mira: el sitio no manda ningún token.
    expect(problemasDeAlta({ VITE_PATROCINIO_URL_MAINNET: "http://cualquiera" })).toEqual([]);
  });

  it("no escribe el valor de ninguna variable", () => {
    const p = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "", VITE_ALTA_PAGO: "1" }).join(" ");
    expect(p).not.toMatch(/https?:/);
  });
});

describe("problemasDeAlta, la publicación de producción", () => {
  const PORTERO = "https://pm.tinkazo.app";

  it("las páginas dicen que con un cupón el modo Oficial es gratis: la publicación de producción sin VITE_ALTA=1 no sale", () => {
    for (const alta of [undefined, "", "0", "  "]) {
      const p = problemasDeAlta({ VERCEL_ENV: "production", VITE_ALTA: alta, VITE_PATROCINIO_URL_MAINNET: PORTERO });
      expect(p, JSON.stringify(alta)).toHaveLength(1);
      expect(p[0]).toContain("VITE_ALTA=1");
      expect(p[0]).toContain("cupón");
    }
  });

  it("con VITE_ALTA=1 y el portero de la red principal, la publicación de producción sale", () => {
    expect(problemasDeAlta({ VERCEL_ENV: "production", VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO })).toEqual([]);
  });

  it("solo frena la publicación de producción: las vistas previas, el desarrollo, la CI y los builds locales salen sin banderas", () => {
    for (const entorno of ["preview", "development", "", undefined]) {
      expect(problemasDeAlta({ VERCEL_ENV: entorno }), String(entorno)).toEqual([]);
    }
    expect(problemasDeAlta({})).toEqual([]);
  });

  it("el plan B1 (VITE_ALTA_LIBRE sola) sigue pudiendo publicarse: es la salida de emergencia", () => {
    expect(problemasDeAlta({ VERCEL_ENV: "production", VITE_ALTA_LIBRE: "1" })).toEqual([]);
  });

  it("con VITE_ALTA=1 pero sin portero dice una sola cosa: la del portero", () => {
    const p = problemasDeAlta({ VERCEL_ENV: "production", VITE_ALTA: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_PATROCINIO_URL_MAINNET");
  });

  it("no escribe el valor de ninguna variable", () => {
    expect(problemasDeAlta({ VERCEL_ENV: "production", VITE_PATROCINIO_URL_MAINNET: "https://secreto.example" }).join(" ")).not.toMatch(/secreto|https?:/);
  });

  it("vite.config.ts le pasa al control el entorno de la publicación (VERCEL_ENV), no solo las variables VITE_", () => {
    const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/problemasDeAlta\(loadEnv\(mode, __dirname, \["VITE_", "VERCEL_ENV"\]\)\)/);
  });
});
