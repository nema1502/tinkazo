import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CREAR_CAMPANA } from "./textos-crear";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

const ES = TEXTOS_CREAR_CAMPANA.es;
const EN = TEXTOS_CREAR_CAMPANA.en;
const CLAVES = Object.keys(ES);
const huecos = (texto: string): string[] => [...texto.matchAll(/\{(\w+)\}/gu)].map((m) => m[1] ?? "").sort();

/** La entrada de la página y todo lo que importa sin import(), como lo recorre el armado de textos del sitio. */
function archivosDeLaPagina(): string[] {
  const vistos = new Set<string>();
  const pendientes = [resolve("src/crear-campana.ts")];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop() as string;
    if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
    vistos.add(archivo);
    const importaciones = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gmu;
    for (const m of readFileSync(archivo, "utf8").matchAll(importaciones)) {
      const base = resolve(dirname(archivo), m[1] ?? "");
      const candidato = [base, `${base}.ts`, resolve(base, "index.ts")].find((c) => existsSync(c) && statSync(c).isFile());
      if (candidato) pendientes.push(candidato);
    }
  }
  return [...vistos];
}

describe("los textos de la página para armar campañas", () => {
  it("las mismas claves en los dos idiomas y en el mismo orden, todas con cc", () => {
    expect(Object.keys(EN)).toEqual(CLAVES);
    expect(CLAVES.every((k) => /^cc[A-Z]/u.test(k))).toBe(true);
  });

  it("cada texto lleva los mismos huecos en los dos idiomas", () => {
    for (const k of CLAVES) expect(huecos(EN[k] ?? ""), k).toEqual(huecos(ES[k] ?? ""));
  });

  it("ninguno está vacío y ninguno lleva comillas dobles", () => {
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t?.trim().length, k).toBeGreaterThan(0);
      expect(t, k).not.toContain('"');
    }
  });

  it("sin punto y coma, comillas angulares, rayas, punto medio ni exclamaciones", () => {
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t, k).not.toMatch(/[;«»—–·!¡]/u);
    }
  });

  it("sin palabras de juegos de azar ni palabras técnicas", () => {
    const azar = /\b(rifa|rifas|loter[ií]a|boleto|boletos|ticket|tickets|apuesta|apuestas|raffle|lottery|bet|bets)\b/iu;
    const tecnicas = /\b(archivo|json|firma|campo|formato|stellar|usdc|wallet|hash|drand|bytes)\b/iu;
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t, k).not.toMatch(azar);
      expect(t, k).not.toMatch(tecnicas);
    }
  });

  it("en inglés se dice draw y no raffle", () => {
    expect(EN.ccSorteo).toBe("Draw");
    expect(CLAVES.some((k) => /raffle/iu.test(EN[k] ?? ""))).toBe(false);
  });

  it("cerrar a más de 12 horas de abrir tiene su propio aviso, que no habla de cerrar antes de abrir", () => {
    expect(ES.ccCierraLejos).toBe("Cerrá dentro de las 12 horas de abrir.");
    expect(EN.ccCierraLejos).toBe("Close within 12 hours of opening.");
  });

  it("los rótulos de abrir y cerrar dicen que es el rato en que la gente se anota", () => {
    expect(ES.ccAbre).toBe("Se anotan desde");
    expect(ES.ccCierra).toBe("Hasta");
    expect(EN.ccAbre).toBe("Sign-up opens");
    expect(EN.ccCierra).toBe("Until");
  });

  it("el último paso dice que hay que mandarla y que todavía no está activa", () => {
    expect(ES.ccPaso6).toBe("Mandala a Tinkazo");
    expect(EN.ccPaso6).toBe("Send it to Tinkazo");
    expect(ES.ccListoLinea).toBe("Todavía no está activa. Mandala antes de las {abre} y te la activamos.");
    expect(EN.ccListoLinea).toBe("It isn't live yet. Send it before {abre} and we'll activate it.");
    expect(ES.ccDescargada).toBe("Listo. Mandásela a Tinkazo para que la active.");
    expect(EN.ccDescargada).toBe("Done. Send it to Tinkazo so we can activate it.");
  });

  it("ninguna clave cc la define otro diccionario con otro texto", () => {
    for (const k of CLAVES) {
      expect(k in TEXTOS_CAMPANA.es, k).toBe(false);
      expect(k in TEXTOS_SALA_CAMPANA.es, k).toBe(false);
      expect(T.es[k], k).toBe(ES[k]);
      expect(T.en[k], k).toBe(EN[k]);
    }
  });

  it("toda cadena cc del código de la página existe en el diccionario y ninguna se arma con plantilla", () => {
    const faltantes: string[] = [];
    const conPlantilla: string[] = [];
    for (const archivo of archivosDeLaPagina()) {
      const codigo = readFileSync(archivo, "utf8");
      if (/`cc[A-Z]/u.test(codigo)) conPlantilla.push(archivo);
      for (const m of codigo.matchAll(/(["'])(cc[A-Z][A-Za-z0-9]*)\1/gu)) {
        if (!((m[2] ?? "") in ES)) faltantes.push(`${archivo}: ${m[2]}`);
      }
    }
    expect(faltantes).toEqual([]);
    expect(conPlantilla).toEqual([]);
  });

  it("las líneas de lo que falta caben en un renglón de celular, 60 caracteres o menos", () => {
    const lineas = CLAVES.filter((k) => /^cc(Falta|Corregi|Enlace|BasesLargas|SorteoLejos|Demasiado|NoSalio|NoEsCampana)/u.test(k));
    expect(lineas.length).toBeGreaterThan(8);
    for (const k of lineas) for (const t of [ES[k], EN[k]]) expect(t?.length, k).toBeLessThanOrEqual(60);
  });

  it("el español pasa el glosario de español neutral, la misma lista que pnpm check:glosario", async () => {
    const ruta = "../../scripts/lib/glosario.mjs";
    const lib = (await import(/* @vite-ignore */ ruta)) as {
      compilar: (g: unknown) => unknown[];
      buscarFaltas: (t: { texto: string; linea: number }[], e: unknown[], n?: string[]) => { estado: string; encontrada: string }[];
    };
    const glosario = JSON.parse(readFileSync("scripts/lib/glosario-neutral.json", "utf8")) as { nombresDeJuegos?: string[] };
    const entradas = lib.compilar(glosario);
    const hallazgos = CLAVES.flatMap((k, i) =>
      lib
        .buscarFaltas([{ texto: ES[k] ?? "", linea: i + 1 }], entradas, glosario.nombresDeJuegos ?? [])
        .filter((f) => f.estado !== "avisar")
        .map((f) => `${k}: ${f.encontrada}`),
    );
    expect(hallazgos).toEqual([]);
  });

  it("el único correo que aparece es el de contacto de Tinkazo", () => {
    for (const k of CLAVES) {
      for (const c of ES[k]?.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu) ?? []) expect(c, k).toBe("hola@tinkazo.app");
    }
  });

  it("los términos dicen, en los dos idiomas, que la campaña que armás queda en este navegador y cómo se borra", () => {
    const frase = "la campaña que estás armando en la página para armar campañas, que se borra con Empezar de nuevo";
    expect(String(T.es.tmQ4B)).toContain(frase);
    expect(String(T.en.tmQ4B)).toContain("the campaign you are putting together on the campaign page, which is cleared with Start over");
    expect(readFileSync("terminos.html", "utf8")).toContain(frase);
  });
});
