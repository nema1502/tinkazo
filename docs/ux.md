# UX de Tinkazo

Cómo se piensa y cómo se comprueba que quien usa Tinkazo sepa, en cada momento, qué sigue. Es una regla de producto y tiene su auditor: lo que acá se dice se mide con `scripts/audit-flujo.mjs`.

## Por qué existe

Una prueba con alguien que usaba la herramienta por primera vez (19 de octubre de 2026) dijo que la interfaz se veía muy bien, y que la experiencia no: "me cuesta encontrar el botón del siguiente [...] no sé cuál es el siguiente". Se midió y tenía razón. Con la lista sellada, el botón de sortear quedaba debajo de los doce juegos, a una pantalla y media de la caja de la espera; y después del ganador, "otro premio" quedaba debajo de la verificación, el QR y la historia, a más de una pantalla. Hasta ese día solo se probaba en 1440x900 y 390x844, y en una laptop común (1362x632 al 100 %) el botón de sellar ni siquiera se veía.

## Los principios

1. **En cada paso hay una sola acción principal.** Los pasos son cuatro: 1 Lista, 2 Sellar, 3 Sortear, 4 Compartir. La acción principal es el botón con el color de la casa (magenta); todo lo demás es secundario y no lleva ese color. Si después del ganador queda con quién sortear, la principal es "Siguiente premio" (con cuántas personas quedan); si no, "Compartir el resultado". "Siguiente premio" vuelve al paso 2 con la lista sin los que ya ganaron.
2. **Se ve sin hacer scroll.** La acción principal tiene que estar a la vista, con la pantalla donde la deja la propia página, en estas cinco pantallas y a 200 % de zoom:

   | Etiqueta | Ancho x alto | Qué es |
   |---|---|---|
   | laptop-100 | 1362x632 | laptop a 100 % de zoom |
   | escritorio | 1280x720 | escritorio |
   | tablet-h | 1024x560 | tablet acostada o laptop chica |
   | celular-h | 844x390 | celular acostado |
   | celular | 390x844 | celular parado |
   | zoom-200 | 681x316 | la laptop de arriba a 200 % de zoom |

   Se logra ordenando la página: arriba lo que se espera y el botón que sigue, y recién después lo opcional (el selector de juegos, los ajustes, las bases, los datos del sello). Los diez juegos no se esconden: quedan debajo del botón, con el juego elegido siempre a la vista junto a él y un "Cambiar de juego" que lleva al selector.
3. **Si no entra, la barra de "lo que sigue".** Es la red de seguridad: una barra fija abajo, con un único botón principal y la línea del paso ("Paso 3 de 4 · Esperando la ronda · 0:25"). Aparece solo cuando el botón de verdad no se ve entero, así que nunca hay dos botones iguales a la vista; su botón hace `.click()` sobre el de verdad, así que la lógica no se repite; no tapa el pie de la página (la herramienta deja aire abajo, esté o no la barra) ni el botón de verdad; y se va con el estadio, con la espera en grande y con cualquier ventana abierta. Si lo que se aprieta desde la barra falla, el motivo se lleva a la pantalla: se escribe junto al botón de verdad, que en ese momento está fuera de ella. Vive en `src/ui/siguiente.ts`.
4. **Un botón apagado dice por qué.** Mientras corre la cuenta, el botón de sortear dice cuánto falta ("Se habilita en 0:25") y se ve apagado pero presente. Al llegar a cero se enciende con un pulso suave, y con `prefers-reduced-motion` el pulso se apaga y queda el aro quieto. El de sellar, apenas se aprieta, dice "Preparando el sello…" y después cada paso ("Armando la transacción…", "Mandando a la red…"): hasta el 21 de octubre de 2026 quedaba apagado y diciendo todavía "Sellar en Stellar" mientras se bajaba la interfaz del contrato, de medio segundo a catorce en la testnet. Desde ese día esa interfaz se baja al abrir la sesión, con la página quieta, y el botón pasa a "Armando la transacción…" en unos milisegundos (`clienteListo` y `precalentarSello` en `src/ui/anchor.ts`).
5. **Siempre se sabe dónde se está.** Arriba de la herramienta hay un indicador de pasos, discreto: el actual resaltado y los hechos con ✓. En el celular entra en una sola línea. Los cambios de paso se anuncian con calma a los lectores de pantalla (región `role="status"`, `aria-live="polite"`), solo cuando cambia de qué se trata el paso y nunca con cada segundo de la cuenta.
6. **Ninguna ventana se corta.** Una ventana entra entera en la pantalla o se recorre por dentro; nada queda fuera de alcance, tampoco a 200 % de zoom. Lo revisa `scripts/audit-ui.mjs`.
7. **Nada de tecnicismos en lo que ve quien sortea.** Nada de drand, bytes, firmas, hashes ni "XLM": lo técnico va plegado o en las páginas de seguridad y de verificar (ver [marca.md](marca.md)).

## Cómo está armado

- `index.html`: el orden de la lista sellada (`#sec-frozen`) es la espera compacta, el botón (`#btn-draw`) con el juego elegido, el selector, los ajustes, las bases y los datos del sello. El bloque de lo que sigue después del ganador (`#again-row`, con `#btn-again-sin`, `#btn-proof` y `#btn-again-nueva`) va justo debajo de las tarjetas del ganador, antes de "Mostrar en grande" y de la verificación.
- `src/ui/siguiente.ts`: calcula el paso (`app.frozen`, `app.drawn`, cuántos nombres hay), pinta el indicador y la barra, y vigila el botón de verdad con un `IntersectionObserver`. `freeze.ts` y `draw.ts` le avisan cuando algo cambia (`actualizarPaso`); la cuenta regresiva se la pasa `main.ts`. La regla de qué paso toca (y de qué se trata) vive aparte, sin DOM, en `src/ui/pasos.ts`, con sus pruebas; y `src/ui/index-textos.test.ts` cuida que `index.html` conserve sus ids y que cada `data-i` exista en los dos idiomas.
- `verError(mensaje)`, también en `siguiente.ts`: lo llaman `freeze.ts` (el sellado) y `draw.ts` (el sorteo, en sus tres ramas de error) después de escribir el motivo. Si el mensaje no se ve, descontando la cabecera fija y la barra, lo lleva a la pantalla. En el sorteo, el botón vuelve a encenderse con su pulso: sigue siendo lo único que hay que hacer.
- La barra no descuenta su propio lugar al mirar el botón: si el botón entra entero en la pantalla se ve, esté donde esté, y la barra se esconde. Así nunca queda el botón de verdad a medio tapar detrás de ella. Arriba sí descuenta la cabecera fija (en pantallas de más de 1100 px).
- Con `?demo=` no hay barra ni indicador: la demo se hace sola. Con la puerta cerrada (sin cuenta conectada) tampoco: la puerta ya dice qué falta.
- Sin cuenta conectada (en una red con contrato), la lista, los premios y sus etiquetas se leen igual y se pueden cargar; no se apagan. Solo el botón de sellar queda con `aria-disabled` (no con `disabled`, para que un lector de pantalla lo encuentre), y la línea debajo dice "Conectá tu cuenta para sellar" (en inglés, "Connect your account to seal"). Mientras tiene `aria-disabled`, el clic no sella: abre la ventana para elegir una cuenta, que es lo que falta (lo dice el manejador del botón en `src/main.ts`). Hasta el 21 de octubre de 2026 no hacía nada, y parecía un botón roto (evaluador visual). La demo sella igual, porque no graba nada, y los auditores del modo libre quitan ese estado a propósito. Lo mide `scripts/audit-ui.mjs`, en la pantalla de la lista sin cuenta: que nada de lo que se lee quede por debajo de 4,5 a 1.
- `env(safe-area-inset-bottom)`: la barra lo usa (`max(10px, env(...))`) para un celular con barra de gestos. Ojo: esos valores solo son distintos de cero con `viewport-fit=cover`, y el sitio no lo usa a propósito (obligaría a rellenar los costados en todas las páginas, por los notch). Hoy vale cero y la barra queda sobre la del navegador.
- **No se rompen ids.** Los auditores y el sitio usan `#btn-draw`, `#btn-freeze`, `#btn-again-sin`, `#g-*`, `#st-skip`, `#winner-box`, `#sec-frozen`, `#sec-draw` y otros. Buscalos antes de renombrar: `grep -rn "getElementById\|\$(\"" scripts/*.mjs`.

## La cabecera

Está en todas las páginas y tiene una sola acción: **Sortear**, el botón amarillo que lleva a la herramienta desde cualquier página. No hay "Entrar" ni otro botón del color de la casa: la portada ("Entrar y sortear, es gratis") y la puerta del sorteo ya tienen el suyo, y la cabecera repetía el de la portada. En el celular, además, un segundo botón de ese color le quitaba la vista a "Sortear". Con una cuenta conectada, la cabecera muestra quién está adentro: el nombre y la red en la portada, y "Mi cuenta" en las páginas de lectura.

En el celular (760 px o menos) la fila tiene tres cosas: "Sortear", "Mis sorteos" y "Más", que abre Juegos, Cómo funciona, Seguridad y Precios. El botón y cada opción miden 44 px de alto como mínimo. La lista se cierra con otro toque en el botón, con un toque fuera de ella, con Escape o al pasar a escritorio. Nada se recorre de costado: antes, "Mis sorteos" quedaba cortado a 390 px (hallazgo H2 del evaluador visual, 20 de octubre de 2026). Entre 761 y 1100 px las seis páginas van en una fila debajo del logo; por encima de 1100 px la cabecera es fija y las seis van en una sola línea.

Lo miden `scripts/audit-ui.mjs` (texto cortado, blancos de toque y scroll horizontal en la cabecera) y `scripts/audit-flujo.mjs --solo-anchos` (de 320 a 414 px). El código está en `src/ui/menu.ts` (la lista de "Más") y en `index.html` y las demás páginas (el bloque `nav.topnav`).

## La espera en grande

Entre sellar y poder sortear pasan unos segundos (45 con cuenta): la lista ya está cerrada y el número que la va a decidir todavía no existe. "Mostrar la espera en grande", en la caja de la espera, pone esos segundos en escena para la sala: la cuenta gigante, el premio y los nombres de todos pasando. Es una opción y no se abre sola. Vive en `src/ui/espera.ts`.

**Desde el 21 de octubre de 2026 desemboca en el show.** Nicolás: "cuando esté la espera en grande y termina, debería hacer que cuando termine, empiece también, ¿no? Ahora la espera termina y se sale". Hasta ese día, al nacer el número la espera se cerraba y dejaba "Lanzar el sorteo" en la página, con el foco (decisión del 17 de octubre, cuando salieron el "¡Contemos juntos!" y el "¡Nació!" de la primera versión, que no vuelven). Ahora:

- Si la espera está abierta cuando nace el número, el sorteo arranca solo, como si se tocara "Lanzar el sorteo" (la cuenta regresiva de `freeze.ts` aprieta el botón de verdad). La espera hace de cortina: donde estaba la cuenta dice "Está llegando el número que decide…" (o "Grabando el sorteo…", con cuenta), con el mismo alto para que los nombres no salten, y se va recién cuando la tarjeta del juego o el estadio están detrás. La sala no vuelve a ver el formulario.
- La pantalla completa se pide al tocar "Mostrar la espera en grande": es el gesto que el navegador exige. El show la hereda y no la vuelve a pedir sin un toque (el navegador la negaría).
- Y el show desemboca en el resultado en grande, el mismo de "Mostrar en grande": el nombre, el premio y el QR del comprobante, sin soltar la pantalla completa y sin que la sala vea la página en el medio (21 de octubre de 2026, buscador de detalles D04). El QR lleva el enlace corto, como el del botón, para que se lea desde el fondo; si el corto no llega en 2 s sale con el largo y cambia cuando llega, y en la demo nunca se arma. Hasta ese día, al terminar el show se soltaba la pantalla completa y la sala veía la página de quien organiza, con la cabecera y la cuenta; para volver a ponerlo en grande había que tocar "Mostrar en grande" y se notaba el salto. "Cerrar", Escape o salir de la pantalla completa vuelven a la página con "Siguiente premio" con el foco: Enter, Enter, y se sigue. Sin show (movimiento reducido), igual. Si quien organiza salió de la pantalla completa durante el show, el resultado va a la página, como siempre. Sin la espera en grande, nada de esto cambia: el resultado queda en la página.
- Si la cuenta pide aprobar cada operación en una ventana (Freighter), el sorteo no puede arrancar solo: la espera queda abierta con una sola acción grande, "Lanzar el sorteo", y la línea "Tu billetera te va a pedir que lo apruebes". La cuenta de prueba y la de Google (Pollar) firman sin ventana y arrancan solas. Sin cadena (la demo, el modo libre) no hay nada que aprobar.
- Si traer el número o grabar el sorteo falla, el motivo y "Reintentar el sorteo" se ven en la espera, en grande y con el foco, sin soltar la pantalla completa: `verError` (`siguiente.ts`) se lo ofrece a la espera antes de mover la página.
- Escape o "Volver a la página" salen, como siempre, y sueltan la pantalla completa que pidió la espera; el foco vuelve a "Lanzar el sorteo" si ya se puede. Con la pantalla completa, Escape la suelta el navegador sin avisarle a la página, así que salir de ella también cierra la espera (salvo mientras se sortea: ahí un segundo Escape cierra).
- Si la espera no está abierta cuando nace el número, todo queda como antes: "Lanzar el sorteo" a la vista y con el foco. El recorrido de `audit-flujo.mjs` no cambia.

Lo mide `scripts/audit-espera.mjs`, en el modo libre con `?lead=3` y sin Stellar, cuadro por cuadro desde adentro de la página: que la espera se abre con un clic de verdad, que el show arranca solo, que en ningún cuadro entre la espera y el estadio se ve la página, que la pantalla completa sigue con el show y que la cortina no aparece encima; y al final, que el show desemboca en el resultado en grande sin un cuadro de la página en el medio, con la pantalla completa y el QR, y que "Cerrar" vuelve a la página con "Siguiente premio" con el foco. El QR se lee con un lector aparte: con el servicio de enlaces cortos de mentira (la auditoría no crea enlaces de verdad), en una pantalla contesta y el QR tiene que ser el corto, y en la otra no contesta y tiene que salir el largo antes de 3 s. En la primera pantalla mira también el caso de "Volver a la página" antes de que nazca el número, y el de los relays del número cortados (el reintento en grande, y el show al volver la red). Deja capturas de la transición en `--out`. La fase de Freighter no tiene prueba de punta a punta: hace falta una billetera que firme.

```bash
CDP_PORT=9982 node scripts/audit-espera.mjs --base http://localhost:4173 [--vistas 1280x720,390x844] [--tema dark|light] [--sin-casos]
```

## Los detallitos (21 de octubre de 2026)

Nicolás: "detallitos que son bonitos y ahorran tiempo o hacen mejor la experiencia de usuario". Un buscador los encontró usando la herramienta de verdad (con capturas), un revisor los filtró contra estas reglas y contra las decisiones del autor, y cada uno se arregló con su propio cambio. Los mide `scripts/audit-detalles.mjs` (en el modo libre, con una captura por pantalla y por tema); D04, `audit-espera.mjs`; D05 y D06 se miraron sellando en testnet con la cuenta de prueba.

| | Qué cambió |
|---|---|
| D01 | Con la lista sellada (y mientras se sella), nada cambia el cuadro: ni "Cargar ejemplo", ni "Editar selección", ni los orígenes. "Mostrar la lista a la sala" muestra la sellada, con su huella, y lo dice. |
| D03 | La lista sin sellar, el premio y "Cuántos ganan" vuelven al recargar y al volver de entrar con Google (en la pestaña, hasta sellar). |
| D04 | Desde la espera en grande, el show termina en el resultado en grande (ver arriba). |
| D05 | Con la cuenta de prueba o con Google, sellar dice "Mandando a la red…", no "Aprobá la operación en tu billetera… 0,81 XLM". |
| D06 | Si se recarga en la espera, el sorteo sellado se ofrece arriba de la lista ("Retomarlo", secundario). Nunca se retoma solo. |
| D08 | "Cargar ejemplo" se ve solo con el cuadro vacío. |
| D09 | Una lista numerada de WhatsApp entra sin los números, y el aviso dice los repetidos que la lista canónica deja en silencio. |
| D10 | Una planilla con nombre y apellido separados ofrece la columna "Nombre + Apellido". |
| D11 | Después del ganador, "Siguiente premio" queda con el foco (si no estaba en otro lado), y la caja de la espera dice "Ya se sorteó". |
| D14 | "Ponerle nombre" deja el campo listo para escribir, y Enter guarda el nombre del evento. |
| D17 | "Entrar y sortear" al final de la demo abre la ventana de ingreso, como el de la portada. |
| D18 | "Pegar lista" es un botón que lleva al cuadro; una lista pegada al final empieza en un renglón nuevo. |
| D19 | La barra dice qué se sortea antes de sellar ("12 personas · Termo", o "sin premio"). |

El revisor descartó D02 (es del selector), D07 (ya estaba hecho), D12 (salvo el "Ya se sorteó"), D13, D16 y D20, con sus motivos en `.claude/progreso/juegos/ux-detalles.md`. D15 (que el mensaje del evento diga quién ganó qué) lo toma el stream de compartir.

```bash
CDP_PORT=9982 node scripts/audit-detalles.mjs --base http://localhost:4173 [--vistas 1280x720,390x844] [--temas dark,light] [--solo D01,D09]
```

## La lista de comprobación

Es lo que mira `audit-flujo.mjs` en cada paso (lista cargada, sellada y esperando, ronda lista, resultado, siguiente premio) y en cada pantalla:

- [ ] Hay una acción principal a la vista, sin scroll: el botón de verdad o el de la barra, nunca los dos ni ninguno.
- [ ] Nunca hay dos botones principales a la vista.
- [ ] La barra no tapa el botón de verdad, ni lo importante del paso (la espera, el primer ganador), ni el pie de la página. Una barra fija siempre tapa algo de lo que está más abajo hasta que se baja; por eso la herramienta deja aire abajo y se mira el pie.
- [ ] Lo que está a la vista se puede tocar: nada encima, en el punto del clic.
- [ ] No hay scroll horizontal.
- [ ] En el celular, los blancos de toque miden 44 px o más.
- [ ] El indicador de pasos marca el paso en que se está y los anteriores con ✓, y entra en una sola línea sin cortarse, también en un celular de 320 px.
- [ ] Quien llega por primera vez, con la bienvenida abierta: con la lista cargada, la única acción principal a la vista es la del paso. "Entendido" pasa a secundario, porque dos botones del color de la casa no dicen cuál es "el siguiente".
- [ ] Ningún botón del flujo corta su texto, y si el texto no entra en un renglón se parte limpio ("Siguiente premio" y debajo "(quedan 16)"), sin un separador ni un número suelto. Se mira de 320 a 414 px: 360 y 375 son los anchos de celular más comunes y las cinco pantallas de arriba no los cubren.
- [ ] El texto se lee: contraste de 4,5 a 1 (3 a 1 el texto grande), en los dos temas.
- [ ] Mientras corre la cuenta, el botón dice cuánto falta; al llegar a cero se enciende, con pulso y sin él si se pide menos movimiento.
- [ ] Con el botón fuera de la pantalla, la barra lo ofrece encendido y su clic sortea.
- [ ] Antes de sellar, la línea de la barra dice qué se sortea ("Paso 2 de 4 · 12 personas · Termo") o "sin premio": sellar fija el premio, y desde la barra no se ve el campo. Un premio largo se corta con puntos suspensivos y la línea entra en 320 px (`scripts/audit-detalles.mjs`, D19).
- [ ] Si el sellado o el sorteo falla (la red de Stellar o la de la ronda no contestan), el motivo se ve en la pantalla aunque se haya apretado la barra, y queda a la vista una acción para reintentar. El mensaje se escribe junto al botón de verdad, que con la barra puesta está fuera de la pantalla: por eso hay que llevarlo a la vista.
- [ ] La barra se va con el estadio, con la espera en grande y con una ventana abierta, y vuelve al cerrarlas.
- [ ] Con la espera en grande abierta cuando nace el número, el show arranca solo y entre la espera y el estadio no se ve la página; con Freighter, una sola acción grande; si algo falla, el motivo y el reintento en la espera; y el show termina en el resultado en grande, con la pantalla completa, hasta que quien organiza lo cierra (`scripts/audit-espera.mjs`).
- [ ] Después del ganador, lo que sigue va pegado al ganador, antes de "Mostrar en grande" y de la verificación. La acción principal es "Siguiente premio" si queda con quién sortear, o "Compartir el resultado" si no; lo demás es secundario. Un segundo después del resultado esa acción queda con el foco (o el botón de la barra, si es el que se ve), como "Lanzar el sorteo" al nacer la ronda, pero solo si el foco no estaba en otro lado; y la caja de la espera dice "Ya se sorteó", no "Ya nació. Dale." (`scripts/audit-detalles.mjs`, D11).
- [ ] Una captura de cada paso, para mirarla con los ojos.

## El auditor

```bash
pnpm build && pnpm preview &        # sirve dist/ en :4173
CDP_PORT=9684 node scripts/audit-flujo.mjs --base http://localhost:4173
```

Recorre el flujo de verdad con la cuenta de prueba de testnet (la única que no necesita a nadie y se carga sola con fondos), una vez por pantalla y por tema, y deja una captura por paso en `--out` (por defecto `docs/capturas/flujo`, que no se versiona), más una del inicio de la página con el indicador de pasos arriba. Cada recorrido arranca un Chrome nuevo: es alguien que llega por primera vez, con la bienvenida a la vista. Después prueba, una vez por pantalla, qué pasa si el sellado falla (se corta la red de Stellar a propósito), y al final mira unos anchos de celular (320, 360, 375 y 414 px) con la lista de ejemplo, sin grabar nada en Stellar.

| Opción | Qué hace |
|---|---|
| `--base` | El sitio a mirar (por defecto `http://localhost:4173`). |
| `--out` | Dónde dejar las capturas. |
| `--vistas` | Cuáles de las pantallas, separadas por coma (`laptop-100,escritorio,tablet-h,celular-h,celular,zoom-200`). |
| `--temas` | `dark`, `light` o los dos (`dark,light`). Por defecto solo `dark`: la geometría es la misma y el flujo es largo. |
| `--sin-resto` | En qué pantallas mirar también el caso en que no queda nadie sin premio, donde la principal es "Compartir el resultado" (por defecto `laptop-100,celular-h`; `none` para saltearlo). |
| `--fallos` | En qué pantallas se prueba el sellado que falla (por defecto todas; `none` para saltearlo). Corta las llamadas al servidor de Stellar, aprieta lo que se ve (la barra, si es lo que está) y comprueba que el motivo aparece en la pantalla y que queda una acción a la vista para reintentar. Se hace una vez por pantalla, en el primer tema. |
| `--anchos` | Los anchos de celular que se miran al final, sin Stellar (por defecto `320,360,375,414`; `none` para saltearlos). Miran lo que el ancho rompe: scroll de costado, el indicador de pasos en una línea y con margen, que ningún botón corte su texto y que ninguna caja deje salir lo que lleva adentro. |
| `--solo-anchos`, `--solo-fallos` | Corren solo los anchos de celular (un minuto por ancho, sin cuenta de prueba ni testnet) o solo el sellado que falla (menos de un minuto por pantalla). |
| `--lang` | `es` o `en`. |
| `--sello-max` | Segundos que espera al sellado en testnet (por defecto 240). |
| `--reintentos` | Cuántas veces repite una pantalla si el sellado falla o tarda (por defecto 2, con un respiro de 15 s entre una y otra; lo medido en un intento descartado no cuenta). |

Cada recorrido dura unos dos minutos, casi todo esperando la ronda; las seis pantallas en un tema, un cuarto de hora (y unos diez minutos más el sellado que falla y los anchos de celular). Como todos los auditores: `CDP_PORT=<puerto>` para tener su propio Chrome (nunca cierres uno que no abriste), la salida marca con ✓ y ✗, y sale con código 1 si algo falla.

Un ✗ en "una acción principal a la vista" dice dónde quedó el botón de verdad y si hay barra: es el síntoma que originó todo esto, y es el primero que hay que mirar.

## Qué se midió el 19 y el 20 de octubre de 2026

La acción principal de cada paso, medida por `audit-flujo.mjs` con la cuenta de prueba en testnet, como alguien que llega por primera vez (con la bienvenida a la vista) y con la pantalla donde la deja la propia página. El "antes" es la herramienta del 19 de octubre, sin esta tarea; el "después", la del 20. Entre paréntesis, dónde quedaba el borde de arriba del botón de verdad, en píxeles desde el borde de arriba de la pantalla; el alto de la pantalla va en la primera columna. "Barra" es que el botón de verdad queda fuera y se ve el de la barra de "lo que sigue".

| Pantalla (alto) | Sellar la lista | Lanzar, esperando la ronda | Siguiente premio, con el ganador | Sellar de nuevo |
|---|---|---|---|---|
| laptop-100 (632) | fuera (768) → barra | fuera (1071) → a la vista | fuera (867) → a la vista | a la vista → a la vista |
| escritorio (720) | fuera (768) → barra | fuera (1071) → a la vista | fuera (867) → a la vista | a la vista → a la vista |
| tablet-h (560) | fuera (671) → barra | fuera (990) → a la vista | fuera (770) → a la vista | a la vista → a la vista |
| celular-h (390) | fuera (808) → barra | fuera (984) → a la vista | fuera (810) → a la vista | fuera (429) → barra |
| celular (844) | fuera (1063) → barra | fuera (1889) → a la vista | fuera (1574) → a la vista | a la vista → a la vista |
| zoom-200 (316) | fuera (811) → barra | fuera (1163) → a la vista | fuera (1219) → barra | fuera (485) → barra |

De las 30 mediciones (seis pantallas por cinco pasos), antes 20 no tenían ninguna acción a la vista; después, ninguna. El paso de "ronda lista" ya se veía antes (la página llevaba la pantalla al botón al nacer la ronda) y se sigue viendo, sin mover la pantalla.

El primer paso queda con la barra en todas las pantallas porque quien llega por primera vez tiene la bienvenida arriba de la lista. Quien ya la cerró, y llega arriba de la página con la lista cargada, ve el botón de sellar entero en laptop-100 y en escritorio; en tablet-h, en el celular y a 200 % de zoom queda un poco más abajo (en el celular parado, 57 px) y lo lleva la barra. Es la red de seguridad cumpliendo su papel: la lista se carga arriba, y compactarla para que el botón entre en todas las pantallas es otra decisión, que esta medida deja a la vista.

Los anchos de celular que las cinco pantallas no cubren se miraron aparte, de 320 a 414 px. Ahí aparecieron dos defectos que ninguna medición del flujo veía: a 360 y 375 px (los más comunes) "Siguiente premio" se partía con el separador suelto al principio del segundo renglón, y a 320 px el indicador de pasos llegaba pegado al borde. Con lo corregido no hay scroll de costado ni texto cortado en ninguno de esos anchos.

Probar lo que pasa cuando algo falla encontró un tercero, el más serio: al sellar o sortear desde la barra, si la red no contestaba, el motivo se escribía junto al botón de verdad, fuera de la pantalla, y a la vista quedaba la barra con el botón otra vez disponible y sin una palabra. En el celular acostado el mensaje quedaba a 462 px en una pantalla de 390, y a 200 % de zoom a 536 px en una de 316. Ahora se lleva a la vista, y el auditor lo comprueba.

Con esto pasó el auditor entero sobre la versión definitiva: las seis pantallas en tema oscuro (468 comprobaciones) y claro (362), el caso en que no queda nadie sin premio, y los anchos de celular. En el tema claro testnet rechazó un sellado y el auditor repitió esa pantalla solo, como está previsto.
