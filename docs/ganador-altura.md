# Regresión de Piñata y Teleférico

## Estado de aceptación

**Primer arreglo verificado: re-revisión independiente B1/B2/B3 aceptada.**
La base y el candidato reproducen la misma oclusión, recuperable con scroll
normal de46px y4.083984px de separación. No se cambió presentación: el auditor
mide la barra real y verifica el área segura. Pasan69tests focalizados y los dos
focos reducidos con nombres largos introducidos antes del sorteo. Los gates
actuales pasan: tipos,155archivos/3161tests/4opt-in omitidos, build y glosario.
Primer commit verificado: `1ec815c05611b54caa6771cd9b0bedb4534a2600`.
La revisión inicial detectó una letra
preplaca inferior al mínimo existente y siete corridas sin identidad de fuente.

El padre reprodujo B1 en navegador:18de98renders con letra aproximada11.11px,
sin otros fallos. Restauró la escala nominal mediante
`Math.max(1, escalaChipLegible(u()))`, sin reducir letras ya mayores. Pasan68tests
focalizados y tres casos directos nuevos con225renders.

Los gates actuales están en `gates-ayXBJX` (job90, cada comando exit0;
70.55s de suite). La matriz actual pasa50flujos identificados:
25por juego,42normales con3515renders consecutivos y8reducidos sin show.
Cada render exige nombre completo legible, geometría y secuencia válidas.
Mínima letra CSS de la mejor copia completa:15.9998401535px, fuente nominal16;
se conserva el redondeo existente de `seLee()`. Menor separación coincidente:
3.9999600384px, conforme a4px con epsilon1e-4 sin modificar.

Las617entradas coinciden antes/después de la matriz y con el árbol al generar
el índice. Cada caso enlaza el manifiesto;100hashes identifican medidas y trazas.
El caso Piñata320×521 normal válido de job90 (97renders) y los49casos de
job91 comparten exactamente la misma identidad de617fuentes. No se reutilizan
los pilotos históricos sin hashes ni se fabrican identidades retrospectivas.
Después de esa comparación solo se agregan recibos documentales a esta guía y al
registro ODD; producto, auditor, tests y configuración permanecen idénticos.

El JS inicial conserva138447bytes (-5gzip); todo JS suma3477bytes/1068gzip frente
a la base6c583e9. Son pesos de recursos, no un benchmark de FPS.
El segundo bug, PR, integración y despliegue siguen sin comenzar.

## Fixture histórico, no texto nuevo del producto

La frase recuperada por el padre de
`.evidence/arreglos-sorteos/red-cuerpo-hrE9yD/estadio-lista-teleferico-1024x560.png`
es exactamente **“¡EL TINKAZO ES PARA Rodrigo Sebastián Flores Mamani!”**.
La captura tiene salto después de Rodrigo. Su `medidas.json` registra relator
`y421.09375,h112.90625` a1024×560 y separación de cabina−6.930036px.
No se inventa un sustituto ni se asigna altura, fuente o ancho al relator.

`--relator original` instala exclusivamente en la página de auditoría un hook
para el anuncio final de `say()`. Conserva la frase producida originalmente en
`fixture.original` y aplica literalmente la frase histórica; el DOM/CSS normal
resuelve sus renglones. **Solo se fija el relator**, incluso si el protocolo
elige otro participante: no se reemplazan su nombre en el cartel/resultado,
beacon, semilla, selección, sellado ni comprobante. El informe distingue esa
narración inyectada del ganador real. La ruta sigue usando la UI libre simulada
de `audit-flujo`, sin cuenta ni transacciones. El servidor debe ser Vite con
fuentes: el auditor importa módulos públicos de estado/protocolo solo para leer
y recomprobar la selección. No reproduce automáticamente la semilla del viejo
job52; guarda el beacon y el ganador reales de cada nueva corrida.

## Comandos focalizados para GREEN del padre

Con servidor propio listo en5187, sin adquirir de nuevo su lock:

```bash
PLAYWRIGHT_PATH=/home/agent/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs heavy -- node scripts/audit-ganador-altura.mjs --base http://127.0.0.1:5187 --fase estadio-lista --juegos pinata --vistas 1024x521 --comprobar --relator original --nombres largos --lang es --movimiento normal --out .evidence/arreglos-sorteos/phaseB-green-pinata
```

```bash
PLAYWRIGHT_PATH=/home/agent/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs heavy -- node scripts/audit-ganador-altura.mjs --base http://127.0.0.1:5187 --fase estadio-lista --juegos teleferico --vistas 1024x560 --comprobar --relator original --nombres largos --lang es --movimiento normal --out .evidence/arreglos-sorteos/phaseB-green-teleferico
```

Conservar stdout, stderr y exit code. Un timeout, fuente Vite ausente, marcador
faltante o falta de muestras es fallo del arnés, **no** RED del producto.
No abrir Chromium ni cambiar su sandbox: se usa WebKit normal.

## Qué observa cada render

El hook síncrono se ejecuta después del render de Pixi y antes del siguiente
RAF; no depende del polling de Playwright ni detiene el reloj. Empieza con el
foco ganador de Teleférico o el contacto/revelación del caramelo en Piñata y
continúa hasta el último render anterior al cierre natural del estadio.

- Guarda número de render, timestamp, reloj de juego/cámara, fase, tiempo del
  cartel, frase cruda y rect real del relator en **cada muestra**.
- Exige secuencia sin huecos ni cola perdida, relojes finitos y marcador con
  transición más sostén de al menos0.8s después de la entrada de0.9s.
- Usa los callbacks físicos existentes: `cabina.body.getBounds()` y el
  `Graphics` del caramelo ganador; no el proxy de foco ni el halo.
- Expone aparte el fondo gráfico del cartel, sin unirlo a los nombres: así la
  comprobación de contención no se vuelve cierta por construcción. Conserva
  los contratos antiguos `ganador()` y `cartel()`.
- Comprueba cuerpo/cartel/nombre vs viewport y relator; cuerpo vs cartel y
  etiquetas externas vs cartel. El nombre propio **dentro de su cartel** se
  comprueba completo/contenido, no se confunde con un choque contra él.
- Exige nombre medible, no vacío y completo, tolerando solo espacios/saltos de
  línea; un nombre ausente o truncado no se omite. La separación usa4px y una
  tolerancia numérica de0.0001px, no una tolerancia visual al solapamiento.
- Convierte coordenadas lógicas Pixi a CSS-client usando `app.screen` y el rect
  del canvas, sin multiplicarlas de nuevo por DPR. Registra backing store/DPR;
  bordes, padding o transformaciones CSS no soportadas producen fallo explícito.
- Mantiene foco de teclado en Sonido, sin pulsarlo, para verificar acceso a
  controles mediante la regla existente de `:focus-within`; no escribe clases.
- Lee WebGL y diversidad real de píxeles. No fabrica valores para el modo reducido.
- Compara el resultado sembrado durante todos los cuadros y al terminar;
  recalcula `select()` con el beacon real y comprueba el nombre final.
- Verifica acceso por scroll a compartir y al enlace público «Avisarle por
  WhatsApp», sin pulsar compartir/enviar. Extrae el mensaje real de su `href`,
  decodifica el comprobante y visita su `verificar.html` en otra pestaña del
  servidor propio. Exige lista/pasos visibles y coherentes con nombres, ronda y
  firma reales. Registra modo libre/sin sello/anclado y el veredicto mostrado;
  no presenta un ensayo libre como sello oficial ni exige veredicto verde.

En Teleférico1024×560 con fixture original, además exige frase idéntica y rect
estable igual al histórico (`y/h`, tolerancia0.01px), sin ignorar animaciones
intermedias del relator, cuyos rects también quedan en la traza.

## Evidencia y matriz posterior

Cada caso escribe `transicion-*.json` con todos los checks y muestras. Los PNG
`peor-*-canvas` copian el framebuffer exacto del render identificado en JSON:
entrada, mínimos contra cartel/relator, mayor cantidad de fallos y primer sostén
estable seleccionado (cartel visible y `tiempoCartel >= 1.7`). Este último PNG
**no representa el último cuadro**. Se copia una sola vez; todas las muestras,
predicados y continuidad siguen registrándose hasta el cierre. Si no se alcanza
ese sostén, no se fabrica un PNG final. Cada muestra registra tiempos de llamada
síncrona del observador y de sus copias (categoría, tamaño, inicio/fin), no tiempo
GPU ni un benchmark de la animación sin instrumentación.
**No incluyen el DOM**: sus rects/frase quedan asociados en JSON. Las capturas
`entrada-pagina`, `resultado` y `verificacion` sí incluyen DOM, pero no se
presentan como el mismo instante exacto del framebuffer peor. La lectura/copia
por render tiene coste de auditoría y no sirve como benchmark de fluidez.

`--help` enumera los controles; sin `--comprobar` conserva el reconocimiento.
Para la matriz posterior el padre puede variar:

| Control | Valores |
| --- | --- |
| `--vistas` | `1024x521,1024x560,1024x600` y vecinos520/522/599/601; anchos móviles pertinentes |
| `--nombres` | `largos`, `cortos` |
| `--lang` | `es`, `en`; inglés requiere `--relator natural` |
| `--relator` | `original`, `natural` |
| `--movimiento` | `normal`, `reduce` |
| `--dispositivo` | `viewport`, `iphone13` |

`iphone13` aplica el descriptor oficial de Playwright **antes** de sobrescribir
viewport. `viewport` significa viewport responsive, no dispositivo ni navegador
Android. Toda corrida es emulación, no teléfono físico. En `reduce` se exige
resultado legible y verificación accesible **sin exigir animación**; renders
perdidos no se pueden justificar como reducción.

Referencias oficiales aportadas por el padre: [emulación Playwright](https://playwright.dev/docs/emulation),
[rects client MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect),
[movimiento reducido MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

## Corrección de fase B e identidad de nombres

En el peor cuadro420 de job59, Piñata521 tiene cuerpo de284.44px y banda libre
de159.08px entre cartel y relator, con sus márgenes. Ninguna traslación sola
resuelve ambos choques. `ajusteGanador()` reutiliza `dentro()`/`enPantalla()`:
primero conserva escala si cabe; solo cuando es imposible reduce lo necesario
y traslada la escena entera. La cámara refleja el ajuste con snapshot/restore,
sin cambiar objetivos, rate, reloj, física o eventos de emoción. No es el segundo
arreglo de zoom horizontal ni se aplica a otros juegos.

El encuadre se calcula **después** de actualizar el cartel del cuadro actual y
usa `getBoundingClientRect().top` real del relator, incluyendo su animación CSS;
el antiguo offsetTop dejaba huecos de3.658691/3.989746px en Teleférico. El foco se
reproyecta sin repetir eventos y los nombres externos se colocan después.

Los58fallos de «nombre separado del cartel» no eran un segundo chip externo:
la traza señalaba la etiqueta propia del cartel como externa. Pixi8 ofrece
`getGlobalAlpha()`; la lectura anterior de `worldAlpha` dejaba vacío el getter
de nombres y el recorrido genérico los reclasificaba. Ahora usa alpha oficial
más uid para identidad, sin deduplicación por aproximación de coordenadas.
Las cajas físicamente vacías no se presentan como texto dibujado.

Sí había un defecto real adicional: el chip previo de Piñata abreviaba a
«Carlos Albe…ernández» y Teleférico no mostraba nombre durante el foco previo al
cartel. Un chip completo, con envoltura usando el helper existente, ocupa una
banda reservada sobre el cuerpo desde la misma revelación/contacto. Está sobre
la penumbra, no sobre el cartel, y se retira cuando el nombre del cartel alcanza
la letra mínima existente. Reemplaza el chip abreviado, no el ganador; ambos
límites, nombre completo y viewport siguen comprobándose en cada cuadro.

La causa del timeout público es estructural, no un permiso que deba forzarse:
`styles.css` oculta globalmente `.solo-verificar` porque la información pública
vive en `verificar.html`. Se abandonó el acceso artificial a btn-reverify y la
apertura programática de detalles ocultos. El recorrido público descrito arriba
no modifica CSS/permisos ni fabrica comprobantes. El entorno sigue siendo UI
libre simulada, no prueba de sellado en producción.

## Carrera residual del compositor (job64)

El padre corrigió el contexto explícito de Playwright; ese cambio se conserva.
En `.evidence/arreglos-sorteos/phaseB-green-transicion-NHrvmG/`, el recorrido
público completo pasa sin errores:71muestras Piñata y73 Teleférico. No fue GREEN:
quedan cinco huecos3.398315/3.894531/3.993652 y3.799316/3.996460px, todos a57–255ms
del anuncio, dentro del pop de280ms. El texto original ya estaba aplicado.

El fixture se resuelve en `say()` **antes** de asignar textContent, crear la
animación y encuadrar. El observador posrender no escribe en el relator; solo
lee y copia el canvas. Job64 no registraba su rect pre-render: la deriva se
infiere de cuerpo/floor y del código, no se inventa como una lectura histórica.
Ahora cada muestra añade rect/frase/timestamp del encuadre, lectura posrender,
reserva y estado/tiempo de animación, más un check de orden y contenido.

La nueva reserva no es un espaciado fijo añadido al producto. Durante el pop
running/pending, `reservaRelator()` acota todo su viaje vertical posible entre
ambas lecturas: `Hvisible × (scaleMax − scaleMin) / (2 × scaleMin)`. La escala
mínima es0.92 y la máxima1.00782428, calculada del extremo del Bézier existente
(.34,1.56,.64,1), incluyendo overshoot. El factor1/2 corresponde al origen CSS
central. El descriptor compartido conserva exactamente escalas, curva y280ms;
la reserva desaparece cuando termina la animación. Se usa altura real, nunca
una altura fija; solo afecta el nuevo encuadre de los dos juegos. `piso()` y su
offsetTop histórico permanecen intactos para los demás nombres/juegos.

El predicado sigue exigiendo4px observables y conserva todos los cuadros. Las
pruebas reproducen los cinco huecos, la excursión completa de la curva y el
caso sin animación; los controles de acceso y el resultado no cambian.

## Límites de la entrega de fuente antes de los pilotos del padre

Tests focalizados:42/42; RED unitario de encuadre2fallos, acceso/identidad3fallos
y reserva temporal2fallos observados antes de sus respectivas implementaciones. Raw job59 confirma también el rect histórico
estable421.09375/112.90625. El GREEN funcional de fase B todavía no está observado.
T1/T2/T3 siguen abiertos para navegador/matriz, tipos, suite/build, revisión y
commit del padre. No hay medición nueva de fluidez: el puente añade un contenedor,
Text/Sprite/Graphics reutilizables (sustituye el chip previo en Piñata); no añade
archivos de recursos ni descargas externas. Los ocho paths staged y todos los
artefactos históricos se conservan.


## Evidencia histórica previa, no aceptación actual

- Pilotos del padre: Piñata 1024×521 y Teleférico 1024×560, más ambos juegos a 320×521 y 390×560 con emulación iPhone 13. Seis recorridos completos, 459 muestras consecutivas, sin fallos de posición, nombre ni acceso al comprobante público. La narración histórica es una fixture; no sustituye al ganador calculado por el protocolo.
- Gates del padre: `pnpm typecheck`, `pnpm test --maxWorkers=2 --reporter=dot`, `pnpm build` y `pnpm check:glosario`, todos salida 0. Suite: 154 archivos, 3155 pruebas aprobadas y cuatro de testnet omitidas por `TINKAZO_RED`; no se cuentan como aprobadas. Se conservan los avisos preexistentes de Vite y glosario. Evidencia local: `.evidence/arreglos-parent/gates-VYMjsM/`.
- Peso frente a la base original: entrada inicial 138447 bytes, sin incremento; gzip 45788 → 45784. El conjunto de 101 archivos JavaScript crece 3450 bytes, 1082 gzip. Comparación con la misma versión de Node, dependencias enlazadas y entorno normal, sin ejecutar el gestor de paquetes en la copia. Evidencia local: `.evidence/arreglos-parent/weight-LMoyUk/`.
- La telemetría conserva rectángulos antes del ajuste y después del render, texto y estado de la animación. Las parejas del pop de los pilotos están en `.evidence/arreglos-parent/phaseC-pop-pairs.json`. El muestreo y las capturas añaden costo: estos tiempos no son un benchmark de FPS ni permiten afirmar fluidez idéntica sin instrumentación. No se modifican los relojes ni las duraciones de los juegos.
- La matriz anterior pasó geometría y secuencia:50recorridos únicos,25por juego;42normales con3115muestras y8reducidos sin show. B1/B2 impiden aceptar legibilidad y procedencia. Incluye los núcleos521/560/600y vecinos, no todos los80altos enteros ni teléfonos físicos. Índice local con rutas y SHA256: `.evidence/arreglos-parent/matrix-50-index.json`. Se conservan y excluyen de los pases los tres intentos históricos fallidos. Gates finales job84: tipos/test/build/glosario salida0,154archivos/3156pruebas aprobadas y4testnet omitidas; `.evidence/arreglos-parent/gates-tDMR6W/`. La revisión independiente está pendiente. No hay primer commit aceptado ni trabajo del segundo bug de zoom. Emulación no equivale a prueba en teléfono físico.


### Resultado con movimiento reducido

El modo reducido omite el show y presenta el resultado en la página normal, que admite desplazamiento. El auditor ubica `.winner-name` con `scrollIntoViewIfNeeded()` antes de capturar y medir el nombre; no cambia estilos, visibilidad, texto, selección ni datos. Mantiene las comprobaciones completas de nombre, dimensiones y viewport, además del acceso al comprobante. Esto evita confundir una posición transitoria durante el desplazamiento automático con un nombre recortado.

La comprobación aislada de la base original y del candidato confirmó que el nombre completo es accesible por desplazamiento normal. Los sorteos de esa comparación consumieron rondas reales diferentes; no se presenta como una reproducción con semilla idéntica. La ejecución original que falló queda conservada. Esta normalización sucede después del show: no omite ni altera las muestras de la transición del estadio ni el mínimo de 4 px.


## Corrección B1/B2: letra real y procedencia

Cada nombre registra fuente local, eje vertical de transformación global Pixi y
letra CSS: fuente por la norma de ese eje convertido al rect del canvas. No se
deduce la letra del alto de su caja. La muestra conserva el mínimo de
`letraMinima(unidadDePantalla(...))`.

«Nombre completo legible» exige una representación completa legible por ganador
observado en todos los renders. El cartel elástico puede entrar por debajo del
mínimo mientras el puente completo ya sea legible. Se conserva el medio píxel
de redondeo existente de `seLee()`, sin modificar4px ni epsilon geométrico.

La nueva matriz registra hashes antes del servidor, referencia al manifiesto
por caso y comparación posterior, sin identidades retrospectivas. Las ejecuciones
del primer verificador en scratch fuera del proyecto quedan excluidas de
aceptación funcional; se conservan sus hallazgos de código/evidencia. Los nuevos
RED/GREEN y gates del padre se ejecutan dentro del proyecto.


## Recibo de la corrección B1/B2

- Matriz nueva: `.evidence/arreglos-sorteos/identified-all-wTWor9/`.
- Índice y hashes: `.evidence/arreglos-parent/identified-50-index.json`.
- Manifiesto de entradas:
  `6e8ca8477f9e3512ed7a336edc2eb04ae520eb63475da4be5b001ab6baf2daf3`.
- Gates: `.evidence/arreglos-parent/gates-8tgWBf/`; cada comando conserva stdout,
  stderr y exit0. Los4skips de `src/stellar/seals.test.ts` requieren
  `TINKAZO_RED`; no se cuentan como pruebas pasadas.
- Peso: `.evidence/arreglos-parent/weight-0JkqWw/weights.json`; mismo Node24.22.1,
  HOME y dependencias. Archivo temporal eliminado antes de iniciar el servidor.
- Se conservan avisos previos de Vite (`__dirname`, importaciones dinámicas
  inefectivas de wallet/tutorial) y dos usos de «avisar» pendientes en glosario.
- Capturas y logs son artefactos locales, no publicados ni forzados en Git.

La matriz es representativa (alturas521/560/600 y vecinos, anchos320/375/390/414,
reducido); no cubre todos los80altos enteros ni dispositivos físicos. El acceso
público se prueba con UI libre simulada y comprobante real de esa ejecución,
no como aceptación de un sorteo oficial de producción.


## Hallazgo adicional B3 y corrección autorizada del auditor

La captura nueva de Piñata320×521 con movimiento reducido oculta la última parte
de «Maximiliano Alexander Constantino Rosario» detrás de la barra fija. El
rectángulo medido del nombre va de y180.3298 a436.4319 dentro del viewport521;
el predicado anterior verificaba ese límite, el texto y el recorte interno,
**no la intersección con la barra fija**. La captura ocurre después del scroll normal
del nombre y antes de las acciones de comprobación pública: no se explica por
un desplazamiento posterior del auditor.

Por tanto, los50PASS anteriores no cerraban S5. El usuario autorizó la corrección
adicional (L33 del registro ODD). La comparación base/candidato de job89 prueba
la misma oclusión preexistente y el acceso completo mediante scroll normal de46px.
No hizo falta tocar HTML/CSS/UI. El auditor espera la visibilidad real de la barra,
usa scroll normal con delta redondeado hacia arriba y exige el margen existente
4px/1e-4. La elegibilidad0.98 de la UI se usa solo para esperar su barra oculta,
no como tolerancia del nombre. RED propio1fallo/68preservaciones→GREEN69/69.

Los dos focos de job90 (`b3-fixed-NzleUV`) ejercitan el nuevo scroll/guard con dos
nombres sintéticos largos ingresados antes de sortear, sin reemplazar ganadores,
semillas o datos. Ambos resultan completos con4.083984px de separación. La copia
privada difiere del auditor oficial solo en esa lista de entrada y el import Node.

La matriz oficial actual usa su lista original de seis nombres y el nuevo guard:
`.evidence/arreglos-parent/identified-b3-50-index.json`, manifiesto
`ed2483a76bd423b2ffd928b7ae0327f917ce006b52c7ef1f8b166f8d9668e96f`.
Contiene100hashes de medidas/trazas,50casos/3515renders, sin fallos de fuente,
geometría, continuidad, nombre final/barra o acceso público. La menor separación
final medida ante barra visible es4.03271484375px. Tipos/test/build/glosario pasan.

Se conserva el timeout de Teleférico320×600 en job90: venció40s antes del resultado
(reloj17.304), no en el guard de la barra. En job91 el mismo caso pasa primero
con101renders, sin cambiar fuente, reloj ni límite. No se atribuye una causa de
rendimiento probada ni se oculta aquel intento. La re-revisión independiente de
los hallazgos reportados fue aceptada (recheck `mvyn9j8d-z-j406`): B1/B2/B3
resueltos, S3/S5/S6 conformes, sin ejecuciones propias nuevas. El padre guardó el
primer commit español `1ec815c05611b54caa6771cd9b0bedb4534a2600` antes de
investigar el zoom; ese orden quedó cumplido.


## Alcance de la preparación del arnés

El auditor de esta evidencia prepara una cuenta/lista simulada: antes de congelar
retira `locked`/`aria-disabled` y oculta `#gate`. Por tanto, la geometría, el
protocolo conservado y el acceso público posterior al resultado no constituyen
una prueba de entrada pública completa ni de sellado real. El muestreo específico
de ganador activo sólo instrumenta Piñata/Teleférico; no acredita otros juegos.
Esta limitación no se oculta ni se corrige ampliando el primer commit. El
descubrimiento del segundo bug usa el ensayo público mediante controles visibles,
sin desbloqueo del DOM; su lista fija y ausencia de comprobante limitan su alcance.

## Segundo arreglo: acercamientos finales pendientes de aceptación

El usuario autorizó nuevos planos finales para Carrera, Sapo y Ruleta; no se
presentan los planos anteriores como tres defectos de zoom demostrados. La matriz
pública prevista tiene48casos. Los cuatro casos completos conservados identifican
su propia fuente; los intentos parciales o fallidos siguen registrados como tales.
No hay segundo commit ni PR del arreglo mientras falten matriz y revisión.

La corrida pública de Carrera#349 llegó al HTML y al verificador7/7 dentro del
límite, pero dos cuadros de entrada del cartel incumplieron la separación4px:
−4.5100366 y1.8200279. La medición usa AABBs conservadoras; no certifica el contorno
raster exacto. La corrección local mueve la separación existente al callback
optativo `trasCorona`, después de avanzar el cartel al cuadro actual. Sólo Carrera
lo registra. No se modifica Stage, cámara, director, Sapo, selección, ritmo, reloj,
ni el límite40s. Las pruebas por la interfaz pública `crearJuego` reproducen las
cajas fallidas antes del cambio; después pasan junto con la preservación sin hook.
Esa prueba aislada no sustituye la corrida pública posterior ni la matriz completa.

El diagnóstico trazado de Race/Wheel y el contraste de grabación conservan todos
los fallos. WheelENlargo completó sin parche de rendimiento. Race con grabación
apagada cerró en35s, pero cambiaron ronda, ganador y carga no controlada: eso no
demuestra la causa histórica. No se aplica ni se afirma una optimización de
rendimiento; esa causa sigue sin demostrarse y bloquea la aceptación pedida.

La revisión independiente focalizada de fuente terminó sin defecto grave
establecido ni pedido de otro lote de corrección. La suite posterior pasa
161archivos/3188tests, con4opt-in omitidos; tipos, build y glosario pasan.
La corrida pública posterior conserva492cuadros,70activos y25de sostén tras la
entrada, sin fallos geométricos muestreados: menor separación3.999947px dentro del
epsilon existente. Se revisó su captura de sostén. Sin embargo, el estadio no
cerró dentro de40s: no se alcanzaron el HTML final ni su verificación pública.
No se convierte esa evidencia parcial en un caso completo. La matriz conserva
4casos históricos completos de48, con9intentos y5claves; sus fuentes originales
no se reasignan al candidato actual. El segundo arreglo queda bloqueado según
la instrucción explícita de reportar el bloqueo si la causa sigue sin demostrar.
