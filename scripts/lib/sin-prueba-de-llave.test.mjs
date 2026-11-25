import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MARCAS_DE_LA_PRUEBA } from "../../src/prueba-llave/en-el-build";
import { esMarcaDeLaPrueba, MARCAS, revisarCarpeta } from "./sin-prueba-de-llave.mjs";

const carpetas = [];
function carpeta() {
  const d = mkdtempSync(join(tmpdir(), "sin-prueba-llave-"));
  carpetas.push(d);
  return d;
}
afterEach(() => {
  for (const d of carpetas.splice(0)) rmSync(d, { recursive: true, force: true });
});

function escribir(dir, relativa, contenido) {
  const ruta = join(dir, relativa);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
}

const mapa = (...fuentes) => JSON.stringify({ version: 3, sources: fuentes, mappings: "" });

const KIT = "../../node_modules/.pnpm/smart-account-kit@0.10.0/node_modules/smart-account-kit/dist/index.js";
const SDK16 = "../../node_modules/.pnpm/@stellar+stellar-sdk@16.4.1/node_modules/@stellar/stellar-sdk/lib/index.js";
const SDK17 = "../../node_modules/.pnpm/@stellar+stellar-sdk@17.3.0_debug@4.4.3/node_modules/@stellar/stellar-sdk/lib/index.js";

function distLimpio() {
  const d = carpeta();
  escribir(d, "index.html", "<!doctype html><title>x</title>");
  escribir(d, "assets/index-abc.js", "console.log(1)");
  escribir(d, "assets/index-abc.js.map", mapa("../../src/main.ts", SDK17, "../../node_modules/.pnpm/@pollar+core@0.12.0/node_modules/@pollar/core/dist/index.js"));
  return d;
}

function distConLaPrueba() {
  const d = distLimpio();
  escribir(d, "prueba/llave/index.html", "<!doctype html><title>Prueba</title>");
  escribir(d, "assets/prueba-llave-abc.js", 'const cuenta = "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";');
  escribir(d, "assets/prueba-llave-abc.js.map", mapa("../../src/prueba-llave/pagina.ts", KIT, SDK16));
  return d;
}

describe("las marcas de la revisión de la carpeta", () => {
  it("son las mismas que las del armado", () => {
    expect(MARCAS.map((m) => m.source)).toEqual(MARCAS_DE_LA_PRUEBA.map((m) => m.source));
  });

  it("reconocen rutas de mapas de fuentes, relativas y con contrabarras", () => {
    expect(esMarcaDeLaPrueba(KIT)).toBe(true);
    expect(esMarcaDeLaPrueba(SDK16)).toBe(true);
    expect(esMarcaDeLaPrueba("src/prueba-llave/flujo.ts")).toBe(true);
    expect(esMarcaDeLaPrueba("..\\..\\node_modules\\.pnpm\\@stellar+stellar-sdk@16.4.1\\node_modules\\@stellar\\stellar-sdk\\lib\\index.js")).toBe(true);
  });

  it("no reconocen el SDK 17 del sitio ni el resto de lo suyo", () => {
    expect(esMarcaDeLaPrueba(SDK17)).toBe(false);
    expect(esMarcaDeLaPrueba("../../src/stellar/envio.ts")).toBe(false);
    expect(esMarcaDeLaPrueba("../../node_modules/.pnpm/@pollar+core@0.12.0/node_modules/@pollar/core/dist/index.js")).toBe(false);
  });
});

describe("una carpeta construida sin la prueba", () => {
  it("un armado limpio pasa", () => {
    const r = revisarCarpeta(distLimpio());
    expect(r.ok).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it("la carpeta prueba/ no pasa", () => {
    const d = distLimpio();
    escribir(d, "prueba/llave/index.html", "x");
    const r = revisarCarpeta(d);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("prueba/");
  });

  it("un mapa de fuentes que nombra al kit o al SDK 16 no pasa", () => {
    for (const fuente of [KIT, SDK16, "../../src/prueba-llave/pagina.ts"]) {
      const d = distLimpio();
      escribir(d, "assets/otro.js.map", mapa(fuente));
      expect(revisarCarpeta(d).ok, fuente).toBe(false);
    }
  });

  it("una dirección o un texto de la prueba en cualquier archivo no pasa", () => {
    for (const texto of ["openzeppelin-smart-account-kit", "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F", "c514d35ea67eaea9bfc1"]) {
      const d = distLimpio();
      escribir(d, "assets/otro.js", `const x = "${texto}";`);
      expect(revisarCarpeta(d).ok, texto).toBe(false);
    }
  });

  it("una carpeta que no existe no pasa", () => {
    expect(revisarCarpeta(join(tmpdir(), "no-existe-esta-carpeta-llave")).ok).toBe(false);
  });
});

describe("una carpeta construida con la prueba", () => {
  it("entera pasa la revisión de presente", () => {
    const r = revisarCarpeta(distConLaPrueba(), { presente: true });
    expect(r.problemas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.hallado).toMatchObject({ pagina: true, kit: true, sdk16: true });
  });

  it("sin presente, la misma carpeta no pasa", () => {
    expect(revisarCarpeta(distConLaPrueba()).ok).toBe(false);
  });

  it("si falta la página, el kit, el SDK 16 o el código de la cuenta, la revisión de presente falla", () => {
    const sinPagina = distConLaPrueba();
    rmSync(join(sinPagina, "prueba"), { recursive: true });
    expect(revisarCarpeta(sinPagina, { presente: true }).ok).toBe(false);

    const sinMapas = distConLaPrueba();
    escribir(sinMapas, "assets/prueba-llave-abc.js.map", mapa("../../src/otra-cosa.ts"));
    const r = revisarCarpeta(sinMapas, { presente: true });
    expect(r.ok).toBe(false);
    expect(r.problemas.length).toBeGreaterThanOrEqual(2);

    const sinCodigo = distConLaPrueba();
    escribir(sinCodigo, "assets/prueba-llave-abc.js", "const x = 1;");
    expect(revisarCarpeta(sinCodigo, { presente: true }).ok).toBe(false);
  });

  it("un armado limpio no pasa la revisión de presente: la revisión no es vacía", () => {
    expect(revisarCarpeta(distLimpio(), { presente: true }).ok).toBe(false);
  });
});
