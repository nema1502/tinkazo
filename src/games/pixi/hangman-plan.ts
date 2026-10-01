/**
 * Ahorcado (hangman): the pure planning half (no Pixi, no DOM, no Math.random).
 *
 * The game decides nothing. The hidden word is the winner's name, and the
 * winners are known before the first letter, so the whole sequence of guesses
 * is planned BACKWARDS from that name: the correct guesses are letters of the
 * winner's name, the wrong ones are letters that are NOT in it (preferably
 * letters that appear in many other candidates, so each one strikes many
 * names), the figure never completes, and the last guess is a correct one that
 * finishes the name.
 *
 * Matching is done on the normalized form of a name (see `normalizeName`);
 * the screen shows the original characters.
 */

/** Hangman is readable up to this many candidates; above it the draw falls back to the race. */
export const HANGMAN_MAX = 12;
/** The figure has this many parts; it is complete (and the round lost) at this many wrong guesses. */
export const MAX_WRONG = 6;
/** Longest playable name, in letters (A-Z once normalized). */
export const MAX_NAME_LETTERS = 18;
/** Shortest playable name, in letters. */
export const MIN_NAME_LETTERS = 2;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Uppercase, accents removed, Ñ as N, and only A-Z kept. */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z]/g, "");
}

/**
 * `true` if Hangman can show this draw (otherwise it falls back to the race):
 * between 2 and `HANGMAN_MAX` names, each with 2 to `MAX_NAME_LETTERS` letters
 * once normalized and, when `winners` is given, at least one valid and
 * distinct winner index.
 */
export function fitsHangman(names: readonly string[], winners?: readonly number[]): boolean {
  if (names.length < 2 || names.length > HANGMAN_MAX) return false;
  for (const name of names) {
    const len = normalizeName(name).length;
    if (len < MIN_NAME_LETTERS || len > MAX_NAME_LETTERS) return false;
  }
  if (winners === undefined) return true;
  if (winners.length === 0) return false;
  const seen = new Set<number>();
  for (const w of winners) {
    if (!Number.isInteger(w) || w < 0 || w >= names.length || seen.has(w)) return false;
    seen.add(w);
  }
  return true;
}

/**
 * `true` if `cand` (a normalized name) still looks like `win` once only the
 * `guessed` letters are shown: the same length and the same letters in the same
 * places. A candidate holding a wrongly guessed letter does not match, because
 * that letter would be on show in it and a blank in the winner's name.
 */
export function matchesPattern(cand: string, win: string, guessed: ReadonlySet<string>): boolean {
  if (cand.length !== win.length) return false;
  for (let i = 0; i < win.length; i++) {
    const c = cand[i] as string;
    const w = win[i] as string;
    if ((guessed.has(c) || guessed.has(w)) && c !== w) return false;
  }
  return true;
}

/** One character of the name as it is drawn. */
export interface MaskCell {
  /** The original character (accent and ñ kept). */
  ch: string;
  /** `true` for a letter slot, `false` for a space or punctuation (a separator, always shown). */
  slot: boolean;
  /** Slot only: its letter has been guessed. */
  shown: boolean;
}

/** The name cell by cell, with the guessed letters revealed. */
export function maskName(name: string, guessed: ReadonlySet<string>): MaskCell[] {
  return [...name.normalize("NFC")].map((ch) => {
    const base = normalizeName(ch);
    if (base.length === 0) return { ch, slot: false, shown: true };
    return { ch, slot: true, shown: [...base].every((l) => guessed.has(l)) };
  });
}

export type ArcName = "remontada" | "susto" | "duelo" | "tapada";

/** How many wrong guesses a round gets (inclusive bounds). */
export interface GuessOpts {
  minWrong: number;
  maxWrong: number;
}

export interface ArcOpts {
  /** The last winner's round: the one with the big moment. */
  last: GuessOpts;
  /** Every other winner's round. */
  other: GuessOpts;
}

/** How scary each arc (see `drama.ts`) makes the last winner's round. The figure never completes. */
export function optsForArc(arc: ArcName): ArcOpts {
  const other: GuessOpts = { minWrong: 1, maxWrong: 2 };
  switch (arc) {
    case "susto":
      return { last: { minWrong: MAX_WRONG - 1, maxWrong: MAX_WRONG - 1 }, other };
    case "remontada":
      return { last: { minWrong: 4, maxWrong: 4 }, other };
    case "duelo":
      return { last: { minWrong: 3, maxWrong: 3 }, other };
    case "tapada":
      return { last: { minWrong: 2, maxWrong: 2 }, other };
  }
}

export interface Guess {
  /** A-Z. */
  letter: string;
  /** `true` if the letter is in the winner's name. */
  correct: boolean;
  /** Candidate indices (into `names`) still consistent with the pattern after this guess. */
  remaining: number[];
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));

/**
 * The guesses for one round, in order.
 *
 * `pool` lists the candidate indices in play (default: everyone); the winner
 * must be in it. Wrong guesses are chosen one by one as the letter that strikes
 * the most candidates still standing; correct guesses go from the letters most
 * of the field shares to the rarest. When there is any wrong guess, the one
 * right before the closing guess is wrong (the last scare).
 */
export function planGuesses(
  names: readonly string[],
  winnerIdx: number,
  rng: () => number,
  opts: GuessOpts,
  pool?: readonly number[],
): Guess[] {
  if (!Number.isInteger(winnerIdx) || winnerIdx < 0 || winnerIdx >= names.length) {
    throw new RangeError(`planGuesses: winner ${winnerIdx} is outside 0..${names.length - 1}`);
  }
  const inPlay = pool ? [...pool] : names.map((_, i) => i);
  if (!inPlay.includes(winnerIdx)) throw new RangeError(`planGuesses: winner ${winnerIdx} is not in the pool`);
  for (const i of inPlay) {
    if (!Number.isInteger(i) || i < 0 || i >= names.length) throw new RangeError(`planGuesses: pool index ${i} is outside the names`);
  }
  const norms = names.map(normalizeName);
  const win = norms[winnerIdx] as string;
  if (win.length < MIN_NAME_LETTERS) throw new RangeError("planGuesses: the winner's name needs at least 2 letters");

  const winLetters = [...new Set(win)];
  const free = [...ALPHABET].filter((l) => !winLetters.includes(l));

  const lo = clampInt(opts.minWrong, 0, Math.min(MAX_WRONG - 1, free.length));
  const hi = clampInt(opts.maxWrong, lo, Math.min(MAX_WRONG - 1, free.length));
  const wrongCount = lo + Math.floor(rng() * (hi - lo + 1));

  // Correct letters: the ones the rest of the field shares first, the rarest last.
  const others = inPlay.filter((i) => i !== winnerIdx);
  const shared = (l: string): number => others.filter((i) => (norms[i] as string).includes(l)).length;
  const keyed = winLetters.map((l) => ({ l, shared: shared(l), tie: rng() }));
  keyed.sort((a, b) => b.shared - a.shared || a.tie - b.tie);
  const rights = keyed.map((k) => k.l);

  // Which slots of the sequence are wrong: the one before the last, and the rest at random.
  const total = rights.length + wrongCount;
  const wrongSlot = new Set<number>();
  if (wrongCount > 0) {
    wrongSlot.add(total - 2);
    const open = Array.from({ length: Math.max(0, total - 2) }, (_, i) => i);
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [open[i], open[j]] = [open[j] as number, open[i] as number];
    }
    for (const s of open.slice(0, wrongCount - 1)) wrongSlot.add(s);
  }

  const out: Guess[] = [];
  const guessed = new Set<string>();
  let remaining = inPlay;
  let nextRight = 0;
  const unused = new Set(free);
  for (let s = 0; s < total; s++) {
    let letter: string;
    const correct = !wrongSlot.has(s);
    if (correct) {
      letter = rights[nextRight++] as string;
    } else {
      // The unused wrong letter that strikes the most candidates still standing.
      const standing = remaining;
      let best = -1;
      let ties: string[] = [];
      for (const l of unused) {
        const strikes = standing.filter((i) => (norms[i] as string).includes(l)).length;
        if (strikes > best) {
          best = strikes;
          ties = [l];
        } else if (strikes === best) ties.push(l);
      }
      letter = ties[Math.floor(rng() * ties.length)] as string;
      unused.delete(letter);
    }
    guessed.add(letter);
    remaining = remaining.filter((i) => matchesPattern(norms[i] as string, win, guessed));
    out.push({ letter, correct, remaining });
  }
  return out;
}

export interface Round {
  /** Participant index of this round's winner. */
  winner: number;
  /** Candidates in play: everyone except the earlier winners. */
  pool: number[];
  guesses: Guess[];
}

/**
 * One round per winner, in `winners` order. A round's pool leaves out the
 * winners of earlier rounds; the last winner gets the arc's big moment.
 */
export function planRounds(names: readonly string[], winners: readonly number[], rng: () => number, opts: ArcOpts): Round[] {
  if (!fitsHangman(names, winners)) throw new RangeError("planRounds: this draw cannot be shown as a hangman");
  return winners.map((winner, r) => {
    const earlier = new Set(winners.slice(0, r));
    const pool = names.map((_, i) => i).filter((i) => !earlier.has(i));
    const guesses = planGuesses(names, winner, rng, r === winners.length - 1 ? opts.last : opts.other, pool);
    return { winner, pool, guesses };
  });
}
