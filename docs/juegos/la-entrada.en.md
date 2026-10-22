# La Entrada

*English version of [la-entrada.md](la-entrada.md). If the two disagree, the Spanish one is up to date.*

The Oruro Carnival, told group by group. A brass band opens the parade and the fraternities follow, each one with its own dance: Diablada, Morenada, Caporales, Tinkus or Llamerada. Every group on the list is a fraternity, and while it passes the reviewing stand everyone's name can be read. At every arch a whole fraternity stays behind, its route finished, and waves from the sidewalk. In the last one people stay behind a few at a time until two are left, and those two face off in front of the Socavón: they jump in turns, either of them can stumble on any jump, and one of them ends the last jump on the ground. The one who arrives, arrives with bells and firecrackers.

**Id:** `oruro` · **Try it:** [tinkazo.app/?demo=oruro](https://tinkazo.app/?demo=oruro) · **Added:** September 28, 2026, as Carnaval de Oruro · **By fraternities:** October 21, 2026

## Why La Entrada

The Oruro Carnival was the biggest show in the catalog, but nobody shouted while watching it: a single crew of devils where a few stayed behind at every block, and nobody knew whom to cheer for. With two hundred people only a few names were ever readable. The games audit (October 4, 2026) marked it for improvement: "with fraternities as groups, everyone has someone to cheer for".

That is how the real entrada works. It is a pilgrimage to the Sanctuary of the Socavón ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)), with some fifty groups, more than 28,000 dancers and 10,000 musicians ([UNESCO](https://ich.unesco.org/en/RL/carnival-of-oruro-00003)), in more than eighteen dance styles, each fraternity with its own brass band ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)). A group of people with a name, a color and a dance, passing by together: that is a fraternity.

**The name.** "La Entrada" in Spanish and in English. It is a proper name, the name of the parade, like Chovena or Pasanaku; in English the "how it's played" card explains what it is. "Carnaval de Oruro" stays in the home page tagline and on the history card. In the English interface the fraternities are called *groups* ("The Jucumaris, the last group!"), and each block is a *block*.

## How it works

**The presentation.** The band opens: bass drum, cymbals, two tubas and two trumpets, in blue uniforms and caps. The fraternities follow in parade order, and each one passes the reviewing stand (the striped awning over the stands) while the camera looks at it up close. As it passes, a card says "HERE COME THE PARABAS", their dance, how many they are, and each member's name and face, up to twenty in two columns, in the same type size as the name chips (19 px on a 720-pixel screen). The announcer names each one ("The Tatús pass by, dancing Diablada!"), except those that pass while the room is still reading the call to clap. So everyone can be seen at the start, also with two hundred people: not 98 out of 200, as before. On a phone the card is narrow, and the fraternity name and the line below it shrink just enough to fit ("LOS JUCUMARIS" used to spill out on the right).

**The blocks.** Then the camera opens up to the whole parade, moving down the street between the facades and the packed stands. At every arch the head of the parade arrives, the band plays a chord and a whole fraternity steps onto the sidewalk: "Block 3! The Tojos stay behind". The camera moves in on them as they wave with both arms up, and the parade closes the gap and moves on. At the top, one chip per fraternity with its color and how many are still dancing; the one that stayed is crossed out. The arches carry no number: the fraternity that stays leaves from wherever it is in the parade, not from the head, and the number on the arch above it contradicted the announcer ("Block 6!" under an arch with a 2; October 21, 2026). The count is in the announcer's line and on the plate at the bottom right, "BLOCK 3 OF 11".

**The last fraternity.** When only one is left: "Only the Jucumaris are left!". Inside it, people stay behind a few at a time, at their own arches, until two are left. Now each one carries their full name above them; those who stay are crossed out with a red line that still lets the name be read. Those who do not get a tag are counted in a "+N" below the counter; on a phone, below the chips, which go below the counter there (on top of them, it covered the first one). Name tags never cover the counter, the chips, the block plate or the drum.

**The face-off.** In front of the Socavón the two face each other and jump in turns, each jump a little sooner and higher than the last. On any jump either of them can stumble: they wobble, their arms reach for balance, the mask or the hat slips, and they hold on. One of them ends the last jump on the ground: they land sitting down, eyes wide and mouth open, and the mask (or the hat, or the montera helmet) flies off and rolls away. "Diego Rojas's hat flew off!". Losing is funny. What flies is what was on the head, never the face: with the face inside what flew, a head could be seen rolling on the ground (October 21, 2026). There is a face under every mask, and it peeks out when the mask slips.

**The arrival.** The other one makes the last jump and reaches the Socavón plaza, with a three-note bell, and the announcer names their fraternity: "The Jucumaris made it to the Socavón!", "Bells for the Parabas: they reached the Socavón!". This is the moment of section 7.8 of the audit: our fraternity made it all the way to the Socavón. Then the crown card names the person, with the Socavón bells and firecrackers.

## The fraternities

They are the automatic groups of [`grupos.ts`](../../src/games/grupos.ts), the same ones as in the cable car: four people per group, up to ten groups, even in size, taken from the order of the sealed list. The Parabas are the Parabas in both games, with the same color (the color of their Mi Teleférico line, which in La Entrada colors the costume), and the QR list tells everyone which group they are in. They do not change anyone's chance: every name still counts once.

Each fraternity's dance is drawn with the round: the five dances are shuffled and each group takes one. With five fraternities or fewer no dance repeats; with ten, each dance appears twice, in two colors.

## The five dances

| Dance | What is drawn | How it moves | Source |
|---|---|---|---|
| Diablada | Mask with ringed horns, bulging eyes and the serpent on the forehead; cape embroidered with stars, golden sequined breastplate, trident | Jumps with a high knee, arms going up and down in turns, the cape flapping | [Diablada de Oruro](https://es.wikipedia.org/wiki/Diablada_de_Oruro) |
| Morenada | The *moreno* costume, a heavy embroidered bell shape; the mask with wild eyes and the tongue out, with its crown; the matraca rattle | A weary step: sways slowly from side to side, the matraca spinning | "slow rhythm and weary step", "extremely bulging eyes and protruding tongue", the matraca ([Morenada](https://es.wikipedia.org/wiki/Morenada)) |
| Caporales | High boots with bells, jacket with shoulder pads, hat | Jumps and kicks in the air, arms open | Boots with bells ([Caporales](https://en.wikipedia.org/wiki/Caporales)); kicks and jumps ([Caporales](https://es.wikipedia.org/wiki/Caporales)) |
| Tinkus | The montera, a hard helmet, with colored feathers; the striped woven vest, the chuspa bag, the abarca sandals | Crouched, stamping, fists up, in a zigzag | Helmet and sandals; hats with feathers and ribbons ([Tinku](https://en.wikipedia.org/wiki/Tinku)) |
| Llamerada | Hat with colored fringes, poncho, the sling and a small llama | The llama herder's step, the sling spinning over the head and the little llama in the other hand; pursed lips, whistling to the llamas | Sling in the right hand and llama in the left ([Llamerada](https://en.wikipedia.org/wiki/Llamerada)) |

Each costume piece is drawn once and turned into a texture, and each dancer is a handful of sprites: what carries the fraternity's color is drawn once per fraternity, what is the same in all of them is shared; what has the color of the skin is drawn in white and tinted, and the hair, once per color. Drawn as shapes, two hundred dancers ran at 25 frames per second. Each dancer's face, the one from the list, is on the chest.

### The women

In the real entrada, men and women dance in different costumes. Which costume each person wears comes from the name, as in the Chovena ([`genero.ts`](../../src/games/genero.ts): a list of common names and the ending); if the name does not say, the costume in the table above, the usual one. It is only drawing: it does not touch who wins.

| Dance | What is drawn | Source |
|---|---|---|
| Diablada | The *china supay*: painted mask with long eyelashes, wool eyebrows, mirror teeth and two little horns; braids with *tullmas*, kerchief, golden breastplate, short skirt with stars and white boots | "The mask, tullma, kerchief and boots" ([Los Tiempos](https://www.lostiempos.com/doble-click/cultura/20230212/trajes-estilizados-colores-vivos-son-tendencia-este-carnaval)); a painted earthenware china supay mask with mirror teeth, long eyelashes and wool eyebrows ([Horniman Museum](https://horniman.ac.uk/object/HC.1999.1546)) |
| Morenada | The *cholita*: short skirt embroidered at the hem, V-neck corset over the white blouse, two braids, and a hat and boots in the costume's color | "Short skirt embroidered at the edges and a V-neck corset", "both the hat and the boots are lined with the same fabric as the costumes", "long hair gathered in two braids" ([Diario de Cuyo](https://www.diariodecuyo.com.ar/noticias/las-danzas-religiosas-en-que-destacan-a-la-mujer-boliviana-336782.html)) |
| Caporales | Short pleated skirt that opens on every jump, V-neck blouse with puffed shoulders, embroidery on the chest, hair up, a small hat pinned to the hair, skin-colored stockings and heels | "Short skirt and a V-neck blouse, long sleeves puffed at the shoulders" (Diario de Cuyo); the round hat pinned to the hair, the stockings and the heels ([Caporales](https://en.wikipedia.org/wiki/Caporales)) |
| Tinkus | Long dress with woven stripes, waist-length jacket, sash, kerchief, and the hat with long feathers, ribbons and small mirrors | "A long dress with a waist-length jacket, woven in brightly colored wool" and "the hat has mirror details" (Diario de Cuyo); "dress, vest, kerchief, sash and hat" (Los Tiempos); hats with long feathers and ribbons ([Tinku](https://en.wikipedia.org/wiki/Tinku)) |
| Llamerada | The dance's fringed hat, embroidered blouse, knee-length skirt and the *aguayo* cloth carried on the back, knotted at the chest | We found no solid source for the women's llamerada costume: the skirt, the blouse and the aguayo are our guess, and it is the first thing someone from Oruro should review. The headdress resembles that of the Mama T'alla, the wife of an Aymara authority ([Llamerada](https://en.wikipedia.org/wiki/Llamerada)) |

The skirt sways with each dance's step: back and forth in the morenada, opening on every caporales jump. The women dance the same steps as the men; the cholita without the matraca, and the llamera without the sling or the llama, with both arms in step. What falls off them in the scare and in the fall is the hat (for the china supay, the mask).

## What the room does

**It claps to the band's beat.** It is the announcer's first line ("Clap along with the band!"), and the bass drum at the top right beats with the band: the drumhead lights up and the mallet hits on every beat, together with the stamping. The beat runs at 120 per minute in **real** seconds with any chosen length: game time stretches, the beat does not, because clapping slower than that is not possible. To the beat, and not for one of the two: clapping for one of them would be voting (section 7.8).

**It cheers for its fraternity.** Everyone knows their group from the QR list ("Parabas · Red line"), sees it pass with their name on the card, and follows it in the chips at the top and in the label each fraternity carries above its block.

## How you lose

Your fraternity stays behind at a block, all of it, and waves from the sidewalk: you become part of the audience, as a group. "They left us Tojos at the second one". In the last fraternity, you stay behind with a few others, your name crossed out above you. And in the face-off, you land sitting down and your hat flies off.

## What the parade does on purpose

Nothing on screen says who wins beyond chance. The plan's tests check this ([`entrada-plan.test.ts`](../../src/games/pixi/entrada-plan.test.ts)) with six hundred seeds:

- **The place of the winner's fraternity in the parade is drawn evenly,** at the head too (before, in the scare and the duel, the winner always started between second and fifth place).
- **So is their place inside the fraternity.**
- **Who stays at each arch does not depend on where they are in the parade:** it is drawn among the fraternities that are not the winner's, and it leaves from wherever it is.
- **In the face-off, which side the winner is on and who jumps first are drawn evenly** (before, the winner was always on the left and jumped first). The number of jumps is adjusted so the last one is the loser's, so who starts says nothing.
- **Stumbling happens to both, evenly.** The loser's last jump ends on the ground: that is already the end.

| Arc | Twist | What you see |
|---|---|---|
| Scare | The mask | Before the last arch of the last fraternity, someone still dancing almost loses their mask (or their hat flies off, or the montera): "Lucía Flores's mask almost fell off!". It is drawn among everyone still dancing, the winner included. With no arches in the last fraternity, it happens in the face-off, to one of the two |
| Comeback | The one that comes back | At an arch, a fraternity heads for the sidewalk as if it were staying ("Are the Tojos staying?") and comes back ("No! They keep dancing!"). It is drawn among those still in the parade after that arch, the winner's included |
| Duel | One more jump | The face-off lasts two more jumps |
| Hush | The band goes quiet | At an arch the band suddenly stops: the music cuts out, the parade freezes mid-step, the crowd stops bouncing and the room, which was clapping, freezes with it. "The band went quiet!". One heartbeat in the middle of the silence, and "The band plays on!" |

## Several prizes

A co-winner is not named when they leave: the announcer says the prize, not the name ("Block 3! The Tojos stay behind, with a prize", "Block 11! 3 stay, one with a prize"), and their name is read only on the card. In the last fraternity their tag is not crossed out: it gets a yellow border. The co-winners in the winner's fraternity stay until the end, from the last prize to the second, and the other one in the face-off never has a prize if someone without a prize can be chosen: a co-winner who loses the face-off would be a winner told as a loser. If one with a prize falls anyway, the fall does not name them.

## How it scales

| Participants | Fraternities | Arches | Last fraternity | Until the crown (game seconds) |
|---|---|---|---|---|
| 2 | 1 of 2 | 0 | Straight to the face-off, a longer one | 11.8 to 12.8 |
| 8 | 2 of 4 | 3 | 4 → 3 → 2 | 19.5 to 21.0 |
| 18 | 5 of 3 or 4 | 5 | 3 → 2, or 4 → 3 → 2 | 28.2 to 29.9 |
| 30 | 8 of 3 or 4 | 9 | 4 → 3 → 2 | 33.8 to 35.1 |
| 50 | 10 of 5 | 11 | 5 → 3 → 2 | 34.3 to 36.0 |
| 200 | 10 of 20 | 12 | 20 → 10 → 5 → 2 | 35.8 to 37.6 |

It was designed for 30 to 200 people. With fewer it works the same, with fewer fraternities: with two people there are no arches and the face-off lasts longer, and the stretch tops out at ×2.2.

## Timing

In game seconds, unstretched ("normal" stretches them so the show lasts 38 seconds, card included).

| Stretch | What happens |
|---|---|
| 0 – 0.7 s | The band opens. "Clap along with the band!" |
| 0.7 s – end of the presentation | Each fraternity passes the reviewing stand: 8.6 s shared among all of them, between 0.92 s and 2.2 s each (2.6 with only one) |
| + 0.9 s | The parade sets off toward the first arch |
| Each arch | From 1.45 s (with many) to 2.3 s (with few) between one and the next; those of the last fraternity, 0.15 s more. The comeback adds 1 s to its arch and the hush 1.2 s. After the last whole fraternity, a 0.9 s breather |
| + 2.2 s | From the last arch to the Socavón |
| Face-off | 0.6 s to settle in; the jumps, each 10% shorter than the one before (from 0.74 to 0.36 s); the fall, and 0.8 s later the winner's last jump |
| + 1 s | The crown |

## The camera

In the presentation it looks at the reviewing stand, with the passing fraternity in the space the name card leaves free (to its left on a big screen, below it on a phone). Along the route it frames the whole parade and fills the screen with it; if it does not fit (on a phone, with many people), the head and as much as fits. At each arch it moves to those who stay, on the sidewalk; in the last fraternity, also to those still dancing, so you see who stays and who goes on. When only one fraternity is left, the band leaves the shot. The scare and the fake-out get their close-up, and when the band goes quiet the camera stays still too.

In front of the Socavón, first the whole temple with the two in front, framed where they are going to be and where they still are: with two hundred people they come up from the front rows, and framed only at their final spot they spent more than a second behind the announcer's box. Then the two, closer and closer and with room for the jumps; that zoom comes in gradually from the temple shot, because with the center and the zoom moving at the same pace the camera moved in on the temple before coming down to them. On arrival, the plaza with the one who arrives and the other one sitting on the ground. At the crown, the one who arrived, whole, under the card: with several prizes the card is taller, and the camera goes down and opens just enough (games review, vistas-8, where the card covered the tips of the horns on a phone held sideways).

With two hundred people the dancers are drawn at a third of the size, and the camera can get up to 2.6 times closer than with eighteen: otherwise the face-off was two tiny figures in the middle of the street. Without the zoom blur (`cam.noBlur()`), so the names can be read on the way.

## Sound

- **The stamping:** one hit on every beat of the band, accented on the one.
- **Each fraternity that comes in:** two brass notes together.
- **Each arch:** the band's chord, higher and longer at each one; those of the last fraternity, one falling note per person who stays.
- **The comeback:** two falling notes ("are they staying?") and two rising ones ("no!").
- **The hush:** the music cuts out dead, a short hit, a heartbeat in the middle of the silence, and the band comes back with its beat.
- **The scare:** a short alarm.
- **The face-off:** one note per jump, alternating between the two and higher each time, with its footfall; the stumble, two low notes; the fall, three falling notes and a thud.
- **The arrival:** the three-note bell, and on the card the Socavón bells, after the fanfare so it does not cover them.

The beat music, when it is on, plays the role of the background band. It is not brass band music: that would be a style of its own in the music engine, like the Chovena's, and it is still pending.

## Respect

- **The Socavón is a sanctuary.** Real dancers enter it on their knees ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)). The winner reaches the plaza in front of the door, with bells, and does not go in: the sanctuary is not the prize.
- **The moreno's mask is silver metal,** with wild eyes and the tongue out. Painted in a skin color with thick lips, outside Bolivia it reads as a caricature.
- **The caporales carry no whip.** The caporal was the overseer of slaves ([Caporales](https://en.wikipedia.org/wiki/Caporales)); the dance keeps the boots, the jumps and the hat.
- **Nothing religious on the dancers:** no Virgin, no archangel, no banners with images. Each fraternity carries a banner with its color and a star.
- **The women's costume comes from the name, not from the position.** Assigned by position, a man could get the skirt, and that reads as mockery (found by the Chovena review, October 5, 2026). If the name says nothing, the usual costume. A man's name ending in a (Joshua, Mustafa) dances in a skirt: the list in `genero.ts` covers the names on the sample list and the common ones in Bolivia, not all of them.
- **The cholita is not a caricature.** The face is everyone's face, with rosy cheeks; the skirt, the corset, the braids and the hat as the sources describe them, nothing exaggerated.
- **What is not played:** UNESCO lists "the uncontrolled financial exploitation of the carnival" among its threats ([UNESCO](https://ich.unesco.org/en/RL/carnival-of-oruro-00003)). No brands, no beer, no cash prizes in the scene.

**Before calling it done, someone from Oruro should see it.** The costumes are our reading of the sources, not a drawing of a real costume.

## How it is built

- [`src/games/pixi/entrada-plan.ts`](../../src/games/pixi/entrada-plan.ts): the plan, pure and tested. The fraternities, the parade order, who stays at each arch, the last fraternity, the twist of each arc, the face-off and all the timings, written with the round's seed before the first frame.
- [`src/games/pixi/entrada-bailes.ts`](../../src/games/pixi/entrada-bailes.ts): the five costumes, men's and women's, the band and each pose, with no memory: the same time draws the same body.
- [`src/games/genero.ts`](../../src/games/genero.ts): which costume each person wears, from the name. The same one the Chovena uses.
- [`src/games/pixi/oruro.ts`](../../src/games/pixi/oruro.ts): the scene, the camera, the cards and the sound, on the new engine's scaffolding ([`stage.ts`](../../src/games/pixi/stage.ts)). It does not touch `stage.ts` or `camera.ts`.
- Name tags are placed with `layoutLabels`, the piñata's, with their inputs rounded to 1/64 of a pixel. The clock step comes from subtracting two absolute times (`stage.ts`), and since the stadium does not always appear on the same frame, two runs of the same round arrive with differences of 1e-12; with tags that just touch, that moved some of them for a few frames (with two hundred people, in one run out of three).

It has no version in the old engine: on a device without WebGL the draw comes out as the llama race, which tells the same winner.

## How to audit it

```bash
node scripts/audit-game.mjs oruro
node scripts/audit-rigor.mjs oruro
node scripts/audit-rigor.mjs oruro --gente 200
node scripts/audit-emocion.mjs oruro
node scripts/audit-identidad.mjs oruro
node scripts/audit-sound.mjs oruro
node scripts/audit-mezcla.mjs oruro
node scripts/audit-pantalla.mjs oruro --res 1280x720,1920x1080
pnpm exec vitest run src/games/pixi/entrada-plan.test.ts
```
