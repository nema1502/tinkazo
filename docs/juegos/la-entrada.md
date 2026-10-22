# La Entrada

El Carnaval de Oruro, contado por fraternidades. Una banda de bronces abre el desfile y detrás pasan las fraternidades, cada una con su baile: Diablada, Morenada, Caporales, Tinkus o Llamerada. Cada grupo de la lista es una fraternidad, y mientras pasa frente al palco se leen los nombres de todos sus integrantes. En cada arco se queda una fraternidad entera, que terminó su recorrido y saluda desde la vereda. En la última se quedan de a varios hasta que quedan dos, que hacen el contrapunto frente al Socavón: saltan alternados y en cualquier salto cualquiera de los dos puede trastabillar, hasta que el último salto de uno termina en el piso. El que llega, llega con campanas y cohetillos.

**Identificador:** `oruro` · **Probalo:** [tinkazo.app/?demo=oruro](https://tinkazo.app/?demo=oruro) · **Agregado:** 28 de septiembre de 2026, como Carnaval de Oruro · **Por fraternidades:** 21 de octubre de 2026

## Por qué La Entrada

El Carnaval de Oruro era el espectáculo más grande del catálogo, pero se miraba sin gritar: una sola comparsa de diablos donde en cada cuadra se quedaban algunos, sin que nadie supiera por quién hinchar. Con doscientas personas se veía el nombre de unos pocos. La auditoría de los juegos (4 de octubre de 2026) lo marcó para mejorar: "con fraternidades por grupos, cada uno tiene por quién hinchar".

Y así es la entrada de verdad. Es una peregrinación hasta el Santuario del Socavón ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)), donde bailan unos cincuenta conjuntos, más de 28.000 bailarines y 10.000 músicos ([UNESCO](https://ich.unesco.org/en/RL/carnival-of-oruro-00003)), en más de dieciocho especialidades de danza, cada fraternidad acompañada por su banda de bronces ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)). Un grupo de gente con un nombre, un color y un baile que pasa junto: eso es una fraternidad.

**El nombre.** "La Entrada" en español y en inglés. Es un nombre propio, el del desfile, como Chovena o Pasanaku; en inglés la tarjeta de "cómo se juega" explica de qué se trata. "Carnaval de Oruro" sigue en el lema de la portada y en la tarjeta de historia.

## La mecánica

**La presentación.** Abre la banda: bombo, platillos, dos bajos y dos trompetas, con su uniforme azul y su gorra. Detrás vienen las fraternidades, en el orden del desfile, y cada una pasa frente al palco (el toldo de colores sobre la gradería) mientras la cámara la mira de cerca. Mientras pasa, un cartel dice "ENTRAN LAS PARABAS", su baile, cuántos son y el nombre y la cara de cada integrante, hasta veinte en dos columnas, con la letra de los chips (19 px en una pantalla de 720). El relator anuncia cada una ("¡Pasan los Tatús, bailando Diablada!"), salvo las que pasan mientras la sala lee el pedido de aplaudir. Así se ven todos al principio, también con doscientos: no 98 de 200, como antes. En un celular el cartel es angosto, y el nombre de la fraternidad y la línea de abajo se achican lo justo para entrar ("LOS JUCUMARIS" se salía por la derecha).

**Las cuadras.** Después la cámara se abre a la comparsa entera, que avanza por la calle entre las fachadas y las graderías llenas. En cada arco la cabeza llega, la banda toca un acorde y una fraternidad entera sale a la vereda: "¡Cuadra 3! Se quedan los Tojos". La cámara se acerca a ellos, que saludan con los dos brazos arriba, y la comparsa cierra el hueco y sigue. Arriba, una pastilla por fraternidad con su color y cuántos siguen; la que se quedó queda tachada. Los arcos no llevan número: la fraternidad que se queda sale de donde esté en la comparsa, no de la cabeza, y el número del arco que se veía encima de ella contradecía al relator ("¡Cuadra 6!" debajo de un arco con un 2; 21 de octubre de 2026). La cuenta va en el relator y en la placa de abajo a la derecha, "CUADRA 3 DE 11".

**La última fraternidad.** Cuando queda una sola: "¡Solo quedan los Jucumaris!". Adentro de ella se quedan de a varios, en sus propios arcos, hasta que quedan dos. Ahí cada uno lleva su nombre entero encima: los que se quedan, tachados con una raya roja que deja leer el nombre. Los que no entran con su cartel se cuentan en un "+N" debajo del contador; en un celular, debajo de las pastillas, que ahí van debajo del contador (encima, tapaba la primera). Los carteles no tapan el contador, las pastillas, la placa de la cuadra ni el bombo.

**El contrapunto.** Frente al Socavón, los dos se miran y saltan alternados, cada salto un poco antes y más alto que el anterior. En cualquiera de los saltos cualquiera de los dos puede trastabillar: se tambalea, los brazos buscan el equilibrio, la máscara o el sombrero se le corren, y aguanta. El último salto de uno termina en el piso: cae sentado, pone ojos grandes y boca en o, y la máscara (o el sombrero, o la montera) sale volando y rueda. "¡A Diego Rojas se le voló el sombrero!". Perder da risa. Lo que vuela es lo de la cabeza, nunca la cara: con la cara adentro de lo que volaba, se veía rodar una cabeza por el piso (21 de octubre de 2026). Abajo de las máscaras hay una cara, que se asoma cuando la máscara se corre.

**La llegada.** El otro da el último salto y llega a la plaza del Socavón, con la campana de tres notas, y el relator nombra a su fraternidad: "¡Los Jucumaris llegaron al Socavón!", "¡Campanas para las Parabas: llegaron al Socavón!". Es el momento de la sección 7.8: nuestra fraternidad llegó hasta el Socavón. Después el cartel de la corona nombra a la persona, con las campanas del Socavón y los cohetillos.

## Las fraternidades

Son los grupos automáticos de [`grupos.ts`](../../src/games/grupos.ts), los mismos del teleférico: de a cuatro personas, hasta diez grupos, parejos, y salen solos del orden de la lista sellada. Las Parabas son Parabas en los dos juegos, con el mismo color (el de su línea de Mi Teleférico, que en La Entrada pinta el traje), y la lista del QR le dice a cada uno en qué grupo está. No cambian la chance de nadie: cada nombre sigue valiendo uno.

El baile de cada fraternidad se sortea con la ronda: los cinco bailes se barajan y cada grupo toma uno. Con cinco o menos fraternidades ninguno se repite; con diez, cada baile sale dos veces, con dos colores.

## Los cinco bailes

| Baile | Lo que se dibuja | Cómo se mueve | De dónde |
|---|---|---|---|
| Diablada | Máscara con cuernos anillados, ojos saltones y la culebra en la frente; capa bordada con estrellas, pechera dorada con lentejuelas, tridente | Salta con la rodilla alta, los brazos suben y bajan alternados, la capa flamea | [Diablada de Oruro](https://es.wikipedia.org/wiki/Diablada_de_Oruro) |
| Morenada | El traje de moreno, una campana pesada y bordada; la máscara de ojos desorbitados y la lengua afuera, con su corona; la matraca | Paso cansino: se mece despacio de un lado al otro, con la matraca girando | "ritmo lento y paso cansino", "ojos extremadamente desorbitados y la lengua saliente", la matraca ([Morenada](https://es.wikipedia.org/wiki/Morenada)) |
| Caporales | Botas altas con cascabeles, chaqueta con hombreras, sombrero | Salta y patea al aire, los brazos abiertos | Botas con cascabeles ([Caporales](https://en.wikipedia.org/wiki/Caporales)); patadas al aire y saltos ([Caporales](https://es.wikipedia.org/wiki/Caporales)) |
| Tinkus | La montera, un casco duro, con plumas de colores; la almilla tejida con franjas, la chuspa, las abarcas | Agachado, zapateando, con los puños arriba, en zigzag | Casco y abarcas; sombreros con plumas y cintas ([Tinku](https://en.wikipedia.org/wiki/Tinku)) |
| Llamerada | Sombrero con flecos de colores, poncho, la honda y una llamita | El paso del llamero, con la honda dando vueltas sobre la cabeza y la llamita en la otra mano; los labios fruncidos del que silba a sus llamas | Honda en la derecha y llamita en la izquierda ([Llamerada](https://en.wikipedia.org/wiki/Llamerada)) |

Cada pieza de los trajes se dibuja una sola vez y se pasa a una textura, y cada bailarín es un puñado de sprites: lo que lleva el color de la fraternidad se dibuja una vez por fraternidad, lo que es igual en todas se comparte; lo que es del color de la piel se dibuja en blanco y se tiñe, y el pelo, una vez por color. Dibujados como figuras, con doscientos bailarines la escena iba a 25 cuadros por segundo. La cara de cada uno, la de su lista, va en el pecho.

### Ellas

En la entrada de verdad, hombres y mujeres bailan con trajes distintos. Con qué traje baila cada uno sale del nombre, como en la Chovena ([`genero.ts`](../../src/games/genero.ts): una lista de nombres comunes y la terminación); si el nombre no lo dice, con el traje de la tabla de arriba, el de siempre. Es solo dibujo: no toca quién gana.

| Baile | Lo que se dibuja | De dónde |
|---|---|---|
| Diablada | La china supay: careta pintada con pestañas largas, cejas de lana, dientes de espejo y dos cuernitos; trenzas con tullmas, pañueleta, pechera dorada, pollera corta con estrellas y botas blancas | "La careta, tullma, pañueleta y botas" ([Los Tiempos](https://www.lostiempos.com/doble-click/cultura/20230212/trajes-estilizados-colores-vivos-son-tendencia-este-carnaval)); una careta de china supay de loza pintada, con dientes de espejo, pestañas largas y cejas de lana ([Horniman Museum](https://horniman.ac.uk/object/HC.1999.1546)) |
| Morenada | La cholita: pollera corta bordada en el ruedo, corsé con escote en V sobre la blusa blanca, dos trenzas, y el sombrero y las botas del color del traje | "Pollera corta con bordados en los extremos y un corset escote en V", "tanto el sombrero como las botas están forrados con la misma tela de los trajes", "el pelo largo y recogido en dos trenzas" ([Diario de Cuyo](https://www.diariodecuyo.com.ar/noticias/las-danzas-religiosas-en-que-destacan-a-la-mujer-boliviana-336782.html)) |
| Caporales | Pollera corta plisada que se abre en cada salto, blusa con escote en V y mangas abullonadas en los hombros, bordado en el pecho, el pelo recogido, un sombrerito sujeto al pelo, medias color piel y zapatos de taco | "Pollera corta y una blusa con escote en forma de V, mangas largas y abultadas en los hombros" (Diario de Cuyo); el sombrero redondo sujeto al pelo, las medias y los tacos ([Caporales](https://en.wikipedia.org/wiki/Caporales)) |
| Tinkus | Vestido largo con franjas tejidas, chaqueta a la cintura, fajero, pañueleta, y el sombrero con plumas largas, cintas y espejitos | "Un vestido largo con una chaqueta a la cintura, tejidos en lana de colores intensos" y "el sombrero incluye detalles de espejos" (Diario de Cuyo); "vestido, chaleco, pañueleta, fajero y sombrero" (Los Tiempos); sombreros con plumas largas y cintas ([Tinku](https://en.wikipedia.org/wiki/Tinku)) |
| Llamerada | El sombrero de flecos del baile, blusa bordada, pollera a la rodilla y el aguayo cargado, anudado en el pecho | No encontramos una fuente firme del traje de las llameras: la pollera, la blusa y el aguayo son una suposición nuestra, y es lo primero que tiene que revisar alguien de Oruro. El tocado del baile se parece al de la Mama T'alla, la esposa de una autoridad aymara ([Llamerada](https://en.wikipedia.org/wiki/Llamerada)) |

La pollera se mece con el paso de cada baile: va y viene en la morenada, se abre en cada salto de los caporales. Ellas bailan los mismos pasos que ellos; la cholita, sin matraca, y la llamera, sin honda ni llamita, con los dos brazos al paso. Lo que se les cae en el susto y en la caída es el sombrero (a la china supay, la careta).

## Qué hace la sala

**Aplaude al ritmo de la banda.** Es la primera línea del relator ("¡Aplaudan al ritmo de la banda!") y el bombo de arriba a la derecha late con el golpe: el parche se prende y el mazo pega en cada tiempo, junto con el zapateo. El golpe va a 120 por minuto **reales** con cualquier duración elegida: el tiempo de juego se estira, el golpe no, porque aplaudir más lento que eso no se puede. Al ritmo y no por uno de los dos: aplaudir por uno sería votar (sección 7.8).

**Hincha por su fraternidad.** Cada uno sabe su grupo por la lista del QR ("Parabas · línea Roja"), lo ve pasar con su nombre en el cartel, y lo sigue en las pastillas de arriba y en el cartel que cada fraternidad lleva sobre su bloque.

## Cómo se pierde

Tu fraternidad se queda en una cuadra, entera, y saluda desde la vereda: pasás a ser público, en grupo. "A los Tojos nos dejaron en la segunda". En la última fraternidad, te quedás con otros pocos, con tu nombre tachado arriba. Y en el contrapunto, te caés sentado y se te vuela el sombrero.

## Lo que la entrada hace a propósito

Nada de lo que se ve dice quién gana más que el azar. Lo comprueban las pruebas del plan ([`entrada-plan.test.ts`](../../src/games/pixi/entrada-plan.test.ts)) con seiscientas semillas:

- **El lugar de su fraternidad en el desfile se sortea parejo,** también a la cabeza (antes, en el susto y el duelo, la ganadora arrancaba siempre entre el segundo y el quinto lugar).
- **Su lugar adentro de la fraternidad, también.**
- **Quién se queda en cada arco no depende de dónde va en la comparsa:** se sortea entre las que no son la del que gana, y sale de donde esté.
- **En el contrapunto, de qué lado salta y quién salta primero se sortean parejo** (antes estaba siempre a la izquierda y saltaba primero). La cantidad de saltos se ajusta para que el último sea del que pierde, así que quién arranca no dice nada.
- **Trastabillar le pasa a los dos, parejo.** El último salto del que pierde termina en el piso: ese ya es el final.

| Arco | Giro | Qué se ve |
|---|---|---|
| Susto | La máscara | Antes del último arco de la última fraternidad, a uno de los que siguen bailando casi se le cae la máscara (o se le vuela el sombrero, o la montera): "¡Casi se le cae la máscara a fulano!". Se sortea entre todos los que bailan, también el que gana. Sin arcos en la última fraternidad, pasa en el contrapunto, a uno de los dos |
| Remontada | La que vuelve | En un arco, una fraternidad arranca para la vereda como si se quedara ("¿Se quedan los Tojos?") y vuelve ("¡No! ¡Siguen bailando!"). Se sortea entre las que siguen después de ese arco, también la del que gana |
| Duelo | Un salto más | El contrapunto dura dos saltos más |
| Tapada | Se calla la banda | En un arco la banda se calla de golpe: la música se corta, la comparsa se congela a mitad del paso, el público deja de saltar y la sala, que aplaudía, se congela con ella. "¡Se calló la banda!". Un latido a mitad del silencio, y "¡Sigue la banda!" |

## Varios premios

Un co-ganador no se nombra cuando sale: el relator dice el premio, no el nombre ("¡Cuadra 3! Se quedan los Tojos, con un premio", "¡Cuadra 11! Se quedan 3, uno con premio"), y su nombre se lee recién en el cartel (lista "Chicos" de la sección 10 de la auditoría). En la última fraternidad su cartel no va tachado: lleva un borde amarillo. Los co-ganadores de la fraternidad del que gana se quedan al final, del último premio al segundo, y el otro del contrapunto nunca tiene premio si se puede elegir a alguien sin premio: un co-ganador que pierde el contrapunto sería un ganador contado como perdedor. Si igual se cae uno con premio, la caída no lo nombra.

## Cómo escala

| Participantes | Fraternidades | Arcos | Última fraternidad | Hasta la corona (segundos de juego) |
|---|---|---|---|---|
| 2 | 1 de 2 | 0 | Directo al contrapunto, más largo | 11,8 a 12,8 |
| 8 | 2 de 4 | 3 | 4 → 3 → 2 | 19,5 a 21,0 |
| 18 | 5 de 3 o 4 | 5 | 3 → 2, o 4 → 3 → 2 | 28,2 a 29,9 |
| 30 | 8 de 3 o 4 | 9 | 4 → 3 → 2 | 33,8 a 35,1 |
| 50 | 10 de 5 | 11 | 5 → 3 → 2 | 34,3 a 36,0 |
| 200 | 10 de 20 | 12 | 20 → 10 → 5 → 2 | 35,8 a 37,6 |

Para lo que fue pensado es de 30 a 200 personas. Con menos funciona igual, con menos fraternidades: con dos personas no hay arcos y el contrapunto dura más, y el estirado topa en ×2,2.

## Los tiempos

En segundos de juego, sin estirar ("normal" los estira para que el show dure 38 segundos, cartel incluido).

| Tramo | Qué pasa |
|---|---|
| 0 – 0,7 s | Abre la banda. "¡Aplaudan al ritmo de la banda!" |
| 0,7 s – fin de la presentación | Cada fraternidad pasa frente al palco: 8,6 s repartidos entre todas, entre 0,92 s y 2,2 s cada una (2,6 con una sola) |
| + 0,9 s | La comparsa arranca hacia el primer arco |
| Cada arco | De 1,45 s (con muchas) a 2,3 s (con pocas) entre uno y otro; los de la última fraternidad, 0,15 s más. La remontada suma 1 s en su arco y la tapada 1,2 s. Después de la última fraternidad entera, 0,9 s de respiro |
| + 2,2 s | Del último arco al Socavón |
| Contrapunto | Se acomodan 0,6 s; los saltos, cada uno un 10 % más corto que el anterior (de 0,74 a 0,36 s); la caída, y 0,8 s después el último salto del que gana |
| + 1 s | La corona |

## La cámara

En la presentación mira el palco, con la fraternidad que pasa en el lugar que deja libre el cartel (a su izquierda en la pantalla grande, debajo en el celular). En el recorrido encuadra la comparsa entera y la llena; si no entra (en un celular, con muchas), la cabeza y lo que entre. En cada arco va a los que se quedan, en la vereda; en la última fraternidad, también a los que siguen, para que se vea quién se queda y quién sigue. Cuando queda una sola fraternidad, la banda sale de la toma. El susto y el amague tienen su primer plano, y cuando la banda se calla la cámara también se queda quieta.

Frente al Socavón, primero el templo entero con los dos delante, encuadrados donde van a estar y donde están todavía: con doscientos llegan desde las filas de adelante, y encuadrados solo en su lugar quedaban más de un segundo detrás del relator. Después los dos, cada vez más cerca y con lugar para los saltos; ese acercamiento entra de a poco desde el zoom del templo, porque con el centro y el zoom al mismo ritmo la cámara se acercaba al templo antes de bajar a ellos. Al llegar, la plaza con el que llega y el otro sentado en el piso. En la corona, el que llegó entero debajo del cartel: con varios premios el cartel es más alto, y la cámara baja y se abre lo justo (revisión de juegos, vistas-8, donde el cartel tapaba la punta de los cuernos en un celular acostado).

Con doscientas personas los bailarines se dibujan a un tercio del tamaño, y la cámara puede acercarse hasta 2,6 veces más que con dieciocho: si no, el contrapunto quedaba de muñequitos en medio de la calle. Sin el desenfoque de los acercamientos (`cam.noBlur()`), para que los nombres se lean en el viaje.

## El sonido

- **El zapateo:** un golpe en cada tiempo de la banda, con acento en el uno.
- **Cada fraternidad que entra:** dos bronces juntos.
- **Cada arco:** el acorde de la banda, más agudo y más largo en cada uno; los de la última fraternidad, una nota que cae por cada uno que se queda.
- **La remontada:** dos notas que caen ("¿se quedan?") y dos que suben ("¡no!").
- **La tapada:** la música se corta en seco, un golpe corto, un latido a mitad del silencio, y la banda vuelve con su golpe.
- **El susto:** una alarma corta.
- **El contrapunto:** una nota por salto, alternada entre los dos y cada vez más aguda, con su pisada; el tropezón, dos notas graves; la caída, tres que caen y un golpe.
- **La llegada:** la campana de tres notas, y en el cartel las campanas del Socavón, después de la fanfarria para que no las tape.

La música con beat, cuando está prendida, hace de banda de fondo. No es música de banda de bronces: eso sería un estilo propio del motor de música, como el de la Chovena, y queda pendiente.

## Respeto

- **El Socavón es un santuario.** Los bailarines de verdad entran de rodillas ([Wikipedia](https://es.wikipedia.org/wiki/Carnaval_de_Oruro)). El que gana llega a la plaza frente a la puerta, con campanas, y no entra: el santuario no es el premio.
- **La máscara del moreno es de metal plateado,** con los ojos desorbitados y la lengua afuera. Pintada del color de una piel y con labios gruesos, fuera de Bolivia se lee como caricatura.
- **Los caporales no llevan látigo.** El caporal era el capataz de los esclavos ([Caporales](https://en.wikipedia.org/wiki/Caporales)); el baile se queda con las botas, los saltos y el sombrero.
- **Nada religioso en los bailarines:** ni la Virgen, ni el arcángel, ni estandartes con imágenes. Cada fraternidad lleva una pancarta con su color y una estrella.
- **El traje de ellas sale del nombre, no del lugar.** Repartido por puesto, a un hombre le podía tocar la pollera, y eso se lee como burla (lo encontró la revisión de la Chovena, 5 de octubre de 2026). Si el nombre no dice nada, baila con el traje de siempre. Un nombre de hombre que termina en a (Joshua, Mustafa) baila de pollera: la lista de `genero.ts` cubre los nombres de la lista de ejemplo y los comunes en Bolivia, no todos.
- **La cholita no es caricatura.** La cara es la de todos, con las mejillas rosadas; la pollera, el corsé, las trenzas y el sombrero, como los describen las fuentes, sin exagerar nada.
- **Lo que no se jugó:** la UNESCO anota "la explotación financiera incontrolada del carnaval" entre lo que lo amenaza ([UNESCO](https://ich.unesco.org/en/RL/carnival-of-oruro-00003)). Nada de marcas, ni de cerveza, ni de premios en plata en la escena.

**Antes de darlo por bueno, que lo vea alguien de Oruro.** Los trajes son una lectura nuestra de las fuentes, no un dibujo de un traje de verdad.

## Cómo está hecho

- [`src/games/pixi/entrada-plan.ts`](../../src/games/pixi/entrada-plan.ts): el plan, puro y con sus pruebas. Las fraternidades, el orden del desfile, quién se queda en cada arco, la última fraternidad, los giros de cada arco, el contrapunto y todos los tiempos, escritos con la semilla de la ronda antes del primer cuadro.
- [`src/games/pixi/entrada-bailes.ts`](../../src/games/pixi/entrada-bailes.ts): los cinco trajes, de ellos y de ellas, la banda y la pose de cada uno, sin memoria: la misma hora dibuja el mismo cuerpo.
- [`src/games/genero.ts`](../../src/games/genero.ts): con qué traje baila cada uno, del nombre. Es el mismo de la Chovena.
- [`src/games/pixi/oruro.ts`](../../src/games/pixi/oruro.ts): la escena, la cámara, los carteles y el sonido, con el andamiaje del motor nuevo ([`stage.ts`](../../src/games/pixi/stage.ts)). No toca `stage.ts` ni `camera.ts`.
- Los carteles con nombre se acomodan con `layoutLabels`, el de la piñata, con lo que entra redondeado a 1/64 de píxel. El paso del reloj sale de restar dos horas absolutas (`stage.ts`), y como el estadio no aparece siempre en el mismo cuadro, dos corridas de la misma ronda llegan con diferencias de 1e-12; en carteles que se tocan justo eso cambiaba el lugar de algunos durante unos cuadros (con doscientos, en una de cada tres corridas).

No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

## Cómo auditarlo

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
