# Marca de Tinkazo

Escrito para quien arme una presentación, un afiche o una diapositiva de Tinkazo y necesite que se vea como Tinkazo. Todos los números de contraste de acá están medidos con la fórmula de WCAG 2.x sobre los colores reales del sitio, no estimados.

## La idea en una línea

> Sorteos que cualquiera puede comprobar.

En inglés: *Draws anyone can check.*

Dice lo que el producto hace de verdad: cualquiera, desde su celular, rehace el sorteo y ve si cuadra. Hasta el 28 de septiembre de 2026 el lema era "Sorteos que nadie puede arreglar. Ni vos". Se cambió porque prometía más de lo que el modelo de amenazas sostiene: el ataque de sellar varias listas y publicar una sigue abierto, está documentado, y la página lo marca en vez de impedirlo. "Arreglar" y "rig" además son palabras de casino. "Comprobar" es la promesa que se cumple siempre.

La idea del "ni vos" sigue viva, pero se cuenta, no se promete: cuando cerraste la lista, el número que la decide todavía no existía.

## El nombre

**Tinkazo**, siempre junto y con mayúscula inicial. Nunca "TinkaZo", "TINKAZO" en texto corrido, ni "Tinkazo App".

En el logotipo van las dos sílabas con peso distinto: `Tinka` en tinta y `zo` en magenta. Es la única vez que el nombre se parte.

Viene del español de Bolivia. El *Diccionario de americanismos* registra dos palabras gemelas: **tinkazo**, que es un presentimiento (nunca "suerte": esa palabra es de las apuestas y el diccionario no la dice), y **tincazo**, que es el golpecito que se da haciendo resbalar el dedo sobre el pulgar. El producto es las dos cosas, y eso se puede contar en diez segundos ante cualquier público.

## La paleta

Cinco colores de acento, dos de superficie y dos de texto. Nada más. La restricción es parte del estilo.

### Tema claro

| Papel | Nombre | Hex |
|---|---|---|
| Fondo | papel | `#fff6e9` |
| Tarjeta | tarjeta | `#ffffff` |
| Texto | tinta | `#191919` |
| Texto secundario | tinta 2 | `#4b4437` |
| Texto terciario | apagado | `#6b655b` |

| Acento | Hex |
|---|---|
| Magenta | `#e93d9c` |
| Naranja | `#ff7a1a` |
| Turquesa | `#00a896` |
| Amarillo | `#ffc629` |
| Morado | `#6c4ce0` |

### Tema oscuro

| Papel | Hex |
|---|---|
| Fondo | `#171126` |
| Tarjeta | `#221a33` |
| Texto | `#f6efe2` |
| Texto secundario | `#cfc6b4` |
| Texto terciario | `#97909f` |

| Acento | Hex |
|---|---|
| Magenta | `#ff5cb3` |
| Naranja | `#ff8b3d` |
| Turquesa | `#17c3b2` |
| Amarillo | `#ffd24d` |
| Morado | `#9b7bff` |

## La regla del texto sobre color

Esta es la que más se rompe y la que más se nota. **Sobre los cinco acentos va tinta, no blanco.** La única excepción es el morado en tema claro.

Contraste medido, texto sobre color plano:

| Acento | Con tinta `#191919` | Con blanco |
|---|---|---|
| Magenta claro | **4,70** | 3,74 |
| Naranja claro | **6,74** | 2,61 |
| Turquesa claro | **5,90** | 2,98 |
| Amarillo claro | **11,19** | 1,57 |
| Morado claro | 3,14 | **5,60** |
| Magenta oscuro | **6,22** | 2,82 |
| Naranja oscuro | **7,55** | 2,33 |
| Turquesa oscuro | **7,94** | 2,21 |
| Amarillo oscuro | **12,20** | 1,44 |
| Morado oscuro | **5,59** | 3,15 |

El umbral es 4,5 para texto normal y 3 para texto grande. Blanco sobre naranja da 2,61: eso no se lee en un proyector de sala ni con buena voluntad.

**El par más fuerte que existe en la marca es amarillo con tinta encima: 11,19 a 1.** Por eso el cartel del ganador es amarillo. Si hay que destacar una sola cosa en una diapositiva, va ahí.

## El estilo

Neobrutalismo: bordes gruesos de tinta, sombras duras sin desenfoque, colores planos, nada de degradados suaves ni de sombras difuminadas.

| Elemento | Valor |
|---|---|
| Borde grueso | 3 px sólido tinta |
| Borde fino | 2 px sólido tinta |
| Sombra grande | 6 px 6 px 0 tinta |
| Sombra chica | 3 px 3 px 0 tinta |
| Rotación de las calcomanías | entre -2 y +2 grados |

**La sombra nunca lleva desenfoque.** Si una diapositiva tiene una sombra difuminada, no es de Tinkazo.

## Las ventanas

El panel de la cuenta, el ingreso, el paso de fondos, el importador de listas y el rearmado de un comprobante son ventanas, y todas cumplen una regla: **una ventana siempre entra en la pantalla o se recorre. Nunca queda cortada, y nada de lo que se toca queda fuera de alcance.**

Hasta el 19 de octubre de 2026 el fondo centraba la tarjeta con `align-items: center`. Una tarjeta más alta que la pantalla se cortaba por arriba y por abajo, y lo cortado no se alcanzaba ni con scroll: el panel con diez sorteos medía 679 px, una laptop a 100 % de zoom tiene 632, y "Salir" y "Cancelar" quedaban pegados al borde o afuera. En un celular acostado (390 px de alto) se perdían 144 px por arriba.

Cómo se cumple:

| Pieza | Regla |
|---|---|
| `.modal-back` | Se recorre (`overflow-y: auto`, `overscroll-behavior: contain`). Deja `--modal-pad` de aire: 20 px, y 12 px en un celular o con menos de 560 px de alto. |
| `.modal-card` | Se centra con `margin: auto`, que cuando no sobra lugar la deja arriba y deja bajar. **Nunca `align-items: center` en el fondo.** |
| Tarjeta con alto máximo | `max-height: calc(100dvh - 2 * var(--modal-pad))`, con `100vh` de respaldo, y recorre solo su cuerpo. |
| Ventana con acciones | Tres partes: encabezado fijo, cuerpo que se recorre (`min-height: 0; overflow-y: auto`) y pie fijo. Cerrar y salir no se alejan con el scroll. |
| Cerrar | Una ✕ de 44 × 44 px en el encabezado. Esc y tocar el fondo también cierran. |
| Salir de la cuenta | Se llama "Cerrar sesión", nunca "Salir" ni "Cancelar" sueltos, y va como botón de texto en el pie: que no se confunda con cerrar la ventana. |
| Accesibilidad | `role="dialog"`, `aria-modal` y `aria-labelledby` al título. El foco entra al abrir, no se escapa (Tab da la vuelta) y vuelve al botón que la abrió. Lo que se mueve al entrar respeta `prefers-reduced-motion`. |

En el panel de la cuenta la red va como insignia (naranja en la red de pruebas, turquesa en la principal) y el saldo en otra, chica. Quien entra con Google o con un correo no ve el saldo mientras sea menor que 1, ni el botón del grifo: la comisión de esas cuentas la va a cubrir Tinkazo con Pollar, y quien entra así no tiene por qué saber qué es un XLM. Con Freighter y con la cuenta de prueba el saldo se ve como siempre.

Se mira en cinco pantallas, en los dos temas, y a 200 % de zoom:

| Etiqueta | Ancho × alto | Qué es |
|---|---|---|
| laptop-100 | 1362 × 632 | la laptop de Nicolás a 100 % |
| escritorio | 1280 × 720 | un escritorio |
| tablet-h | 1024 × 560 | una tablet acostada |
| celular-h | 844 × 390 | un celular acostado |
| celular | 390 × 844 | un celular parado |
| zoom-200 | 681 × 316 | la laptop a 200 % de zoom |

`node scripts/audit-ui.mjs` lo comprueba en cuatro pantallas (1440 × 900, la laptop, el celular acostado y el celular parado), con un historial de diez sorteos de nombres largos, y rechaza una ventana que se corte.

## Tipografía

Se usa la tipografía del sistema, a propósito: el sitio no carga ninguna fuente y por eso pinta el primer cuadro al instante.

| Uso | Familia | Peso |
|---|---|---|
| Títulos | `system-ui` | 900 |
| Texto | `system-ui` | 500 a 700 |
| Números, huellas, direcciones | `ui-monospace`, Consolas | 700 |

Los títulos van muy apretados (`letter-spacing: -0.02em`) y los rótulos en versalitas, muy separados (`0.08em` a `0.14em`).

**Todo lo que sea un dato verificable va en monoespaciada.** Una huella, un hash, una dirección de contrato, un número de ronda. Es una señal: lo que está en monoespaciada se puede comprobar.

### La letra

Lo que cuenta es el ángulo de la altura de la x, y la `system-ui` tiene una x de unos 0,52 em. Una imagen de 1,5 m de alto vista a 6 m (un proyector desde el fondo de la sala) y un celular de 390 px a 35 cm piden el mismo ángulo, así que la regla es una sola, en dos medidas:

| Dónde | Secundario | Principal | Cómo se mide |
|---|---|---|---|
| Lo que mira la sala, en 1080 de alto | 28 px (2,6 % del alto) | 48 px (4,4 %) | `scripts/audit-legible.mjs` |
| Lo que mira la sala, en un celular parado | 16 px | 22 px | `scripts/audit-legible.mjs` |
| La herramienta (la página de quien organiza) | 16 px | 22 px | `scripts/audit-legible.mjs`, `scripts/audit-ui.mjs` |

Principal es lo que se lee primero: los títulos, el botón de la acción del paso, el nombre del ganador y el cartel del estadio. Las versalitas ganan un 35 %: un rótulo de 14 px en mayúsculas vale como uno de 19. La monoespaciada tiene la x más chica y no sirve para nombres. En el CSS son `--letra-sec` y `--letra-prin` (y `--letra-sala-sec` y `--letra-sala-prin` para el estadio); en los juegos, `LEGIBLE` y `letraMinima(k)` de `src/games/pixi/letra.ts` (los juegos dibujan en unidades `k`, un píxel del diseño de 720 de alto: 18,7 y 32). Con mucha gente los nombres de un juego pueden bajar, pero nunca de la regla en 1080 con las personas que promete el juego con nombre entero.

## La llama

La mascota es una llama pixelada, dibujada con rectángulos, sin curvas. Va en magenta con sombra dura de tinta, rotada unos tres grados.

No tiene cara ni ojos. No se le pone sombrero ni poncho. Es una silueta y con eso alcanza.

## Cómo se escribe

El sitio está en español boliviano con voseo, y en inglés neutro. No hay un tercer registro.

**Lo que sí:**

- Voseo: "pegá la lista", "sorteá", "probalo", "si encontrás".
- Vocabulario neutral: el voseo y los nombres de los juegos se quedan, pero lo cotidiano se escribe como se entiende en cualquier país ("ahora" y no "ahorita", "comprobar" y no "chequear"). La lista de lo que se evita, con su alternativa, es `scripts/lib/glosario-neutral.json`; `pnpm check:glosario` falla si aparece fuera de los nombres de los juegos y de `historia.html`, y corre en la CI. Una entrada en `"estado": "avisar"` no falla: es un uso que ya está en el texto y falta decidir (hoy `cancha` en "¡A la cancha!"). El 26 de octubre de 2026 se cambiaron 21 giros de todos los días (`guagua` por bebé, `plata de mentira` por dinero de prueba, `¿Dale?` por ¿Seguimos?, `Metele` por Agregá, `en un rato` por en unos minutos, `largada` por salida, `planilla` por hoja de cálculo, `este equipo` por este navegador, `Bajar como CSV` por Descargar, `anclados` por guardados en Stellar, `EN EL RUEDO` por SIGUEN, `¡CHUTA!` por ¡UY!, entre otros), y las Parabas y los Jucumaris pasaron a Guacamayas y Osos andinos. Se quedan el voseo, `acá`, `celular` y los nombres culturales (chovena, trueque, La Entrada, cuadra, fraternidad, Diablada, Socavón), con una línea que los explica donde hace falta; los Tojos quedan a confirmar. Nada de tuteo.
- Frases cortas, de una idea cada una.
- Decir el precio y el costo con el número y la fecha: "0,76 XLM, unos 16 centavos, medido el 3 de octubre", no "es muy barato".
- Admitir los límites. El veredicto amarillo de la página de verificación dice que la cuenta cierra pero que nadie atestigua la lista. Esa honestidad es la marca.

**Lo que no:**

- "Revoluciona", "disrumpe", "la próxima generación de", "impulsado por blockchain".
- Prometer lo que no está hecho. Si algo está en testnet, se dice testnet.
- Explicar la criptografía antes de explicar para qué sirve.
- Signos de exclamación en el texto del producto. En los subtítulos de los juegos sí, porque ahí se escribe como un relator.

## Los subtítulos son otro registro

Dentro de los juegos el texto es de relator de partido: mayúsculas, gritos, "¡NO RESPIRA NADIE!". Eso vive solo ahí. No se filtra a la página ni a una presentación.

## Los ocho juegos

Los del selector, en su orden. Cada uno tiene su color dominante, útil si una diapositiva los muestra. Siete salen de la cultura boliviana y latinoamericana (la ruleta es de todos). De pie y El Trueque salieron del selector el 26 de octubre de 2026 y siguen abriendo con `?demo=`.

| Juego | Color | En una frase |
|---|---|---|
| Carrera de llamas | Naranja y magenta | Ocho carriles por la cordillera |
| Sapo | Madera, con la argolla amarilla y los aros de los cinco | La rana del cajón: la última argolla cae en el agujero de quien gana |
| Trompo | Tierra, con trompos de los cinco | El ruedo de tiza: chocan y se caen hasta el mano a mano |
| Chovena | Tierra colorada y tipoy blanco con las cintas de los cinco | La rueda chiquitana de la mano: cuando se corta la música, el que trastabilla sale |
| Piñata | Los cinco, en conos | Cada palo tira caramelos; el último que queda adentro gana |
| Ruleta | Los cinco, en gajos | La de siempre, pero que se ve girar con dos personas |
| Teleférico | Los de las líneas, sobre un atardecer | Un convoy de cabinas por grupos: en cada estación baja un grupo entero |
| Carnaval de Oruro | Rojo de las máscaras y amarillo, de noche | Una comparsa de la Diablada que se queda cuadra por cuadra hasta el Socavón |

## Lo boliviano

Entra por la función, nunca por la decoración. Si el elemento se puede sacar sin que nada deje de funcionar, es decoración y sobra.

Cada cosa boliviana del producto hace algo: el nombre, la llama de la mascota, el perno tricolor de la ruleta que marca la vuelta, el aguayo que es el tablero de juego, el teleférico, cuyo cable es la barra de progreso y cuyas cabinas llevan los colores de las diez líneas de La Paz y El Alto, la entrada del Carnaval de Oruro, cuyas cuadras son las rondas de eliminación, y la rueda de la chovena, que se achica cada vez que alguien se suelta. El trompo y la piñata son de toda Latinoamérica y siguen la misma regla: el choque y el palo son los que eliminan. Los nombres de la lista de ejemplo (Quispe, Mamani, Choque, Condori, Limachi, Villca) son el detalle más sutil y el que más gusta.

**Lo que no va:** wiphalas, cholitas, el Illimani, Tiwanaku, ni la palabra "Bolivia" escrita en pantalla. El pie de página dice "Hecho en Bolivia por Nicolás" y con eso alcanza.

## Los números que se pueden decir

Todos medidos, no estimados. Si se actualizan, se actualizan acá también.

| Dato | Valor |
|---|---|
| Costo de sellar un sorteo | 0,099 XLM |
| Costo de sortear, con la verificación criptográfica | 0,083 XLM |
| **Total por sorteo** | **0,76 XLM, unos 0,16 dólares** (testnet, 3 de octubre de 2026; el 16 de septiembre eran 0,18: subió la renta de la red) |
| Solo la verificación BLS en la cadena | 0,003 XLM |
| Tamaño del contrato compilado | 11,4 KB |
| Tests del contrato | 19 |
| Tests del protocolo en TypeScript | 27 |
| Tests de TypeScript en total | 196 |
| Comprobaciones por juego del auditor | 20 |
| Juegos | 8 |
| Espera entre sellar y sortear, modo libre | 10 segundos |
| Espera si el sorteo se ancla en Stellar | 45 segundos |
| Dependencias para sortear | 3 (RPC de Stellar, relays de drand, la wallet del organizador) |
| Servidores propios para sortear | 0. El único servicio propio es el de los enlaces cortos, para compartir: un Worker de Cloudflare que guarda copias cifradas que Tinkazo no puede leer y, si se cae, deja el enlace largo. No decir "0 servidores" a secas |

## Los enlaces

| Qué | Dónde |
|---|---|
| Producto | https://tinkazo.app |
| Código | https://github.com/nema1502/tinkazo |
| Protocolo, especificación normativa | `docs/protocolo.md` |
| Licencia | MIT |

## Para una presentación

El orden que funciona, probado contra las objeciones que aparecen:

1. **La palabra.** En Bolivia un tinkazo es una corazonada: el presentimiento de que hoy te toca. Abre con algo humano y deja el nombre pegado.
2. **El problema.** Toda comunidad hace sorteos, y en todos hay alguien que piensa que el organizador le dio el premio a su amigo.
3. **El truco, en una frase.** La lista se cierra antes de que exista el número que va a decidir. El orden es todo.
4. **La demostración.** Un sorteo de verdad, en vivo. Dura diez segundos de espera y un juego. Que el público vea la lista congelarse.
5. **La prueba.** Abrir el comprobante desde un celular ajeno y que la página rehaga el sorteo sola.
6. **El costo.** Unos 16 centavos por sorteo, que cobra la red. Y verificar siempre es gratis.
7. **La honestidad.** Mostrar el veredicto amarillo: cuando el sorteo no está anclado, la herramienta lo dice en vez de dar un verde fácil. Esta diapositiva convence más que las seis anteriores.

Lo que no conviene mostrar en una presentación: el código del contrato, el diagrama de arquitectura, ni la explicación de BLS12-381. Si alguien pregunta, está en la documentación.
