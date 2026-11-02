# Guajojó

Estado: **apagado en el selector** (1 de noviembre de 2026). Abre con `?demo=guajojo` y `?pose=guajojo`; entra al selector con `node scripts/nuevo-juego.mjs --encender guajojo` al pasar la batería y con el sí de quien mantiene el proyecto. Está escrito sobre el [kit de juegos](../juegos.md#cómo-nace-un-juego-el-kit): el plan es [`guajojo-plan.ts`](../../src/games/pixi/guajojo-plan.ts) (puro, con 29 pruebas) y la escena [`guajojo.ts`](../../src/games/pixi/guajojo.ts).

Un sendero del monte de noche, visto desde atrás del grupo. Al fondo, un palo seco: es el guajojó. De día es la punta de un palo; de noche abre dos ojos amarillos. Mientras canta se camina; cuando calla, quietos: la mirada barre el sendero y al que no le alcanza el freno pisa una ramita (¡crac!) y se sienta en la hinchada. Gana quien llega de pie al amanecer. Es el parecido de «luz roja, luz verde» que se pidió en octubre, pero boliviano, sin la sombra de una serie de apuestas y sin un faro técnico.

## El momento que hace gritar a la sala

Quedan dos, en un pie, a cada lado del palo. El ave corta el canto antes de la nota grave, la música se apaga y se abren los ojos. La mirada va a una (en el susto, la ganadora): tambalea… aguanta, y la sala grita «¡aguantá!». La mirada va a la otra: «¡CRAC!». Un respiro, y el amanecer: sale el sol, la hinchada se pone de pie y el nombre va en grande.

## Para cuántas personas

Mínimo 2, ideal de 8 a 30, máximo 200. Con 3, cada uno es personaje; con 8, todos los nombres a la vista; con 18, la hinchada llena un costado; con 30, los nombres van por tandas; con más de 64 no hay lista y el primer silencio sienta a casi la mitad.

| Personas | Silencios | Show hasta el golpe (el duelo suma un silencio) | «Normal» promete (con la tarjeta de «cómo se juega» adentro) |
|---|---|---|---|
| 2 | 2 (uno de práctica) | 19 s | 29 s |
| 3 | 3 (uno de práctica) | 25 s (duelo 32) | 35 s |
| 8 | 4 | 32 s (duelo 38) | 41 s |
| 18 | 4 | 34,6 s (duelo 41) | 44 s |
| 30 | 5 | 42,5 s (duelo 49) | 52 s |
| 60 | 6 | 55 s (duelo 62) | 60 s (tope) |
| 200 | 7 | 50 s (duelo 57) | 59 s |

Los silencios son 2 con dos personas, 3 hasta 7, 4 hasta 18, 5 hasta 42, 6 hasta 102 y 7 con más; el duelo suma uno. «Rápido» es el 90 % de «Normal» y el techo es 60 s. «Normal» no cambia con el arco: sale de la cantidad de gente (`guajojo-duracion.ts`, que el selector lee sin cargar el juego) y el estiramiento absorbe el duelo y la tapada.

## Cómo es un silencio

| Fase | Segundos | Qué se ve |
|---|---|---|
| Llamada | 2,5 | Cae el sol, luciérnagas, el silbo |
| Lista | 1,5 por tanda de 8 (hasta 64) | Salen los caminantes con farolito y nombre |
| Canto | 2,6 (1,7 en la tapada) | Todos avanzan, con su silbo y de tres a cinco notas que bajan |
| Silencio | 2,4 + 0,2 por ciclo | Se abren dos ojos amarillos y la mirada barre; varios tambalean en un pie |
| ¡Crac! | 0,8 | Al que le toca no le alcanza el freno: pisa una ramita y se sienta en la hinchada |
| Último silencio | 3,6 | Quedan la ganadora y la rival junto al palo; la mirada va a cada una y cae la rival |
| Amanecer | 2,6 + cartel | Camina sola al palo, sale el sol y el ave vuelve a ser rama |

**Quién se sienta** sale de una permutación sembrada de todos menos la ganadora y la rival, repartida con el reparto de «luz roja, luz verde» (con 18, caen 8, 5 y 3, y al final la rival). **La última de pie es la elegida, pero la sala no lo puede saber:** la mirada, los tambaleos y el orden de caída salen de la ronda, no de quién gana. Algunos de los que se salvan también tambalean (hasta seis por silencio), y la ganadora tambalea con la misma chance que cualquiera; en el último silencio, a quién mira primero la mirada lo sortea la ronda (salvo en el susto). Con varios premios la rival es la segunda premiada («¡Se sienta, pero con premio!») y los demás premiados se sientan antes.

## El giro de cada arco

| Arco | Qué ve la sala |
|---|---|
| Remontada | Sale última y en el último canto pasa a todos para llegar junto al palo |
| Susto | La mirada se detiene en la ganadora en el penúltimo silencio, que tambalea y aguanta, y en el último empieza por ella antes de ir a la rival |
| Duelo | Un silencio más, con la rival adelante hasta el final |
| Tapada | El canto corto (dos notas) y cae una tanda grande; la ganadora corre en el medio del grupo |

## Cómo cada uno lee su nombre antes del ganador

1. **Lista:** tandas de ocho (hasta 64 personas), 1,5 s cada una, con el nombre sobre la cabeza.
2. **En cada canto y silencio**, los nombres de hasta doce de los que siguen, rotando cada 0,9 s; en el último silencio, los dos.
3. **En cada crac**, el nombre de quien se sienta crece un segundo, pegado a donde pasó.

La meta de `audit-identidad` es 8 de 8, 17 de 18 y 27 de 30.

## La ficha del niño

- **Ir adelante es:** seguir de pie en el sendero. El contador baja a medida que la gente se sienta y llega a 1 con el golpe.
- **Hacia dónde:** arriba, hacia el palo. Un solo sentido de principio a fin: el grupo se achica al acercarse al horizonte.
- **Lo que falta se ve con:** el palo (la meta, en todo cuadro), la distancia a la que están los que quedan y la hinchada que crece a los costados.
- **El contador:** el del kit, arriba a la izquierda, «QUEDAN n DE N», con una fila de marcas debajo (una por persona: encendidas las que siguen).
- **Cada hecho, con su tipo y su pose:** «se sienta» (`salio`: el cuerpo se agacha en 0,28 s, con la ramita que se parte y las chispas), «aguanta» (`casi`: en un pie, con los brazos en vilo) y «gana» (`gano`: los brazos arriba junto al palo).
- **Cómo sale quien sale:** se sienta donde pasó y su nombre crece un segundo ahí mismo; después se desliza a la hinchada. Sin X roja y con el tono suave de siempre (`sonido.salida()`).
- **El relator:** seis palabras o menos, un nombre y ningún número («¡Crac! Te escuchó, Ana»).

## Cámara, sonido y letra

- **Cámara:** plano entero en la llamada y la lista; detrás del grupo mientras camina; a los ojos y la mirada cuando calla (el palo, la meta, está siempre en cuadro); en el último silencio, sobre los dos y el palo. Un golpe de cámara y un sacudón en el primer crac de cada silencio.
- **Sonido:** un silbo (`note(14)`, 0,55 s) y de tres a cinco notas que bajan (la grave es «¡quietos!»); la música se corta en el silencio (`musicHold`) y vuelve en el crac; latido a 0,75 s; clic de ramita en cada crac; en el amanecer, la escalerita, el golpe de siempre y la fanfarria del kit.
- **Letra:** la del kit (`nombres.ts`: al menos el 2,6 % del alto en un proyector y 16 px en un celular). La noche es de medios tonos para que no se queme en un proyector: solo brillan los ojos, los farolitos y las luciérnagas.
- **Tema:** oscuro, noche con luna; claro, atardecer.

## Qué es y qué no es

- **El ave es un palo seco que abre los ojos**, como es de verdad. Sin alas ni pico de caricatura, y en silueta.
- **La leyenda** no se cuenta durante el show. Va después del resultado, en la tarjeta plegada «¿De dónde viene este juego?», y dice solo lo que dice la fuente: en el oriente boliviano (Beni, Pando y Santa Cruz) se cuenta que una joven enamorada corrió por el monte y quedó convertida en ave. **Sin muerte y sin hechiceros, y sin atribuirla a un pueblo.** Fuentes: [Los Tiempos, 6 de agosto de 2019](https://www.lostiempos.com/doble-click/cultura/20190806/guajojo-historia-amor-que-se-hizo-ave-mal-aguero) y [Wikipedia, Nyctibius griseus](https://es.wikipedia.org/wiki/Nyctibius_griseus) (la de la tarjeta de historia: palo seco, silbo largo, notas decrecientes).
- **Nunca** se dice eliminado, perdió, muerte ni agüero: quien se sienta no pierde, escucha; el final es el amanecer.
- El nombre es «Guajojó» en los dos idiomas; en la tarjeta en inglés, «the night bird». Nunca «Potoo».
- Nada con cara de casino y nada de apuestas.

## Para validar con quien mantiene el proyecto (lo cultural)

1. Que el guajojó sea un **ave de leyenda y no sagrada** (aunque la fuente dice que se la tiene por mal agüero, el juego no lo usa).
2. Que la leyenda de la tarjeta **omita a los hechiceros y la muerte** y no nombre a un pueblo.
3. Que sus **ojos sean amarillos**: la fuente de la ficha dice «ojos rojos» de noche, y el brillo de los ojos del nictibio, de cerca y con luz, es rojizo; el diseño pidió amarillo y así quedó.
4. Que quien se sienta «escucha» (no «pierde»). El rótulo del contador fue «EN EL MONTE» hasta la cuarta vuelta de la prueba del niño; ahora es «QUEDAN», igual en todos los de pie, porque «EN EL MONTE 5 DE 18» se leía como lo hecho y no como lo que queda.

## Batería (2 de noviembre de 2026)

- [x] `pnpm typecheck` y `pnpm test` (154 archivos, 3.178 pruebas)
- [x] `audit-game` 20/20
- [x] `audit-rigor` 22/22 (incluye pantalla): 0 llamadas a `Math.random`, 437 huellas idénticas, 144 cuadros por segundo, dura lo que promete (44, 40 y 52 s con 18)
- [x] `audit-identidad`: 100 % con 8, 18, 30 y 50, con el nombre entero
- [x] `audit-emocion` 4/4: zoom del golpe de 2,13 veces (2,28 en celular), quien gana siempre a la vista y sin el cartel encima
- [x] `audit-sound` (hueco máximo de 1,0 s) y `audit-mezcla` 6/6 (parejo con los demás: −30,2 contra −28,5 LUFS)
- [x] `audit-legible` 21/21 en proyector y celular, los dos temas
- [x] `audit-delatores` con 8 y con 18 personas (200 semillas, en el navegador): ningún delator. La primera corrida encontró dos (quien va atrás cuando quedan dos ganaba el 78 %, y en el susto el último nombrado era siempre la ganadora); se sortearon el orden y la mirada, y quien aguanta ya no se nombra en el rótulo
- [ ] `audit-nino`: **no pasa** (0 de 4 corridas con 18 personas). El final se entiende (3 de 3 en todas las fotos), la mitad del show no: «quién va adelante» no tiene respuesta natural en un juego de quedar de pie, y «qué acaba de pasar» a 3 s de un crac no se ve en la foto. Es lo mismo que le pasa a De pie
- [x] Capturas en escritorio y celular, dos temas, y revisión visual con capturas reales
- [ ] `node scripts/nuevo-juego.mjs --encender guajojo` (lo hace quien mantiene el proyecto)
