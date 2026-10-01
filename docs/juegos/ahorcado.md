# Ahorcado

Hangman where the hidden word is **the winner's name**. On the left a gallows holds a friendly cartoon figure that is built part by part with every wrong letter; in the middle the masked name, one slot per letter, and a strip of guessed letters; on the side every candidate as a chip, struck out as the letters rule them out, so the audience watches the field narrow until one name remains.

**Identifier:** `ahorcado` · **Try it:** `/?demo=ahorcado` (real draw), `/?pose=ahorcado` (fixed scene, no network)

> **Status: not audited in a browser yet.** The planning module, the fallback rule and the strings are covered by unit tests (`pnpm test`). The scene, the camera, the sound, the layout and the timings were written without running them in Chrome. Run the four auditors below before this goes to `main`.

## The rule: the game decides nothing

The winner is chosen by the [protocol](../protocolo.md) before the game starts. Ahorcado receives `(names, winners, beacon, done)` and only tells it. The letters are not guessed by anything: the whole sequence is **planned backwards from each winner's name**.

1. `normalizeName` turns a name into its matching form: uppercase, accents removed, Ñ as N, only A-Z kept. The screen shows the original characters (accents, ñ, spaces and punctuation), and a letter reveals every slot whose base letter it is.
2. `planGuesses(names, winnerIdx, rng, opts, pool?)` returns the ordered guesses `{ letter, correct, remaining }`:
   - **Correct** guesses are exactly the distinct letters of the winner's normalized name, from the letters most of the field shares to the rarest. The **last guess is always a correct one that completes the name**.
   - **Wrong** guesses are letters that are **not** in the name. Each one is chosen as the unused letter that strikes the most candidates still standing, so wrong letters visibly clear the list. When there is any wrong guess, the one right before the closing guess is wrong (a last scare).
   - The figure **never completes**: at most `MAX_WRONG - 1 = 5` wrong guesses.
   - `remaining` lists the candidates still consistent with the revealed pattern after that guess: same length and the same letters in the same places, and none holding a wrongly guessed letter. It always contains the winner, it never grows, and after the last guess it is exactly the candidates whose normalized name equals the winner's. That is the winner alone, unless two names normalize alike (for example "José" and "Jose"), and then both stay on the list, honestly.
3. `planRounds(names, winners, rng, opts)` plans one round per winner, in `winners` order. A round's candidate pool leaves out the winners of earlier rounds.
4. No `Math.random()`: only the stage's seeded `rng`. The animation is a function of the stage clock (`dt`). Same round, same frames.

All of this lives in [`src/games/pixi/hangman-plan.ts`](../../src/games/pixi/hangman-plan.ts), with no Pixi or DOM imports, and is tested in [`hangman-plan.test.ts`](../../src/games/pixi/hangman-plan.test.ts): every `n` from 2 to 12, every arc, 64 seeds, with accents, ñ and spaces; plus the invariants above, determinism, the "José/Jose" duplicates case, the cap rules and the multi-winner pools.

## Arcs and camera

The arc comes from [`drama.ts`](../../src/games/drama.ts) and sets the last winner's wrong guesses (`optsForArc`). It is marked on the canvas (`data-arco`, `data-ahorcado="names x winners"`).

| Arc | Last winner's wrong guesses | Camera |
|---|---|---|
| Susto | 5 (the figure is one part from complete; the narrator warns) | Follows the letters; push-in over the last hang |
| Remontada | 4 | Follows every letter closely from the start |
| Duelo | 3 | Follows the letters; push-in over the last hang |
| Tapada | 2 | Push-in waits for the second half of the last hang |

The other winners' rounds get 1 or 2 wrong guesses and a faster rhythm. On the last guess the camera punches in on the completed name, the slots pulse, the figure cheers (arms up, a hop) and the winner chip is outlined; then the winner plate follows.

## Several winners

One round per winner, in the order of the winners list. The figure and the masked name reset, the caption counts "Winner k of N", and a winner's chip keeps a numbered badge for the rest of the draw. Later rounds do not list earlier winners as candidates (they show as taken). The **last** winner gets the big moment: the arc's scare, a longer hang before the closing letter and the close-up.

## Caps and fallbacks

- **`HANGMAN_MAX = 12`** candidates, **`MAX_NAME_LETTERS = 18`** letters per name (spaces and punctuation do not count) and **at least 2 letters** once normalized. `fitsHangman(names, winners?)` checks all of it, plus valid and distinct winners. The constants live in `hangman-plan.ts` (so Node tests can import them) and `src/state.ts` re-exports `HANGMAN_MAX`.
- **Over the cap, or any name that is too short or too long** (for example an emoji-only name, or "X"): the draw falls back to the **llama race**, like Sapo, Plinko and the wheel. `playableGame(game, people, names?, winners?)` in `src/state.ts` now takes the names and winners as optional arguments; `draw.ts` passes them, while the preload in `games/engine.ts` only knows the headcount and applies the cap (preloading a game that ends up falling back is harmless). Existing callers keep working. It changes nothing about who won. Covered in `src/state.test.ts`.
- **No WebGL or `?motor=clasico`:** there is no classic-engine version, so the race tells the same winner.
- **Reduced motion / `?instant=1`:** `mountPixi` returns `null`, the game calls `done()` at once.
- **A planner error or a drawing error:** the game closes through `S.cleanup()`, which calls `done()`. Neither can leave the draw hanging.
- **Skip button:** jumps to the winner plate; `done()` is called when the plate is dismissed, as always.
- **Lore card:** Ahorcado has no entry in `src/games/lore.ts` and nothing was invented. Like every game without its own entry it shows the generic sourced cards.
- **Mute:** all sounds go through `beep` in `src/sound.ts`, so they follow the sound toggle.

## Figure style

A cartoon puppet that hangs from a rope by a ring above its head (it is not around the neck): yellow head with a face, teal limbs. Parts come in this order: head, body, left arm, right arm, left leg; the right leg never appears, because the figure is never completed. At four parts the smile turns into a worried "o". No blood, no faces of distress; when the name is complete the figure cheers.

## Timing

In game seconds, not stretched: intro 4.5 s, 1.2 s before the first letter, then about 0.8 to 1.5 s per letter in the last round (0.5 to 0.9 s in the others), 2.3 s of hang before the closing letter and 2.2 s of settling before the plate. A last round with 6 distinct letters and 5 wrong guesses comes to roughly 23 s. These are computed from the code, not measured: confirm with `audit-rigor` that normal, fast and epic land near 30, 20 and 42 s. A long name (up to 18 distinct letters) makes the last round longer; the per-letter gap shrinks to keep it bounded, but it has not been timed.

## Thumbnail

`src/ui/thumbs.ts` has an `ahorcado` painter: a gallows whose figure builds up, a five-slot word that fills in, and chips that get struck out. It depends only on the thumbnail clock and goes through the shared `paintThumb` flow.

## How to demo and audit

```bash
pnpm build && pnpm preview &
node scripts/audit-game.mjs ahorcado
node scripts/audit-sound.mjs ahorcado
node scripts/audit-rigor.mjs ahorcado
node scripts/audit-emocion.mjs ahorcado
```

`audit-rigor`, `audit-sound` and `audit-emocion` list `ahorcado` in their game lists (`TODOS` / `JUEGOS`). With `?n=200` the real draw switches to the race by design; `?pose=ahorcado&n=200` calls the scene directly, which refuses the list and closes at once (the planner's guard), so use a list of 12 or fewer there.

Things only eyes can judge and nobody has:

- Does the layout hold at 390 px wide (portrait: gallows and strip on top, name across, chips in two columns) and in a short landscape window?
- Does an 18-letter name read in one or two lines, and do the slots stay legible?
- Do 12 chips fit in the side column, and is the red strike line obvious over the chip faces?
- Is the figure friendly, and does the worried face at four parts read as suspense and not as distress?
- Do the strike animations, the camera follow, the close-up and the final pulse feel right, and do the narrator lines keep up with the letters?
- Are the timings right, and does a long name make the last round drag?
