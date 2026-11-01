# Kit del organizador: evidencia de entrega

## Alcance comprobado

Página existente, texto fuente literal ES/EN y únicamente las cuatro correcciones aprobadas. No cambia botones de la aplicación, sorteo, ganador, sellado, Worker, encuesta, marca ni otros juegos. La fuente editorial está en L1 de `odd/tasks/kit-organizador.md`.

| Comprobación | Resultado observado |
| --- | --- |
| Focalizadas | 153 aprobadas en 3 archivos; 136 unidades editoriales verificadas. RED y GREEN preservados en `.evidence/kit-organizador/`. |
| Tipos | `pnpm typecheck`: salida 0. |
| Suite | `pnpm test --maxWorkers=2 --reporter=dot`: 155 archivos, 3148 aprobadas y 4 omitidas. |
| Omisiones | `src/stellar/seals.test.ts`, integración testnet opt-in `TINKAZO_RED`; no se ejecutó ni se cuenta como aprobada. No se modifica protocolo. |
| Build y glosario | `pnpm build` y `pnpm check:glosario`: salida 0. Dos avisos editoriales pendientes de `avisar`, no errores. |
| Navegador real | WebKit y Firefox normales, 390/1280 px, ES/EN/ES: 70 aserciones aprobadas y cero fallos por motor; dos registros adicionales son metadatos. |
| Interacción | Navegación, fragmento directo, idiomas, ausencia de desborde, imágenes locales, QR y ambos modos de impresión. Restablecimiento al completar PDF nativo y por evento `afterprint`; cancelación del diálogo nativo del sistema no ejercitada. |
| Guía A4 | Firefox/BiDi nativo: cuatro páginas por idioma. Contenido fuente completo; bases en una página y tabla completa en otra, sin texto fuera del papel. Ocho páginas revisadas visualmente. |
| Tarjetas A4 | Una hoja con dos tarjetas completas, ambas ES/EN, blanco y negro, texto principal 14 pt y QR 35 mm. |
| QR impreso | Ambos códigos decodificados independientemente desde el raster nativo del PDF. Destino exacto: `https://tinkazo.app/sorteo-para-meetup.html#comprobacion`. |
| Main actualizado | Fetch final: `6c583e98ee0864be13297297f7521097cc494b53`; la pregunta de Confianza no está integrada. No se copia código ni se inventa la frase adicional para Luma. |

Los hashes de entradas de aplicación, configuración y lockfile coinciden entre los gates completos, el build servido y la prueba de navegador/PDF. Después solo cambia documentación. La identidad detallada está disponible localmente en `docs/capturas/kit-organizador/identity.json`, sin versionar por la política de `.gitignore`.

### Fallos conservados y corrección del lector

Job60 terminó con salida 1 aunque los dos motores de pantalla pasaron: el lector PDF insertaba espacios entre corridas de glifos (`fi ll`, `wi fi`) y reducía el QR a unos 2.6 píxeles por módulo. Esto no era texto perdido ni un QR incorrecto del producto. Job61 releyó los **mismos PDF, sin regenerarlos ni cambiar fuente**, uniendo texto según sus posiciones y usando píxeles nativos a 144 dpi. Salida 0: ninguna unidad inglesa faltante y ambos QR correctos. Los registros originales se conservan, no se reemplazaron por un supuesto GREEN de producto.

## Carga inicial

Los cuatro scripts solicitados por ambos motores suman 16,719 bytes (7,367 gzip); la entrada nueva mide 408 bytes (276 gzip). Se inyectan 74 claves por idioma, no el diccionario completo. No se solicita de inicio Stellar, Pixi, juegos ni una biblioteca QR. Las claves anteriores del diccionario no se reescriben: 3,344 entradas existentes idénticas y 20 adiciones ES/EN. El SVG es local y estático.

## Evidencia local y huellas

La política existente de `.gitignore` indica que las salidas de auditores se regeneran y no se versionan. No se fuerza su inclusión ni se cambia esa política. Los resultados de esta tabla y estas huellas sí documentan lo observado; los archivos originales quedan disponibles en el checkout:

- `docs/capturas/kit-organizador/{es-mobile.png,en-desktop.png}`.
- `docs/capturas/kit-organizador/{guide-es-a4.pdf,guide-en-a4.pdf,cards-a4.pdf,cards-a4.png}`.
- Guía ES SHA-256: `eb129a6506e12fecaf718065cdb9d165d2f3589cda68ccf62366290763ad6f63`.
- Guía EN SHA-256: `0e4f7d2ae15cdd056daa6498cf8100090d2b8816f2969ed5f2dd50526f8dfa65`.
- Tarjetas SHA-256: `4ba71c5c9e4396977136b116c4a32b69a8d4c4102b868b8bb8ea8aaa9a4a1739`.

Los PDF son evidencia de una preview local propia, no de producción. Las anotaciones de enlaces relativos de la guía conservan el origen localhost de esa prueba; el QR de las tarjetas siempre lleva el HTTPS público canónico. El nuevo fragmento se hará efectivo en producción únicamente después de la integración y despliegue del equipo, no por abrir este PR.

## Límites abiertos

- Sin celular físico, proyector ni impresora: no se atribuye proyección real, escaneo de papel ni lectura física a un metro a una emulación o PDF.
- Las incertidumbres oficiales de compatibilidad HDMI/AirPlay/Smart View y Luma están documentadas con fuentes en [el kit](kit-organizador.md). No se reescribieron frases no autorizadas.
- Chromium local no tiene sandbox utilizable; no se desactivó. Se utilizaron WebKit y Firefox disponibles.
- Preview Vercel auténtica y CI remoto pendientes de la publicación. Un HTTP 200 de Login–Vercel no cuenta como aceptación en computadora o celular.
- Sin integración ni despliegue de producción. `Risk: none`: se agregan claves de datos y módulos locales; no se altera lógica compartida ni valores anteriores consumidos por otras páginas.
