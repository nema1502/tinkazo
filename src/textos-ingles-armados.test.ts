import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "./i18n";
import { TEXTOS_CARRERA } from "./games/llamas/carrera-textos";

/**
 * Las frases en inglés que se arman por piezas. Cada una se prueba en todas sus combinaciones: que quede bien
 * formada y que no vuelvan las formas que sonaban traducidas (la pasada editorial del 16 de noviembre de 2026).
 */

const en = T.en;

describe("el aviso al ganador: premio, sello, personas, equipos y varios", () => {
  const casos: { premio: string; sinSello: boolean; varios: boolean; equipos: boolean; personas?: number }[] = [];
  for (const premio of ["", "Termo"]) {
    for (const sinSello of [false, true]) {
      for (const varios of [false, true]) {
        for (const equipos of [false, true]) {
          for (const personas of [undefined, 4]) casos.push({ premio, sinSello, varios, equipos, personas });
        }
      }
    }
  }

  it.each(casos)("premio %j", ({ premio, sinSello, varios, equipos, personas }) => {
    const texto = en.tellBody("Ana", premio, 7, "https://x.example/r", varios, sinSello, personas, equipos);
    const [cabeza, origen] = texto.split("\n\n");
    // Con premio dice qué se lleva. Sin premio, que ganó el sorteo: nunca «se lleva el sorteo».
    expect(cabeza).toBe(premio ? "You won, Ana! You're taking home Termo." : "You won the draw, Ana!");
    const de = personas ? "7 entries from 4 people" : equipos ? "7 teams" : "7 people";
    if (sinSello) {
      expect(origen).toBe(`You were drawn from ${de}.`);
      expect(texto).not.toMatch(/hand-picked/);
    } else {
      expect(origen).toMatch(new RegExp(`^You were drawn from ${de}, and no one hand-picked you\\. `));
      expect(texto).toContain(varios ? "Check it for yourselves, it takes ten seconds" : "Check it yourself, it takes ten seconds");
    }
    expect(texto).not.toMatch(/came out of|taking home the draw/);
    expect(texto).toContain("https://x.example/r");
  });
});

describe("las bases y el resumen antes de sellar: varias participaciones por persona", () => {
  const base = {
    prize: "Termo",
    count: 2,
    listHash: "ab12",
    sealedAt: "16 Nov 2026",
    round: 10,
    roundAt: "16 Nov 2026",
    network: "test",
    verifyUrl: "https://x.example/v",
  };

  it("las bases dicen que quien tiene varias participaciones se puede sortear más de una vez", () => {
    for (const winners of [1, 3]) {
      const texto = en.rules({ ...base, winners, entries: 5 });
      expect(texto).toContain("with 5 entries: anyone with several entries can be drawn more than once. ");
      expect(texto).toContain(winners === 1 ? "One winner is drawn." : "3 winners are drawn.");
      expect(texto).not.toMatch(/come out more than once/);
    }
    expect(en.rules({ ...base, winners: 1 })).not.toMatch(/more than once/);
  });

  it("las bases de antes de sellar, igual", () => {
    for (const winners of [1, 3]) {
      const texto = en.rulesPre({ prize: "Termo", count: 2, winners, verifyUrl: "https://x.example/v", entries: 5 });
      expect(texto).toContain("anyone with several entries can be drawn more than once.");
    }
  });

  it("el resumen antes de sellar, con y sin varias participaciones", () => {
    expect(en.sellarResumen(2, 1, "Termo", 5)).toBe(
      "2 people, 5 entries, 1 winner, Termo. Anyone with several entries can be drawn more than once. Sealing locks the list.",
    );
    expect(en.sellarResumen(2, 3, "", 2, false)).toBe("2 people, 3 winners, no prize. Sealing locks the list.");
  });
});

describe("el aviso de quien sale más de una vez y el tope de diez participaciones", () => {
  it("salioVarias en dos y en tres", () => {
    expect(en.salioVarias("Ana", 2, [0, 2])).toBe("Ana was drawn 2 times: #1 and #3.");
    expect(en.salioVarias("Ana", 3, [0, 1, 2])).toBe("Ana was drawn 3 times: #1, #2 and #3.");
    expect(en.salioVeces).toBe("{nombre} was drawn {n} times.");
  });

  it("el tope de diez, en singular y en plural", () => {
    expect(en.partTopeAviso("Ana", false)).toBe("The maximum is 10 per person. Ana was kept at 10.");
    expect(en.partTopeAviso("Ana, Beto and Nora", true)).toBe("The maximum is 10 per person. Ana, Beto and Nora were kept at 10.");
  });
});

describe("la carrera de llamas: quien se queda a descansar", () => {
  it("el eco de la clasificatoria, en cada variante y con dos nombres", () => {
    for (let quedan = 0; quedan < 6; quedan++) {
      expect(en.pelEcho("Ana", quedan), `quedan ${quedan}`).toMatch(/^Ana (lies down|stops to rest|stays behind to rest)! \d+ left\.$/);
      expect(en.pelEcho("Ana", quedan)).not.toMatch(/lay down/);
    }
    expect(en.pelEchoDos("Ana", "Beto", 3)).toBe("Ana and Beto lie down! 3 left.");
  });

  it("el relator de la carrera, en cada variante", () => {
    const { carEcha } = TEXTOS_CARRERA.en as unknown as { carEcha: (n: string, v: number) => string };
    expect([0, 1, 2].map((v) => carEcha("Ana", v))).toEqual(["Ana lies down to rest!", "Ana lies down!", "Ana rests a while!"]);
  });

  it("los tropiezos y los piques del comentario", () => {
    for (let i = 0; i < 12; i++) {
      expect(en.cTropiezoR("Ana")).toMatch(/^(Ana went off course!|Ana hit an asteroid!|Whoa, Ana drifted off!)$/);
      expect(en.cPiqueL("Ana")).toMatch(/^(Here comes Ana on the outside!|Ana picks up the pace!|Look at Ana!)$/);
    }
  });
});

describe("el cartel final del juego De pie: uno o varios", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  async function textosEnStand() {
    const datos = new Map<string, string>();
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    });
    vi.resetModules();
    const modo = await import("./ensayo-modo");
    modo.marcarStand(true);
    return (await import("./i18n")).T.en;
  }

  it("una persona o varias, con el verbo que le toca", async () => {
    const t = await textosEnStand();
    expect(t.cWin("ANA", false)).toBe("ANA IS PICKED!");
    expect(t.cWin("ANA AND BETO", true)).toBe("ANA AND BETO ARE PICKED!");
  });
});

describe("las preguntas del juego De pie: cada pieza con su comienzo", () => {
  // El cartel junta una línea chica (`cQuiAskA` o `cQuiAskAN`) con la grande: `quien.ts`, función `cartel`.
  it("las cuatro preguntas sobre el nombre empiezan con «DOES YOUR NAME» y la del número con «IS YOUR NUMBER»", () => {
    const sobreElNombre = [
      en.cQuiAskL("A"),
      en.cQuiAskD("3"),
      en.cQuiAskM(),
      en.cQuiAskG(6),
    ].map((fin) => `${en.cQuiAskA} ${fin}`);
    expect(sobreElNombre).toEqual([
      "DOES YOUR NAME HAVE THE LETTER A?",
      "DOES YOUR NAME HAVE THE NUMBER 3?",
      "DOES YOUR NAME START BETWEEN A AND M?",
      "DOES YOUR NAME HAVE MORE THAN 6 LETTERS?",
    ]);
    expect(`${en.cQuiAskAN} ${en.cQuiAskO(7)}`).toBe("IS YOUR NUMBER GREATER THAN 7?");
  });

  it("lo que se sientan, con sí y con no, en las cinco preguntas", () => {
    const frases = [
      en.cQuiSitL("A", true), en.cQuiSitL("A", false),
      en.cQuiSitD("3", true), en.cQuiSitD("3", false),
      en.cQuiSitM(true), en.cQuiSitM(false),
      en.cQuiSitG(6, true), en.cQuiSitG(6, false),
      en.cQuiSitO(7, true), en.cQuiSitO(7, false),
    ];
    expect(frases).toEqual([
      "don't have the letter A", "have the letter A",
      "don't have the number 3", "have the number 3",
      "start between N and Z", "start between A and M",
      "have 6 letters or fewer", "have more than 6 letters",
      "have a number 7 or lower", "have a number greater than 7",
    ]);
    for (const f of frases) {
      expect(en.cQuiSits(f)).toBe(`Sit down: those who ${f}`);
      expect(en.cQuiYes(f, 0)).toBe(`Yes! Sit down: those who ${f}.`);
      expect(en.cQuiYes(f, 1)).toBe(`Yes! Sitting down: those who ${f}.`);
    }
  });
});

describe("el tope de personas de cada juego: lo que dice la recomendación", () => {
  const juegos = ["race", "sapo", "trompo", "chovena", "teleferico", "trueque", "wheel", "pinata", "quien", "oruro", "guajojo", "toborochi", "bolillas"];

  it("con una lista larga, cada juego dice cuántos aguanta y con qué palabras", () => {
    for (const j of juegos) {
      const f = (en as unknown as Record<string, (n: number, min: number, max: number) => string>)[`rec.${j}.largo`];
      expect(typeof f, j).toBe("function");
      const texto = f!(250, 2, 200);
      expect(texto, j).toMatch(/^With 250, /);
      expect(texto, j).toContain("200");
      expect(texto, j).not.toMatch(/does not offer|doesn't read|reaches|comparsa/);
    }
    const largo = (j: string) => (en as unknown as Record<string, (n: number, min: number, max: number) => string>)[`rec.${j}.largo`]!(250, 2, 200);
    expect(largo("race")).toBe("With 250, that is more than the 200 the race can take.");
    expect(largo("bolillas")).toBe("With 250, it isn't offered: the circle holds up to 200.");
    expect(largo("chovena")).toBe("With 250, it isn't offered: it needs one wheel per crew. The maximum is 200.");
    expect(largo("wheel")).toBe("With 250, the wheel can't be read: it goes up to 200 names.");
    expect(largo("pinata")).toBe("With 250, the piñata can't be read: it goes up to 200 names.");
  });
});

describe("la ayuda del botón de desbloqueo al proteger la cuenta", () => {
  it("dice que se desbloquea con lo mismo que abre el celular o la computadora, sin igualar una acción con un objeto", () => {
    expect(en.clDesbloqueoAyudaCel).toBe(
      "You unlock with the same thing you use to open your phone: your fingerprint, face or passcode. It never leaves your phone, and Tinkazo doesn't see it.",
    );
    expect(en.clDesbloqueoAyudaCompu).toBe(
      "You unlock with the same thing you use to open your computer: your fingerprint, face or password. It never leaves your computer, and Tinkazo doesn't see it.",
    );
    for (const clave of ["clDesbloqueoAyudaCel", "clDesbloqueoAyudaCompu"] as const) {
      expect(en[clave], clave).not.toMatch(/^Unlocking is/);
    }
  });
});
