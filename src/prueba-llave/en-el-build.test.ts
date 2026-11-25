import { describe, expect, it } from "vitest";
import { ANFITRIONES_PERMITIDOS, incluirPruebaDeLlave, MARCAS_DE_LA_PRUEBA, modulosDeLaPrueba, problemasDePruebaDeLlave, rutaNormal } from "./en-el-build";

describe("cuándo entra la prueba de la llave al armado", () => {
  it("sin la variable no entra nunca, en ningún entorno", () => {
    for (const vercel of [undefined, "preview", "production", "development"]) {
      for (const gh of [undefined, "true"]) {
        expect(incluirPruebaDeLlave({ VERCEL_ENV: vercel, GITHUB_ACTIONS: gh })).toBe(false);
      }
    }
  });

  it("solo el valor 1 la pide", () => {
    for (const v of ["0", "true", "yes", "", " 1"]) {
      expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: v, VERCEL_ENV: "preview" })).toBe(false);
    }
  });

  it("con la variable entra en una vista previa de Vercel", () => {
    expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("con la variable entra en la revisión de GitHub, que no trae VERCEL_ENV", () => {
    expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", GITHUB_ACTIONS: "true" })).toBe(true);
    expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", VERCEL_ENV: "", GITHUB_ACTIONS: "true" })).toBe(true);
  });

  it("con la variable pero sin nada que diga dónde se arma, no entra: una computadora suelta no alcanza", () => {
    expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1" })).toBe(false);
    expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", GITHUB_ACTIONS: "false" })).toBe(false);
  });

  it("con producción, desarrollo o cualquier otro valor de Vercel no entra, aunque GitHub diga que sí", () => {
    for (const vercel of ["production", "development", "otro"]) {
      expect(incluirPruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", VERCEL_ENV: vercel, GITHUB_ACTIONS: "true" })).toBe(false);
    }
  });

  it("la variable en una publicación de producción frena la construcción, y el mensaje no escribe valores", () => {
    const p = problemasDePruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", VERCEL_ENV: "production" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_PRUEBA_LLAVE");
    expect(problemasDePruebaDeLlave({ VITE_PRUEBA_LLAVE: "1", VERCEL_ENV: "preview" })).toEqual([]);
    expect(problemasDePruebaDeLlave({ VERCEL_ENV: "production" })).toEqual([]);
    expect(problemasDePruebaDeLlave({})).toEqual([]);
  });
});

describe("las marcas de la prueba, contra rutas con la forma real del almacén de pnpm", () => {
  const dentro = [
    "/repo/node_modules/.pnpm/smart-account-kit@0.10.0/node_modules/smart-account-kit/dist/index.js",
    "/repo/node_modules/.pnpm/smart-account-kit-bindings@0.5.0_@stellar+stellar-sdk@16.4.1/node_modules/smart-account-kit-bindings/dist/index.js",
    "/repo/node_modules/.pnpm/@simplewebauthn+browser@13.3.0/node_modules/@simplewebauthn/browser/esm/index.js",
    "/repo/node_modules/.pnpm/@stellar+stellar-sdk@16.4.1/node_modules/@stellar/stellar-sdk/lib/index.js",
    "/repo/node_modules/.pnpm/base64url@3.0.1/node_modules/base64url/index.js",
    "/repo/node_modules/smart-account-kit/dist/kit.js",
    "/repo/node_modules/smart-account-kit-bindings/dist/index.js",
    "/repo/node_modules/@simplewebauthn/browser/esm/index.js",
    "/repo/src/prueba-llave/flujo.ts",
  ];
  const fuera = [
    "/repo/node_modules/.pnpm/@stellar+stellar-sdk@17.3.0_debug@4.4.3/node_modules/@stellar/stellar-sdk/lib/index.js",
    "/repo/node_modules/.pnpm/@pollar+core@0.12.0/node_modules/@pollar/core/dist/index.js",
    "/repo/src/stellar/envio.ts",
    "/repo/src/protocol/canonical.ts",
    "/repo/prueba-llave-no-es-esto.ts",
  ];

  it("cada ruta de la prueba coincide con alguna marca", () => {
    for (const ruta of dentro) expect(MARCAS_DE_LA_PRUEBA.some((m) => m.test(ruta)), ruta).toBe(true);
  });

  it("las rutas del sitio de hoy, incluido el SDK 17, no coinciden con ninguna", () => {
    for (const ruta of fuera) expect(MARCAS_DE_LA_PRUEBA.some((m) => m.test(ruta)), ruta).toBe(false);
  });

  it("con contrabarras de Windows coinciden igual, una vez normalizadas", () => {
    const win = "C:\\repo\\node_modules\\.pnpm\\@stellar+stellar-sdk@16.4.1\\node_modules\\@stellar\\stellar-sdk\\lib\\index.js";
    expect(modulosDeLaPrueba([win, "C:\\repo\\src\\stellar\\envio.ts"])).toEqual([win]);
    expect(rutaNormal(win)).not.toContain("\\");
  });

  it("modulosDeLaPrueba deja solo los de la prueba", () => {
    expect(modulosDeLaPrueba([...dentro, ...fuera])).toEqual(dentro);
  });
});

describe("los anfitriones donde la página carga el kit", () => {
  it("sí: la computadora de quien prueba y el alias de rama de una vista previa", () => {
    for (const h of ["localhost", "127.0.0.1", "tinkazo-git-llave-piloto-equipo.vercel.app", "TINKAZO-GIT-LLAVE-PILOTO-EQUIPO.vercel.app"]) {
      expect(ANFITRIONES_PERMITIDOS(h), h).toBe(true);
    }
  });

  it("no: producción, sus subdominios, la dirección de Vercel de producción, el alias de la rama principal y las direcciones únicas", () => {
    for (const h of [
      "tinkazo.app",
      "www.tinkazo.app",
      "sub.tinkazo.app",
      "pm.tinkazo.app",
      "tinkazo.vercel.app",
      "tinkazo-git-main-equipo.vercel.app",
      "tinkazo-abc123xyz-equipo.vercel.app",
      "tinkazo-git-.vercel.app.otro.com",
      "otro-git-llave.vercel.app",
      "",
    ]) {
      expect(ANFITRIONES_PERMITIDOS(h), h).toBe(false);
    }
  });
});
