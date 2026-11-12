# El vigilante del portero de mainnet

Un Worker de Cloudflare (`tinkazo-vigilante`) que cada diez minutos le pregunta al portero de mainnet cómo está y avisa por correo si hace falta. Está desplegado desde el 11 de noviembre de 2026 y responde en `vigilante.tinkazo.app`. Armarlo de nuevo, o cambiar el KV, el dominio, el correo o los secretos, pide la palabra de quien mantiene el proyecto. Los pasos, en orden, están en [`docs/operacion.md`](../../docs/operacion.md), sección "El vigilante".

Es un script aparte de los otros (portero, enlaces, sala, cuenta, música): un error acá no puede tumbarlos, ni al revés.

## Por qué existe

El portero de mainnet paga las comisiones de sellar y sortear. Si los créditos de Pollar bajan del piso, deja de aceptar canjes de cupones, y el día de un evento alguien tiene que enterarse en minutos. La vigilancia anterior era un flujo de GitHub Actions con horario (`.github/workflows/vigilar-portero.yml`), pero GitHub dispara cerca del 10 % de las corridas programadas y no hay forma de pagarlo para que cumpla. Un Cron Trigger de Cloudflare no tiene ese problema. El flujo de GitHub queda de respaldo.

## Qué hace en cada vuelta

1. Lee lo recordado del KV (una lectura).
2. Pide `GET https://pm.tinkazo.app/v1/patrocinio/estado` con la clave de operar (`Authorization: Bearer ...`), como el flujo de GitHub.
3. Revisa la respuesta con **la misma lógica que el flujo de GitHub**: `scripts/lib/revision-portero.mjs`, un módulo puro (sin nada de Node) que importan los dos. No hay una copia.
4. Decide a quién avisar de qué, y manda.
5. Guarda todo junto en el KV (una escritura como mucho).

## Cuándo avisa

Lo mismo que decide el flujo de GitHub:

- un **problema nuevo**, o uno que **empeoró** (créditos bajos que pasan a bajo el piso, un tramo de cobros sin explicar que pasa al siguiente).
- el **mismo problema que sigue** pasadas **23 horas** del último aviso (un recordatorio).
- **el portero que no contesta dos vueltas seguidas**. Con una sola vuelta es un tropiezo y no avisa. Con dos, es un problema.
- **un problema que se arregla** se olvida y manda un aviso corto de que se arregló. Si vuelve, es nuevo. Si el vigilante no puede entrar al portero (la clave no está, el portero la rechaza o contesta algo que no se entiende), no sabe cómo están las cosas: no da nada por arreglado y conserva lo avisado, así que al recuperar el acceso lo que seguía mal no se avisa otra vez.

Los problemas que revisa están en la cabecera de `scripts/lib/revision-portero.mjs`: el portero que no paga los sellos ni los sorteos (apagado, devuelto a Pollar o sin decir su modo), el portero sin su llave (`llave` en null), créditos de Pollar bajos o bajo el piso o sin leer, la cuenta que paga con poco saldo o casi sin saldo o sin leer, las altas pausadas, los cobros de Pollar sin explicar (por tramos), el patrocinio de la app prendido o sin leer, un portero que no es el de mainnet y una respuesta que no se entiende. A eso se suma uno propio del vigilante: que no tenga la clave para entrar al portero, o que el portero ya no se la acepte (`401` o `403`), que se avisa enseguida.

### El correo es privado, así que lleva las cifras

A diferencia del registro de GitHub (público), el correo dice qué pasa, los créditos, el piso, el margen, el saldo de la cuenta que paga y qué hacer, en frases cortas y sin tecnicismos. El asunto se entiende en la pantalla bloqueada del celular: lo que pasa primero, y "y 2 más" si hay varios. Los textos están en `src/mensaje.ts` y una prueba cuida que no lleven punto y coma, comillas angulares, rayas largas ni tecnicismos.

## El resumen del día

A las **12:00 UTC (las 8 de la mañana en Bolivia)** llega un resumen: todo bien o no, con las cifras. Es la señal de vida: **si un día no llega, el vigilante se cayó.** Sale en la primera vuelta que encuentra la hora, una sola vez, y si el envío falla se reintenta. La primera vuelta de un Worker recién puesto también manda uno, y sirve de prueba.

Con la variable `RESUMEN_CADA_HORAS` se pide el resumen cada N horas (de 1 a 24), contadas desde las 12:00 UTC: con `6`, a las 12, 18, 0 y 6 UTC. Un valor raro vale 24.

## La memoria

Una sola entrada del KV (`MEMORIA`, clave `memoria`), escrita una vez por vuelta:

| Campo | Qué guarda |
| --- | --- |
| `claves`, `avisadoEn` | Los problemas ya avisados (claves estables, sin cifras) y cuándo fue el último aviso. Es el mismo formato que usa el flujo de GitHub |
| `sinRespuesta` | Vueltas seguidas en que el portero no contestó |
| `ultimaVuelta`, `salioBien` | Lo que muestra la ruta pública |
| `resumenEn` | El comienzo de la hora del último resumen armado |
| `pendientes` | Avisos que no salieron, con los canales que les faltan |

Si el vigilante tiene un KV que no se puede leer, no es una primera vuelta: no sabe qué se avisó, así que no manda nada, no da nada por nuevo y no escribe (deja `error-kv` en el registro, y la hora de la ruta pública deja de avanzar). Lo que había queda como estaba. Un KV vacío sí es la primera vuelta.

Se escribe después de enviar: si la vuelta se corta justo en el medio, un aviso puede salir repetido, pero no se pierde. Un KV no es del todo inmediato entre regiones (una lectura puede tardar hasta un minuto en ver una escritura), pero las vueltas están a diez minutos.

## Si un envío falla

No se pierde el aviso. Queda como pendiente con los canales que le faltan y se reintenta en la vuelta siguiente, y cada intento queda anotado en el registro del Worker (`error-envio`, con el código del error y sin secretos). Cada envío de correo tiene un tope de 15 segundos: si se cuelga, falla con `CORREO_TIEMPO` y queda pendiente como cualquier otra falla. Un aviso que lleva más de 24 horas sin poder salir se descarta, anotado (`aviso-descartado`), para no mandar algo viejo. Se guardan diez pendientes como mucho. Si falta algo de configuración, queda como `error-config` (con el nombre de lo que falta, nunca su valor) y la vuelta no sale bien. Sin a quién avisar (falta `AVISAR_A` o el binding, y Telegram está apagado) no se da nada por avisado y tampoco se gasta el resumen: apenas se configure, avisa como si fuera la primera vez. Lo que ya estaba pendiente se guarda y sale cuando vuelva a haber a quién mandarlo, si no pasaron las 24 horas. Por eso se puede desplegar primero y cargar los secretos después.

## Telegram, opcional y apagado

Si existen los secretos `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`, el mismo aviso sale también por `sendMessage` de Telegram. Sin los dos, no hace nada. Un fallo de un canal se reintenta solo en ese canal: si el correo salió y Telegram no, el correo no se repite.

## Las rutas

| Pedido | Qué hace |
| --- | --- |
| `GET /` | `{"servicio","ultimaVuelta","salioBien"}`. La hora de la última vuelta (ISO) y si salió bien. **Pública y sin ningún secreto ni cifra ni problema**, para que algo de afuera mire que el vigilante sigue vivo. `salioBien` es falso si no se pudo leer al portero, si falta configuración o si quedó un aviso sin mandar. Si `ultimaVuelta` tiene más de unos 30 minutos, el reloj se cayó |
| `POST /prueba` con `Authorization: Bearer <la clave de prueba>` | Manda un aviso de prueba por el correo (y por Telegram si está prendido) con las cifras de ahora y dice cómo salió: `{"correo":"enviado"\|"error"\|"sin-configurar","telegram":...}`. No cambia lo recordado. `401` sin clave, `403` con otra (también con la clave de operar cruda), `503` si el vigilante no tiene la clave de operar |

**La clave de prueba** no es la clave de operar: es un derivado de ella, el HMAC-SHA-256 del texto fijo `tinkazo-vigilante/prueba/v1` con la clave de operar (sin los espacios de los extremos) como llave, en hexadecimal minúsculo (64 caracteres). Así la clave de operar no viaja hasta el vigilante, y de la clave de prueba no se puede sacar la de operar ni la acepta el portero. Si se rota la clave de operar, la de prueba cambia sola. Se calcula en Node, sin imprimirla: `createHmac("sha256", clave.trim()).update("tinkazo-vigilante/prueba/v1").digest("hex")` (el comando entero está en la hoja de operación).

`GET /` guarda lo que lee del KV 60 segundos en la memoria del Worker, así que una lluvia de pedidos casi nunca llega al KV, y una vuelta nueva se ve enseguida. Una vuelta cada diez minutos y la ruta quedan muy por debajo de lo incluido en Workers Paid, que es el plan de la cuenta. `POST /prueba` espera 60 segundos entre una prueba y la siguiente (`429` con cuánto esperar). Ese tope es por instancia del Worker y vuelve a cero con cada despliegue: es un resguardo contra un descuido, y lo que cuida la ruta es la clave. La clave de operar se lee sin los espacios ni el salto de línea de los extremos: un secreto cargado a mano suele traer uno al final.

Lo demás es `404`, y un método que no corresponde, `405`. Ninguna ruta manda cabeceras CORS: un navegador de otro sitio no puede leerlas. Las respuestas nunca se guardan en una caché (`Cache-Control: no-store`) ni se indexan.

## Qué necesita (secretos y variables)

| Nombre | Tipo | De dónde sale |
| --- | --- | --- |
| `PORTERO_ADMIN_TOKEN` | secreto | La clave de operar del portero de mainnet: el mismo valor que su `ADMIN_TOKEN`, el que el flujo de GitHub guarda como `PORTERO_MAINNET_ADMIN_TOKEN` |
| `AVISAR_A` | secreto | La dirección (o varias, separadas por comas) a la que llega el aviso. Tiene que estar verificada en la cuenta de Cloudflare |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | secretos, opcionales | Un bot de Telegram propio y el chat al que escribe. Sin los dos, Telegram está apagado |
| `PORTERO_URL` | variable | `https://pm.tinkazo.app` |
| `CORREO_USUARIO`, `CORREO_DOMINIO` | variables | Desde qué dirección sale el correo (`avisos` en `tinkazo.app`). La dirección entera no se escribe en el repositorio |
| `RESUMEN_CADA_HORAS` | variable | `24` por defecto |
| `MEMORIA` | KV | Se crea con `npx wrangler@4 kv namespace create MEMORIA` |
| `CORREO` | `send_email` | El binding de correo de Cloudflare |

La clave de operar es la más poderosa del portero (apaga, sube el tope, exporta las tablas). El vigilante la usa solo para leer `estado` y para calcular la clave de prueba con la que reconoce a quien pide `POST /prueba`. Nunca va al registro, a una respuesta ni a un correo.

La clave solo viaja a un host de `*.tinkazo.app`: con un `PORTERO_URL` de otro host, de otro puerto o con usuario pegado, el vigilante vuelve a `pm.tinkazo.app`. Y el pedido que la lleva no sigue redirecciones: una redirección es una falla (cuenta como vuelta sin respuesta). Los secretos se leen sin los espacios ni el salto de línea de los extremos.

La clave de operar sí viaja en una cabecera al portero, en cada pedido de `estado`. Hay que mirar en el panel de Cloudflare si los registros de invocación de los dos Workers, `tinkazo-patrocinio-mainnet` y `tinkazo-vigilante` (el primer `POST /prueba` todavía llevó la clave de operar cruda), guardan la cabecera `Authorization` en claro o dicen `REDACTED`. Si la guardan en claro, después del evento se apagan esos registros y se rota la clave (pasos en la hoja de operación).

## El correo de Cloudflare: qué pide

Según la documentación vigente de Cloudflare (leída el 11 de noviembre de 2026, páginas de Email Service y Email Routing):

- El binding se declara con `[[send_email]]` y un `name`. `send()` recibe un objeto con `to`, `from`, `subject` y `text` o `html`, y devuelve un `messageId`. Un fallo es un `Error` con un `code` que empieza con `E_` (por ejemplo `E_SENDER_NOT_VERIFIED`, `E_SENDER_DOMAIN_NOT_AVAILABLE`, `E_RECIPIENT_NOT_ALLOWED`, `E_DAILY_LIMIT_EXCEEDED`). El vigilante registra ese código y nada más.
- **El remitente** tiene que ser una dirección de un dominio de la cuenta con el ruteo de correo prendido (Email Routing). Se usa un usuario del dominio de Tinkazo. El ruteo de correo de `tinkazo.app` ya está prendido (hoy hay direcciones que reenvían): solo se comprueba que sigue prendido. No se toca ningún registro del dominio.
- **El destino**: mientras el dominio no esté dado de alta para enviar a cualquiera (Email Sending, en beta y solo con Workers Paid), el correo solo puede ir a **direcciones de destino ya verificadas de la cuenta**. Se agregan y verifican en el panel (Email, Email Routing, Destination addresses: se agrega la dirección y se toca el enlace del correo de verificación). Son de la cuenta y sirven para cualquier dominio. Esos envíos son gratis en todos los planes y no cuentan para ningún límite. Es el único camino que usa el vigilante.
- Una dirección no verificada, o fuera de la cuenta, falla con `E_RECIPIENT_NOT_ALLOWED`. Se ve en el registro y en `POST /prueba`.

Lo que **no se pudo confirmar** de la documentación, y se comprueba en el primer despliegue con `POST /prueba`:

- Si el usuario del remitente (`avisos`) tiene que existir como regla o dirección de ruteo, o si basta con el dominio.
- Cómo se comporta `wrangler dev` con el binding (la documentación habla de una simulación local que escribe el correo en archivos, sin entregarlo).
- El tope diario exacto de envíos (la documentación solo dice que arranca conservador).

## Probarlo

Todas las pruebas (`pnpm exec vitest run workers/vigilante`) corren sin Cloudflare ni red, con funciones puras y un mundo de mentira (`src/mundo-falso.ts`): el portero que contesta lo que se le diga, un KV en memoria, un binding de correo que anota lo que recibe, un Telegram que hace lo mismo y un reloj que se mueve a mano. Cubren cada tipo de problema, que no avisa dos veces lo mismo, el recordatorio a las 23 horas, el arreglo, el portero que no contesta, el resumen, el envío que falla y se reintenta, y que la ruta pública no deja ver nada privado.

En local, `npx wrangler@4 dev --port 8795` desde esta carpeta, con un `.dev.vars` (que no se versiona) con los secretos. Una vuelta se dispara con `curl "http://localhost:8795/cdn-cgi/local/scheduled"`, la ruta que da la documentación de Cloudflare para probar un Cron Trigger. Cuidado: la vuelta le habla al portero de verdad si `PORTERO_URL` no se cambia en el `.dev.vars`, y manda el correo si el binding anda en local. Para probar sin tocar nada, `PORTERO_URL` apunta a un servidor propio.

Ya desplegado, se prueba que anda con `GET /` (la hora de la última vuelta) y `POST /prueba` (un correo de prueba): ver [`docs/operacion.md`](../../docs/operacion.md).

## Qué hacer con cada aviso

La tabla de los avisos, con qué quiere decir cada uno y qué hacer, está en [`docs/operacion.md`](../../docs/operacion.md), sección "El vigilante". Cada correo trae además el "Qué hacer" de su problema.
