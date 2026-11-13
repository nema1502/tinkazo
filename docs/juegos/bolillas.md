# Bolillas

Estado: **borrador** (nacido con `node scripts/nuevo-juego.mjs bolillas`). Apagado en el selector: abre con `?demo=bolillas` y `?pose=bolillas`.

> Esta es la página de diseño del paso 1 de "Cómo nace un juego" (`docs/juegos.md`). Una página: se llena antes de escribir la escena y pasa con el sí de quien mantiene el proyecto.

La troya de Santa Cruz: un círculo de tiza en la tierra con las canicas de los que juegan adentro, y una pegadora que tira por turnos. Cada canica que cruza la tiza queda eliminada; la última que se queda adentro se lleva el premio, y ya lo decidió el sorteo antes de la primera tirada. El juego se llama **Bolillas** porque así se dice en Santa Cruz; en otras partes lo mismo se dice canicas, y los textos lo pueden mencionar. El plan puro (`src/games/pixi/bolillas-plan.ts`) trae la siembra de canicas y la geometría de cada tiro (largada, impacto, salida, deflectación), y la escena 2D y la 3D animan el mismo plan.

## El momento que hace gritar a la sala

La última tirada roza a la canica que gana: rueda hasta la tiza, titila en la orilla, parece que va a cruzar, y se queda adentro. Queda sola en el círculo: ese nombre ganó.

## Para cuántas personas

De 2 a 200. La troya se juega con hasta 12 canicas (`CANICAS_MAX` en el plan): el círculo se lee y cada tiro se siente. Luce de 5 a 12: con pocas, el círculo queda vacío y los tiros pasan de uno al otro. Con más de 12, una tanda previa (`qualifier.ts`): aparecen todos los nombres, se cruzan en una a tres oleadas hasta que quedan 12 finalistas (siempre con los premios adentro) y esos siembran sus canicas en el círculo. Con dos premios o más, las canicas de los premios no salen nunca: la última golpeada es la del primer premio. Va a `rango` en `src/games/pixi/kit/catalogo.ts`.

## Las reglas de la pegadora

- **El orden de las canicas sale de la ronda**: la misma tanda saca siempre a las mismas canicas, de a una por tirada; la rival de la historia sale en el último tiro antes del casi.
- **Ninguna tirada toca a la canica que gana**, hasta el casi del cierre, que la roza sin cruzarla: el plan mide cada tramo de tiro (ida, salida y deflectación) para que no roce a nadie que sigue adentro, y a los premios nunca.
- **Todas las canicas salen cruzando la tiza**, con el rumbo y la fuerza que el plan les fijó; después quedan afuera, con su nombre apagado.

## El giro de cada arco

| Arco | Qué ve la sala |
|---|---|
| Remontada | La canica que gana queda sembrada al centro y casi no la buscan; los tiros de afuera van sacando la orilla hasta dejarla sola, y la sala la descubre tarde. |
| Susto | Un tiro roza la canica que gana antes de tiempo y no la saca: la sala la mira con cuidado desde ahí, y en el cierre casi la cruzan igual. |
| Duelo | Las últimas dos canicas quedan cerca de la tiza; el tiro pega a la rival y la manda a la orilla, pegada a la canica que gana, que tiene que titilar para no cruzar. |
| Tapada | El tiro que saca a la rival rebota y va directo hacia la canica que gana: el casi del cierre es el rebote que se frena en la tiza. |

## Cómo cada uno lee su nombre antes del ganador

Cada canica lleva la cara de su persona y su nombre junto a la canica (el chip del estadio, `S.chip`). Con 12 o menos, todos las ven desde la siembra; con más, se ven primero en la tanda previa (todos los nombres, tachados en oleadas) y los finalistas pasan al círculo. La cámara anda del círculo entero al tramo del tiro en curso, y el nombre de la canica que sale queda apagado donde cruzó. Con 8 leen todos; con 18, nueve de cada diez (`audit-identidad`).

## La ficha del niño

Se aprueba antes del código. La regla (26 de octubre de 2026): **cualquier cuadro del juego, sin leer el relator, muestra si ya ganó alguien, cuánto falta, qué acaba de pasar, adónde mirar y lo propio de su forma**. La forma va en `catalogo.ts` (de-pie), el plan lo declara en `respuestas(t)` y `audit-nino` lo compara con una foto y una tira de tres cuadros sin subtítulo.

- **Ir adelante es:** seguir adentro del círculo (los que no cruzaron la tiza: la tanda previa los cruzó y la pegadora saca los demás de a uno). El líder no es el ganador.
- **Hacia dónde:** centro (`sentido: "centro"`), de principio a fin: las canicas van y vienen alrededor de la tierra, la tiza no la cruza la cámara.
- **Lo que falta se ve con:** las canicas que quedan adentro, apagándose una a una; el número lo canta el marcador.
- **El contador:** el marcador del kit, arriba a la izquierda; baja con cada oleada de la tanda previa y con cada canica que cruza, y llega a 1 con el golpe.
- **Cada hecho, con su tipo y su pose:** `salio` en cada oleada y en cada tiro (la canica vuela cruzando la tiza a los 0,3 s de su línea), `casi` cuando la última tirada roza a quien gana (la canica titila sobre la tiza), `gano` al caer el golpe.
- **Cómo sale quien sale:** la canica cruza la tiza con su nombre y queda apagada afuera, sin X roja; suena `sonido.salida()`.
- **El relator:** seis palabras o menos, ningún nombre (los nombres van junto a las canicas), ningún número.

## Qué no es

No hay dinero en juego: la pegadora no cobra ni reparte nada, y nadie gana un botín. No hay casino, ni fichas, ni tablero. Lo cultural, según lo pasado por quien pide el juego: en Santa Cruz al juego de canicas se le dice **bolillas**, y la variante que juega es **la troya** (círculo de tiza en la tierra, las canicas puestas adentro, tirar para sacarlas: es.wikipedia.org/wiki/Canica). Falta la fuente local de la troya para salir del borrador.

## Batería

- [ ] `pnpm typecheck` y `pnpm test`
- [ ] `audit-game` 20/20
- [ ] `audit-nino` (una foto y una tira de tres cuadros sin subtítulo contra `respuestas(t)`)
- [ ] `audit-rigor`, `audit-identidad`, `audit-emocion`, `audit-sound`, `audit-mezcla`, `audit-pantalla`, `audit-delatores`
- [ ] Capturas en escritorio y celular, dos temas, con la revisión visual
- [ ] `node scripts/nuevo-juego.mjs --encender bolillas`
