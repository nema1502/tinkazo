# Celular: resultado y evidencia

La tarea 1 corrige la cabecera de 320 px y los errores confirmados de ingreso y sorteo. La implementación está en `776338e` (cabecera) y `1c6f2cf` (recuperación), sobre `e05a802`. No cambia contrato, protocolo, selección de ganadores, juegos, Worker ni paleta.

## Qué revisar

| Caso | Resultado |
|---|---|
| H1 | Reproducido: 3 filas y 197 px a320. Corregido con HTML/CSS mínimo: logo/idioma/cuenta arriba; Sortear/Mis sorteos/Más debajo. |
| E1 | Fallo al cargar selector: mensaje neutral persistente y recarga explícita, conservando borrador. Repetir un import rechazado no bastaba para recuperarlo. |
| E2 | Aviso de ingreso sin acción y de7s: ahora persiste y ofrece otra vía/cierre. Causas desconocidas sin atribuciones inventadas. |
| E3 | Envío/verificación de código: mensaje neutral, causas específicas solo reconocidas. Inválido/vencido y correo plano ya funcionaban y se conservaron. |
| E4 | Ya se recuperaba el resultado registrado: camino intacto. Si no puede leerse, consulta el comprobante exacto. Preparar de nuevo solo con ausencia confirmada por el mismo contrato; conserva datos y exige otro gesto para sellar. |

Menú, privacidad del chip, reintentos seguros y respaldo interno de vista grande en iPhone se conservan. El evento de error sigue entregando texto en `detail`; agrega una acción opcional compartida con la espera.

## Pruebas observadas

| Comprobación | Resultado |
|---|---|
| RED cabecera |552 comprobaciones,100 fallos; exit1 antes de corregir |
| GREEN cabecera |632 comprobaciones,0 fallos; incluye80 comparaciones de geometría desktop/lectura idénticas a base |
| Spot del padre, cabecera |104 comprobaciones,0 fallos; exit0 |
| RED errores |E1–E4 reproducidos;7 fallos esperados antes de agregar la consulta de ausencia |
| Pruebas focalizadas del escritor |8 archivos,196 pruebas; exit0 |
| Spot del padre, errores |81 comprobaciones,0 fallos; exit0 tras corregir sincronización del auditor |
| Verificador independiente |8 archivos,196 pruebas y tipos; exit0 |
| Flujo independiente |38 combinaciones,190 aserciones satisfactorias; límites de códigos de salida abajo |
| Recuperación con anchor real |124 aserciones;5 invocaciones de navegador exit0; se interceptó contrato, no anchor |
| `pnpm typecheck` |exit0 |
| `pnpm test --maxWorkers=2` |157 archivos;3155 aprobadas y4 omitidas; exit0 |
| `pnpm build` |exit0 |
| `pnpm check:glosario` |exit0;2 entradas de aviso por decidir |

Las4 omisiones son `sealsOnChain contra testnet`, habilitadas por `TINKAZO_RED`. No se ejecutaron las lecturas históricas opt-in: no son pruebas aprobadas. El build informa avisos sobre `__dirname` en Vite e imports dinámicos inefectivos.

El spot inicial de errores falló por una carrera del auditor: leyó un mensaje vacío antes de completarse el envío. Se conservó el fallo y se corrigió la espera hasta ver un error no vacío y el botón rehabilitado. La repetición pasó; no requirió cambiar producto.

## Navegadores y alcance real

- Chromium153.0.8010.12 táctil emulado:320/360/375/414 × ES/EN × claro/oscuro.
- WebKit26.6 táctil emulado:misma matriz completa.
- Firefox155 en modo escritorio:320 ES/EN y ambos temas;1440 ES y ambos temas.
- Cabecera:cuenta fuera/conectando/retomando/dentro/red incorrecta en fixtures de presentación.
- Flujo:ingreso con error neutral, sello, espera y resultado grande; recuperación desde botón/barra/espera. Fullscreen instrumentado dentro del gesto; API ausente o rechazada conserva las vistas internas.

**Son emulaciones, no Android/iPhone físicos ni Safari físico.** No se completó autenticación con proveedores ni se enviaron operaciones a cadena. El recorrido usa configuración sin contrato; la recuperación prueba anchor real con adaptadores externos. Juegos omitidos por movimiento reducido/instantáneo: no hay afirmación de render WebGL.

Tres invocaciones iniciales del verificador excedieron el límite de30s de la herramienta. Sus hijos finitos escribieron JSON satisfactorio y cerraron, pero sus códigos de salida no están acreditados: **no se presentan como procesos exit0**. Las demás ejecuciones quedan individualizadas en los registros.

El comando local adicional `check-paginas` no llegó a medir páginas: su launcher CDP nativo abortó por `No usable sandbox` (diagnóstico exit134; gate exit1). **No está aprobado localmente.** No se modificó el launcher ni la seguridad del host. La geometría compartida sí tiene80 comparaciones de navegador contra base; la CI del PR conserva su gate de páginas normal.

## Capturas e identidad

- [Cabecera antes](capturas/celular/header/before/) / [después](capturas/celular/header/final/).
- [Errores antes/después, barra y espera](capturas/celular/errores/).
- [Resultado WebKit](capturas/celular/verificacion/webkit-light-result.png), [resultado Firefox](capturas/celular/verificacion/firefox-light-result.png), [error en espera Chromium](capturas/celular/verificacion/chromium-dark-espera-error.png) y [error desde barra WebKit](capturas/celular/verificacion/webkit-dark-barra-error.png).
- Copia independiente:archivos de producto idénticos byte a byte a `1c6f2cf19e214b81bc37b6274046f772cc06fa9b`; SHA-256 del diff de snapshot:`d8b9b2fd64950d53ba171f776728aeed4b490831e73968177f2d9d45b1600fe7`.
- Registros completos locales, ignorados por Git:`.evidence/celular/header/`, `.evidence/celular/errores/`, `.evidence/celular/verify/` y `.evidence/celular/final/`. Conservan fuente, stdout/stderr, exit codes disponibles y primeros fallos.
- Auditores reproducibles:[cabecera](../scripts/audit-celular-header.mjs) y [errores](../scripts/audit-celular-errores.mjs). Uso:[cabecera](ux-celular-cabecera.md) y [flujo](ux.md).

## Seguimiento fuera del cambio

WebKit375 ES, ambos temas:el indicador existente `#pasos li/.p-t` llega a376.359375px y el documento mide376px. Se reproduce idéntico en base y cambio; la cabecera termina a361px. Es preexistente, no bloquea esta unidad y no se corrigió. [Base](capturas/celular/verificacion/baseline-webkit-375-overflow.png) / [cambio](capturas/celular/verificacion/webkit-375-overflow.png).

Alturas521–600px y zoom final horizontal siguen fuera de alcance, reservados para tarea5; no se añadieron correcciones de esos casos. Evaluación nativa del rango:medium, `reviewDue=false`; el riesgo compartido de interfaz motivó la verificación independiente, no una revisión ordinaria adicional.

## Entrega

PR a `main`, con commits en español y autor solicitado. Preview de Vercel y CI se registrarán tras publicar; este informe no los da por aprobados anticipadamente. El equipo integra el PR. Sin merge ni despliegue de producción.
