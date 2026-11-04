# Cómo se hicieron los sonidos

Los archivos de esta carpeta se generan con un servicio de efectos de sonido por texto (ver `LICENCIA.md`). Acá están los textos que se pidieron, para que se puedan volver a generar o ajustar. La llave del servicio nunca se guarda en el repositorio: se lee de la variable de entorno `ELEVENLABS_API_KEY` o de `.env.local`.

## Cómo se regeneran

1. Escribir un manifiesto JSON con `{juego, id, prompt, dur, variantes, loop}` por sonido (los de abajo son los usados).
2. `node scripts/sonidos/generar.mjs manifiesto.json --salida <carpeta de crudos>` baja las variantes (cada una cuesta unos 11 créditos por segundo).
3. `python -I scripts/sonidos/procesar.py <carpeta de crudos>` recorta el silencio, saca los graves que un parlante chico no reproduce, normaliza la sonoridad (RMS de -18 dBFS, pico máximo de -1,5 dBFS), elige las mejores variantes por medición (más energía por encima de 200 Hz; para las notas, la altura más cercana a la pedida y más clara), codifica a mp3 mono de 64 kbps y escribe `src/sonidos/archivos.ts`.
4. `pnpm test` (la prueba del banco mira que todo exista y que los pesos entren) y los auditores de sonido y de mezcla.

Las notas de los instrumentos (`-lo` y `-hi`) se afinan en el navegador con la velocidad de reproducción; su altura medida está en `archivos.ts`.

## Los textos pedidos

| Archivo | Texto pedido | Segundos | Variantes pedidas |
|---|---|---|---|
| `chovena/corte` | A sharp loud wooden drum slap, one tight hit, dry, then silence | 0.6 | 3 |
| `chovena/ganador` | A festive crowd cheer with a baroque violin flourish and a big drum hit, celebration climax | 3.0 | 4 |
| `comun/campana-hi` | A single soft glass bell chime note, high register, around C5, gentle ring, dry, no reverb, nothing else | 1.5 | 3 |
| `comun/campana-lo` | A single low pitched soft bell chime note, pitch G3 about 196 Hz, deep gentle ring, dry, nothing else | 1.5 | 5 |
| `comun/impacto` | A cinematic impact hit with a sharp mid-range snap and a punchy boom, bright crack on top of the thud, single hit, short decay, nothing else | 1.3 | 5 |
| `comun/kalimba-hi` | A single kalimba thumb piano note, high register, around C5, clean soft pluck, dry close-mic recording, no reverb, no other sounds | 1.2 | 3 |
| `comun/kalimba-lo` | A single kalimba thumb piano note, low register, around C3, clean soft pluck, dry close-mic recording, no reverb, no other sounds | 1.2 | 3 |
| `comun/madera-hi` | A single very high pitched tuned wooden xylophone block note, pitch C6 about 1046 Hz, short dry bright tonal tick, nothing else | 0.8 | 5 |
| `comun/madera-lo` | A single deep low pitched tuned wooden log drum marimba note, pitch G3 about 196 Hz, short dry tonal knock, nothing else | 0.8 | 5 |
| `comun/zampona-hi` | A single sustained very high pitched Andean panpipe zampona note, pitch C6 about 1046 Hz, bright breathy tone, steady, nothing else | 1.2 | 5 |
| `comun/zampona-lo` | A single sustained bass Andean panpipe toyo note, very low pitch G2 about 98 Hz to G3 196 Hz, deep hollow wooden flute tone, steady, nothing else | 1.2 | 10 |
| `guajojo/ganador` | Night forest at dawn: a night bird call then birds waking up and a cheering crowd, celebration climax | 3.0 | 4 |
| `guajojo/silbido-hi` | A single clear bird whistle note, high pitched around 1500 Hz, pure bright tone, dry, nothing else | 0.8 | 4 |
| `guajojo/silbido-lo` | A single clear human-like whistle note, low pitched around 300 Hz, pure soft tone, dry, nothing else | 0.8 | 5 |
| `oruro/bombo` | A single bass drum hit from a carnival band with a punchy beater click and a short boom, dry | 0.6 | 4 |
| `oruro/bronce` | A single sustained brass band trumpet note, bold and short, dry, nothing else | 1.0 | 3 |
| `oruro/bronce-hi` | A single sustained trumpet note, pitch C5 about 523 Hz, bold and bright, short, dry, nothing else | 1.0 | 4 |
| `oruro/bronce-lo` | A single sustained low brass note on a euphonium, pitch G3 about 196 Hz, bold, short, dry, nothing else | 1.0 | 4 |
| `oruro/campana` | A large festive bell chiming, a rich ring | 2.5 | 3 |
| `oruro/ganador` | A carnival brass band triumphant fanfare with a bass drum and a crowd cheering, celebration climax | 3.0 | 4 |
| `oruro/paso` | A dancer's boot stomp with a small jingle of bells, short | 0.5 | 3 |
| `pinata/caramelos` | Hard candies falling and bouncing on a tile floor, a short pattering shower | 1.0 | 3 |
| `pinata/ganador` | Children cheering and laughing with a party horn and a confetti pop, celebration climax | 3.0 | 4 |
| `pinata/palo` | A wooden stick whacking a papier-mache pinata, a dull paper thud with a rattle of candy inside | 0.7 | 3 |
| `pinata/rotura` | A pinata smashing open: loud crack, candies pouring and scattering on the floor, confetti paper rustle, kids cheering | 2.2 | 4 |
| `pinata/soga` | A rope creaking while holding a hanging weight, a short creak | 0.6 | 3 |
| `pinata/traqueteo` | Candies rattling inside a cardboard pinata being shaken, short | 0.8 | 3 |
| `race/casco` | A single llama hoof thud on dry dirt ground, soft and short, close, no music | 0.5 | 4 |
| `race/ganador` | A stadium crowd erupting in a joyful roar and cheer with a bright brass fanfare hit and clapping, celebration climax | 3.0 | 4 |
| `race/redoble` | A short rising snare drum roll lasting half a second ending on a soft hit, dry | 0.8 | 3 |
| `race/resoplido` | A single short llama snort and grunt, comedic, close-mic, nothing else | 0.8 | 3 |
| `race/tropiezo` | A cartoon stumble: a quick scuff slide on dirt and a soft thud with a tiny crowd 'oooh', short | 1.0 | 3 |
| `sapo/boca` | A metal coin dropping into a hollow wooden mouth: a bright metallic clink then a hollow glup | 1.2 | 3 |
| `sapo/ficha` | A single metal coin token bouncing and clinking on wood, short and bright, dry | 0.6 | 3 |
| `sapo/ganador` | A big frog croak followed by a cheering crowd and a metallic coin jackpot clink, celebration climax | 3.0 | 4 |
| `teleferico/apagon` | An electric power-down: a quick descending whirr and a clunk as the lights go out, short | 1.0 | 3 |
| `teleferico/cable` | Steel cable humming and creaking under tension from a cable car, a low smooth whirr | 1.0 | 3 |
| `teleferico/ganador` | A cable car station bell ringing and a crowd cheering with applause, high mountain celebration climax | 3.0 | 4 |
| `teleferico/llegada` | A cable car arriving at the station: an arrival bell ding and a gentle mechanical settle | 1.5 | 3 |
| `teleferico/torre` | A cable car passing over a pylon tower: a metallic clunk and rattle, short | 0.8 | 3 |
| `toborochi/colibri` | A hummingbird hovering, a fast steady wing buzz, no music | 1.5 | 3 |
| `toborochi/ganador` | Wind chimes and wooden flutes with a crowd cheering, a majestic flowering tree celebration climax | 3.0 | 4 |
| `toborochi/viento` | A gust of wind through trees, a whooshing breeze, no music | 3.0 | 3 |
| `trompo/cae` | A wooden spinning top wobbling and falling over with a rolling clatter on dirt, short | 1.2 | 3 |
| `trompo/choque` | Two wooden spinning tops colliding with a sharp wood clack and a short buzz, close | 0.9 | 3 |
| `trompo/ganador` | A crowd cheering with a wooden top spinning down and wood clacks, triumphant celebration climax | 3.0 | 4 |
| `trompo/zumbido` | A wooden spinning top whirring, a steady smooth buzzing whirr, no music | 1.5 | 3 |
| `wheel/ganador` | A carnival wheel stopping with a ratchet slowdown and a bell ding then a crowd cheering, jackpot celebration | 3.0 | 4 |
| `wheel/tum` | A single soft mid-range drum thump like a conga or tom drum with woody body around 250 Hz, short, dry | 0.7 | 4 |
