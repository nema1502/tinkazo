import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La prueba de la llave no se mezcla con el sitio. Estas pruebas leen los archivos como texto y cuidan los hechos que
 * sostienen el aislamiento: quién importa qué, dónde está el plugin y que nada nombre la red principal.
 */
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const carpetaDeLaPrueba = join(raiz, "src", "prueba-llave");
const leer = (...partes: string[]): string => readFileSync(join(raiz, ...partes), "utf8").split(String.fromCharCode(13)).join("");

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosTs(ruta));
    else if (e.name.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

const rel = (ruta: string): string => relative(raiz, ruta).split(sep).join("/");
const delaPrueba = archivosTs(carpetaDeLaPrueba);
const sinPruebas = delaPrueba.filter((f) => !f.endsWith(".test.ts"));
const delSitio = archivosTs(join(raiz, "src")).filter((f) => !f.startsWith(carpetaDeLaPrueba));

describe("nada del sitio importa la prueba", () => {
  it("ningún archivo de src fuera de la carpeta de la prueba la nombra en un import", () => {
    const malos = delSitio.filter((f) => /from\s*["'][^"']*prueba-llave|import\s*\(\s*["'][^"']*prueba-llave/.test(readFileSync(f, "utf8")));
    expect(malos.map(rel)).toEqual([]);
  });

  it("ninguna página del sitio carga la de la prueba", () => {
    const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html"));
    expect(paginas.length).toBeGreaterThan(5);
    for (const p of paginas) expect(leer(p), p).not.toContain("prueba-llave");
  });

  it("de vite.config.ts solo se importa el archivo sin imports", () => {
    const config = leer("vite.config.ts");
    const imports = [...config.matchAll(/from\s*"\.\/src\/prueba-llave\/([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["en-el-build"]);
    expect(leer("src", "prueba-llave", "en-el-build.ts")).not.toMatch(/^\s*import\s/m);
  });
});

describe("el kit entra por un solo archivo", () => {
  it("solo puente-kit.ts importa el kit y el de passkeys con efecto, y su primer import es el de Buffer", () => {
    const conKit = sinPruebas.filter((f) => /from\s*["']smart-account-kit["']/.test(readFileSync(f, "utf8")));
    expect(conKit.map(rel)).toEqual(["src/prueba-llave/puente-kit.ts"]);
    const imports = [...readFileSync(join(carpetaDeLaPrueba, "puente-kit.ts"), "utf8").matchAll(/^import\s+(?:[^;]*?from\s*)?["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports[0]).toBe("./buffer-global");
  });

  it("el resto de la prueba solo importa del kit tipos propios: nada de smart-account-kit ni de bindings", () => {
    for (const f of sinPruebas.filter((x) => !x.endsWith("puente-kit.ts"))) {
      const t = readFileSync(f, "utf8");
      expect(t, rel(f)).not.toMatch(/["']smart-account-kit(-bindings)?["']/);
    }
  });

  it("el SDK de Stellar que usa la prueba es el del sitio: ningún archivo pide una versión suelta", () => {
    for (const f of sinPruebas) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/stellar-sdk@\d/);
    }
  });
});

describe("el plugin del armado", () => {
  const config = leer("vite.config.ts");

  it("es el primero de la lista y lee el entorno con las tres familias de variables", () => {
    expect(config).toMatch(/plugins:\s*\[\s*pruebaDeLlave\(\)/);
    expect(config).toContain('loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV", "GITHUB_ACTIONS"])');
  });

  it("solo actúa al construir y no toca la configuración general de external ni de dedupe", () => {
    const bloque = config.slice(config.indexOf("function pruebaDeLlave"), config.indexOf("Las páginas de lectura se adelantan"));
    expect(bloque).toContain('apply: "build"');
    expect(bloque).not.toMatch(/external\s*:|dedupe/);
    expect(config).not.toMatch(/resolve\s*:\s*\{[^}]*dedupe/);
  });
});

describe("la página de la prueba", () => {
  const html = leer("prueba", "llave", "index.html");

  it("no se indexa, avisa en las dos lenguas aunque no cargue el código y trae su noscript", () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).toContain("Es una prueba. Nada de acá vale plata.");
    expect(html).toContain("This is a test. Nothing here is worth money.");
    expect(html).toMatch(/<noscript>[\s\S]*Esta prueba necesita JavaScript\.[\s\S]*This test needs JavaScript\.[\s\S]*<\/noscript>/);
  });

  it("no usa atributos data-i del diccionario del sitio y carga solo su código", () => {
    expect(html).not.toMatch(/\bdata-i[a-z-]*=/);
    const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(["/src/prueba-llave/pagina.ts"]);
  });

  it("tiene una acción principal y una secundaria, y nada de comillas angulares ni punto y coma en su texto", () => {
    expect(html.match(/data-accion="principal"/g)).toHaveLength(1);
    expect(html.match(/data-accion="secundario"/g)).toHaveLength(1);
    const visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(new RegExp(`[;${String.fromCharCode(171, 187)}]`));
  });

  it("la página está en una carpeta que ninguna comprobación de la raíz recorre", () => {
    expect(readdirSync(raiz).filter((f) => f.endsWith(".html"))).not.toContain("prueba-llave.html");
  });
});

describe("la prueba vive solo en la red de prueba", () => {
  const despliegues = JSON.parse(leer("src", "stellar", "deployments.json")) as { mainnet: { contractId: string; rpcUrl: string } };

  it("ningún archivo de la prueba nombra la red principal, su contrato ni su RPC", () => {
    for (const f of sinPruebas) {
      const t = readFileSync(f, "utf8");
      expect(t, rel(f)).not.toContain(despliegues.mainnet.contractId);
      expect(t, rel(f)).not.toContain(despliegues.mainnet.rpcUrl);
      expect(t.toLowerCase(), rel(f)).not.toMatch(/mainnet|pubnet|public global/);
    }
  });

  it("ninguna cadena visible habla de rifas, loterías, boletos ni apuestas", () => {
    for (const f of sinPruebas.filter((x) => x.endsWith("textos.ts"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\b(rifa|loter[ií]a|boleto|apuesta|raffle|ticket)\b/i);
    }
  });

  it("los archivos de la prueba no dejan rutas de una máquina ni nombres de trabajo privados", () => {
    // Las palabras se arman por partes: este archivo también se revisa y no puede nombrarlas.
    const palabras = ["Tinkazo" + "_Privado", "bita" + "cora", "age" + "ntes", "eval" + "uador", "." + "cla" + "ude", "worktree" + " de"];
    const rutas = /C:[\/]Nic/;
    for (const f of delaPrueba.filter((x) => !x.endsWith("aislamiento.test.ts"))) {
      const t = readFileSync(f, "utf8");
      expect(t, rel(f)).not.toMatch(rutas);
      for (const p of palabras) expect(t, `${rel(f)}: ${p}`).not.toContain(p);
    }
  });
});

describe("la revisión automática", () => {
  const ci = leer(".github", "workflows", "ci.yml");

  it("el armado del sitio, el armado con la prueba y la revisión de presente están en la calidad que exige la rama principal", () => {
    expect(ci).toContain("node scripts/check-sin-prueba-de-llave.mjs dist\n");
    expect(ci).toContain("VITE_PRUEBA_LLAVE=1 pnpm exec vite build --outDir dist-llave");
    expect(ci).toContain("node scripts/check-sin-prueba-de-llave.mjs dist-llave --presente");
  });

  it("el recorrido corre aparte y no frena nada", () => {
    const flujo = leer(".github", "workflows", "prueba-llave.yml");
    expect(flujo).toContain("continue-on-error: true");
    expect(flujo).toContain("timeout-minutes: 35");
    expect(flujo).toContain("timeout 1800");
    expect(flujo).toContain("retention-days: 14");
    expect(ci).not.toContain("recorrido-llave");
  });
});

describe("las dependencias de la prueba", () => {
  const paquete = JSON.parse(leer("package.json")) as { devDependencies: Record<string, string>; dependencies: Record<string, string>; scripts: Record<string, string> };
  const lock = leer("pnpm-lock.yaml");

  it("van exactas y como dependencias de desarrollo: nada de eso viaja en el código del sitio", () => {
    expect(paquete.devDependencies["smart-account-kit"]).toBe("0.10.0");
    expect(paquete.devDependencies["@simplewebauthn/browser"]).toBe("13.3.0");
    expect(paquete.devDependencies["buffer"]).toBe("6.0.3");
    for (const n of ["smart-account-kit", "@simplewebauthn/browser", "buffer"]) expect(paquete.dependencies[n], n).toBeUndefined();
  });

  it("el sitio sigue en el SDK 17.3.0 y el kit trae el suyo, el 16.4.1, aparte", () => {
    expect(paquete.dependencies["@stellar/stellar-sdk"]).toBe("17.3.0");
    expect(lock).toContain("'@stellar/stellar-sdk@17.3.0':");
    expect(lock).toContain("'@stellar/stellar-sdk@16.4.1':");
    expect(lock).toMatch(/smart-account-kit@0\.10\.0\(debug@[\d.]+\):\n\s+dependencies:\n(?:\s+.*\n)*?\s+'@stellar\/stellar-sdk': 16\.4\.1/);
    expect(lock).toContain("'@simplewebauthn/browser@13.3.0':");
  });

  it("los dos comandos de la prueba existen", () => {
    expect(paquete.scripts["check:sin-prueba-de-llave"]).toContain("check-sin-prueba-de-llave.mjs");
    expect(paquete.scripts["recorrido:llave"]).toContain("recorrido-llave.mjs");
  });
});
