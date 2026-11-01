# Kit del organizador

## Usar e imprimir

La guía sigue en `/sorteo-para-meetup.html`: no hay otra página ni un flujo nuevo de sorteo. Los botones **es / en** usan el ciclo existente de `pagina.ts` e `idioma.ts`. La guía muestra e imprime el idioma seleccionado; cada tarjeta contiene ambos idiomas a la vez.

- **Imprimir guía A4 / Print A4 guide** imprime los cinco pasos y las secciones de lectura existentes. La tabla de problemas y las citas de bases/mensaje llevan reglas para evitar cortes internos. Los enlaces conservan su texto; el correo es un enlace legible.
- **Imprimir dos tarjetas A4 / Print two A4 cards** imprime solamente dos tarjetas planas. Elegir papel A4 vertical, escala 100 %, márgenes de 10 mm, sin encabezado/pie del navegador. Cerrar o cancelar la impresión restablece el modo normal mediante `afterprint`. La impresión desde el menú del navegador usa la guía por defecto.
- Las tarjetas miden 190 × 135 mm, con 6 mm entre ellas, tipografía principal de 14 pt y QR de 35 mm. El área A4 con márgenes es 190 × 277 mm; la hoja CSS usa 276 mm. El PDF nativo comprobó dos unidades completas en una sola hoja, sin texto fuera del papel. La lectura física a un metro todavía no está probada.

El QR público estático es `public/kit-organizador/comprobacion.svg`. Abre exactamente:

`https://tinkazo.app/sorteo-para-meetup.html#comprobacion`

No contiene evento, participantes, origen de preview, sesión ni fragmentos privados. Usa negro sobre blanco, corrección Q y cuatro módulos blancos de margen en cada lado, como el helper local `src/ui/qr.ts`. Se genera con la dependencia ya instalada `qrcode-generator`, no con un servicio externo. El SVG y las dos tarjetas están en el HTML desde el inicio: imprimir no espera canvas ni red adicional de terceros.

## Fuente editorial y regeneración

La fuente literal ES/EN de Guido está en **L1** de `odd/tasks/kit-organizador.md`; L3/L4 documentan las únicas cuatro correcciones aprobadas. La guía cambia solo el CTA inicial de Google, el contador pendiente del siguiente premio, Chromecast desde computadora con el menú actual, y Advanced en Luma web. No cambia ningún botón de la herramienta. Las secciones existentes de comprobación/nombres y sus traducciones se conservan.

```sh
node scripts/lib/kit-organizador-material.mjs --help
node scripts/lib/kit-organizador-material.mjs --write
```

El segundo comando reemplaza únicamente el bloque marcado de material de la página existente y el QR local. No consulta Git ni red. Necesita el documento fuente ODD, que también utiliza la prueba editorial; mantenerlo con el cambio. El HTML generado es material estático revisable, no una segunda ruta. El script no debe usarse para aprobar cambios editoriales nuevos.

## Comprobaciones focalizadas

```sh
node_modules/.bin/vitest run src/kit-organizador.test.ts src/kit-organizador-copy.test.ts src/seo.test.ts --maxWorkers=2 --reporter=dot
pnpm typecheck
```

Las pruebas comprueban navegación pública, selección/restablecimiento de impresión por clic, QR SVG decodificado independientemente con `jsqr`, margen blanco, ambos idiomas en cada tarjeta, 136 unidades de contenido fuente con las cuatro correcciones y las protecciones SEO/editoriales existentes. La prueba de impresión con EventTarget verifica los efectos públicos de los botones sin atribuirle paginación real. La comparación de CSS es solo una protección estructural. El diccionario compartido recibe diez claves nuevas por idioma: no se editan frases previas.

La entrada nueva importa `pagina.ts` y CSS local. No importa el diccionario completo, Stellar, billeteras, juegos ni la librería QR en el cliente. El plugin existente de Vite sigue inyectando solo las claves usadas en la página. El padre debe comprobar el grafo/tamaño final del build y las solicitudes reales.

## Auditor de navegador para el padre

Requiere un servidor ya iniciado por el padre y un Playwright ya disponible; no instala nada, no inicia servidor ni cambia el sandbox. Motor predeterminado: WebKit normal.

```sh
node scripts/audit-kit-organizador.mjs --help
node scripts/audit-kit-organizador.mjs --base http://localhost:5187 --engine webkit --playwright /ruta/al/playwright/index.mjs
```

`--playwright` puede omitirse si el módulo es resoluble. `--out` queda restringido a `.evidence/kit-organizador/`. El auditor comprueba escritorio 1280 px y viewport móvil 390 px, cambio ES/EN/ES real, navegación, desbordes, imágenes, dos tarjetas simultáneamente bilingües, QR decodificado desde imagen rasterizada y zona blanca, selección de ambos modos de impresión, restablecimiento al terminar y geometría CSS A4. Guarda capturas y `results.json`, incluidas las solicitudes de scripts para inspección de carga diferida. Una página protegida de preview no cuenta como la guía aunque responda HTTP 200.

**No produce ni valida un PDF.** Las capturas con medios de impresión no son prueba de paginación. El padre conserva la comprobación de PDF nativo Firefox/BiDi con A4 real, tamaño de páginas, dos tarjetas completas en una sola hoja, ausencia de cortes de texto/bases/tabla, y revisión visual/escaneo a tamaño real. No usar flags para desactivar el sandbox de Chromium.

## Evidencia externa y límites

La investigación de L3/L4, no un ensayo con hardware, respalda las cuatro correcciones:

| Fuente oficial | Alcance y límite |
| --- | --- |
| [Luma CSV](https://help.luma.com/p/download-guest-csv) | Manage, Guests, Download CSV y código por correo. No se probó una cuenta real de Luma. |
| [Luma Blasts](https://help.luma.com/p/sending-or-scheduling-event-blasts) | Hasta siete días después; Advanced para el mensaje completo en web frente al límite del compositor en línea. |
| [Chrome en computadora](https://support.google.com/chromecast/answer/3228332?hl=en-GB) | Menú Cast, save and share → Cast… desde computadora. Requiere receptor compatible; no es una ruta Chrome móvil. |
| [Android](https://support.google.com/chromecast/answer/6059461?hl=en) | Describe Google Home/receptor compatible; no garantiza Smart View universal. Se conserva el texto solicitado sin inventar compatibilidad. |
| [Apple AirPlay](https://support.apple.com/en-us/102661) | Receptor compatible y misma red wifi. No se probó proyección. |
| [Apple cable](https://support.apple.com/guide/iphone/connect-to-a-display-with-a-cable-iph93af723b9/ios) | La consulta de investigación devolvió 429. Compatibilidad de adaptadores y la afirmación comparativa de fiabilidad HDMI no quedaron plenamente verificadas; el texto de Guido sigue intacto por instrucción expresa. |
| [DENSO WAVE](https://www.qrcode.com/en/howto/code.html/index.html) | Margen blanco de cuatro módulos. Falta prueba física de papel/escáner. |
| [MDN impresión](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing) | `@media print` / `@page` son mecanismos, no una aceptación A4 por sí mismos. |

No hay celular físico ni proyector disponible. El viewport móvil no demuestra proyección ni legibilidad física a un metro. No se obtuvo acceso autorizado a previews protegidas: el padre debe validar la preview auténtica en escritorio/móvil antes de cerrar. La tarea 2 no estaba en la base `6c583e9`; el padre debe actualizar la comprobación de main al cierre. No se copia esa tarea ni se inventa una frase opcional para Luma.

## Estado de entrega

La implementación y las pruebas focalizadas son una unidad Kit independiente. Los registros locales se guardan en `.evidence/kit-organizador/` (excluida). El padre completó las suites, build, navegador, PDF y comprobación actualizada de S9; los resultados y límites están en [la evidencia de entrega](kit-organizador-verificacion.md). La revisión de preview auténtica, CI remoto y aceptación física se registran por separado: una captura de impresión CSS o una página Login–Vercel no las sustituyen.
