# De pie (antes ¿Quién es?)

La sala se para. En cada turno aparece una pregunta sobre el nombre ("¿TU NOMBRE TIENE LA R?"), cada uno la revisa en silencio, y después se contesta por quien ganó: "¡SÍ! Se sientan los que no la tienen". La sala se sienta, y recién entonces la pantalla da vuelta las cartas de los que se sentaron, como un árbitro que confirma. Quedan de pie los que siguen. Con cuatro o menos, "¡Finalistas, que los vean!". La última pregunta deja a uno solo de pie: el ganador.

**Identificador:** `quien` (no cambió: `/?demo=quien`, `/?pose=quien` y `/?pose=quien&n=200` siguen andando) · **Nombre visible:** "De pie" en español y "Stand up" en inglés · **Probarlo:** `/?demo=quien`, `/?pose=quien`, `/?pose=quien&n=200`.

**Fuera del selector desde el 26 de octubre de 2026** (decisión del proyecto): es un juego de leer, y la prueba del niño pide que cualquier cuadro diga, sin leer, quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar. Sigue abriendo con `?demo=quien`; su captura se queda como fondo de su tarjeta.

## De dónde sale

Del Ahorcado que propuso Guido Salazar ([@GuidoSV7](https://github.com/GuidoSV7)) el 1 de octubre de 2026. La revisión visual de ese día encontró dos problemas: la horca (un muñeco colgado evoca amenazas, en Bolivia más aún) y el largo del nombre, que delataba al ganador antes de la primera letra. Se quedó la idea de las preguntas que achican la lista.

En octubre de 2026 el juego se rehízo para salas grandes. Con cincuenta cartas en una pantalla el nombre no se lee desde el fondo de la sala, y la sala no lo necesita: cada uno sabe cómo se escribe su nombre, y lo que importa es si sigue de pie. Por eso el centro del juego pasó del tablero a la sala, y el tablero quedó como confirmación.

## La regla: el juego no decide nada

El ganador sale del [protocolo](../protocolo.md) antes de que empiece el juego. Las preguntas se eligen sabiendo quién es ([`quien-plan.ts`](../../src/games/pixi/quien-plan.ts), puro y probado):

1. Cada pregunta es de uno de cinco tipos, y tiene una respuesta verdadera para cada nombre: si el nombre tiene una **letra** (sin tildes; la Ñ cuenta como N), si tiene un **dígito**, si empieza de la **A a la M**, si tiene **más de N letras**, o si el **número del final** es mayor que N ("Invitado 12" con un 7 es mayor). Quien no tiene número cuenta como cero.
2. En cada turno se toma la pregunta que deja el grupo más cerca de la mitad. Repetir el tipo de la pregunta anterior cuesta un nombre: así las preguntas varían.
3. Los que no siguen se sientan: los que no cumplen lo que cumplió quien ganó. El ganador nunca se sienta, porque la respuesta sale de su nombre.
4. Con dos o tres cartas, la ronda arranca con una pregunta de calentamiento que no saca a nadie: una letra que tienen todos, o una que no tiene ninguno.
5. Si quedan nombres que no se pueden separar con ninguna pregunta ("José" y "Jose", con las mismas letras, el mismo largo y la misma mitad), el juego lo dice ("¡Mismas letras! El sorteo ya eligió.") y se sientan los que sobran. Si se llega al tope de doce preguntas con nombres que todavía se podían separar, dice otra cosa ("¡Nombres casi iguales!"): nunca dice "mismas letras" de nombres que no lo son.
6. Con varios premios hay una ronda por cada uno, del último al primero, sin los ganadores anteriores. Quien gana un premio que no es el último se sienta con él, y la sala vuelve a pararse ("¡Va el premio 2! Todos de pie, menos los que ya ganaron"). La ronda del primer premio es la larga, con el suspenso de la última pregunta.

Probado con listas de 2, 8, 18, 50 y 200 nombres, incluida una de 200 con homónimos numerados (hasta once copias de cada nombre, con su número): ninguna ronda llega al tope de doce preguntas. Con 200 nombres el promedio es de unas ocho preguntas, y nunca pasan de nueve.

Todo sale de la hora del juego (`dt`). Sin `Math.random()`: las variantes de las frases salen del número de la pregunta, no del azar.

## Cómo va

- **Reparto:** "¡N personas! Todos de pie. Si no podés, levantá la mano." Las cartas llegan de abajo a la grilla. En la primera ronda, además: "Vale el nombre de la lista, sin tildes. Si alguien quedó parado por error, la pantalla lo corrige."
- **Cada pregunta:** aparece en grande ("¿TU NOMBRE / TIENE LA R?") en una placa con una barra que se achica. Es la revisión: dura 2,6 segundos en la primera ronda y 2,2 en las siguientes; las dos últimas preguntas de cada ronda, 0,4 más, y la última de la ronda grande, 1 más. Mientras tanto la placa late una vez por segundo y suenan tics, y cada tic sostiene la música en la tensión de la revisión, sin subirla: antes se caía hasta el piso en cada espera.
- **La respuesta:** "¡SÍ!" o "¡NO!", y debajo "Se sientan los que no la tienen" (o "la tienen", según). Un segundo después la sala se sienta, y la pantalla da vuelta las cartas de los que se sentaron. Si no se sienta nadie (la pregunta de calentamiento, con dos o tres), los de pie dan un saltito, uno detrás del otro: con dos personas eran 4,2 s sin que se moviera nada.
- **Finalistas:** con cuatro o menos de pie, "¡FINALISTAS, QUE LOS VEAN!" con sus nombres en el subtítulo. La cámara se acerca y los finalistas se mecen unos tres segundos (2,4 en las rondas siguientes).
- **Final:** el ganador de pie, con el cartel de siempre. Con varios premios, un cartel por ganador y un podio al final.

## Lo que se ve

- La pregunta, grande y arriba, en una placa amarilla con su barra de revisión.
- La respuesta, en la misma placa, con la frase de quién se sienta.
- El contador: "DE PIE  N / M".
- Las cartas, con la cara y el nombre completo en dos líneas, en un solo texto: con homónimos ("Carlos Choque" y "Carlos Choque 2") el nombre de pila solo no decía de quién era la carta. Las que se sientan se dan vuelta y muestran el dorso con un "?". Las que siguen de pie se mecen.
- Los ganadores de rondas anteriores, arriba a la derecha, con su marco amarillo.
- El sello de la respuesta que decide ("¡SÍ!" o "¡NO!"), grande, un segundo: en la pantalla ancha en el medio del tablero, entre las cartas; en vertical, en la franja libre entre la pregunta y las cartas, porque ahí las dos últimas quedan lado a lado en el medio y el sello les tapaba los nombres.
- El tablero termina encima de la caja del relator, medida de verdad: cuando una frase ocupa dos o tres renglones, el tablero se achica de a poco (sin cambiar de columnas) para que la caja no tape la última fila. Antes se armaba contra la franja de un renglón, y las reglas del arranque tapaban los apellidos de abajo.
- No hay foco que salte de carta en carta: era una búsqueda en la pantalla, y en la última pregunta delataba a la carta del ganador.

## Cuánta gente

De 8 a 200 probados. Con 2 o 3 nombres, el juego tiene dos o tres preguntas, y no se ofrece (el mínimo es 8). Con 8 son tres o cuatro preguntas; con 50, cinco a siete; con 200, siete a nueve.

Duración medida con un premio, a "normal" (38 segundos de juego):

| Personas | Duración |
|---|---|
| 8 | 38,3 s |
| 200 | 38,2 s |

Con varios premios cada ronda vuelve a preguntar desde el principio, y la duración crece: con 8 personas y tres premios, 39 s; con 50 y tres premios, 56 s. El estiramiento del reloj del juego no baja de ×0,55, así que con tres premios y muchas personas el juego dura más que la ventana de "épico": con esas combinaciones hay que limitar los premios, o acortar las rondas siguientes. Eso no se resuelve acá.

A 200 personas el tablero no se lee desde el fondo de la sala: cada uno revisa su nombre de memoria, la pantalla confirma con las cartas y los finalistas se ven grandes. El auditor de identificación mide 8, 18 y 50: con 8 y con 18 todos se ven antes del ganador; con 50 ninguno se lee en el tablero (0%, informado y no aprobado).

Con 200 personas y "normal", cada revisión queda en unos 2 segundos reales, porque el reloj del juego se estira hasta llenar la ventana (cálculo a partir de la duración medida). La revisión de tres segundos reales pide "épico".

## Qué no se aprende

- Cada pregunta parte a la sala cerca de la mitad, así que ninguna señala al ganador hasta el final.
- No hay foco: nada frena en la carta de quien gana antes del sello.
- Las preguntas dependen del ganador: con la misma lista, cada turno cambia.

## Auditoría

```bash
node scripts/audit-game.mjs quien --base http://localhost:4173
node scripts/audit-identidad.mjs quien --base http://localhost:4173
node scripts/audit-emocion.mjs quien --base http://localhost:4173
node scripts/audit-rigor.mjs quien --base http://localhost:4173
node scripts/audit-sound.mjs quien --base http://localhost:4173
node scripts/audit-mezcla.mjs quien --base http://localhost:4173
```

El planificador tiene sus pruebas en [`quien-plan.test.ts`](../../src/games/pixi/quien-plan.test.ts): el ganador nunca se sienta, cada pregunta dice la verdad sobre cada nombre, con homónimos no se dice "mismas letras" sin serlo, y el tipo de pregunta varía.

Hasta el 22 de octubre de 2026 tres auditores fallaban, y se arreglaron:

- **Mezcla:** sin los graves de 150 Hz perdía de 3,6 a 3,7 LU (límite 3,5). En cada revisión la tensión de la música se caía hasta el piso y quedaban el bombo y el bajo solos. Desde que cada tic la sostiene, 3,2 LU.
- **Exigente, con 2:** 4,2 s quieto después de la pregunta de calentamiento (límite 4). Con el saltito, 1,5 s; con 3, 2,0 s.
- **Identificación, con 50:** no leía a nadie, tampoco al ganador. Con el nombre en un solo texto, 50 de 50. Ojo: con 100 y 200 el auditor mide el alto del bloque de dos líneas y no el de cada línea, así que cuenta como leídos nombres de 7 a 10 píxeles por línea que en la sala no se leen. Con 8, 18 y 50 cada línea pasa sola el umbral de 11,5 píxeles, con 50 por poco: 14 píxeles al arrancar y 12 cuando el tablero se acomoda a la caja de las reglas, en dos renglones.

## Lo que queda afuera

- La duración por cantidad, en el selector (ver [docs/juegos.md](../juegos.md), la sección de duración). El rango del selector, de 8 a 100, ya está (`RANGOS` de `src/ui/recomendar.ts`, 26 de octubre de 2026): se juega hasta 200, pero pasados unos 100 el nombre de cada carta no se lee desde el fondo.
- La lista de la sala: el importador propone filtrar por el check-in de Luma, y el selector tiene que avisar cuando De pie se ofrece con una lista que no es la de la sala.
- Las comparsas (grupos por color): De pie no las necesita, pero en salas grandes sumarían.
- Con tres premios y muchas personas, la duración (ver arriba).
