# Respuestas de confianza en el resultado

## Estado de esta entrega

Preparado, **apagado**. `src/confianza-activacion.ts` mantiene `SERVICIO_CONFIANZA = ""`; `src/contar.ts` conserva `CONTADOR = ""`. Son interruptores independientes. No se despliega ni se activa nada en esta tarea de implementación. T5 espera que Nicolás confirme **ambas** cosas: protección de cuota y despliegue del Worker. La activación y la fecha de términos se harán después, en el mismo PR.

## Qué se pregunta

Después de «Lo que se comprobó», fuera de la tarjeta del ganador: «¿Confiaste en el resultado?», Sí / No / No sé. Es secundaria y opcional, sin selección inicial. `fieldset`, `legend`, radios nativos y botón de envío separado; las flechas del teclado solo seleccionan. Cambiar idioma o repintar no envía ni vuelve a registrar listeners.

Se monta al terminar la revisión, incluso roja o incompleta, si hay referencia admisible y servicio disponible. No cambia el veredicto, el ganador ni «Quiero comprobarlo». Con el interruptor apagado no hay formulario visible. ES/EN usan `idioma.ts`; el import estático permite extraer textos por página con Vite.

## Qué sale y qué queda

Único cuerpo: `{"e":"proof_trust","p":{"answer":"yes|no|unsure"},"ref":{"net":"testnet|mainnet","contract":"…","id":"…"}}`.

La validación cerrada compartida exige una respuesta y referencia exactas. Solo `proof_trust` admite anteriores oficiales hasta su `ultimoId` válido; los demás eventos siguen siendo del vigente. Aceptar una referencia **no prueba que exista el sorteo**. No se consulta Stellar ni se añade un SDK para contar.

El emisor reutiliza `puedeContar`, `enPractica` y `cuerpo`. Conserva dominio, DNT/GPC, exclusión de automatización, demo y ensayo; tampoco genera opiniones en prerender. Usa `fetch` CORS legible, texto simple, `credentials: omit`, `referrerPolicy: no-referrer`. No usa beacon ni respuestas opacas.

Solo un POST **204** confirma «Respuesta recibida. Gracias». Cualquier otra respuesta o pérdida de red queda incierta, sin reintento automático. El botón avisa que reintentar podría contar dos veces. El envío pendiente bloquea otro envío de la misma referencia. La confirmación vive en memoria y en `sessionStorage` por referencia: esa marca no se transmite, no es una identidad ni una garantía de personas únicas. Si el almacenamiento falla, la memoria sirve durante esta carga; recargar puede perder la marca.

El Worker conserva su SQL agregado por día UTC, evento, respuesta y referencia. No se agregan eventos individuales, identificadores ni hora del clic. Una repetición válida suma otra vez. No se cambia `Contador.sumar` ni la ruta: el POST ya espera su resultado y solo responde 204 con `ok`. Se conservan los output gates predeterminados de Durable Objects: una salida de red espera las escrituras previas; una falla reinicia el objeto y descarta salidas. No se usa `allowUnconfirmed`. Referencia oficial: [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). Que `sendBeacon` devuelva `true` solo significa que el navegador encoló el envío, no que se almacenó.

## Consultar respuestas recibidas

Desde la raíz:

```sh
node scripts/conteos-confianza.mjs --help
node scripts/conteos-confianza.mjs --desde 2026-10-01 --hasta 2026-10-31
# Prueba de lectura local:
node scripts/conteos-confianza.mjs --desde 2026-10-01 --hasta 2026-10-31 --api http://localhost:8792/v1/conteos
```

Ambas fechas son obligatorias, reales, de formato AAAA-MM-DD; el período es inclusivo UTC. La CLI divide en ventanas disjuntas de hasta 92 días. Solo subdivide una ventana si recibe 413 con `error: muchas`. Si un solo día ya excede el límite no intenta horas: la API sigue siendo de fechas y mantiene el rechazo de más de 5.000 filas. Un 429, otro error HTTP, red o fila inválida cancela toda la salida de totales con exit 1. No hay reintentos automáticos.

La salida tabulada agrupa por red, contrato y número: Sí, No, No sé y respuestas recibidas. No son personas únicas ni historia completa. Se informa el período cubierto y que el día actual puede tener hasta cinco minutos de retraso por caché. Se espera y valida todo antes de escribir stdout.

## Pruebas reproducibles (sin opiniones en producción)

Deterministas:

```sh
pnpm exec vitest run workers/enlaces/src/conteo.test.ts src/contar.test.ts src/respuestas-confianza.test.ts src/ui/confianza.test.ts src/i18n.test.ts --maxWorkers=2
node --test scripts/lib/conteos-confianza.test.mjs
```

El padre ejecuta puertas largas con `heavy`: `pnpm typecheck`, `pnpm test`, `pnpm build`. También aloja Vite 5186 y Wrangler 8792 bajo sus locks, con persistencia local nueva y aislada en el directorio ignorado `.evidence/confianza-resultado/wrangler-*`. Contra ese runtime aislado:

```sh
node workers/enlaces/probar-confianza.mjs http://localhost:8792
node workers/enlaces/probar.mjs http://localhost:8792
```

El primero compara sumas reales antes y después de rechazos, tres respuestas, anteriores y duplicados. Usa rangos deterministas distintos que incluyen hoy, para no confundir caché con ausencia de escrituras. Ejecutarlo primero en un runtime nuevo evita que otro ensayo haya cacheado esos rangos. El segundo conserva la regresión pública de enlaces cortos. No se usan destinos de producción.

Navegador, con WebKit y Vite ya alojado por el padre:

```sh
heavy -- node scripts/audit-confianza.mjs
```

`BASE_URL` permite cambiar el servidor local; `PLAYWRIGHT_PATH` permite resolver el módulo instalado, sin rutas de la VPS en código. La matriz es escritorio/celular × ES/EN × claro/oscuro, con capturas en `docs/capturas/confianza-resultado/` y evidencia en `.evidence/confianza-resultado/browser.json`. Está rotulada **SIMULACIÓN UI**: inyecta un servicio de prueba, nunca activa la configuración ni sortea las guardas reales del emisor. Comprueba grupo accesible, radios sin selección, flechas sin envío, idioma, montaje repetido, bloqueo pendiente, incertidumbre y confirmación. Una prueba adicional usa la revisión real con dependencias de firma/red simuladas: espera al fin del intento rojo/incompleto, admite un anterior en límite, oculta uno fuera de límite y comprueba que responder no cambia el veredicto. La matriz visual no demuestra aceptación en producción ni reemplaza la prueba de SQLite local.

## Evidencia observada antes de publicar

- Puertas finales: tipos exit0; 156 archivos de pruebas, 3152 aprobadas y cuatro testnet opt-in omitidas; CLI pública 4/4; build y glosario exit0. Identidad y logs en `.evidence/confianza-resultado/final-r2/`.
- Wrangler **local**, con SQLite real aislado: tres respuestas, contratos anteriores y límites, rechazos sin suma y duplicados; regresión HTTP de enlaces cortos, exit0. Sin opiniones ni consultas de prueba en producción. Logs en `.evidence/confianza-resultado/runtime/`.
- Quedaron omitidas las pruebas administrativas sin `ADMIN_TOKEN` y el tope por IP/hora sin `--tope`, ajenas al cambio; no se cuentan como aprobadas.
- Diferencial público: 198 entradas de todos los eventos anteriores coinciden con la base6c583e9; scratch dentro del worktree, sin cambiar HOME, retirado tras el check. Logs en `.evidence/confianza-resultado/diferencial/`.
- WebKit real: cuatro integraciones con firma/red simuladas y ocho vistas de UI simulada ES/EN × claro/oscuro × 390/1280, exit0. No acredita recepción de opiniones en producción. [Escritorio EN](capturas/confianza-resultado/1280-en-dark.png), [escritorio ES](capturas/confianza-resultado/1280-es-light.png), [celular EN](capturas/confianza-resultado/390-en-light.png), [celular ES incierto](capturas/confianza-resultado/390-es-dark-incierta.png). Son viewports emulados, no dispositivos físicos.
- Revisión independiente del código y de esa evidencia: sin blockers. Sus ejecuciones adicionales usaron HOME aislado contra el protocolo, por lo que **no se usan como aceptación funcional**; la evidencia ejecutable aceptada es la del padre con HOME normal. No se repitieron esas ejecuciones.
- Evaluación nativa: medium, `reviewDue=false`/`under_budget`; escalación de riesgo item2 por privacidad y guardas de referencia, cubierta con la revisión independiente indicada. No se inició una transacción de revisión nativa.

CI del PR y revisión de preview siguen pendientes de publicación/acceso. El servicio y el embudo permanecen apagados; la aceptación local no autoriza activación ni despliegue.
