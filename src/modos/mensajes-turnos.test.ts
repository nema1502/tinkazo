// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { select } from "../protocol/select";
import { fotoDeSorteo, mensajeDeSorteo } from "../ui/compartir";
import { htmlDeTurnos } from "../ui/lista-de-turnos";
import { turnMessage, turnNotice } from "./mensajes";
import { isTurnOrder, turnOrder } from "./turnos";

/**
 * Los mensajes de un orden de turnos: el resumen de antes de sellar, las bases, el mensaje para el grupo, el aviso a cada
 * persona y lo que se comparte (el texto y la foto). Ninguno dice que alguien gana: las palabras de ganar no se usan.
 */

const PROHIBIDAS = /ganador|ganan?\b|ganó|ganaron|premio|pozo|suerte|aportes|winner|\bwins?\b|\bwon\b|prize|\bpot\b|luck|rifa|lotería|raffle|lottery|pasanaku/i;
/** El punto medio (U+00B7) no se escribe en ningún texto que se vea: se arma con su código para no dejarlo en el archivo. */
const PUNTO_MEDIO = String.fromCharCode(0xb7);
const ENLACE = "https://tinkazo.app/v#abc";
const numero = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
const huella = Uint8Array.from({ length: 32 }, (_, i) => (i * 91 + 5) & 255);
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
const ganadoresDe = (n: number): number[] => select(numero, huella, n, n);

describe("el mensaje para el grupo", () => {
  const orden = ["Ana", "Beto", "Carla"];

  it("en español: el orden, que nadie lo eligió, y cómo verificarlo", () => {
    expect(turnMessage("es", { orden, enlace: ENLACE })).toBe(
      [
        "Orden de los turnos: 1. Ana, 2. Beto, 3. Carla",
        "Nadie eligió este orden: la lista se cerró antes de que existiera el número que lo decidió.",
        `Si querés verificarlo, entrá acá: ${ENLACE}`,
        "",
        "Sorteado con Tinkazo: https://tinkazo.app",
      ].join("\n"),
    );
  });

  it("en inglés", () => {
    expect(turnMessage("en", { orden, enlace: ENLACE })).toBe(
      [
        "Turn order: 1. Ana, 2. Beto, 3. Carla",
        "Nobody chose this order: the list was closed before the number that decided it existed.",
        `If you want to verify it, open this link: ${ENLACE}`,
        "",
        "Drawn with Tinkazo: https://tinkazo.app",
      ].join("\n"),
    );
  });

  it("sin sello no promete lo que no se puede comprobar ni ofrece el enlace: dice que un orden sin sello no tiene comprobante", () => {
    // La verificación de un sorteo sin sello no lleva la cantidad de turnos y mostraría uno solo: el enlace no se ofrece.
    expect(turnMessage("es", { orden, enlace: ENLACE, sinSello: true })).toBe(
      ["Orden de los turnos: 1. Ana, 2. Beto, 3. Carla", "Este orden no se selló antes del sorteo, así que no se puede comprobar.", "", "Sorteado con Tinkazo: https://tinkazo.app"].join("\n"),
    );
    expect(turnMessage("en", { orden, enlace: ENLACE, sinSello: true })).toBe(
      ["Turn order: 1. Ana, 2. Beto, 3. Carla", "This order was not sealed before the draw, so it can't be checked.", "", "Drawn with Tinkazo: https://tinkazo.app"].join("\n"),
    );
    for (const lang of ["es", "en"] as const) {
      const m = turnMessage(lang, { orden, enlace: ENLACE, sinSello: true });
      expect(m, lang).not.toContain(ENLACE);
      expect(m, lang).not.toMatch(/Nadie eligió|verificarlo|Nobody chose|verify it|verificar\.html/);
    }
  });

  it("con sello el mensaje sigue ofreciendo el enlace", () => {
    for (const lang of ["es", "en"] as const) expect(turnMessage(lang, { orden, enlace: ENLACE }), lang).toContain(ENLACE);
  });

  it("sin las palabras de ganar, en los dos idiomas", () => {
    for (const lang of ["es", "en"] as const) {
      expect(turnMessage(lang, { orden, enlace: ENLACE }), lang).not.toMatch(PROHIBIDAS);
      expect(turnMessage(lang, { orden, enlace: ENLACE, sinSello: true }), lang).not.toMatch(PROHIBIDAS);
    }
  });
});

describe("el aviso a cada persona", () => {
  it("«Te tocó el turno 3 de 12. Revisalo vos»", () => {
    expect(turnNotice("es", { turn: 3, of: 12, enlace: ENLACE })).toBe(`Te tocó el turno 3 de 12. Revisalo vos: ${ENLACE}\n\nSorteado con Tinkazo: https://tinkazo.app`);
    expect(turnNotice("en", { turn: 3, of: 12, enlace: ENLACE })).toBe(`You got turn 3 of 12. Check it yourself: ${ENLACE}\n\nDrawn with Tinkazo: https://tinkazo.app`);
  });

  it("sin sello lo dice, no manda a revisarlo ni lleva enlace; ningún aviso usa palabras de ganar", () => {
    const es = turnNotice("es", { turn: 1, of: 2, enlace: ENLACE, sinSello: true });
    expect(es).toContain("Te tocó el turno 1 de 2. Este orden no se selló antes del sorteo, así que no se puede comprobar.");
    expect(es).not.toContain("Revisalo");
    expect(es).not.toContain(ENLACE);
    const en = turnNotice("en", { turn: 1, of: 2, enlace: ENLACE, sinSello: true });
    expect(en).toContain("You got turn 1 of 2. This order was not sealed before the draw, so it can't be checked.");
    expect(en).not.toContain(ENLACE);
    for (const lang of ["es", "en"] as const) {
      for (const sinSello of [false, true]) expect(turnNotice(lang, { turn: 7, of: 300, enlace: ENLACE, sinSello }), `${lang} ${sinSello}`).not.toMatch(PROHIBIDAS);
    }
  });

  it("cada renglón de la lista tiene su «Avisarle», escondido hasta que exista el enlace, y apunta a su turno", () => {
    const html = document.createElement("div");
    html.innerHTML = htmlDeTurnos(nombres(5), ganadoresDe(5), { avisar: true });
    const enlaces = [...html.querySelectorAll<HTMLAnchorElement>("a[data-turno]")];
    expect(enlaces).toHaveLength(5);
    expect(enlaces.map((a) => a.dataset.turno)).toEqual(["0", "1", "2", "3", "4"]);
    expect(enlaces.every((a) => a.hidden && a.textContent === "Avisarle")).toBe(true);
    expect(enlaces[2]?.getAttribute("aria-describedby")).toBe("wn-2");
    // Sin la opción (la verificación, la pantalla grande) no hay avisos.
    html.innerHTML = htmlDeTurnos(nombres(5), ganadoresDe(5));
    expect(html.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("lo que se comparte", () => {
  const datos = (n: number, premio = "Turnos") => {
    const names = nombres(n);
    const ganadores = ganadoresDe(n);
    return { names, ganadores, d: { enlace: ENLACE, ganadores: turnOrder(names, ganadores), total: n, premio } };
  };

  it.each([2, 12, 300])("el texto, con %i turnos, dice el orden del sorteo: los mismos índices, en el mismo orden", (n) => {
    const { names, ganadores, d } = datos(n);
    expect(isTurnOrder(d.total, d.ganadores.length, d.premio)).toBe(true);
    for (const lang of ["es", "en"] as const) {
      const texto = mensajeDeSorteo(lang, d);
      const primera = texto.split("\n")[0] as string;
      const esperada = ganadores.map((i, k) => `${k + 1}. ${names[i]}`).join(", ");
      expect(primera, lang).toBe(String(T[lang].turnsMsgCab).replace("{orden}", esperada));
      expect(texto, lang).not.toMatch(PROHIBIDAS);
      expect(texto, lang).toContain(ENLACE);
    }
  });

  it("la foto dice «Orden de turnos», trae las personas en el orden del sorteo y cuántas son, sin «Premio»", () => {
    const { names, ganadores, d } = datos(12, "Turnos de limpieza");
    const foto = fotoDeSorteo("es", d, ENLACE);
    expect(foto.titulo).toBe("Orden de turnos");
    // La foto dibuja las primeras (11 con más de doce, y «N más») y deja el resto: acá llegan todas, en el orden del sorteo.
    expect(foto.personas).toEqual(ganadores.map((i) => names[i]));
    expect(foto.lineas).toEqual(["Turnos de limpieza", "12 personas, turnos del 1 al 12"]);
    expect(JSON.stringify(foto)).not.toMatch(PROHIBIDAS);
    const en = fotoDeSorteo("en", { ...d, premio: "Turns" }, ENLACE);
    expect(en.titulo).toBe("Turn order");
    expect(en.lineas).toEqual(["12 people, turns 1 to 12"]);
    expect(JSON.stringify(en)).not.toMatch(PROHIBIDAS);
  });

  it("la foto de un orden repartido dice las personas y los turnos, como las bases", () => {
    const d = { enlace: ENLACE, ganadores: ["Ana", "Beto", "Ana", "Carla", "Ana"], total: 5, personas: 3, premio: "Turnos" };
    expect(fotoDeSorteo("es", d, ENLACE).lineas).toEqual(["3 personas, 5 turnos, turnos del 1 al 5"]);
    expect(fotoDeSorteo("en", d, ENLACE).lineas).toEqual(["3 people, 5 turns, turns 1 to 5"]);
    // Una persona por turno: la línea de siempre.
    expect(fotoDeSorteo("es", { ...d, personas: 5 }, ENLACE).lineas).toEqual(["5 personas, turnos del 1 al 5"]);
  });

  it("un orden sin sello se comparte sin enlace: el mensaje dice que no tiene comprobante y la foto no lleva QR", () => {
    const { d } = datos(12);
    for (const lang of ["es", "en"] as const) {
      const sin = mensajeDeSorteo(lang, { ...d, sinSello: true });
      expect(sin, lang).not.toContain(ENLACE);
      expect(sin, lang).toContain(String(T[lang].turnsSinComprobante));
      expect(sin, lang).not.toMatch(PROHIBIDAS);
      const foto = fotoDeSorteo(lang, { ...d, sinSello: true }, ENLACE);
      expect(foto.enlace, lang).toBe("");
      expect(foto.sinQr, lang).toBe(String(T[lang].turnsSinComprobante));
      // Con sello, todo como siempre: el enlace va en el mensaje y en la foto.
      expect(fotoDeSorteo(lang, d, ENLACE).enlace, lang).toBe(ENLACE);
      expect(mensajeDeSorteo(lang, d), lang).toContain(ENLACE);
    }
  });

  it("un sorteo común sin sello sigue ofreciendo su enlace: solo el orden de turnos no tiene comprobante", () => {
    const comun = { enlace: ENLACE, ganadores: ["Ana"], total: 12, premio: "Termo", sinSello: true };
    expect(fotoDeSorteo("es", comun, ENLACE).enlace).toBe(ENLACE);
    expect(mensajeDeSorteo("es", comun)).toContain(ENLACE);
  });

  it("3 poleras entre 3 personas se sigue compartiendo como siempre: quién ganó, el premio y «Entre 3 personas»", () => {
    const { d } = datos(3, "3 poleras");
    expect(isTurnOrder(d.total, d.ganadores.length, d.premio)).toBe(false);
    expect(mensajeDeSorteo("es", d)).toContain("Sorteo de 3 poleras: ganaron");
    const foto = fotoDeSorteo("es", d, ENLACE);
    expect(foto.titulo).toBe("Ganaron");
    expect(foto.lineas[0]).toContain("3 poleras");
  });
});

describe("el resumen de antes de sellar y las bases", () => {
  const p = {
    prize: "Turnos de limpieza",
    count: 12,
    winners: 12,
    listHash: "ab".repeat(32),
    sealedAt: "9 de noviembre de 2026",
    round: 123,
    roundAt: "9 de noviembre de 2026, 21:03",
    raffleId: "7",
    network: "testnet",
    verifyUrl: "https://tinkazo.app/como-funciona.html",
  };

  it("el resumen: «12 personas, turnos del 1 al 12. Al sellar, la lista queda cerrada.»", () => {
    expect(T.es.turnsSellarResumen(12)).toBe("12 personas, turnos del 1 al 12. Al sellar, la lista queda cerrada.");
    expect(T.en.turnsSellarResumen(12)).toBe("12 people, turns 1 to 12. Sealing locks the list.");
    for (const lang of ["es", "en"] as const) expect(T[lang].turnsSellarResumen(300), lang).not.toMatch(PROHIBIDAS);
  });

  it("las bases de antes y de después de sellar hablan de turnos y no de ganar ni de premio", () => {
    for (const lang of ["es", "en"] as const) {
      const bases = [T[lang].turnsRules(p), T[lang].turnsRules({ ...p, raffleId: "" }), T[lang].turnsRulesPre(p)];
      for (const texto of bases) {
        expect(texto, lang).not.toMatch(PROHIBIDAS);
        expect(texto, lang).not.toContain(PUNTO_MEDIO);
        expect(texto, lang).toMatch(/Turnos de limpieza/);
      }
      expect(T[lang].turnsRules(p), lang).toContain(p.listHash);
      expect(T[lang].turnsRules(p), lang).toContain(p.verifyUrl);
      expect(T[lang].turnsRulesPre(p), lang).toContain(p.verifyUrl);
    }
    expect(T.es.turnsRules(p)).toContain("del 1 al 12");
    expect(T.en.turnsRules(p)).toContain("1 to 12");
  });

  it("un orden repartido: las bases dicen las personas, los turnos y que van del 1 al último turno", () => {
    const repartido = { ...p, count: 3, entries: 5 };
    for (const bases of [T.es.turnsRules(repartido), T.es.turnsRulesPre(repartido)]) {
      expect(bases).toContain("Participan las 3 personas de la lista, con 5 turnos.");
      expect(bases).toContain("del 1 al 5");
      expect(bases).not.toContain("del 1 al 3");
      expect(bases).toContain("Quien tiene más de una participación recibe un turno por cada una.");
      expect(bases).not.toMatch(PROHIBIDAS);
    }
    for (const bases of [T.en.turnsRules(repartido), T.en.turnsRulesPre(repartido)]) {
      expect(bases).toContain("The 3 people on the list take part, with 5 turns.");
      expect(bases).toContain("1 to 5");
      expect(bases).not.toContain("1 to 3");
      expect(bases).not.toMatch(PROHIBIDAS);
    }
    // Con una participación por persona, el texto de siempre.
    expect(T.es.turnsRules({ ...p, entries: 12 })).toBe(T.es.turnsRules(p));
    expect(T.en.turnsRulesPre({ ...p, entries: 12 })).toBe(T.en.turnsRulesPre(p));
  });

  it("el texto flotante de las bases tampoco dice quién gana", () => {
    for (const lang of ["es", "en"] as const) expect(T[lang].turnsRulesNote, lang).not.toMatch(PROHIBIDAS);
  });

  it("los demás textos del modo, sin las palabras de ganar ni el punto medio, salvo el ejemplo con «pasanaku»", () => {
    const claves = Object.keys(T.es).filter((k) => k.startsWith("turns") && k !== "turnsExample");
    for (const k of claves) {
      for (const lang of ["es", "en"] as const) {
        const v = T[lang][k];
        if (typeof v !== "string") continue;
        expect(v, `${lang}.${k}`).not.toMatch(PROHIBIDAS);
        expect(v, `${lang}.${k}`).not.toContain(PUNTO_MEDIO);
      }
    }
  });
});
