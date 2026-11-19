import { describe, expect, it } from "vitest";
import { GEO, planEscanearArriba, planLista, type Caja, type EntradaLista, type Medida, type PlanLista, type Texto } from "./foto-lista";

/**
 * El plan de la lista de ganadores de la foto del juego (`foto-lista.ts`), puro y sin lienzo, con una medida fija. La
 * "real" se parece a la letra del navegador (0,56 del tamaño por letra en negrita fuerte, 0,52 en lo demás y 0,55 en la
 * monoespaciada: "Beto Choque" en 40 px mide 246). La "ancha" mide un 16 % más que ella: con letra más ancha (otro teléfono,
 * otro idioma) las reglas valen igual, y los nombres se parten más.
 *
 * Lo que tiene que cumplir con cualquier cantidad de ganadores, en español y en inglés, con y sin QR:
 * - ningún panel pisa la ventana del arte (y 236 a 540), ni la tarjeta del QR, ni otro panel, con sus sombras;
 * - todo texto y toda cara quedan adentro de su panel, con su aire;
 * - los nombres que se ven van enteros y en orden, y son lo más grande del medio;
 * - si faltan nombres, "y N más" (N de dos o más) y la frase de dónde está la lista completa; si no, ninguna de las dos.
 */

const por = (negrita: number, resto: number, mono: number): Medida => (peso, tam, t) => Array.from(t).length * tam * (peso === "mono" ? mono : peso === 900 || peso === 800 ? negrita : resto);
const medir = por(0.56, 0.52, 0.55);
const medirAncha = por(0.65, 0.6, 0.6);

const TEXTOS = {
  es: {
    titulo: "Ganaron", turnos: "Orden de turnos", mas: "y {n} más", escanear: "Escaneá para comprobarlo", escanearSin: "Escaneá para ver la lista y la cuenta",
    frase: "La lista completa está en el QR.", fraseOrden: "El orden completo está en el QR.", fraseMsj: "La lista completa está en el mensaje.", fraseOrdenMsj: "El orden completo está en el mensaje.",
    premio: "Premio: Entradas al concierto", entre: (n: number) => `Salieron entre ${n} personas`, turnosLinea: (n: number) => `${n} personas, turnos del 1 al ${n}`, sinSello: "Sin sello: no se puede comprobar.",
  },
  en: {
    titulo: "Winners", turnos: "Turn order", mas: "and {n} more", escanear: "Scan to check it", escanearSin: "Scan to see the list and the math",
    frase: "The full list is in the QR code.", fraseOrden: "The full order is in the QR code.", fraseMsj: "The full list is in the message.", fraseOrdenMsj: "The full order is in the message.",
    premio: "Prize: Concert tickets", entre: (n: number) => `Drawn from ${n} people`, turnosLinea: (n: number) => `${n} people, turns 1 to ${n}`, sinSello: "No seal: it can't be checked.",
  },
} as const;

const BASE = [
  "Ana Quispe", "Beto Choque", "Nora Vargas", "Maximiliano Gutiérrez", "Luz Mamani", "Carla Rojas", "Diego Flores", "Elena Cruz", "Franco Vaca", "Gabriela Soliz",
  "Hugo Mendoza", "Irene Justiniano", "Julio Paz", "Karen Rocha", "Leonardo Aguilar", "Mónica Salazar", "Nicanor Torrez", "Olga Céspedes", "Pablo Villca", "Rosa Condori",
];
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => BASE[i] ?? `Persona ${i + 1}`);
const LARGO = "María Fernanda Quispe Mamani";

/** Una entrada como la arma `foto.ts` desde `fotoDeSorteo`: la frase de dónde está la lista según haya QR. */
function entrada(n: number | string[], lang: "es" | "en" = "es", extra: Partial<EntradaLista> & { turnos?: boolean; sinSello?: boolean } = {}): EntradaLista {
  const t = TEXTOS[lang];
  const lista = typeof n === "number" ? nombres(n) : n;
  const { turnos, sinSello, ...resto } = extra;
  const conQr = resto.conQr ?? true;
  return {
    medir,
    titulo: turnos ? t.turnos : t.titulo,
    nombres: lista,
    lineas: turnos ? [t.turnosLinea(lista.length)] : [t.premio, t.entre(lista.length * 4), ...(sinSello ? [t.sinSello] : [])],
    mas: t.mas,
    frase: turnos ? (conQr ? t.fraseOrden : t.fraseOrdenMsj) : conQr ? t.frase : t.fraseMsj,
    escanear: sinSello ? t.escanearSin : t.escanear,
    conQr,
    altoA: 437,
    ...resto,
  };
}

/* ------------------------------------------------------------- lo que se mira de un plan */

const QR_TARJETA: Caja = { x: GEO.QR_X, y: GEO.QR_Y, w: GEO.QR_LADO, h: GEO.QR_LADO };
const SIN_QR_TARJETA: Caja = { x: GEO.M, y: GEO.SIN_QR_Y, w: GEO.W - 2 * GEO.M, h: GEO.SIN_QR_ALTO };
/** La caja con su sombra dura de 12 px abajo a la derecha. */
const conSombra = (c: Caja, s = 12): Caja => ({ x: c.x, y: c.y, w: c.w + s, h: c.h + s });
const seCruzan = (a: Caja, b: Caja): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dentro = (c: Caja, p: Caja): boolean => c.x >= p.x + GEO.LADO - 1 && c.x + c.w <= p.x + p.w - GEO.LADO + 1 && c.y >= p.y + GEO.AIRE - 1 && c.y + c.h <= p.y + p.h - GEO.AIRE + 1;

function paneles(p: PlanLista): Caja[] {
  return [p.panel, ...(p.escanear ? [p.escanear.panel] : [])];
}

/** Todos los textos del panel de la lista. */
function textosDeLista(p: PlanLista): Texto[] {
  return [p.titulo, ...p.filas.flatMap((f) => [...f.nombre, f.numero]), ...(p.mas ? [p.mas] : []), ...p.frase, ...p.cola];
}

/** El renglón con sus palabras unidas por un espacio (sin partir palabras). */
const nombreDe = (f: PlanLista["filas"][number]): string => f.nombre.map((r) => r.t).join(" ");

/** Todo lo que no puede fallar con ningún plan. */
function reglasDeOro(p: PlanLista, conQr: boolean, etiqueta: string): void {
  const ps = paneles(p);
  for (const c of ps) {
    // La ventana del arte queda libre siempre: ningún panel del medio sube de 556.
    expect(c.y, `${etiqueta}: panel arriba de 556`).toBeGreaterThanOrEqual(GEO.FRANJA_ARRIBA);
    expect(seCruzan(conSombra(c), { x: 0, y: GEO.ARTE_ARRIBA, w: GEO.W, h: GEO.ARTE_ABAJO - GEO.ARTE_ARRIBA }), `${etiqueta}: pisa el arte`).toBe(false);
    // Entra en la foto, con su sombra.
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w + 12, `${etiqueta}: pasa del borde derecho`).toBeLessThanOrEqual(GEO.W);
    // Ni la tarjeta del QR (con su sombra de 14), ni la tarjeta que la reemplaza, ni otro panel.
    if (conQr) expect(seCruzan(conSombra(c), conSombra(QR_TARJETA, 14)), `${etiqueta}: pisa la tarjeta del QR`).toBe(false);
    else expect(seCruzan(conSombra(c), SIN_QR_TARJETA), `${etiqueta}: pisa la tarjeta de abajo`).toBe(false);
  }
  if (ps.length === 2) expect(seCruzan(conSombra(ps[0] as Caja), conSombra(ps[1] as Caja)), `${etiqueta}: los paneles se pisan`).toBe(false);
  // Todo texto y toda cara, adentro de su panel, con su aire.
  for (const t of textosDeLista(p)) expect(dentro(t.caja, p.panel), `${etiqueta}: "${t.t}" se sale de su panel`).toBe(true);
  for (const f of p.filas) {
    expect(dentro(f.cara, p.panel), `${etiqueta}: la cara de ${f.k} se sale`).toBe(true);
    // El número no pisa al nombre.
    const nombreDerecha = Math.max(...f.nombre.map((r) => r.caja.x + r.caja.w));
    if (!f.numero.derecha) continue;
    expect(f.numero.caja.x, `${etiqueta}: el número pisa el nombre de ${f.k}`).toBeGreaterThanOrEqual(nombreDerecha);
  }
  if (p.escanear) {
    for (const t of p.escanear.texto) expect(dentro(t.caja, p.escanear.panel), `${etiqueta}: Escaneá se sale`).toBe(true);
    const d = p.escanear.dominio;
    expect(dentro({ x: d.x, y: d.y, w: d.w, h: d.h }, p.escanear.panel), `${etiqueta}: la calcomanía se sale`).toBe(true);
    const ultimo = p.escanear.texto[p.escanear.texto.length - 1] as Texto;
    expect(d.y, `${etiqueta}: la calcomanía pisa Escaneá`).toBeGreaterThanOrEqual(ultimo.caja.y + ultimo.caja.h);
  }
  // Las filas no se pisan entre sí en la misma columna.
  for (const a of p.filas) for (const b of p.filas) if (a.k < b.k) expect(seCruzan(a.caja, b.caja), `${etiqueta}: las filas ${a.k} y ${b.k} se pisan`).toBe(false);
  // Los nombres son lo más grande del medio: más que el título, que "y N más", que la frase, que el premio, que Escaneá y que la calcomanía.
  const nombresTam = p.letra;
  for (const t of [p.titulo, ...(p.mas ? [p.mas] : []), ...p.frase, ...p.cola, ...(p.escanear?.texto ?? [])]) expect(t.tam, `${etiqueta}: "${t.t}" no es más chico que los nombres`).toBeLessThan(nombresTam);
  if (p.escanear) expect(p.escanear.dominio.tam).toBeLessThan(nombresTam);
  for (const f of p.filas) expect(f.numero.tam).toBeLessThan(nombresTam);
  expect(nombresTam).toBeGreaterThanOrEqual(36);
  // "y N más" y la frase solo cuando faltan, y N de dos o más.
  expect(p.vistos + p.faltan).toBe(p.total);
  expect(p.filas).toHaveLength(p.vistos);
  if (p.faltan > 0) {
    expect(p.faltan, `${etiqueta}: nunca "y 1 más"`).toBeGreaterThanOrEqual(2);
    expect(p.mas?.t).toContain(String(p.faltan));
    expect(p.frase.length).toBeGreaterThan(0);
  } else {
    expect(p.mas).toBeNull();
    expect(p.frase).toEqual([]);
  }
}

/* ------------------------------------------------------------- la matriz del encargo */

type Caso = { id: string; n: number; extra?: Parameters<typeof entrada>[2] };
const CANTIDADES = [2, 3, 4, 5, 8, 12, 20, 50, 300];
const CASOS: Caso[] = [
  ...CANTIDADES.map((n) => ({ id: `${n} ganadores`, n })),
  { id: "un orden de turnos de 5", n: 5, extra: { turnos: true } },
  { id: "un orden de turnos de 18", n: 18, extra: { turnos: true } },
  { id: "un orden de turnos de 300", n: 300, extra: { turnos: true } },
  { id: "sin sello, 12", n: 12, extra: { sinSello: true } },
];

describe.each([["real", medir], ["ancha", medirAncha]] as const)("las reglas de oro con la medida %s, con cualquier cantidad de ganadores, en los dos idiomas", (_m, med) => {
  for (const lang of ["es", "en"] as const) {
    for (const conQr of [true, false]) {
      for (const c of CASOS) {
        it(`${lang}, ${conQr ? "con QR" : "sin QR"}: ${c.id}`, () => {
          const p = planLista(entrada(c.n, lang, { ...c.extra, conQr, medir: med }));
          reglasDeOro(p, conQr, `${lang} ${c.id}`);
          // Con QR, A o B; sin QR, N. Nunca sube del renglón 556 (lo mira reglasDeOro).
          if (conQr) expect(["A", "B"]).toContain(p.arreglo);
          else expect(p.arreglo).toBe("N");
          // Los que se ven, enteros y en orden.
          p.filas.forEach((f, i) => {
            expect(f.k).toBe(i);
            expect(nombreDe(f)).toBe(nombres(c.n)[i]);
            expect(f.numero.t).toBe(`#${i + 1}`);
          });
        });
      }
    }
  }
});

describe("qué arreglo y cuántos nombres, con la letra de la prueba", () => {
  it("dos y tres ganadores van en la columna, encima de Escaneá, con todos los nombres", () => {
    for (const n of [2, 3]) {
      const p = planLista(entrada(n));
      expect(p.arreglo).toBe("A");
      expect(p.vistos).toBe(n);
      expect(p.faltan).toBe(0);
      expect(p.letra).toBeGreaterThanOrEqual(40);
      expect(p.escanear).toBeNull();
      expect(p.panel).toMatchObject({ x: 56, y: 556, w: 472 });
    }
  });

  it("de cuatro a ocho ganadores se ven todos, con 36 o más de letra", () => {
    for (const n of [4, 5, 8]) {
      const p = planLista(entrada(n));
      expect(p.vistos, `${n}`).toBe(n);
      expect(p.faltan).toBe(0);
      expect(p.letra).toBeGreaterThanOrEqual(36);
    }
  });

  it("B: el panel de Escaneá arriba de la tarjeta del QR, 544 a 996 y 556 a 800", () => {
    const p = planLista(entrada(5));
    expect(p.arreglo).toBe("B");
    expect(p.escanear?.panel).toEqual({ x: 544, y: 556, w: 452, h: 244 });
    // La columna de la lista llega hasta el pie de la tarjeta del QR como mucho.
    expect(p.panel.y + p.panel.h).toBeLessThanOrEqual(1268);
  });

  it.each([9, 12, 20, 50, 300])("con %i ganadores: los primeros con letra de 40, 'y N más' y la frase del QR", (n) => {
    const p = planLista(entrada(n));
    expect(p.arreglo).toBe("B");
    expect(p.letra).toBe(40);
    expect(p.vistos).toBeGreaterThanOrEqual(4);
    expect(p.vistos).toBeLessThan(n);
    expect(p.faltan).toBe(n - p.vistos);
    expect(p.mas?.t).toBe(`y ${n - p.vistos} más`);
    expect(p.frase.map((l) => l.t).join(" ")).toBe("La lista completa está en el QR.");
    expect(p.frase.every((l) => l.color === "amarillo")).toBe(true);
  });

  it("un orden de turnos dice 'El orden completo' y su título", () => {
    const p = planLista(entrada(18, "es", { turnos: true }));
    expect(p.titulo.t).toBe("Orden de turnos");
    expect(p.frase.map((l) => l.t).join(" ")).toBe("El orden completo está en el QR.");
    expect(p.faltan).toBe(18 - p.vistos);
  });

  it("un orden de turnos de cinco entra entero", () => {
    const p = planLista(entrada(5, "es", { turnos: true }));
    expect(p.vistos).toBe(5);
    expect(p.faltan).toBe(0);
  });

  it("en inglés los textos nuevos son los de la frase en inglés", () => {
    const p = planLista(entrada(20, "en"));
    expect(p.mas?.t).toBe(`and ${p.faltan} more`);
    expect(p.frase.map((l) => l.t).join(" ")).toBe("The full list is in the QR code.");
  });

  it("sin QR: la lista en la franja de lado a lado, hasta 944, y la frase dice 'en el mensaje'", () => {
    const p = planLista(entrada(20, "es", { conQr: false }));
    expect(p.arreglo).toBe("N");
    expect(p.escanear).toBeNull();
    expect(p.panel.y + p.panel.h).toBeLessThanOrEqual(944);
    expect(p.frase.map((l) => l.t).join(" ")).toBe("La lista completa está en el mensaje.");
  });

  it("sin QR y con pocos ganadores: todos a la vista, en una columna o en dos", () => {
    for (const n of [2, 3, 5]) {
      const p = planLista(entrada(n, "es", { conQr: false }));
      expect(p.arreglo).toBe("N");
      expect(p.vistos).toBe(n);
    }
  });

  it("A si ahí los nombres llegan a 40; si no, B", () => {
    // Con el alto de A muy chico no entra nada: B.
    expect(planLista(entrada(5, "es", { altoA: 200 })).arreglo).toBe("B");
    // Sin lugar encima de Escaneá (0), siempre B.
    expect(planLista(entrada(2, "es", { altoA: 0 })).arreglo).toBe("B");
  });

  it("si no entra todo, la letra no baja de 40 salvo que un nombre largo lo pida", () => {
    const p = planLista(entrada(12));
    expect(p.letra).toBe(40);
  });
});

/* ------------------------------------------------------------- nombres largos */

describe("nombres largos: nunca se cortan", () => {
  const renglonesDe = (p: PlanLista, k: number): string[] => (p.filas[k] as PlanLista["filas"][number]).nombre.map((r) => r.t);

  it("María Fernanda Quispe Mamani, entera en dos renglones y sin puntos suspensivos", () => {
    const p = planLista(entrada([LARGO, "Beto Choque"]));
    reglasDeOro(p, true, "dos con uno largo");
    expect(renglonesDe(p, 0).join(" ")).toBe(LARGO);
    expect(renglonesDe(p, 0).length).toBeGreaterThanOrEqual(2);
    expect(renglonesDe(p, 0).some((r) => r.includes("…"))).toBe(false);
    expect(p.recorta).toBe(false);
  });

  it("tres, doce y cincuenta nombres largos: todos los que se ven, enteros", () => {
    for (const n of [3, 12, 50]) {
      const largos = Array.from({ length: n }, (_, i) => [LARGO, "Guadalupe Villavicencio Mamani", "Juan Carlos de la Cruz Fernández"][i % 3] as string);
      for (const lang of ["es", "en"] as const) {
        const p = planLista(entrada(largos, lang));
        reglasDeOro(p, true, `${n} largos ${lang}`);
        p.filas.forEach((f, i) => expect(nombreDe(f)).toBe(largos[i]));
        expect(p.recorta).toBe(false);
        expect(p.letra).toBeGreaterThanOrEqual(36);
      }
    }
  });

  it("una tira de 60 letras seguidas queda adentro de su panel, partida por letras y con puntos suspensivos solo al final", () => {
    for (const lista of [["A".repeat(60), "Beto Choque"], ["A".repeat(60), ...nombres(11)], nombres(2).concat(["B".repeat(60)])]) {
      const p = planLista(entrada(lista));
      reglasDeOro(p, true, "60 letras");
      for (const f of p.filas) for (const r of f.nombre.slice(0, -1)) expect(r.t).not.toContain("…");
    }
  });

  it.each([
    ["Huanca-Chuquimia", ["Huanca-", "Chuquimia"]],
    ["@maria.fernanda.qm", ["@maria.", "fernanda.qm"]],
  ])("una sola palabra de %s: se parte donde ella lo pide, sin guion de más", (nombre) => {
    for (const lista of [[nombre, "Beto Choque"], [nombre, ...nombres(4)], [nombre, ...nombres(11)]]) {
      for (const conQr of [true, false]) {
        const p = planLista(entrada(lista, "es", { conQr }));
        reglasDeOro(p, conQr, `${nombre} en ${lista.length}`);
        const fila = p.filas[0] as PlanLista["filas"][number];
        // Los renglones juntos, sin espacios, son el nombre: ninguna letra de más ni de menos.
        expect(fila.nombre.map((r) => r.t).join("")).toBe(nombre);
        expect(fila.nombre.every((r) => !r.t.endsWith("-") || nombre.includes(`${r.t}`))).toBe(true);
        expect(p.recorta).toBe(false);
      }
    }
  });

  it("el caso de siempre: Huanca-Chuquimia y un solo compañero, dos ganadores, no deja al plan sin salida", () => {
    const p = planLista(entrada(["Huanca-Chuquimia", "Beto Choque"]));
    expect(p.filas).toHaveLength(2);
    expect(p.filas[0]?.nombre.map((r) => r.t)).toEqual(["Huanca-", "Chuquimia"]);
  });

  it.each([16, 18, 20, 23])("una palabra de %i letras sin dónde partirla: todas las letras, partida con guion a la vista", (letras) => {
    const palabra = "Abcdefghijklmnopqrstuvwxyz".slice(0, letras);
    for (const lista of [[palabra, "Beto Choque"], [palabra, ...nombres(4)], [palabra, ...nombres(11)]]) {
      for (const conQr of [true, false]) {
        const p = planLista(entrada(lista, "es", { conQr }));
        reglasDeOro(p, conQr, `${letras} letras en ${lista.length}`);
        const fila = p.filas[0] as PlanLista["filas"][number];
        // Con los guiones quitados, las letras son las mismas.
        expect(fila.nombre.map((r) => r.t.replace(/-$/, "")).join("")).toBe(palabra);
        // Cada tramo que sigue a otro lleva el guion del anterior a la vista.
        fila.nombre.slice(0, -1).forEach((r) => expect(r.t.endsWith("-")).toBe(true));
      }
    }
  });

  it("un correo, partido antes de la arroba y después de los puntos", () => {
    const p = planLista(entrada(["juanperez2024@gmail.com", "Beto Choque", "Nora Vargas"]));
    reglasDeOro(p, true, "correo");
    const fila = p.filas[0] as PlanLista["filas"][number];
    expect(fila.nombre.map((r) => r.t.replace(/-$/, "")).join("")).toBe("juanperez2024@gmail.com");
    // Con la medida real, el primer tramo entra entero: se parte antes de la arroba y no por letras.
    expect(fila.nombre[0]?.t).toBe("juanperez2024");
  });

  it("quien salió más de una vez: la cuenta no se parte y el número va a la derecha o, si es ancho, debajo del nombre", () => {
    const personas = ["Ana (2 veces)", "Beto Choque", "Nora (3 veces)", "Luz Mamani", "Carla Rojas", "Diego Flores"];
    const numeros = ["#1 #4", "#2", "#3 #6 #9", "#5", "#7", "#8"];
    const p = planLista(entrada(personas, "es", { numeros }));
    reglasDeOro(p, true, "participaciones");
    expect(p.vistos).toBe(6);
    expect(p.filas.map((f) => f.numero.t)).toEqual(numeros);
    for (const f of p.filas) for (const r of f.nombre) expect(r.t).not.toMatch(/\($|^\d* ?veces\)$/);
    // Con números tan anchos, la letra de los números baja: más chica que la de los nombres.
    for (const f of p.filas) expect(f.numero.tam).toBeLessThan(p.letra * 0.75);
  });
});

/* ------------------------------------------------------------- premios largos */

/**
 * Una medida que distingue mayúsculas, dígitos y espacios, como la letra de verdad: una mayúscula en negrita mide 0,70 del
 * tamaño, una minúscula 0,52 y un espacio 0,27. Un premio escrito en mayúsculas ocupa más que uno en minúsculas.
 */
const medirMayus: Medida = (peso, tam, t) =>
  Array.from(t).reduce((n, c) => {
    if (peso === "mono") return n + tam * 0.55;
    const fuerte = peso === 900 || peso === 800;
    if (c === " ") return n + tam * 0.27;
    if (c !== c.toLowerCase() || /\d/.test(c)) return n + tam * (fuerte ? 0.74 : 0.7);
    return n + tam * (fuerte ? 0.56 : 0.52);
  }, 0);

describe("el premio no se corta: con cualquier cantidad de ganadores y de letras, entero y sin puntos suspensivos", () => {
  // El campo del premio admite 60 letras. Los tres más largos que pueden salir: con palabras largas, en mayúsculas y de corrido.
  const PREMIOS = {
    es: ["Electrodomésticos, refrigeradores y computadoras portátiles", "CANASTA NAVIDEÑA CON PANETÓN, CHOCOLATE Y VINO DE TARIJA", "Una mochila de aguayo y dos entradas para el concierto del"],
    en: ["Appliances, refrigerators and portable laptop computers", "CHRISTMAS BASKET WITH PANETTONE, CHOCOLATE AND TARIJA WINE", "A woven backpack and two tickets to the concert of the day"],
  } as const;
  const medidas = [["real", medir], ["ancha", medirAncha], ["con mayúsculas", medirMayus]] as const;

  it("los premios de la prueba caben en el campo (60 letras como mucho)", () => {
    for (const lang of ["es", "en"] as const) for (const p of PREMIOS[lang]) expect(Array.from(p).length).toBeLessThanOrEqual(60);
  });

  /** Los renglones de la cola, juntos con un espacio, son el texto de las líneas: ninguna palabra de menos. */
  const colaEntera = (p: PlanLista): string => p.cola.map((t) => t.t).join(" ");

  describe.each(medidas)("con la medida %s", (_m, med) => {
    for (const lang of ["es", "en"] as const) {
      for (const conQr of [true, false]) {
        for (const n of [2, 3, 5, 8, 12, 20, 50]) {
          it(`${lang}, ${conQr ? "con QR" : "sin QR"}, ${n} ganadores: ninguno de los tres premios largos lleva puntos suspensivos`, () => {
            for (const premio of PREMIOS[lang]) {
              const e = entrada(n, lang, { conQr, medir: med });
              const lineas = [`${lang === "es" ? "Premio" : "Prize"}: ${premio}`, ...e.lineas.slice(1)];
              const p = planLista({ ...e, lineas });
              const etiqueta = `${lang} ${conQr} ${n} ${premio}`;
              reglasDeOro(p, conQr, etiqueta);
              expect(p.recorta, `${etiqueta}: recorta`).toBe(false);
              expect(p.cola.some((t) => t.t.includes("…")), `${etiqueta}: puntos suspensivos en la cola`).toBe(false);
              expect(colaEntera(p), `${etiqueta}: la cola entera`).toBe(lineas.join(" "));
              // Los nombres que se ven, enteros y en orden: por lo menos tres con QR y dos sin él (o todos, si son menos).
              p.filas.forEach((f, i) => expect(nombreDe(f)).toBe(nombres(n)[i]));
              expect(p.vistos, `${etiqueta}: nombres que se ven`).toBeGreaterThanOrEqual(Math.min(n, conQr ? 3 : 2));
              // El premio y lo demás de la cola, nunca más chicos que 28.
              for (const t of p.cola) expect(t.tam).toBeGreaterThanOrEqual(28);
            }
          });
        }
        for (const n of [5, 18]) {
          it(`${lang}, ${conQr ? "con QR" : "sin QR"}, orden de turnos de ${n}: el nombre del orden, largo, queda entero`, () => {
            for (const nombre of PREMIOS[lang]) {
              const e = entrada(n, lang, { conQr, medir: med, turnos: true });
              const lineas = [nombre, ...e.lineas];
              const p = planLista({ ...e, lineas });
              const etiqueta = `${lang} ${conQr} turnos ${n} ${nombre}`;
              reglasDeOro(p, conQr, etiqueta);
              expect(p.recorta, `${etiqueta}: recorta`).toBe(false);
              expect(p.cola.some((t) => t.t.includes("…"))).toBe(false);
              expect(colaEntera(p)).toBe(lineas.join(" "));
              p.filas.forEach((f, i) => expect(nombreDe(f)).toBe(nombres(n)[i]));
            }
          });
        }
      }
    }
  });

  it("2 ganadores y un premio de 56 letras con la medida real: baja la letra del premio antes que cortarlo, y los nombres siguen en 40 o más", () => {
    const e = entrada(2, "es", { lineas: ["Premio: Electrodomésticos, refrigeradores y computadoras portátiles", "Salieron entre 80 personas"] });
    const p = planLista(e);
    expect(p.recorta).toBe(false);
    expect(colaEntera(p)).toBe(e.lineas.join(" "));
    expect(p.letra).toBeGreaterThanOrEqual(40);
    // El premio no sube de 34 ni baja de 28.
    const premio = p.cola[0] as Texto;
    expect(premio.tam).toBeLessThanOrEqual(34);
    expect(premio.tam).toBeGreaterThanOrEqual(28);
  });

  it("un premio corto sigue como siempre: 34 de letra, en crema y en un renglón", () => {
    for (const n of [2, 5, 12]) {
      const p = planLista(entrada(n));
      expect(p.cola[0]?.tam).toBe(34);
      expect(p.cola[0]?.color).toBe("crema");
      expect(p.recorta).toBe(false);
    }
  });

  it("un texto sin fin (de más de 80 letras, que el campo no admite) sigue adentro del panel, y el plan dice que recortó", () => {
    for (const conQr of [true, false]) {
      const e = entrada(12, "es", { conQr, lineas: [`Premio: ${"palabra ".repeat(30)}`, "Salieron entre 80 personas"] });
      const p = planLista(e);
      reglasDeOro(p, conQr, `sin fin ${conQr}`);
      expect(p.recorta).toBe(true);
    }
  });
});

/* ------------------------------------------------------------- Escaneá arriba y el costo */

describe("Escaneá arriba de la tarjeta del QR", () => {
  it.each([36, 40, 44, 56])("con nombres de %i: más chico que ellos, con la calcomanía más chica que ellos, todo adentro del panel", (F) => {
    for (const texto of [TEXTOS.es.escanear, TEXTOS.es.escanearSin, TEXTOS.en.escanear, TEXTOS.en.escanearSin]) {
      const e = planEscanearArriba(medir, texto, F);
      expect(e.panel).toEqual({ x: 544, y: 556, w: 452, h: 244 });
      for (const t of e.texto) {
        expect(t.tam).toBeLessThan(F);
        expect(t.tam).toBeGreaterThanOrEqual(28);
        expect(dentro(t.caja, e.panel)).toBe(true);
      }
      expect(e.texto.map((t) => t.t).join(" ")).toBe(texto);
      expect(e.dominio.tam).toBeLessThan(F);
      expect(dentro({ x: e.dominio.x, y: e.dominio.y, w: e.dominio.w, h: e.dominio.h }, e.panel)).toBe(true);
    }
  });
});

describe("el costo", () => {
  it("con 300 nombres, la medida se llama menos de 2000 veces", () => {
    let llamadas = 0;
    const contada: Medida = (peso, tam, t) => {
      llamadas++;
      return medir(peso, tam, t);
    };
    for (const conQr of [true, false]) {
      llamadas = 0;
      planLista(entrada(300, "es", { medir: contada, conQr }));
      expect(llamadas, `${conQr}`).toBeLessThan(2000);
    }
  });

  it("es determinista: dos veces lo mismo", () => {
    expect(planLista(entrada(12))).toEqual(planLista(entrada(12)));
  });

  it("premio de 60 letras, sin sello, con 8 ganadores: todo adentro, y ni el premio ni los nombres se cortan", () => {
    const largo = "Una mochila de aguayo y dos entradas para el concierto del";
    for (const conQr of [true, false]) {
      const lineas = [`Premio: ${largo}`, "Salieron entre 80 personas", "Sin sello: no se puede comprobar."];
      const p = planLista(entrada(8, "es", { conQr, sinSello: true, lineas }));
      reglasDeOro(p, conQr, `premio largo ${conQr}`);
      p.filas.forEach((f, i) => expect(nombreDe(f)).toBe(nombres(8)[i]));
      expect(p.recorta).toBe(false);
      expect(p.cola.map((t) => t.t).join(" ")).toBe(lineas.join(" "));
    }
  });

  it("un premio larguísimo y sin QR sigue entrando, y el plan dice que recortó", () => {
    const p = planLista(entrada(20, "es", { conQr: false, sinSello: true, lineas: [`Premio: ${"palabra ".repeat(30)}`, "Salieron entre 80 personas", "Sin sello: no se puede comprobar."] }));
    reglasDeOro(p, false, "cola larguísima");
    expect(p.vistos).toBeGreaterThanOrEqual(1);
    expect(p.recorta).toBe(true);
  });
});
