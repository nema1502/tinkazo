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
| laptop-100 | 1362 × 632 | una laptop de 1362 × 632 a 100 % |
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
- Vocabulario neutral: el voseo y los nombres de los juegos se quedan, pero lo cotidiano se escribe como se entiende en cualquier país ("ahora" y no "ahorita", "comprobar" y no "chequear"). La lista de lo que se evita, con su alternativa, es `scripts/lib/glosario-neutral.json`; `pnpm check:glosario` falla si aparece fuera de los nombres de los juegos y de `historia.html`, y corre en la CI. Una entrada en `"estado": "avisar"` no falla: es un uso que ya está en el texto y se revisa aparte (hoy `cancha` en "¡A la cancha!"). El 26 de octubre de 2026 se cambiaron 21 giros de todos los días (`guagua` por bebé, `plata de mentira` por dinero de prueba, `¿Dale?` por ¿Seguimos?, `Metele` por Agregá, `en un rato` por en unos minutos, `largada` por salida, `planilla` por hoja de cálculo, `este equipo` por este navegador, `Bajar como CSV` por Descargar, `anclados` por guardados en Stellar, `EN EL RUEDO` por SIGUEN, `¡CHUTA!` por ¡UY!, entre otros), y las Parabas y los Jucumaris pasaron a Guacamayas y Osos andinos. Se quedan el voseo, `acá`, `celular` y los nombres culturales (chovena, trueque, La Entrada, cuadra, fraternidad, Diablada, Socavón), con una línea que los explica donde hace falta; los Tojos quedan a confirmar. Nada de tuteo.
- Frases cortas, de una idea cada una.
- Decir el precio y el costo con el número y la fecha: "0,76 XLM, unos 16 centavos, medido el 3 de octubre", no "es muy barato".
- Admitir los límites. El veredicto amarillo de la página de verificación dice que la cuenta cierra pero que nadie atestigua la lista. Esa honestidad es la marca.

**Lo que no:**

- "Revoluciona", "disrumpe", "la próxima generación de", "impulsado por blockchain".
- Prometer lo que no está hecho. Si algo está en testnet, se dice testnet.
- Explicar la criptografía antes de explicar para qué sirve.
- Signos de exclamación en los botones y mensajes del producto. En los subtítulos de los juegos, en los stickers y en los videos sí, porque ahí se escribe como un relator.

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

**Lo que no va:** wiphalas, cholitas, el Illimani, Tiwanaku, ni la palabra "Bolivia" escrita en pantalla. El pie de página dice "Hecho en Bolivia" con el nombre de quien lo hizo, y con eso alcanza.

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

## Recursos descargables

La página pública `/marca.html` reúne la llama, los colores copiables, los usos de letra y el sello en español e inglés. Se encuentra desde el pie de la portada.

- `public/marca/llama.svg`: la silueta exacta de `public/icon.svg`, sin el rectángulo de fondo; lienzo de 512 × 512.
- `public/marca/llama.png`: la misma silueta, en RGBA de 2048 × 2048 y fondo transparente.
- `public/marca/llama-oscuro.svg` y `llama-oscuro.png`: la misma llama en el magenta del tema oscuro (`#ff5cb3`), para poner sobre fondos oscuros.
- `public/marca/sello-es.svg` y `sello-en.svg`: sellos de 960 × 280, transparentes, para fondos claros, con las letras convertidas en trazos. No estirar ni agregar detalles a la llama.

El sello dice «Sorteo verificable con Tinkazo» o «Verifiable draw with Tinkazo». Se usa cuando el sorteo tiene un comprobante verificable y se acompaña con el enlace a ese comprobante. No certifica que la lista inicial estuviera bien armada.

### El kit para patrocinios y eventos

La misma página tiene la sección «Para patrocinios y eventos», pensada para que quien organiza un evento con Tinkazo baje todo solo:

- Logo completo en `logo-horizontal` (llama a la izquierda, TINKAZO a la derecha) y `logo-apilado` (llama arriba), cada uno claro y `-oscuro`, en SVG y en PNG de 2048 px de ancho, con fondo transparente. La llama y el «ZO» van en magenta del tema; el resto en tinta (`#191919` en claro, `#f6efe2` en oscuro).
- Stickers `sticker-redondo`, `sticker-redondo-oscuro` y `sticker-cuadrado`, de 5 y de 7 cm, en SVG y PDF a tamaño real (1 unidad del SVG = 1 mm) con 3 mm de sangrado. La línea de corte va en una capa aparte (`id="corte"` en el SVG y una capa apagable en el PDF), con trazo de 0,25 mm. Fondo crema `#fff6e9` con borde de tinta, o tinta `#191919` con la llama en `#ff5cb3`. Los colores son RGB: la imprenta los convierte.
- `tinkazo-kit-marca.zip`: todo lo anterior más la llama, el sello y un `LEEME.txt` en español e inglés con la descripción, la paleta, las reglas de uso, la dirección y el contacto.

**La letra de los archivos.** El sitio usa la letra del sistema en grosor 900, que cambia de un equipo a otro, y un archivo de logo no puede depender de eso. Para los archivos se eligió **Montserrat Black** (SIL Open Font License 1.1; el .ttf oficial y su `OFL.txt` están en `scripts/marca/fuentes/`): es una geométrica de trazo grueso y mayúsculas anchas, la más cercana al 900 que ve la gente en el sitio, y es libre. La frase del sello usa Montserrat Bold. El texto se convierte en trazos con `opentype.js` (dependencia de desarrollo), con el kerning de la fuente y el espaciado de 0,06 em de la cabecera, así que nada depende de la letra del equipo ni de la impresora.

**Reglas de uso.** Espacio libre alrededor igual a la altura de la llama; tamaño mínimo de 24 px de alto en pantalla y 8 mm impreso; no estirar; no cambiar los colores; no ponerlo sobre fondos que no contrasten; se escribe «Tinkazo».

`node scripts/generar-marca.mjs` regenera todo esto (llama, logos, sellos, stickers y el ZIP) sin modificar el icono ni el logotipo. Es reproducible: dos corridas dejan los mismos bytes (el ZIP lleva siempre la fecha 1-1-1980). Rasteriza los PNG y arma los PDF y el ZIP sin herramientas de imagen adicionales. Los enlaces de descarga son del mismo origen, como requiere el atributo HTML `download`.


### Segunda versión: dirección, stickers, redes, afiches y portada

La segunda vuelta del kit suma, todo generado por el mismo script y también dentro del ZIP (114 archivos nuevos):

- **Logo con la dirección** (`logo-web-horizontal`, `logo-web-apilado`, cada uno claro y `-oscuro`, SVG y PNG de 2048 px): el logo con `tinkazo.app` debajo en Montserrat Bold, a la mitad del tamaño de la palabra y con el «.app» en magenta. Mínimo 24 px de alto el horizontal y 48 px el apilado (10 mm y 20 mm impresos).
- **Stickers nuevos**, de 5 y 7 cm, SVG y PDF, con sangrado y capa `corte`: `sticker-llama-recortada` (la silueta con filete de tinta y borde blanco de 2 mm; la línea de corte sigue el contorno, calculado como la unión de los píxeles de la llama), `sticker-web` y `sticker-web-oscuro` (la pastilla tinkazo.app), y en español y en inglés `sticker-verificable-es|en`, `sticker-gratis-…`, `sticker-escanea-…` (QR a https://tinkazo.app) y `sticker-evento-…` (con una franja para escribir el premio).
- **Hojas A4** `stickers-hoja-a4-es|en` (5 cm) y `stickers-hoja-a4-7cm-es|en`: los stickers acomodados con 5 mm de aire entre sí, con la capa `corte` para una cortadora de vinilo.
- **Imágenes para redes** `redes-<formato>-<claro|oscuro>-<es|en>.png`: portada abierta 1200×630, cuadrada 1080×1080, historia 1080×1920, cabecera 1500×500, cabecera de LinkedIn 1584×396 y las de patrocinio 1080×1080 y 1920×1080 con un recuadro para el logo del evento.
- **Afiches y cartel**: `afiche-evento-a4-…` y `afiche-evento-a3-…` («Hoy sorteamos con Tinkazo», QR grande a https://tinkazo.app, tres líneas de qué es y una franja para escribir el premio) y `cartel-mesa-a5-…` (QR a https://tinkazo.app/sorteo-para-meetup.html#comprobacion), en SVG y PDF.
- **Portada del kit** `kit-portada.png` (español) y `kit-portada-en.png`, 1600×900, con miniaturas de las piezas, para mandar junto al enlace.

**Cómo se dibuja.** Todo son formas planas (sin degradados, brillos ni desenfoque) en los cinco acentos de la paleta, con bordes gruesos de tinta, sombras duras, la franja de cinco colores de la cabecera, banderines de papel picado, confeti y rayas de velocidad. El código está en `scripts/marca/`: `base.mjs` (letras en trazos, geometría, rasterizador de PNG, PDF y ZIP), `dibujo.mjs` (el lienzo y sus piezas), `qr.mjs` (el QR con `qrcode-generator`, nivel Q y zona tranquila de 4 módulos), `logos.mjs`, `stickers.mjs`, `redes.mjs`, `afiches.mjs`, `portada.mjs` y `piezas.mjs`, que las junta. El confeti usa un generador con semilla fija: el mismo dibujo en cada corrida. Las pruebas decodifican los QR de los SVG con `jsqr`.

El PNG y el ZIP dependen de la versión de zlib de cada equipo: la prueba de reproducibilidad compara una corrida con otra en el mismo equipo, y los SVG (texto) contra los del commit.

### Cómo se ordena /marca.html y qué pesa

De arriba abajo, lo más pedido primero: el kit para quien nos pone de sponsor, la colección de stickers con personaje, los impresos del stand, los QR para el arte, la sección para creadores de contenido y, al final, «Logos, redes y reglas de uso» (los logos con y sin dirección, los stickers sueltos, las hojas, las redes, los afiches, cómo describirnos y las reglas de uso).

El repo no admite archivos de más de 4 MB, así que los ZIP van en cinco: `tinkazo-kit-marca.zip` (el kit original: logos, stickers, hojas, redes, afiches y portada, 4,16 MB, con muy poco margen), `tinkazo-kit-sponsor.zip` (1 MB), `tinkazo-kit-impresos.zip` (los SVG del roll-up y del banner con las fotos que enlazan, 1,5 MB), `coleccion/tinkazo-stickers.zip` y `qr/tinkazo-qr.zip` (los QR, 1,1 MB). Los PDF del roll-up y del banner (1,6 MB cada uno) se bajan sueltos. Si el kit completo vuelve a crecer, hay que sacar algo antes de agregar.

Instagram (`@tinkazo.app`, con k) está en el pie de todas las páginas, en el `sameAs` de la portada y en «Dirección y contacto».

### La colección de stickers con personaje

Veintiocho stickers para pegar en la laptop o regalar en un evento, en `public/marca/coleccion/` y en la sección «Stickers con personaje» de `/marca.html#coleccion`. Los genera `scripts/marca/coleccion.mjs` (los dibujos y las salidas) con `scripts/marca/silueta.mjs` (el troquel), desde el mismo `generar-marca.mjs`.

- **Los diez juegos, numerados del 1 al 10** para completar la serie: carrera («A toda llama»), ruleta («Vuelta y vuelta»), piñata («Dale, dale, dale»), trompo («Mano a mano»), sapo («Puntería fina»: el sapo de bronce sobre su cajón, con la boca cerrada y una ficha en el aire), guajojó («Te estoy viendo»), toborochi («Panza llena, corazón contento»), chovena («Nadie se suelta»), La Entrada («Con mi comparsa») y teleférico («Todos arriba»).
- **Especial Tarija**: «Tinkazo en Tarija» (la llama chapaca, con sombrero de ala ancha y un racimo de uvas, en los viñedos del valle) y «DevFest Tarija 2026» (la misma llama con su laptop, de noche; sin logos de terceros).
- **La llama**: «Llama de mi corazón», «Despertame cuando salga mi nombre», «¡Salió mi nombre!», la caravana de cinco llamas («Participar es gratis»), «Hecho en Bolivia» y «Con K de Tinkazo».
- **Frases**: «Verificalo vos», «Apthapi: cada uno trae algo», «Hasta la cacharpaya», «Todos en la lista» (la llama con la lista en la mano) y «Sin trampa, con cariño».
- **Para devs**: «Funciona en mi llama», «404, llama no encontrada», `git commit -m "llama"`, «Mi sorteo tiene tests» y «Hola, mundo». Un chiste técnico por sticker, y solo en esta tanda.

**Reglas que siguen.** Coleccionable sin azar: cada uno se elige, nunca sobres sorpresa, piezas raras ni rarezas. La llama sigue sin cara ni poncho: lo tierno sale de la pose (echada, saltando, en caravana) y de lo que la acompaña (un corazón, confeti, una «z»). La llama echada es la del logo con las patas dobladas, para que se reconozca de un vistazo. Todos llevan `tinkazo.app` en una etiqueta chica de tinta con la letra en papel, colgada del borde de abajo del troquel y del mismo tamaño en todos (2,35 mm de alto de letra a 5 cm, más de 26 puntos a 300 ppp; la prueba exige 2,2 mm): nunca tapa el dibujo ni se vuelve cartel. Los números x/10 de los juegos van chicos, en una esquina. Si algún día la colección suma una llama con carita (la pide la ternura), es decisión de quien dirige: el logo no cambia. Los otros personajes sí tienen ojos, como en los juegos. Nada de dados, cartas ni fichas de casino (la del sapo es el tejo de bronce del juego, sin números ni signos de plata); nada sobre dinero ni suerte. No se diseña por género: hay una línea tierna, una con humor, una orgullosa y una de grupo, y cada persona elige. La palabra «yapa» queda afuera porque el glosario neutral del sitio la evita.

**Cómo se dibuja.** Pixel art de rectángulos como el logo, unas pocas formas limpias (la ruleta, la piñata, los cerros) y las letras de Montserrat en trazos, en la paleta de la marca más los colores de los personajes de los juegos. Cada frase va en una cinta con borde de tinta y sombra dura, girada tres grados. La letra más chica mide 2,85 mm de alto a 5 cm (la prueba exige 2,8).

**Cambio del 7 de noviembre de 2026.** Salieron el sapo con la boca abierta y «¡Adentro!», «Todos adentro» y «Nadie se queda afuera» (leídos juntos sonaban sugestivos); entraron «Puntería fina», «Todos en la lista», «Participar es gratis» y el especial de Tarija; se rehicieron el toborochi (el árbol botella con sus flores) y el guajojó (el pájaro de la noche con la luna); cada sticker lleva `tinkazo.app` y hay una hoja A4 «laptop» con los nueve que más dan ganas de pegar, de 6 cm.

**El troquel.** La silueta es la unión de todo lo dibujado agrandada 2,6 mm con esquinas redondas y sin huecos: se calcula con un campo de distancias sobre una grilla de 0,25 mm y se traza como un polígono suave. El sangrado es la misma silueta 3 mm más grande (2 mm en las hojas). La línea de corte va en la capa `corte`, con trazo de 0,25 mm.

**Los archivos.** En `public/marca/coleccion/`: un PNG transparente de 512 px por sticker y por idioma (`<id>-es.png`, `<id>-en.png`; `dev-commit.png` es uno solo), las hojas en PDF y su vista previa en PNG (`hoja-a4-juegos`, `hoja-a4-frases` con frases, devs y Tarija, `hoja-a4-laptop` con nueve de 6 cm y `hoja-a3` con los 28 más cuatro de los más pedidos; las demás, de 5 cm, en es y en), `frases.txt` con todas las frases en los dos idiomas y lo que quieren decir las palabras bolivianas, `tinkazo-stickers.zip` (cada sticker en PDF de 5 y 7 cm y en SVG de 5 cm, las hojas A4, las frases y un LEEME) y `tinkazo-stickers-png.zip` con los PNG. Cada ZIP tiene que quedar por debajo de 4 MB: por eso el SVG va en una sola medida, los PNG van aparte y la hoja A3 se baja suelta.

### Para el stand y para quien nos pone de sponsor

- **Roll-up** `rollup-85x200-es|en` y `rollup-100x200-es|en` (PDF y SVG) y **banner para el frente de la mesa** `banner-mesa-120x40-es|en` (lona; «Escaneá y probá» arriba del QR y todo a 6 cm de los bordes, por el dobladillo y los ojales; para algo chico arriba de la mesa están el cartel A5 y el afiche A3), en el tema claro y con 5 mm de sangrado. De arriba abajo: banderines, el logo (17 cm de llama en el de 85), la frase en tres líneas (letra de unos 6 cm: se lee a más de 6 m), la tarjeta amarilla del ancho del contenido con el QR a https://tinkazo.app (el código mide 32,5 cm de lado, 43,5 con su margen blanco, entre 0,9 y 1,3 m del piso: se escanea desde unos 3 m), tinkazo.app e Instagram, seis juegos en una grilla de tres columnas del mismo ancho que la tarjeta («Juegos de Bolivia», sin número: se ven seis) y cuatro personajes de los stickers (sapo, guajojó, toborochi y la llama del corazón). Los 15 cm de abajo quedan libres porque los tapa la base; solo baja hasta ahí el fondo y el remate de colores de los últimos 3 cm. Cada imprenta pide su sangrado (3, 5 o 10 mm): hay que pedirle la plantilla.
- **Las fotos de los juegos** salen de la escena fija (`?pose=<juego>&semilla=…`) dibujada a 3840×2160 con `scripts/marca/fotos-juegos.mjs` y quedan en `scripts/marca/fotos/` en tres tamaños: 2560 px para el roll-up (unos 180 ppp en el de 85), 1280 px para el banner de mesa y 640 px para las vistas de la página. El generador no abre un navegador: el PDF mete el JPEG tal cual, el SVG para editar enlaza `juego-<juego>.jpg` (que viaja al lado, en `public/marca/` y en `impresos/` del ZIP) y la vista de la página (`vista-…svg`) lleva las chicas adentro.
- **Logos para la pared de sponsors** `logo-pared-horizontal` (1200×600) y `logo-pared-cuadrado` (800×800), en claro, `-oscuro`, `-negro` y `-blanco`, SVG, PNG transparente, PNG de 2400 px (`-2400.png`) y PDF vectorial (30 y 20 cm de ancho), en una caja fija con aire alrededor para que queden del mismo tamaño que los demás.
- **Imágenes para anunciarlo** `redes-sponsor-post|historia|linkedin|x|panoramica|banner-<tema>-<idioma>.png` («Somos sponsor del DevFest Tarija», el 28 de noviembre de 2026), con los personajes de los stickers; la panorámica mide 1200×675 y el banner para la web del evento 1980×400. La publicación, la historia y la panorámica salen además en un segundo estilo, `redes-sponsor-<formato>-juegos-<tema>-<idioma>.png`, con capturas de seis juegos y su nombre: se bajan de a una desde la página y no van en el ZIP, porque con fotos pesan más. Esas tres, que son las que se comparten por Instagram y WhatsApp, llevan el QR del enlace oficial para reservar lugar en el DevFest, con la leyenda «Escaneá para reservar tu lugar» («Scan to save your seat»): la placa blanca mide de 290 a 410 px con su borde de 4 módulos, y la prueba decodifica con `jsqr` las 24 imágenes. Las capturas son `scripts/marca/fotos/<juego>-red.png` (800 por 450, PNG) y las pinta el rasterizador propio. Los tres textos para redes van rotulados como sugeridos para que los publiquen los organizadores, y ninguno dice que Tinkazo hace los sorteos del evento ni que tiene stand. En las cabeceras todo arranca después de los 430 px de la izquierda, donde va la foto de perfil. El evento se nombra en texto: nunca su logo.
- **Eventos** (sección `#eventos` de la página): una tarjeta por evento, con su enlace oficial y un QR grande («Escaneá para reservar tu lugar» en el DevFest Tarija, «Escaneá para inscribirte» en el NASA Space Apps Challenge de Santa Cruz de la Sierra). Los enlaces y los QR salen de `scripts/marca/eventos.mjs` (el mismo `qr.mjs` de los impresos: nivel Q y zona blanca de 4 módulos) y se escriben en `public/marca/devfest/qr-devfest-tarija-2026.svg` y `public/marca/space-apps/qr-space-apps-santa-cruz-2026.svg`; las pruebas los decodifican. La tarjeta de Space Apps no lleva logo ni afiche de la NASA ni de Space Apps (sus marcas tienen reglas de uso y hay que pedir la autorización), avisa que Tinkazo no es parte de la NASA y no dice «aliado oficial» hasta que se confirme; para ocultarla basta agregarle `hidden`.
- **Textos** en `scripts/marca/textos-sponsor.mjs` (los mismos que las claves `maSp*` de la página, y la prueba lo exige): la descripción en 25, 50 y 100 palabras (50 y 100 exactas: la prueba lo exige), tres publicaciones (cuando se anuncia, el día del evento y para agradecer; ninguna dice que hacemos los sorteos del evento ni que tenemos stand, porque eso lo confirma quien organiza), cómo se escribe el nombre y dónde encontrarnos (Instagram @tinkazo.app). Salen en `textos-sponsor.txt`.
- **Cinco preguntas para coordinar** (`preguntas-organizadores.txt` y la página): formato del logo y fecha, largo de la descripción, cómo nombrar el evento, si hay lugar para nosotros y si quieren algún sorteo con Tinkazo.
- **`tinkazo-kit-sponsor.zip`** (2,6 MB) junta los logos de pared, las imágenes, los textos y las preguntas para el organizador; el kit completo los trae en `sponsor/` y los impresos en `impresos/`.

### QR para tu arte

La sección `/marca.html#qr` ofrece códigos QR listos para poner en un afiche, un volante, una historia, una diapositiva o un sticker, para quien organiza un evento, un sponsor, quien diseña o una comunidad. Todo vive en `public/marca/qr/` y también se baja junto en `tinkazo-qr.zip` (1,1 MB, con un LEEME en español y en inglés).

- **El principal** lleva a `https://tinkazo.app/`, la portada: ahí se pega la lista, se entra con una cuenta y se sortea. Ninguna ancla ni parámetro de la dirección abre la ventana de ingreso (solo lo hace el botón de la portada), así que no existe un camino directo a «conectar la cuenta» ni a «crear el sorteo», y no hay un QR aparte de «crear tu cuenta»: la portada cubre las dos cosas.
  - `qr-etiqueta-magenta.png` y `qr-etiqueta-amarilla.png` (2000 por 2580 px, fondo transparente): la placa blanca con el QR, la llamita arriba con borde blanco y sombra dura, y «tinkazo.app» en una etiqueta inclinada abajo. Es lo que se pone encima de cualquier arte, en el color que más contraste con él. La llama va al lado del código, nunca dentro. El diseño está aprobado: no se rehace sin pedirlo.
  - `qr-tarjeta-<cuadrada|historia>-<papel|amarillo|noche>-<es|en>.png`: 1080 por 1080 para una publicación y 1080 por 1920 para una historia, que respeta las zonas de Instagram.
  - `qr-tinkazo-app-<blanco|papel|transparente>.svg|png`: solo el código, con módulos de tinta (`#191919`) sobre blanco, sobre el crema de la marca (`#fff6e9`) o sin fondo (solo para un fondo claro), y su margen de 4 módulos. Corrección de errores nivel Q. El PNG ronda los 2000 px, con módulos de píxeles enteros.
- **Más destinos**, sobre blanco, en SVG y en PNG, hasta cuatro: `qr-demo-carrera` (`https://tinkazo.app/?demo=race`, un sorteo de ejemplo con la carrera de llamas; la demo nunca graba nada), `qr-comprobar` (`https://tinkazo.app/sorteo-verificable.html`, cómo se comprueba un sorteo), `qr-juegos` (`https://tinkazo.app/juegos.html`) y `qr-instagram` (`https://www.instagram.com/tinkazo.app/`).

**Por qué «Comprobalo vos» no lleva a `verificar.html`.** Sin un comprobante en la dirección, esa página muestra «Este enlace no trae un sorteo»: el comprobante vive en el fragmento de cada sorteo (`#r…`), así que un código general dejaría a quien lo escanea frente a un error. El QR del comprobante de cada sorteo lo arma la herramienta cuando sale el ganador. Para un afiche sirve la página que explica cómo se comprueba, `sorteo-verificable.html`. La prueba `src/marca-qr.test.ts` vigila que ese destino no vuelva.

**Reglas de uso.** Tamaño mínimo impreso: 2 cm de lado el código solo (con su margen blanco) y 3 cm de ancho la etiqueta. Siempre oscuro sobre claro, nunca invertido (muchos lectores no lo leen). No recolorear, no deformar, no tapar con adornos ni poner un logo encima, y no recortar el margen. Probarlo con un celular, a la distancia real. Ningún destino lleva parámetros de rastreo: lo único con consulta es `?demo=race`.

**Cómo se hace.** Los códigos solos y el ZIP los genera `scripts/marca/qr-clave.mjs` (con `qrcode-generator`, nivel Q) desde el mismo `generar-marca.mjs`; `node scripts/generar-marca.mjs --solo qr` los regenera sin tocar nada más (en particular, sin rehacer los stickers de la colección). Es reproducible: dos corridas dejan los mismos bytes. La etiqueta y las tarjetas se dibujan aparte, en HTML con la letra y la llama de la marca, y se capturan con Chrome; el repositorio guarda los PNG finales y el ZIP los lee tal cual. Las pruebas (`src/marca-qr.test.ts`) leen cada PNG con jsQR, a tamaño completo y a 400 px de ancho y sin probar la imagen invertida, y comparan el destino exacto con una lista escrita a mano.

## Marcas de otros

Tinkazo corre sobre la red Stellar, y la portada lo dice con una firma chica: «Hecho con» y el logo de Stellar (en inglés, «Built on»). El logo es una marca de otros, no de Tinkazo: se usa como lo pide su dueño y no se confunde con el kit de marca de este documento.

### De dónde sale el logo

Son los logos oficiales de Stellar, en sus dos versiones: negro, para el tema claro, y blanco, para el oscuro. Lo único que se les hizo fue achicarlos al mismo tamaño (511 × 128 px) y guardarlos como WebP, para que pesen poco (cada uno, menos de 20 KB). No se les cambió el color, ni las proporciones, ni se recortaron.

| Archivo | Tema | Dónde |
|---|---|---|
| `stellar-logo-negro-511x128.webp` | claro | `public/terceros/stellar/` |
| `stellar-logo-blanco-511x128.webp` | oscuro | `public/terceros/stellar/` |

Viven en `public/terceros/`, aparte de `public/marca/`: esa carpeta es el kit de Tinkazo y hay pruebas que cuentan sus archivos. Si Stellar cambia su logo, se vuelve a bajar el oficial y se reemplazan los dos archivos con el mismo nombre y el mismo tamaño.

### Reglas de uso

- **Sin alterar.** Ni color, ni proporciones, ni recorte, ni filtros de CSS para cambiarle el color. Cada tema usa su archivo: negro sobre el papel claro y blanco sobre el oscuro. El alto se fija en 20 px y el ancho sale de la proporción del archivo.
- **Chico.** Es una firma, no un titular: entre 18 y 22 px de alto, con aire alrededor, y nunca el elemento más grande ni más llamativo del bloque. Va debajo de los botones de la portada, para no empujar el botón principal fuera de la primera pantalla, ni en un celular de 360 × 640 ni en uno de 320 de ancho.
- **Sin sugerir aval.** No se escribe nada que haga pensar que la Stellar Development Foundation avala, patrocina o es socia de Tinkazo («socio», «aliado oficial», «certificado por Stellar»). Se dice solo «Hecho con» y el logo, y el logo lleva el texto alternativo «Stellar».
- **El aviso va en la página de términos.** La política de marca de la Stellar Development Foundation (vigente desde el 21 de enero de 2025, https://www.stellar.org/trademark-brand-policy/) pide un aviso cuando un software muestra su marca, y permite ponerlo en una página de créditos si no queda bien junto al logo. En Tinkazo ese lugar es `terminos.html`, al final del contenido, como una nota chica. La portada no lleva el aviso: solo la línea «Hecho con» y el logo. El aviso dice, en los dos idiomas:
  - es: «Stellar es una marca de la Stellar Development Foundation. Todos los derechos reservados. Tinkazo es un proyecto independiente: no está afiliado a la Stellar Development Foundation, ni patrocinado ni avalado por ella.»
  - en: «"Stellar" is a trademark of the Stellar Development Foundation. All rights reserved. Tinkazo is an independent project, not affiliated with, sponsored or endorsed by the Stellar Development Foundation.»
- **El enlace.** Toda la línea lleva a https://stellar.org y abre en otra pestaña, con `rel="noopener"`.

### Dónde se usa

El logo, solo en la portada (`index.html`); el aviso de marca, solo en la página de términos (`terminos.html`):

- La línea «Hecho con» y el logo, al final del bloque de texto de arriba (`.hero-copy`), debajo de los botones. Las clases son `built-on`, `built-on-link`, `built-on-text` y `built-on-logo`, con `built-on-logo-light` (el negro) y `built-on-logo-dark` (el blanco). Los estilos están en `src/styles.css`, junto a `.hero-note`.
- El aviso de marca, al final de `terminos.html`, en un párrafo con la clase `note` (la nota chica de las páginas de lectura). La portada ya no lleva el aviso en su pie.
- Los textos son las claves `builtOn` (la línea) y `tmStellarMarca` (el aviso) de `src/i18n.ts`.
- `src/hecho-con-stellar.test.ts` vigila la línea, el enlace, las dos imágenes, las claves, que la portada no lleve el aviso, que `terminos.html` lo lleve con el texto exacto en los dos idiomas y el peso de los archivos.

Si el logo pasa a otra página, hay que cumplir las mismas reglas; el aviso sigue en la página de términos y no se repite en el pie.

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

## Kit para creadores de contenido

`marca.html#creadores` ofrece a quien hace videos (TikTok, Reels, Shorts) un clip vertical de cada juego, un logo animado para abrir y cerrar y diez guiones con su guía de CapCut, en español y en inglés. Los datos viven en `src/marca-creadores.ts` (guiones, clips, pasos) y `src/marca-creadores-textos.ts` (títulos y notas); la página los pinta con `src/marca-creadores-ui.ts`.

**Los videos no van al repositorio** (el auditor privado lo bloquea): se graban en una carpeta privada y se sirven desde Cloudflare, en `https://m.tinkazo.app/kit/<archivo>` (ruta pública del Worker `workers/musica`, ver su README). Mientras `KIT_PUBLICADO` en `src/marca-creadores.ts` sea `false`, la página muestra los guiones y la guía, pero ningún enlace de descarga: la bajada dice que los clips llegan pronto, el primer paso es grabar la pantalla con el ejemplo del juego (`?demo=<juego>`, el enlace va en cada guion) y nada promete un clip. Con `true`, la bajada pasa a `crBListo` y el primer paso a bajar el clip. Los guiones `.txt` se vuelven a generar después de cambiar la bandera.

| Pieza | Cómo se hace | Medidas |
|---|---|---|
| Clips (`tinkazo-<juego>-9x16.mp4`) | `scripts/marca/videos/grabar-clips.mjs`: el show determinista se dibuja cuadro por cuadro con un reloj cambiado y se codifica con ffmpeg. La ventana de cada juego está en `ventanas.json`; el mismo ganador de ejemplo en todos | 1080 por 1920, 30 cuadros por segundo, sin música, de unos 13 s, H.264. Terminan con un segundo quieto en el cartel del ganador, sin fundido: el último cuadro es siempre el ganador. Aparte sale `tinkazo-<juego>-9x16-bucle.mp4`, con el final fundido en el principio, para repetirlo sin salto |
| Logo animado | `scripts/marca/videos/logo-animado.mjs`: la misma llama y las mismas letras (Montserrat, OFL) que el resto de la marca | Entrada de 2,5 s y cierre de 3,2 s (con tinkazo.app y @tinkazo.app) en fondo oscuro, claro, verde `#00ff00` para recortar y transparente (WebM VP9) |
| Guiones y subtítulos | `scripts/marca/videos/guiones.mjs`: `.txt` y `.srt` por juego y por idioma, de los mismos datos que la página, la placa del gancho en PNG transparente (`tinkazo-placa-<juego>-<idioma>.png`) y la letra en `tinkazo-letra-montserrat.zip`. El texto en pantalla termina antes del cartel del ganador (`cartel` en `CLIPS`, medido en los cuadros): la pregunta no tapa la respuesta | El texto en pantalla va en la zona segura: entre el 15 % y el 65 % de la altura y a más del 11 % de cada costado. No hay una zona oficial única; se prueba con un borrador subido |
| Miniaturas | `scripts/marca/videos/posters.mjs` deja `public/kit-clips/<juego>.webp` (capturas de nuestros juegos, sí van al repositorio) | 270 por 480 |

Publicar: copiar o subir la carpeta con `workers/musica/subir-kit.mjs` (`--seco` revisa sin tocar nada), desplegar el Worker, comprobar con `curl -sI https://m.tinkazo.app/kit/<archivo>` y recién ahí pasar `KIT_PUBLICADO` a `true`. Cada cambio de un archivo del kit conviene que cambie su nombre (`-v2`).

Instagram es `@tinkazo.app`, con k (https://www.instagram.com/tinkazo.app/). No se pueden usar logos de terceros en los videos.
