# Sapo

A table seen from above, tilted a little, with a big frog in the middle and one hole per name around it. A token is tossed again and again: some throws miss, some nearly drop in, and the final throw of each winner drops into that winner's hole.

**Identifier:** `sapo` · **Try it:** `/?demo=sapo` (real draw), `/?pose=sapo` (fixed scene, no network)

> **Status: not audited in a browser yet.** The planning module is covered by unit tests (`pnpm test`). The scene, the camera, the sound and the timings were written without running them in Chrome. Run the four auditors below before this goes to `main`.

## The rule: the game decides nothing

The winner is chosen by the [protocol](../protocolo.md) before the game starts. Sapo receives `(names, winners, beacon, done)` and only tells it. The token does not land by chance: the throws are **planned from the winners' holes**.

1. Names are shuffled over the holes with the round's seeded `rng`. It reuses `assignSlots` from [`plinko-plan.ts`](../../src/games/pixi/plinko-plan.ts): a permutation, so every name has its own hole and several winners never share one.
2. `holeLayout(n)` puts `n` holes evenly on a ring around the frog. The hole radius shrinks with the gap between neighbours.
3. `planThrows(n, winnerSlots, rng, opts)` returns the ordered throws. For each winner, in `winners` order: some `miss` throws, then some `near` throws, then one `hit`.
   - `miss`: lands on the bare table, between holes and outside the frog. It clinks, bounces and rolls off.
   - `near`: rests on the **rim ring** of a hole that is **not** the thrower's own target (a neighbour of it), between 1.2 and 1.6 hole radii from that hole's centre. It wobbles and pops out. The narrator names whoever sits at that hole.
   - `hit`: lands inside the winner's hole (within 0.45 of its radius from the centre). Its `targetSlot` is that winner's slot.
4. Neither a `miss` nor a `near` ever lands inside the capture radius of any hole (plus a small clearance), so the only way into a hole is the planned hit. This is checked geometrically in the tests.
5. The animation is a function of the stage clock only. The toss is a parabola in screen space between planned points, driven by `dt`. No `Math.random()`: same round, same frames.

All of this lives in [`src/games/pixi/sapo-plan.ts`](../../src/games/pixi/sapo-plan.ts), which has no Pixi or DOM imports, and is tested in [`sapo-plan.test.ts`](../../src/games/pixi/sapo-plan.test.ts) (every `n` from 2 to 12, one to `n` winners, 64 seeds).

## Several winners

A short toss sequence per winner, in the order of the winners list, each ending in its own hole (slots are distinct). Earlier winners get one miss and then their hit, with a one-line narration ("Toss 2 of 3", "It dropped into X's hole!"). The **last** winner gets the big moment: more tension throws, a longer hang before the final throw, a slower final flight and the camera following the token.

## Arcs and camera

The arc comes from [`drama.ts`](../../src/games/drama.ts) and sets how many tension throws the last winner gets (`optsForArc`). It is marked on the canvas (`data-arco`, `data-sapo="holes"`).

| Arc | Last winner's throws before the hit |
|---|---|
| Susto, duelo | 2 misses and 2 near misses. The narrator names the neighbour whose rim the token danced on ("Almost dropped into X's hole!") |
| Remontada | 4 misses and 1 near miss. The camera follows the last winner's tosses closely from the start |
| Tapada | 1 miss and 1 near miss. Nobody is named before the token is in (the near miss is only "Clink!"), and the camera waits for the second half of the final flight |

Camera: wide while the token waits; a follow zoom (about 1.25x) on the last winner's throws; a punch on every clink and a punch-in on a near miss; a slow push-in over the whole final flight up to about 2.3x, then a close-up of the winner's hole. On the hit the frog's mouth opens (it croaks), the hole lights up and pulses, and the winner plate follows.

## Caps and fallbacks

- **`SAPO_MAX = 12`**, exported from `src/state.ts` next to `PLINKO_MAX` (defined in `sapo-plan.ts` so tests can import it in Node). More than 12 holes stop being legible on a phone.
- **More than 12 names:** the draw falls back to the **llama race**, like Plinko and the wheel. The substitution is `playableGame()` in `src/state.ts`, used by `draw.ts` and by the preload in `games/engine.ts`. It changes nothing about who won.
- **No WebGL or `?motor=clasico`:** there is no classic-engine version, so the race tells the same winner.
- **Reduced motion / `?instant=1`:** `mountPixi` returns `null`, the game calls `done()` at once.
- **Skip button:** jumps to the winner plate; `done()` is called when the plate is dismissed, as always.
- **Lore card:** Sapo has no entry in `src/games/lore.ts` and nothing was invented. Like every game without its own entry it shows the generic sourced cards.
- **Mute:** all sounds go through `beep` in `src/sound.ts`, so they follow the sound toggle.

## Timing

In game seconds, not stretched: intro 4.5 s (holes appear one by one), 2.0 s hanging before the first throw, then each throw (0.75 to 0.9 s of flight plus 0.8 to 1.3 s of bounce, wobble or sink), 1.8 s of hang before the last throw, 2.2 s for its flight and 2.0 s of settling before the plate. For one winner that is roughly 20 to 24 s depending on the arc; each extra winner adds roughly 3 s. These are computed from the code, not measured: confirm with `audit-rigor` that normal, fast and epic land near 30, 20 and 42 s. They probably need tuning.

## Thumbnail

`src/ui/thumbs.ts` has a `sapo` painter: a green table, a frog, six holes and a token that alternates a miss and a drop. It depends only on the thumbnail clock.

## How to demo and audit

```bash
pnpm build && pnpm preview &
node scripts/audit-game.mjs sapo
node scripts/audit-sound.mjs sapo
node scripts/audit-rigor.mjs sapo
node scripts/audit-emocion.mjs sapo
```

`audit-rigor`, `audit-sound` and `audit-emocion` list `sapo` in their game lists (`TODOS` / `JUEGOS`). With `?n=200` the draw switches to the race by design.

Things only eyes can judge and nobody has: is the token readable at 390 px wide, do the hole avatars (placed just outside each hole) read from the back of a room and do they overlap at 12 names, is the near miss obvious, does the roll-off path cross a hole visually (the planner only guarantees the landing point, not the path to the exit), does the frog read as a frog, do the chips fit, and are the timings right.
