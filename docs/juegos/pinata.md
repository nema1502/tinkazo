# Piñata

La de las posadas y los cumpleaños. Una estrella de siete picos cuelga en el patio, con papel picado arriba. Cada nombre es un caramelo adentro. Con cada palo caen algunos, y los que caen quedan afuera. Al final la piñata se rompe, y el último caramelo, el que se quedó adentro hasta el final, baja despacio: ese gana.

**Identificador:** `pinata` · **Probalo:** [tinkazo.vercel.app/?demo=pinata](https://tinkazo.vercel.app/?demo=pinata) · **Agregado:** 28 de septiembre de 2026

## Por qué una piñata

Porque es la fiesta más reconocible de Latinoamérica y porque tiene suspenso de fábrica: todo el mundo sabe que algo va a caer y nadie sabe cuándo se rompe. Según el INAH de México, llegó en 1586 con los frailes agustinos de Acolman, en las misas de aguinaldo que después se volvieron las posadas. La de siete picos es la clásica.

Y el relato viene solo: "¡Dale, dale, dale! ¡No pierdas el tino!".

## La mecánica

**La piñata cuelga.** Es un péndulo que se amortigua: cada palo le da un empujón y se hamaca. La cuerda cruje cada vez que pasa por abajo.

**Los palos.** Entre cinco y nueve, según cuánta gente haya, cada vez más seguidos. Cada palo entra en arco con su estela, y donde pega sale una estrella y se desprenden papelitos; la piñata se aplasta y rebota, se sacude, se raja un poco más y caen caramelos: al principio muchos, al final de a uno. Los caramelos rebotan, ruedan y se apilan en un montoncito que crece, que se desliza por las laderas: antes quedaban todos en el piso, a una altura al azar, y eran tan chicos que se leían como puntitos. Cuando quedan seis o menos adentro, al lado de la piñata aparece la lista de quiénes siguen.

**La rotura.** El último golpe la rompe con un destello: la olla se parte en ocho pedazos que salen girando, y los siete picos salen volando con una lluvia de papel de china. La rival cae primero, rápido. El caramelo ganador cae último, despacio, casi flotando, con un brillo, y el piso lo recibe.

## Lo que la piñata hace a propósito

**El caramelo ganador nunca cae antes.** El orden en que caen está sembrado con la ronda, y la ganadora va primera en esa lista. El palo no decide nada.

| Arco | Qué pasa |
|---|---|
| Susto | En los últimos palos el caramelo ganador se asoma por la rajadura ("¡casi se cae fulano!") y vuelve a entrar |
| Remontada | Dos palos al aire antes de los últimos ("¡falló!") |
| Duelo | Quedan dos adentro hasta el golpe final, y cae la rival |
| Tapada | La lista de los que quedan adentro no se muestra, y nadie la nombra hasta que se rompe |

## Cómo escala

| Participantes | Palos | Qué se ve |
|---|---|---|
| 2 | 5 | Pocos caramelos grandes; casi todo es el suspenso de la rotura |
| 18 | 8 | Una lluvia de caramelos al principio y la lista de los últimos seis |
| 200 | 9 | Llueven caramelos chicos y se arma una alfombra en el piso |

Con doscientos, los caramelos que ya quedaron quietos se dibujan una sola vez en una capa fija. Redibujarlos en cada cuadro le costaba a un celular.

## Los tiempos

En segundos de juego, con 18 participantes y sin estirar.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 3,0 s | La piñata cuelga. "¡Arriba la piñata!", "¡18 caramelos adentro, uno por nombre!" |
| 3,5 – 14,9 s | Ocho palos, cada vez más seguidos |
| 15,5 s | Se rompe. "¡SE ROMPIÓ!" |
| 16,0 – 17,9 s | Cae el último caramelo, despacio |
| 17,9 s | El cartel, con el caramelo ganador brillando en el piso |

Al principio era más corta y el modo "épico" no llegaba a durar lo elegido: estirado al máximo, que es ×2,2, se quedaba en 32 de 42 segundos. Ahora tiene más palos y más aire entre ellos.

## La cámara

La piñata de cerca en los palos, más cerca cuando se raja y cuando se asoma el caramelo del susto, y cuando se rompe sigue al último caramelo hasta el piso.

## El sonido

- **Al colgarla:** tres notas que suben.
- **Los caramelos adentro:** un traqueteo cuando se anuncia cuántos hay.
- **La cuerda:** un crujido cada vez que la piñata pasa por abajo, cambiando de nota para no repetir el mismo golpe.
- **Cada palo:** un golpe seco y el repiqueteo de los caramelos que caen.
- **El palo al aire:** una nota suave.
- **La rotura:** un golpe fuerte y, mientras baja el último caramelo, un arpegio que desciende nota por nota hasta el piso.

## Cómo está hecho

Vive en [`src/games/pixi/pinata.ts`](../../src/games/pixi/pinata.ts) y usa el andamiaje del motor nuevo, [`src/games/pixi/stage.ts`](../../src/games/pixi/stage.ts). No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

## Cómo auditarlo

```bash
node scripts/audit-rigor.mjs pinata
node scripts/audit-game.mjs pinata
node scripts/audit-emocion.mjs pinata
node scripts/audit-sound.mjs pinata
```
