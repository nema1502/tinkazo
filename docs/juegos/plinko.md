# Plinko

A triangular peg board with one slot per name at the bottom. A ball drops from the top, bounces left or right at every row and lands in a slot. The slot it lands in is the winner's.

**Identifier:** `plinko` · **Try it:** `/?demo=plinko` (real draw), `/?pose=plinko` (fixed scene, no network)

> **Status: not audited in a browser yet.** The planning module is covered by unit tests (`pnpm test`). The scene, the camera, the sound and the timings were written without running them in Chrome. Run the four auditors below before this goes to `main`.

## The rule: the game decides nothing

The winner is chosen by the [protocol](../protocolo.md) before the game starts. Plinko receives `(names, winners, beacon, done)` and only tells it. So the ball does not fall by chance: its path is **planned backwards from the winner's slot**.

1. Names are shuffled over the slots with the round's seeded `rng` (`assignSlots`). The shuffle is a permutation, so every name has its own slot and several winners never share one.
2. The board for `n` names has `rows` peg rows and `rows + 1` landing positions (a position is the number of right bounces, 0..rows). They are split evenly, `perSlot` per slot, so `slot = floor(rights / perSlot)`. With `n >= 8` that is the classic Galton board (`rows = n - 1`); with fewer names the board gets extra rows so it is never two bounces long (`boardFor`).
3. For the winner's slot, a landing position inside it is picked (`planDrop`) and a seeded sequence of left/right steps with exactly that many rights is built (`planPath`). The ball provably lands in the winner's slot: `landingSlot(path) === winnerSlot`, checked in the tests for every board size, every slot and sixty seeds.
4. The animation is a function of the stage clock only. No `Math.random()`: same round, same frames.

All of this lives in [`src/games/pixi/plinko-plan.ts`](../../src/games/pixi/plinko-plan.ts), which has no Pixi or DOM imports, and is tested in [`plinko-plan.test.ts`](../../src/games/pixi/plinko-plan.test.ts).

## Several winners

One ball per winner, dropped in the order of the winners list, each into its own slot (names are unique, so slots are distinct). Earlier balls are quicker and quieter, with a one-line narration ("Ball 2 of 3", "It landed in X's slot"). The **last** ball gets the big moment: it hangs at the top for longer, falls slower, and the camera follows it. The winner plate announces everyone at the end, like the other games.

## Arcs and camera

The arc comes from [`drama.ts`](../../src/games/drama.ts) and shapes the last ball. It is marked on the canvas (`data-arco`, `data-plinko="rows x slots"`).

| Arc | What happens |
|---|---|
| Susto, duelo | Near miss: the last three steps all go the same way, so the ball hangs over a neighbouring slot and swings back. The narrator names the neighbour ("Almost lands on X's slot!") |
| Remontada | No swerve. The camera closes in early (six segments from the end) and stays close |
| Tapada | Nobody is named before the ball is in. No neighbour chips, no near-miss line, and the camera waits for the very last fall |

Camera: wide while the ball is high; a follow zoom (about 1.25x, then 1.8x) over the last rows; 2.3x on the final fall, with a small punch and shake on each of the last pegs. After the landing it zooms on the winner's bin and the slot pulses. The last three segments are also slower (x1.3, x1.8, x2.4), and the narrator heat rises: bounce, "few rows left", near miss, "last peg".

Edge slots are forced straight runs when there is one position per slot (a ball can't hang beyond the wall), so there is no swerve there. The camera and the narrator carry the suspense.

## Caps and fallbacks

- **`PLINKO_MAX = 12`**, exported from `src/state.ts` next to `WHEEL_MAX` (defined in `plinko-plan.ts` so tests can import it in Node). With 12 slots the board is 12 positions wide; more than that and the slots stop being legible on a phone.
- **More than 12 names:** the draw falls back to the **llama race**, exactly like the wheel does above `WHEEL_MAX`. The substitution is `playableGame()` in `src/state.ts`, used by `draw.ts` and by the preload in `games/engine.ts`. It changes nothing about who won.
- **No WebGL or `?motor=clasico`:** there is no classic-engine version, so the race tells the same winner (same as the Piñata).
- **Reduced motion / `?instant=1`:** `mountPixi` returns `null`, the game calls `done()` at once.
- **Skip button:** jumps to the winner plate; `done()` is called when the plate is dismissed, as always.
- **Lore card:** Plinko has no entry in `src/games/lore.ts` and nothing was invented. Like every game without its own entry it shows the generic sourced cards (`any`), not a card about Plinko.

## Timing

In game seconds, not stretched: intro 4.5 s (pegs go up row by row, slots appear one by one), 2.0 s with the ball hanging, then the fall (0.65 s per segment for the last ball, plus the slowdown at the end), then 1.6 s of settling before the plate. About 15 s for 2 to 8 names and about 17.6 s for 12; each extra winner adds roughly 3 to 5 s. These are computed from the code, not measured: confirm with `audit-rigor` that normal, fast and epic land near 30, 20 and 42 s.

## How to demo and audit

```bash
pnpm build && pnpm preview &
node scripts/audit-game.mjs plinko
node scripts/audit-sound.mjs plinko
node scripts/audit-rigor.mjs plinko
node scripts/audit-emocion.mjs plinko
```

`audit-game` checks that the winner on screen is the one the protocol chose (also with `?nw=2`) and that the screen is restored; `audit-rigor` replays the same round twice and compares frames, counts `Math.random()` calls, checks that skipping at 10, 50 and 90% closes, the duration targets, and 2 and 12 people (`?n=2`, `?n=12`; above 12 it switches to the race by design, so `?n=200` measures the race). `audit-rigor` and `audit-sound` list `plinko` in their `TODOS` / `JUEGOS`.

Things only eyes can judge and nobody has: is the ball readable at 390 px wide, do the slot avatars read from the back of a room, is the near-miss obvious, do the chips fit.
