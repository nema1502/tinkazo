import { describe, expect, it } from "vitest";
import {
  HANGMAN_MAX,
  MAX_NAME_LETTERS,
  MAX_WRONG,
  fitsHangman,
  maskName,
  matchesPattern,
  normalizeName,
  optsForArc,
  planGuesses,
  planRounds,
  type ArcName,
  type Guess,
} from "./hangman-plan";

/** A tiny seeded rng (mulberry32), enough for the tests. */
function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sweeps run thousands of expectations; give them room on a busy machine. */
const SWEEP_MS = 60_000;
const SEEDS = Array.from({ length: 64 }, (_, i) => i * 7919 + 1);
const ARCS: readonly ArcName[] = ["remontada", "susto", "duelo", "tapada"];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Accents, ñ, spaces and a few shared letters, so strikes are not trivial. */
const POOL = [
  "José", "María Ñandú", "Ana", "Luis Ángel", "Pedro", "Sofía", "Lucía",
  "Martín", "Valentina", "Camila", "Diego", "Renata", "Joaquín", "Ñusta",
];
const namesFor = (n: number): string[] => POOL.slice(0, n);

const letterSet = (name: string): Set<string> => new Set(normalizeName(name));

describe("hangman: normalizeName", () => {
  it("uppercases, strips accents, maps ñ to n and keeps only A-Z", () => {
    expect(normalizeName("José")).toBe("JOSE");
    expect(normalizeName("María Ñandú")).toBe("MARIANANDU");
    expect(normalizeName("Ángel-Luis")).toBe("ANGELLUIS");
    expect(normalizeName("  o'Brien 3 ")).toBe("OBRIEN");
    expect(normalizeName("ÑOÑO")).toBe("NONO");
    expect(normalizeName("😀 !!")).toBe("");
  });
});

describe("hangman: fitsHangman", () => {
  it("has the documented caps", () => {
    expect(HANGMAN_MAX).toBe(12);
    expect(MAX_WRONG).toBe(6);
    expect(MAX_NAME_LETTERS).toBe(18);
  });

  it("accepts a normal list, with or without winners", () => {
    expect(fitsHangman(namesFor(5))).toBe(true);
    expect(fitsHangman(namesFor(5), [2])).toBe(true);
    expect(fitsHangman(namesFor(HANGMAN_MAX), [0, 3, 7])).toBe(true);
    expect(fitsHangman(namesFor(2), [1])).toBe(true);
  });

  it("rejects fewer than two names and over-cap lists", () => {
    expect(fitsHangman([])).toBe(false);
    expect(fitsHangman(["Ana"])).toBe(false);
    expect(fitsHangman(Array.from({ length: HANGMAN_MAX + 1 }, (_, i) => `Nombre${"abcdefghijklmnop"[i]}`))).toBe(false);
    expect(fitsHangman(Array.from({ length: 200 }, () => "Ana"))).toBe(false);
  });

  it("rejects names with fewer than 2 letters once normalized", () => {
    expect(fitsHangman(["Ana", "X"])).toBe(false);
    expect(fitsHangman(["Ana", "!!"])).toBe(false);
    expect(fitsHangman(["Ana", "12345"])).toBe(false);
    expect(fitsHangman(["Ana", "😀"])).toBe(false);
    expect(fitsHangman(["Ana", "Bo"])).toBe(true);
  });

  it("rejects names longer than the letter cap, and accepts exactly the cap", () => {
    expect(fitsHangman(["Ana", "a".repeat(MAX_NAME_LETTERS + 1)])).toBe(false);
    expect(fitsHangman(["Ana", "a".repeat(MAX_NAME_LETTERS)])).toBe(true);
    // spaces and punctuation do not count towards the cap
    expect(fitsHangman(["Ana", `${"a".repeat(MAX_NAME_LETTERS)} !!- `])).toBe(true);
  });

  it("rejects invalid winners", () => {
    expect(fitsHangman(namesFor(4), [])).toBe(false);
    expect(fitsHangman(namesFor(4), [4])).toBe(false);
    expect(fitsHangman(namesFor(4), [-1])).toBe(false);
    expect(fitsHangman(namesFor(4), [1, 1])).toBe(false);
    expect(fitsHangman(namesFor(4), [1.5])).toBe(false);
  });
});

describe("hangman: optsForArc", () => {
  it("keeps every arc's wrong count inside 0..MAX_WRONG-1 and orders the arcs by fright", () => {
    for (const arc of ARCS) {
      const o = optsForArc(arc);
      for (const part of [o.last, o.other]) {
        expect(part.minWrong).toBeGreaterThanOrEqual(0);
        expect(part.maxWrong).toBeGreaterThanOrEqual(part.minWrong);
        expect(part.maxWrong).toBeLessThanOrEqual(MAX_WRONG - 1);
      }
    }
    expect(optsForArc("susto").last.maxWrong).toBe(MAX_WRONG - 1);
    expect(optsForArc("susto").last.minWrong).toBeGreaterThan(optsForArc("remontada").last.maxWrong - 1);
    expect(optsForArc("remontada").last.minWrong).toBeGreaterThan(optsForArc("duelo").last.maxWrong - 1);
    expect(optsForArc("duelo").last.minWrong).toBeGreaterThan(optsForArc("tapada").last.maxWrong - 1);
    expect(optsForArc("tapada").last.minWrong).toBeGreaterThanOrEqual(1);
  });
});

/**
 * All the invariants of one planned round, shared by the sweeps. Violations are
 * collected and asserted once: thousands of single `expect` calls made the
 * sweeps needlessly slow.
 */
function checkRound(names: readonly string[], winner: number, guesses: readonly Guess[], pool: readonly number[], min: number, max: number): void {
  const bad: string[] = [];
  const W = letterSet(names[winner] as string);
  const winnerNorm = normalizeName(names[winner] as string);
  if (guesses.length === 0) bad.push("no guesses");
  // correct <=> the letter is in the winner's name
  for (const g of guesses) if (g.correct !== W.has(g.letter)) bad.push(`${g.letter} correct flag is wrong`);
  const wrong = guesses.filter((g) => !g.correct).length;
  if (wrong > MAX_WRONG - 1) bad.push(`${wrong} wrong guesses complete the figure`);
  if (wrong < min || wrong > max) bad.push(`${wrong} wrong guesses outside ${min}..${max}`);
  // no letter twice, only A-Z
  const letters = guesses.map((g) => g.letter);
  if (new Set(letters).size !== letters.length) bad.push("a letter was guessed twice");
  for (const l of letters) if (!ALPHABET.includes(l) || l.length !== 1) bad.push(`${l} is not A-Z`);
  // the closing guess is correct and completes the name
  const lastG = guesses[guesses.length - 1] as Guess;
  if (!lastG.correct) bad.push("the last guess is wrong");
  const rights = new Set(guesses.filter((g) => g.correct).map((g) => g.letter));
  if (rights.size !== W.size || [...W].some((l) => !rights.has(l))) bad.push("not every winner letter was guessed");
  const beforeLast = new Set(guesses.slice(0, -1).filter((g) => g.correct).map((g) => g.letter));
  if (beforeLast.size !== W.size - 1) bad.push("the name is complete before the last guess");
  // `remaining`: inside the pool, holds the winner, shrinks only
  let prev: readonly number[] = pool;
  for (const g of guesses) {
    if (!g.remaining.includes(winner)) bad.push("the winner left `remaining`");
    if (g.remaining.some((r) => !prev.includes(r))) bad.push("`remaining` grew or left the pool");
    prev = g.remaining;
  }
  // after the last guess: exactly the pool names equal to the winner once normalized
  const same = pool.filter((i) => normalizeName(names[i] as string) === winnerNorm);
  if (JSON.stringify([...lastG.remaining].sort((a, b) => a - b)) !== JSON.stringify([...same].sort((a, b) => a - b))) {
    bad.push("the final `remaining` is not the normalized duplicates of the winner");
  }
  expect(bad).toEqual([]);
}

describe("hangman: planGuesses invariants", () => {
  it(
    "holds for every n, arc and seed (accents, ñ, spaces)",
    () => {
      for (let n = 2; n <= HANGMAN_MAX; n++) {
        const names = namesFor(n);
        const pool = names.map((_, i) => i);
        for (const arc of ARCS) {
          const o = optsForArc(arc).last;
          for (const seed of SEEDS) {
            const winner = (seed + n) % n;
            const guesses = planGuesses(names, winner, rngOf(seed), o);
            checkRound(names, winner, guesses, pool, o.minWrong, o.maxWrong);
          }
        }
      }
    },
    SWEEP_MS,
  );

  it(
    "picks wrong letters that strike as many remaining names as possible",
    () => {
      for (let n = 3; n <= HANGMAN_MAX; n++) {
        const names = namesFor(n);
        for (const seed of SEEDS) {
          const winner = seed % n;
          const guesses = planGuesses(names, winner, rngOf(seed), optsForArc("susto").last);
          const W = letterSet(names[winner] as string);
          let before: readonly number[] = names.map((_, i) => i);
          const used = new Set<string>();
          for (const g of guesses) {
            if (!g.correct) {
              const strikes = (l: string): number => before.filter((i) => letterSet(names[i] as string).has(l)).length;
              const best = Math.max(...[...ALPHABET].filter((l) => !W.has(l) && !used.has(l)).map(strikes));
              expect(strikes(g.letter)).toBe(best);
            }
            used.add(g.letter);
            before = g.remaining;
          }
        }
      }
    },
    SWEEP_MS,
  );

  it("always puts a scare right before the closing guess when there are wrong guesses", () => {
    for (const seed of SEEDS) {
      const names = namesFor(8);
      const guesses = planGuesses(names, seed % 8, rngOf(seed), optsForArc("susto").last);
      expect(guesses.length).toBeGreaterThanOrEqual(2);
      expect((guesses[guesses.length - 2] as Guess).correct).toBe(false);
    }
  });

  it("is deterministic per seed and differs across seeds", () => {
    const names = namesFor(9);
    const a = planGuesses(names, 4, rngOf(77), optsForArc("duelo").last);
    const b = planGuesses(names, 4, rngOf(77), optsForArc("duelo").last);
    expect(a).toEqual(b);
    const sig = (g: Guess[]): string => g.map((x) => x.letter + (x.correct ? "+" : "-")).join("");
    const variants = new Set(SEEDS.map((s) => sig(planGuesses(names, 4, rngOf(s), optsForArc("duelo").last))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("keeps every normalized duplicate to the end ('José' and 'Jose')", () => {
    const names = ["José", "Jose", "Ana", "Luis", "Marta"];
    for (const seed of SEEDS) {
      const guesses = planGuesses(names, 0, rngOf(seed), optsForArc("susto").last);
      const lastG = guesses[guesses.length - 1] as Guess;
      expect([...lastG.remaining].sort()).toEqual([0, 1]);
      checkRound(names, 0, guesses, [0, 1, 2, 3, 4], 5, 5);
      const g2 = planGuesses(names, 1, rngOf(seed), optsForArc("tapada").last);
      expect([...(g2[g2.length - 1] as Guess).remaining].sort()).toEqual([0, 1]);
    }
  });

  it("works for two names, for the longest name and for a one-letter-repeated name", () => {
    const long = "abcdefghijklmnopqr"; // 18 distinct letters
    const g = planGuesses(["Ana", long], 1, rngOf(5), optsForArc("susto").last);
    checkRound(["Ana", long], 1, g, [0, 1], 5, 5);
    const rep = planGuesses(["Ana", "Aa"], 1, rngOf(9), optsForArc("duelo").last);
    checkRound(["Ana", "Aa"], 1, rep, [0, 1], 3, 3);
    expect(rep.filter((x) => x.correct)).toHaveLength(1);
  });

  it("rejects impossible requests instead of planning nonsense", () => {
    const names = namesFor(4);
    const o = optsForArc("duelo").last;
    expect(() => planGuesses(names, 9, rngOf(1), o)).toThrow(RangeError);
    expect(() => planGuesses(names, -1, rngOf(1), o)).toThrow(RangeError);
    expect(() => planGuesses(["Ana", "X"], 1, rngOf(1), o)).toThrow(RangeError);
    expect(() => planGuesses(names, 2, rngOf(1), o, [0, 1])).toThrow(RangeError);
  });
});

describe("hangman: planRounds (several winners)", () => {
  it(
    "plans one round per winner in order, excluding earlier winners from later pools",
    () => {
      for (let n = 3; n <= HANGMAN_MAX; n++) {
        const names = namesFor(n);
        for (const arc of ARCS) {
          for (const seed of SEEDS.slice(0, 16)) {
            const k = 1 + (seed % Math.min(3, n - 1));
            const winners = Array.from({ length: k }, (_, i) => (seed + i * 3) % n).filter((w, i, a) => a.indexOf(w) === i);
            const rounds = planRounds(names, winners, rngOf(seed), optsForArc(arc));
            expect(rounds.map((r) => r.winner)).toEqual(winners);
            rounds.forEach((r, ri) => {
              const earlier = winners.slice(0, ri);
              expect(r.pool).toEqual(names.map((_, i) => i).filter((i) => !earlier.includes(i)));
              const o = optsForArc(arc)[ri === rounds.length - 1 ? "last" : "other"];
              checkRound(names, r.winner, r.guesses, r.pool, o.minWrong, o.maxWrong);
              for (const g of r.guesses) for (const e of earlier) expect(g.remaining).not.toContain(e);
            });
          }
        }
      }
    },
    SWEEP_MS,
  );

  it("gives the last winner the arc's scare and the others less", () => {
    const names = namesFor(10);
    const rounds = planRounds(names, [1, 4, 7], rngOf(3), optsForArc("susto"));
    expect(rounds[2]?.guesses.filter((g) => !g.correct)).toHaveLength(5);
    expect(rounds[0]?.guesses.filter((g) => !g.correct).length).toBeLessThan(5);
  });

  it("an earlier winner with the same normalized name as a later one does not linger", () => {
    const names = ["José", "Jose", "Ana", "Luis"];
    const rounds = planRounds(names, [0, 1], rngOf(4), optsForArc("duelo"));
    expect((rounds[0]?.guesses.at(-1) as Guess).remaining.sort()).toEqual([0, 1]);
    expect((rounds[1]?.guesses.at(-1) as Guess).remaining).toEqual([1]);
  });

  it("is deterministic and refuses lists the game cannot show", () => {
    const names = namesFor(7);
    const a = planRounds(names, [2, 5], rngOf(11), optsForArc("remontada"));
    expect(planRounds(names, [2, 5], rngOf(11), optsForArc("remontada"))).toEqual(a);
    expect(() => planRounds(names, [2, 2], rngOf(11), optsForArc("remontada"))).toThrow(RangeError);
    expect(() => planRounds(names, [], rngOf(11), optsForArc("remontada"))).toThrow(RangeError);
    expect(() => planRounds(["Ana", "X"], [0], rngOf(11), optsForArc("remontada"))).toThrow(RangeError);
  });
});

describe("hangman: pattern helpers", () => {
  it("masks a name keeping original characters, separators and accents", () => {
    const m = maskName("José Ñandú", new Set(["J", "O", "N", "U"]));
    expect(m.map((c) => (c.slot && !c.shown ? "_" : c.ch)).join("")).toBe("Jo__ Ñ_n_ú");
    // letter slots count the normalized letters only
    expect(m.filter((c) => c.slot)).toHaveLength(normalizeName("José Ñandú").length);
    expect(m.find((c) => !c.slot)?.ch).toBe(" ");
  });

  it("reveals every original character whose base letter was guessed (accent, ñ)", () => {
    const m = maskName("Ñandú Álvaro", new Set(["N", "A", "U"]));
    const shown = m.filter((c) => c.slot && c.shown).map((c) => c.ch);
    expect(shown).toEqual(["Ñ", "a", "n", "ú", "Á", "a"]);
  });

  it("matchesPattern compares only what the guessed letters reveal", () => {
    const g = new Set(["A"]);
    expect(matchesPattern("ANA", "ANA", g)).toBe(true);
    expect(matchesPattern("AVA", "ANA", g)).toBe(true);
    expect(matchesPattern("AMA", "ANA", new Set(["A", "N"]))).toBe(false);
    expect(matchesPattern("ANAS", "ANA", g)).toBe(false);
    // a wrong guessed letter strikes whoever has it
    expect(matchesPattern("EVA", "ANA", new Set(["E"]))).toBe(false);
  });
});
