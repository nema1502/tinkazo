import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { olvidarMemoria } from "../enlace-corto";
import type { SorteoDelEvento } from "../protocol/evento";
import { PROOF_VERSION, type Proof } from "../protocol/proof";
import { fotoDeEvento, fotoDeSorteo, lineasDeEvento, mensajeDeEvento, mensajeDeSorteo, paqueteDeEvento, prepararEvento } from "./compartir";

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const corto = "https://tinkazo.app/c/Ab3dE6gH#AAAAAAAAAAAAAAAAAAAAAA";
const BASE = "https://tinkazo.app";
const lista = (lang: "es" | "en", nombres: string[]): string =>
  new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);

describe("mensaje del sorteo: el mismo que el de la pantalla del sorteo", () => {
  const casos = [
    { ganadores: ["Ana"], premio: "Pizza" },
    { ganadores: ["Ana"], premio: "" },
    { ganadores: ["Ana", "Beto"], premio: "Pizza" },
    { ganadores: ["Ana", "Beto", "Carla"], premio: "" },
  ];
  for (const lang of ["es", "en"] as const) {
    for (const c of casos) {
      it(`${lang}: ${c.ganadores.length} ganador(es), premio "${c.premio}", palabra por palabra igual a T.${lang}.summary`, () => {
        const varios = c.ganadores.length > 1;
        const esperado = T[lang].summary(lista(lang, c.ganadores), 12, c.premio, enlace, varios);
        expect(mensajeDeSorteo(lang, { ganadores: c.ganadores, total: 12, premio: c.premio, enlace })).toBe(esperado);
      });
    }
  }

  it("con el enlace corto, el mensaje lleva el corto y no el largo", () => {
    const m = mensajeDeSorteo("es", { ganadores: ["Ana"], total: 12, premio: "Pizza", enlace: corto });
    expect(m).toContain(`entrá acá: ${corto}`);
    expect(m).not.toContain("verificar.html");
  });
});

/** Dos sorteos del evento: uno con premio y otro sin, con dos ganadores. */
const deEvento = [
  { prize: "Polera", ganadores: ["Gabriela Flores"] },
  { prize: "", ganadores: ["Ana", "Beto"] },
];

describe("mensaje del evento: dice quién ganó qué (D15), igual que summaryEvento", () => {
  it("un renglón por sorteo: el premio, o Sorteo, y quién ganó", () => {
    expect(lineasDeEvento("es", deEvento)).toEqual(["Polera: Gabriela Flores", "Sorteo: Ana y Beto"]);
    expect(lineasDeEvento("en", deEvento)).toEqual(["Polera: Gabriela Flores", "Draw: Ana and Beto"]);
  });

  it("es: con el nombre por defecto y uno o varios sorteos, igual a summaryEvento", () => {
    for (const n of [1, 3]) {
      const lineas = lineasDeEvento("es", deEvento.slice(0, Math.min(n, 2)));
      expect(mensajeDeEvento("es", { titulo: "Sorteos del 20 de octubre de 2026", sorteos: n, enlaces: enlace, lineas })).toBe(
        T.es.summaryEvento("20 de octubre de 2026", n, enlace, lineas),
      );
    }
  });

  it("en: igual a summaryEvento", () => {
    for (const n of [1, 3]) {
      const lineas = lineasDeEvento("en", deEvento.slice(0, Math.min(n, 2)));
      expect(mensajeDeEvento("en", { titulo: "Draws from October 20, 2026", sorteos: n, enlaces: enlace, lineas })).toBe(
        T.en.summaryEvento("October 20, 2026", n, enlace, lineas),
      );
    }
  });

  it("en el orden en que salieron, no en el que se sumaron (hallazgo 10)", () => {
    const sumados = [
      { prize: "Libro", ganadores: ["Carla Choque"], id: "753", sealedAt: 2 },
      { prize: "Termo", ganadores: ["Inés Gutiérrez"], id: "750", sealedAt: 1 },
    ];
    expect(lineasDeEvento("es", sumados)).toEqual(["Termo: Inés Gutiérrez", "Libro: Carla Choque"]);
    const f = fotoDeEvento("es", "Meetup", [{ ...sorteoGrande(2, 3), id: "753" }, { ...sorteoGrande(1, 3), id: "750" }], corto);
    expect(f.filas?.map((x) => x.premio)).toEqual(["Premio 1", "Premio 2"]);
  });

  it("los renglones van entre la cabecera y el enlace", () => {
    const m = mensajeDeEvento("es", { titulo: "Meetup Cochabamba", sorteos: 2, enlaces: enlace, lineas: lineasDeEvento("es", deEvento) });
    expect(m).toBe(
      `Meetup Cochabamba (2 sorteos), todos verificables.\nPolera: Gabriela Flores\nSorteo: Ana y Beto\nSi querés verificarlos, entrá acá:\n${enlace}\n\nSorteado con Tinkazo · https://tinkazo.app`,
    );
  });

  it("con un solo sorteo dice verificable, no todos, y verificarlo", () => {
    const es = mensajeDeEvento("es", { titulo: "Meetup", sorteos: 1, enlaces: enlace, lineas: ["Polera: Ana"] });
    expect(es.startsWith("Meetup (1 sorteo), verificable.\nPolera: Ana\nSi querés verificarlo, entrá acá:\n")).toBe(true);
    const en = mensajeDeEvento("en", { titulo: "Meetup", sorteos: 1, enlaces: enlace, lineas: ["Polera: Ana"] });
    expect(en.startsWith("Meetup (1 draw), verifiable.\nPolera: Ana\nIf you want to verify it, open this link:\n")).toBe(true);
  });
});

/**
 * Un comprobante de tamaño real. Los nombres salen de letras pseudoaleatorias
 * (fijas, para que la prueba sea reproducible): con secuencias numéricas el
 * enlace comprime demasiado y no pasa el presupuesto de una parte.
 */
function sorteoGrande(i: number, personas: number): SorteoDelEvento {
  let x = 7919 * (i + 1);
  const letra = (): string => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return "abcdefghijklmnopqrstuvwxyz"[(x >>> 16) % 26] as string;
  };
  const names = Array.from({ length: personas }, () => Array.from({ length: 12 }, letra).join(""));
  const comprobante: Proof = { v: PROOF_VERSION, names, round: 32_000_000 + i, prize: `Premio ${i}`, signature: "ab".repeat(48), sealedAt: 1_792_500_000 + i };
  return { ...comprobante, ganadores: [names[0] as string] };
}

/** Las pruebas que arman enlaces comprimen; bajo carga de la suite entera pasan de los cinco segundos por defecto. */
const LENTA = 30_000;

describe("evento en las partes de siempre: títulos, enlaces y mensaje", () => {
  // Doce sorteos de 120 personas pasan de sobra el presupuesto de un enlace: se parten en varias partes.
  const sorteos = Array.from({ length: 12 }, (_, i) => sorteoGrande(i + 1, 120));

  it("es: cada parte dice cuál es, y el mensaje trae todos los enlaces y quién ganó qué", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "es", BASE);
    expect(r).not.toBeNull();
    const partes = r?.partes ?? [];
    expect(partes.length).toBeGreaterThan(1);
    partes.forEach((p, i) => {
      expect(p.titulo).toBe(`Meetup · Parte ${i + 1} de ${partes.length}`);
      expect(p.enlace.startsWith(`${BASE}/evento.html#`)).toBe(true);
      expect(r?.mensaje).toContain(`Parte ${i + 1} de ${partes.length}: ${p.enlace}`);
    });
    // Cada parte lleva sus sorteos, y entre todas, todos.
    expect(partes.flatMap((p) => p.sorteos)).toEqual(sorteos);
    expect(r?.mensaje.startsWith(`Meetup (${sorteos.length} sorteos), todos verificables.\nPremio 1: `)).toBe(true);
    expect(r?.mensaje).toContain(`Premio 12: ${sorteos[11]?.ganadores[0]}`);
  }, LENTA);

  it("en: el título de cada parte dice Part x of y", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "en", BASE);
    const n = r?.partes.length ?? 0;
    expect(n).toBeGreaterThan(1);
    expect(r?.partes[0]?.titulo).toBe(`Meetup · Part 1 of ${n}`);
    expect(r?.mensaje).toContain(`Part ${n} of ${n}: `);
  }, LENTA);

  it("un evento chico es un solo enlace, con el nombre tal cual y sin 'Parte'", async () => {
    const r = await paqueteDeEvento("Meetup", [sorteoGrande(1, 3)], "es", BASE);
    expect(r?.partes).toHaveLength(1);
    expect(r?.partes[0]?.titulo).toBe("Meetup");
    expect(r?.mensaje).not.toContain("Parte");
    expect(r?.mensaje).toContain(r?.partes[0]?.enlace ?? "");
  }, LENTA);

  it("sin sorteos no hay paquete", async () => {
    expect(await paqueteDeEvento("Meetup", [], "es", BASE)).toBeNull();
  });
});

/** Un `localStorage` de mentira, y el servicio de enlaces cortos en memoria. */
function conServicio(responde: "bien" | "caido"): { posts: () => number } {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  vi.stubGlobal("location", { origin: BASE });
  let posts = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (responde === "caido") throw new TypeError("Failed to fetch");
    if (init?.method === "POST") posts++;
    return new Response(JSON.stringify({ id: `Ev${String(posts).padStart(6, "0")}`, borrar: "permiso" }), { status: 201 });
  });
  olvidarMemoria();
  return { posts: () => posts };
}

describe("evento con enlace corto: entero, en un solo enlace y una sola foto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    olvidarMemoria();
  });
  const sorteos = Array.from({ length: 12 }, (_, i) => sorteoGrande(i + 1, 120));

  it("si sale el corto, un solo enlace corto, sin partes, con quién ganó qué y una sola foto con ese QR", async () => {
    const s = conServicio("bien");
    const r = await prepararEvento("Meetup", sorteos, "es", { base: BASE });
    expect(s.posts()).toBe(1);
    expect(r.corto).toBe(true);
    expect(r.fotos).toHaveLength(1);
    expect(r.nota).toBeUndefined();
    expect(r.fotos[0]?.enlace).toMatch(/^https:\/\/tinkazo\.app\/c\/Ev\d{6}#[A-Za-z0-9_-]{22}$/);
    expect(r.mensaje).toContain(`entrá acá:\n${r.fotos[0]?.enlace}\n`);
    expect(r.mensaje).not.toContain("Parte");
    expect(r.mensaje).not.toContain("evento.html");
    expect(r.mensaje).toContain("Premio 3: ");
  }, LENTA);

  it("si el servicio no contesta, las partes de siempre, una foto por parte y la nota", async () => {
    conServicio("caido");
    const r = await prepararEvento("Meetup", sorteos, "es", { base: BASE });
    expect(r.corto).toBe(false);
    expect(r.fotos.length).toBeGreaterThan(1);
    expect(r.nota).toContain(`${r.fotos.length} enlaces`);
    r.fotos.forEach((f, i) => expect(f.titulo).toBe(`Meetup · Parte ${i + 1} de ${r.fotos.length}`));
    expect(r.mensaje).toContain("Parte 1 de");
  }, LENTA);

  it("sin corto pedido (la demo), ni siquiera lo intenta", async () => {
    const s = conServicio("bien");
    const r = await prepararEvento("Meetup", [sorteoGrande(1, 3)], "es", { base: BASE, corto: false });
    expect(s.posts()).toBe(0);
    expect(r.corto).toBe(false);
    expect(r.fotos[0]?.enlace.startsWith(`${BASE}/evento.html#`)).toBe(true);
  }, LENTA);
});

describe("lo que va en la foto", () => {
  it("un sorteo anclado en la red de prueba: número, red y fecha arriba; ganó, el premio y entre cuántos", () => {
    const f = fotoDeSorteo("es", { enlace, ganadores: ["Ana"], total: 18, premio: "Polera", fecha: 1_792_600_000, numero: "278", red: "testnet" }, corto);
    expect(f.rotulo).toMatch(/^Sorteo #278 · red de prueba · \d{1,2} de [a-z]+ de 2026$/);
    expect(f.titulo).toBe("Ganó");
    expect(f.personas).toEqual(["Ana"]);
    expect(f.lineas).toEqual(["Se lleva: Polera", "Salió entre 18 personas"]);
    expect(f.enlace).toBe(corto);
    expect(f.escanear).toBe("Escaneá para comprobarlo");
  });

  it("en inglés, varios ganadores y sin anclar: el rótulo es el de siempre", () => {
    const f = fotoDeSorteo("en", { enlace, ganadores: ["Ana", "Beto", "Carla"], total: 50, premio: "" }, enlace);
    expect(f.rotulo).toBe("Draw result");
    expect(f.titulo).toBe("Winners");
    expect(f.lineas).toEqual(["Drawn from 50 people"]);
    expect(f.escanear).toBe("Scan to check it");
    expect(f.mas).toBe("and {n} more");
  });

  it("un sorteo comprobado con el historial de Stellar no trae número, pero en testnet sigue diciendo red de prueba", () => {
    const f = fotoDeSorteo("es", { enlace, ganadores: ["Ana"], total: 18, premio: "", fecha: 1_792_600_000, red: "testnet" }, enlace);
    expect(f.rotulo).toMatch(/^Resultado del sorteo · red de prueba · \d{1,2} de [a-z]+ de 2026$/);
    expect(fotoDeSorteo("es", { enlace, ganadores: ["Ana"], total: 18, premio: "", red: "mainnet" }, enlace).rotulo).toBe("Resultado del sorteo");
  });

  it("en la red principal no dice red de prueba", () => {
    const f = fotoDeSorteo("es", { enlace, ganadores: ["Ana"], total: 5, premio: "", numero: "9", red: "mainnet" }, enlace);
    expect(f.rotulo).toBe("Sorteo #9");
  });

  it("un evento: su nombre, cuántos sorteos y un renglón por sorteo", () => {
    const f = fotoDeEvento("es", "Meetup", [sorteoGrande(1, 3), { ...sorteoGrande(2, 3), prize: "" }], corto);
    expect(f.titulo).toBe("Meetup");
    expect(f.sub).toBe("2 sorteos");
    expect(f.filas?.[0]?.premio).toBe("Premio 1");
    expect(f.filas?.[1]?.premio).toBe("Sorteo");
    expect(f.rotulo.startsWith("Evento · ")).toBe(true);
  });

  it("un evento: si no entran todos los ganadores, la foto tiene los primeros enteros y cuántos más, nunca un nombre a medias", () => {
    const tres = { ...sorteoGrande(1, 3), ganadores: ["Elena Condori", "Sofía Aguilar", "Pablo Gutiérrez"] };
    const es = fotoDeEvento("es", "Meetup", [tres], corto);
    expect(es.filas?.[0]?.ganadores).toBe("Elena Condori, Sofía Aguilar y Pablo Gutiérrez");
    expect(es.filas?.[0]?.cortos).toEqual(["Elena Condori, Sofía Aguilar y 1 más", "Elena Condori y 2 más"]);
    const en = fotoDeEvento("en", "Meetup", [tres], corto);
    expect(en.filas?.[0]?.cortos).toEqual(["Elena Condori, Sofía Aguilar, and 1 more", "Elena Condori and 2 more"]);
    // Con uno solo no hay nada que acortar.
    expect(fotoDeEvento("es", "Meetup", [sorteoGrande(2, 3)], corto).filas?.[0]?.cortos).toEqual([]);
  });
});

/** Los textos de la página del enlace corto (c.html). */
const DE_C = ["cTitulo", "cDesc", "cKicker", "cAbriendo", "cAbriendoB", "cRedT", "cRedB", "cNoExisteT", "cNoExisteB", "cRotoT", "cRotoB", "cOtraVez", "cPortada"];

describe("textos nuevos de compartir y de eventos", () => {
  const codigo = readFileSync("src/ui/compartir.ts", "utf8");
  const usadas = [...codigo.matchAll(/cad\(\s*\w+,\s*"(\w+)"\s*\)/g)].map((m) => m[1] as string);
  const marcas = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

  it("cada clave que pide compartir.ts existe en español y en inglés", () => {
    expect(usadas.length).toBeGreaterThan(15);
    const faltan = usadas.filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string");
    expect(faltan).toEqual([]);
  });

  it("las claves de los dos lados de un ternario también existen en los dos idiomas", () => {
    const ternarias = [...codigo.matchAll(/\?\s*"(\w+)"\s*:\s*"(\w+)"/g)].flatMap((m) => [m[1] as string, m[2] as string]);
    expect(ternarias.length).toBeGreaterThan(5);
    const faltan = ternarias.filter((k) => /^[a-z]+[A-Z]/.test(k) && (typeof T.es[k] !== "string" || typeof T.en[k] !== "string"));
    expect(faltan).toEqual([]);
  });

  it("los textos de compartir, de la foto y de Mis eventos tienen las mismas marcas en los dos idiomas", () => {
    const claves = Object.keys(T.es).filter((k) => /^(cmp|evn|foto)/.test(k) || DE_C.includes(k) || k === "vCompartir");
    expect(claves.length).toBeGreaterThan(50);
    const distintas = claves.filter((k) => JSON.stringify(marcas(String(T.es[k]))) !== JSON.stringify(marcas(String(T.en[k]))));
    expect(distintas).toEqual([]);
  });

  it("ningún texto nuevo para la sala dice rifa, boleto, lotería, hash ni cifrado", () => {
    const claves = Object.keys(T.es).filter((k) => /^(cmp|evn|foto)/.test(k) || DE_C.includes(k));
    const prohibidas = /rifa|boleto|lotería|loteria|casino|hash|firma|drand|cifra|encrypt|aes\b|raffle|ticket/i;
    for (const k of claves) {
      expect(String(T.es[k])).not.toMatch(prohibidas);
      expect(String(T.en[k])).not.toMatch(prohibidas);
    }
  });
});

describe("el enlace corto no se borra desde la interfaz (21 de octubre de 2026)", () => {
  // Borrarlo cortaba la verificación de todos los que ya lo tenían (el grupo, la
  // foto, el proyector), podía parecer que se escondía un resultado y se tocaba
  // sin querer. Si hace falta, se pide a hola@tinkazo.app y lo borra Tinkazo.
  const cadenas = (l: "es" | "en"): string[] => Object.values(T[l]).filter((v): v is string => typeof v === "string");

  it("Mis sorteos no tiene botones para borrar enlaces cortos", () => {
    expect(readFileSync("index.html", "utf8")).not.toMatch(/btn-hist-cortos/);
    expect(readFileSync("src/ui/history.ts", "utf8")).not.toMatch(/data-borrar-corto|borrarCorto|borrarTodos/);
  });

  it("ningún texto promete borrarlo por cuenta propia", () => {
    expect(cadenas("es").filter((v) => /Borrar (el|los) enlaces? cortos?|La borrás|borres desde Mis sorteos/.test(v))).toEqual([]);
    expect(cadenas("en").filter((v) => /Delete the short links?|delete it from My draws/i.test(v))).toEqual([]);
  });

  it.each(["cmpPrivBorrar", "histWhy", "cfG5b", "tmCortoB", "sgLimitCorto", "clasePrivB"])(
    "%s dice a quién pedirle que lo borre, en los dos idiomas",
    (clave) => {
      expect(T.es[clave]).toContain("hola@tinkazo.app");
      expect(T.en[clave]).toContain("hola@tinkazo.app");
    },
  );
});
