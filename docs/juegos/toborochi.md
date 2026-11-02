# El Toborochi

Estado: **apagado en el selector** (2 de noviembre de 2026). Abre con `?demo=toborochi` y `?pose=toborochi`; entra al selector con `node scripts/nuevo-juego.mjs --encender toborochi` después de pasar la batería y con la aprobación de quien mantiene el proyecto. Está escrito sobre el [kit de juegos](../juegos.md#cómo-nace-un-juego-el-kit): el plan es [`toborochi-plan.ts`](../../src/games/pixi/toborochi-plan.ts) (puro, con sus pruebas), el árbol [`toborochi-arbol.ts`](../../src/games/pixi/toborochi-arbol.ts) (puro) y la escena [`toborochi.ts`](../../src/games/pixi/toborochi.ts).

Un toborochi en flor, sin hojas, en una mañana de mayo (tema claro) o al atardecer (tema oscuro). Cada persona es una flor en la punta de una rama, con su cara y su nombre. El surazo pasa por la copa en ráfagas y, a su paso, suelta las flores que la ronda descartó: caen con su nombre y quedan escritas en la alfombra del suelo. Cuando quedan dos, un colibrí las visita, duda y se posa en una. Gana donde se posa el colibrí; el protocolo ya lo había decidido y el juego solo lo cuenta.

## El momento que hace gritar a la sala

Quedan dos. El viento para en seco y cae un pétalo; cuando el colibrí se suspende frente a la primera flor, calla la música. Entra el colibrí zumbando y se suspende frente a una flor: media sala grita su nombre. Retrocede (vuela para atrás) y va a la otra: grita la otra mitad. Duda, a veces vuelve. Calla el zumbido, mete el pico en la elegida y se posa: golpe, la flor se enciende y los pétalos del suelo suben en remolino. Y en cada ráfaga, cada uno mira su flor mientras llega la ola: «¡aguantá!». En la piñata los nombres están adentro; acá, a la vista.

## Para cuántas personas

Mínimo 2, ideal de 8 a 40, máximo 200. Con 3, flores enormes y una ráfaga de práctica; con 8, el nombre entero en cada flor; con 18, nombre de pila (con inicial si se repite); con 30, seis ramas de cinco; con más de 64 no hay tandas de nombres.

| Personas | Ráfagas | Show hasta el golpe (sin estirar) |
|---|---|---|
| 2 | 1 (de práctica) | 12 a 15 s |
| 3 | 2 (una de práctica) | 16 a 19 s |
| 8 | 3 | 21 a 28 s |
| 18 | 3 | 26 a 33 s |
| 30 | 4 | 32 a 40 s |
| 60 | 5 | 44 a 51 s |
| 200 | 6 | 37 a 44 s |

Las ráfagas son 1 con 2, 2 hasta 7, 3 hasta 18, 4 hasta 42, 5 hasta 102 y 6 con más; el duelo suma una. Dejan dos: con 18 se llevan 8, 5 y 3. El reloj estira el show a la duración que se eligió (hasta 2,2 veces), así que «Normal» promete lo de siempre y no hace falta una tabla propia.

## Cómo es el show

| Fase | Segundos | Qué se ve |
|---|---|---|
| Florece | 2,5 | Se abren las flores |
| Tandas | 1,5 por tanda de ocho (hasta 64) | Una brisa muestra nombres enteros |
| Ráfaga | 2,8 + 0,2 por flor que suelta (hasta 1,2) | Se nubla el sur; una ola de viento dobla la copa entera y, a su paso, suelta a las que la ronda descartó |
| Calma | 1,2 (+1 por cada premio de más) | Los nombres de hasta ocho de las que quedan; en la primera, un colibrí lejos |
| Quedan dos | 1,2 | El viento para en seco; una a cada lado |
| Colibrí | 3,9 a 6,8 | Dos a cuatro visitas, sembradas; calla el zumbido y mete el pico |
| Se posa | foco + cartel | Golpe, la flor se enciende, los pétalos suben en remolino |

**El viento empuja al grupo, nunca a una.** El plan reparte una permutación sembrada de todos menos las finalistas y los premios de más; el lugar de cada flor también es sembrado; el frente cruza la copa de izquierda a derecha y cada flor se suelta cuando le llega. Con varios premios la rival es la segunda premiada y los demás se van en las calmas, «con premio», con un brillo dorado.

## El giro de cada arco

| Arco | Qué ve la sala |
|---|---|
| Remontada | En la última ráfaga una de las dos (la ganadora la mitad de las veces) se cae y se engancha más abajo |
| Susto | En la última ráfaga una de las dos (la ganadora la mitad de las veces) cuelga de un hilo y aguanta |
| Duelo | Una ráfaga más |
| Tapada | Las dos últimas quedan sin nombre hasta el cartel |

Además, en la primera ráfaga de los otros arcos, una flor sorteada puede colgar de un hilo y después caer.

## Los delatores

- La ola dobla **la copa entera**, igual para todas; nunca una flor sola.
- Tiemblan fuerte de tres a cinco flores en cada ráfaga, sorteadas **entre todas** las que siguen (también las que van a caer).
- Ninguna rama se vacía antes de la última ráfaga.
- El colibrí visita a las dos, alternando; la primera visitada gana la mitad de las veces (con 400 semillas, entre el 40 y el 60 %).
- La cámara encuadra a las **dos** finalistas, nunca a la visitada sola, y el desenfoque se apaga.
- El cielo se nubla de a poco y nunca sobre las flores.

## Cómo cada uno lee su nombre antes del ganador

1. Tandas de ocho con el nombre entero (`S.batch`), hasta 64 personas.
2. En cada calma, hasta ocho de las que quedan (cinco en un celular), y hasta seis durante cada ráfaga (tres en un celular).
3. Cada flor que cae lleva su nombre al suelo (hasta diez por ráfaga).
4. La alfombra los conserva: una rejilla en el suelo con el nombre de las últimas que cayeron, al nivel que entra en su casilla.
5. En «quedan dos» y con el colibrí, los nombres de las dos (salvo en la tapada).

La meta de `audit-identidad` es 8 de 8, 17 de 18 y 27 de 30.

## La ficha del niño

- **Ir adelante es:** seguir en el árbol. El contador baja de a una cada vez que una flor se desprende y llega a 1 con el golpe.
- **Hacia dónde:** arriba. Hay que mirar el árbol: las que siguen están en la copa, y las que se van caen a la alfombra, fuera de la mirada. La primera versión decía «abajo» y un describidor a ciegas contestó «arriba» las 27 veces que vio el árbol.
- **Lo que falta se ve con:** las flores que quedan en la copa y la alfombra que se llena.
- **El contador:** el del kit, arriba a la izquierda, «QUEDAN n DE N», con una fila de marcas debajo (una por persona: encendidas las que siguen).
- **Cada hecho, con su tipo y su pose:** «se va» (`salio`: la flor se desprende y baja aleteando), «cuelga de un hilo» o «se engancha» (`casi`), «visita» (`casi`: el colibrí suspendido frente a la flor) y «gana» (`gano`: la flor se enciende).
- **Cómo sale quien sale:** cae con su nombre y queda escrita en la alfombra; sin X roja y con el tono suave de siempre.
- **El relator:** seis palabras o menos, un nombre y ningún número («¡Se va Ana, con premio!»).

## Cámara, sonido y letra

- **Cámara:** el árbol entero respirando un 1 % (en celular, la copa arriba y la alfombra abajo); en las ráfagas, un sacudón chico en el pico y una inclinación leve de toda la escena; desde «quedan dos», las dos finalistas; silencio de 0,4 s y golpe.
- **Sonido:** viento de ruido filtrado de 350 a 1.500 Hz (de 0,04 a 0,05, más fuerte en cada ráfaga), punteo de `note(16)` a `note(10)` en las caídas, zumbido de `note(12)` con trémolo que crece al acercarse y calla 0,4 s antes de posarse, «tsip» de `note(18)` en cada visita; la música se corta cuando el colibrí se suspende frente a la primera flor (con ella, la mezcla pierde menos en un parlante chico); golpe y fanfarria del kit. El viento no son osciladores: lo mide `audit-mezcla`, no `audit-sound`.
- **Letra:** la del kit (al menos el 2,6 % del alto en un proyector y 16 px en un celular). Los nombres van en chip o con contorno, nunca sobre el rosado.
- **Tema:** claro, mañana de mayo; oscuro, atardecer.

## Qué es y qué no es

- **La leyenda** no se cuenta durante el show. Va después del resultado, en la tarjeta plegada «¿De dónde viene este juego?», y nombra a Araverá con su fuente: [El Deber, 24 de mayo de 2025](https://eldeber.com.bo/santa-cruz/el-toborochi-en-flor-un-simbolo-que-pinta-de-rosa-santa-cruz_515706/). Cuenta la leyenda, no biología: no afirma ningún dato de la naturaleza como cierto. Se cuenta de muchas maneras (Tarija cuenta otra).
- Ni Araverá ni los espíritus se dibujan; el colibrí es un pájaro, no un dios.
- «Toborochi» en los dos idiomas, como Pasanaku; en pantalla «surazo» y, en inglés, «the south wind». Nunca eliminado, perdió, suerte ni Araverá en el show.
- Sin nombre científico.
- Nada con cara de casino y nada de apuestas.

## Para validar con quien mantiene el proyecto (lo cultural)

1. Que el colibrí visite el toborochi del juego: El Deber lo dice de la leyenda («aún asoma convertida en flor para ser visitada por los colibríes»); que lo haga el árbol real no lo dice (habla de «aves, abejas y otros polinizadores»).
2. El surazo en mayo es una suposición del diseño, no un dato de la fuente.
3. Que la tarjeta nombre a Araverá (decisión del 1 de noviembre), con la fuente.
4. Que las que caen «se van» (no «pierden»). El rótulo del contador fue «EN EL ÁRBOL» hasta la cuarta vuelta de la prueba del niño; ahora es «QUEDAN», igual en todos los de pie.

## Batería

- [x] `pnpm typecheck` y `pnpm test`
- [ ] `audit-game` 20/20
- [ ] `audit-nino` (tres capturas sin subtítulo contra `respuestas(t)`)
- [ ] `audit-rigor`, `audit-identidad`, `audit-emocion`, `audit-sound`, `audit-mezcla`, `audit-pantalla`, `audit-delatores`
- [ ] Capturas en escritorio y celular, dos temas, con la revisión visual
- [ ] `node scripts/nuevo-juego.mjs --encender toborochi`
