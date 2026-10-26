# Enlaces cortos de comprobantes (y el contador del embudo)

Un Worker de Cloudflare en `c.tinkazo.app` que guarda el comprobante de un sorteo detrás de un id de 8 caracteres, para que el enlace que se comparte por WhatsApp sea corto y su QR se lea bien desde una foto. Lleva también el [contador anónimo del embudo](#el-contador-anónimo-del-embudo): cuántas veces se usa cada paso del sorteo, por día, sin nada de nadie.

- **Lo que guarda son bytes opacos.** El navegador cifra el comprobante antes de mandarlo, y la clave viaja en el fragmento del enlace (`tinkazo.app/c/<id>#<clave>`), que el navegador nunca envía al servidor. Tinkazo no puede leer los nombres.
- **No hay que confiar en él para verificar.** La página del comprobante vuelve a calcular el sello de la lista y lo compara con el que está en Stellar. Si el servicio se cae, un enlace corto ya compartido no abre mientras dure la caída; el enlace largo de siempre sigue funcionando, y quien organiza lo tiene en Mis sorteos («Ver comprobante»), en el equipo donde sorteó.
- **No vence.** Un enlace queda guardado para que el sorteo se pueda volver a comprobar. La interfaz no ofrece borrarlo: hacerlo cortaba la verificación de todos los que ya lo tenían (el grupo de WhatsApp, el QR de la foto, el del proyector), podía parecer que se quería esconder un resultado y se tocaba sin querer. Si alguien necesita que se borre, por ejemplo porque alguien de la lista lo pide, escribe a hola@tinkazo.app y lo borra Tinkazo (ver [Borrar a pedido](#borrar-a-pedido)).
- **Dónde guarda:** Durable Objects con SQLite, en la misma cuenta de Cloudflare. Son consistentes apenas escriben (un enlace recién creado abre al instante en cualquier país) y entran en el plan gratis: 5 GB por cuenta, 100.000 filas escritas y 5 millones leídas por día. Los enlaces se reparten en 62 objetos según el primer carácter del id, porque en el plan gratis cada objeto llega a 1 GB, y un objeto aparte lleva los cupos. No usa R2: para activarlo, Cloudflare pide cargar un medio de pago.

## La API

| Pedido | Qué hace |
| --- | --- |
| `POST /v1` con el cuerpo binario (hasta 256 KB) | Crea el enlace. Responde `201 {"id", "borrar"}`. Solo desde tinkazo.app, www, las vistas de Vercel y localhost |
| `GET /v1/<id>` | Devuelve los mismos bytes, desde cualquier origen |
| `DELETE /v1/<id>` con `Authorization: Bearer <borrar>` | Lo borra con el permiso de ese enlace. El navegador que lo creó lo guarda en silencio; la interfaz ya no lo usa |
| `DELETE /v1/<id>` con `Authorization: Bearer <ADMIN_TOKEN>` | Lo borra Tinkazo, a pedido. Existe solo si el Worker tiene el secreto `ADMIN_TOKEN`, de 32 caracteres o más; se compara en tiempo constante |
| `GET /<id>` | Redirige a `https://tinkazo.app/c/<id>`; el navegador conserva el fragmento |

Límites: 256 KB por enlace, 60 altas por hora por dirección IP (se cuentan en memoria, sin guardar la IP) y 20.000 altas por día en total.

## Borrar a pedido

Cuando alguien escribe a hola@tinkazo.app para que se borre un enlace, alcanza con el id: los 8 caracteres que siguen a `tinkazo.app/c/`. La parte que va después del `#` es la clave y no hace falta; sin ella, Tinkazo tampoco puede abrir la copia.

```bash
# Una sola vez: crear el secreto y cargarlo en el Worker (desde esta carpeta,
# con la sesión de wrangler login de la cuenta de Tinkazo). Pide el valor.
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler@4 secret put ADMIN_TOKEN

# Borrar un enlace: 204 si lo borró, 404 si ya no estaba.
curl -i -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://c.tinkazo.app/v1/<id>
```

El secreto no se versiona: va en el gestor de contraseñas o en `.env.local`, que git ignora. Para probarlo en local, `npx wrangler@4 dev --port 8787 --var ADMIN_TOKEN:<secreto>` o un archivo `.dev.vars` en esta carpeta (también ignorado).

Lo que hay que saber antes de borrar:

- Quien tenga el enlace corto o su QR deja de poder abrirlo: el grupo de WhatsApp, la foto y el proyector se quedan sin comprobante. El sorteo y su enlace largo no cambian.
- No le quita la lista a quien ya la abrió: su navegador guarda el enlace largo. Uno que lo abrió en los últimos cinco minutos puede seguir viéndolo desde su caché (`Cache-Control: max-age=300`).
- El navegador que armó el enlace lo tiene anotado y, si vuelve a compartir ese sorteo, manda el mismo enlace, que ya no abre. Conviene avisarle a quien organiza.

## Probar y desplegar

```bash
# En local (workerd, sin tocar Cloudflare)
npx wrangler@4 dev --port 8787 --var ADMIN_TOKEN:una-clave-de-prueba-de-al-menos-32-caracteres
ADMIN_TOKEN=una-clave-de-prueba-de-al-menos-32-caracteres node probar.mjs http://localhost:8787

# Desplegar (con la sesión de wrangler login de la cuenta de Tinkazo)
npx wrangler@4 deploy
ADMIN_TOKEN=<el secreto> node probar.mjs https://c.tinkazo.app
```

`probar.mjs` crea un enlace, lo lee, prueba los límites, la redirección y el borrado con el permiso del enlace, y no deja nada guardado. Con `ADMIN_TOKEN` en el entorno prueba también el borrado a pedido; sin él, lo saltea. Del contador prueba lo que se rechaza y la lectura; en local, además, suma conteos de prueba y los lee de vuelta (contra producción no: quedarían en los números públicos), y con `--tope` (después de la dirección) el tope por dirección y por hora, que deja esa dirección una hora sin contar.

La dirección `c.tinkazo.app` es un registro AAAA a `100::` con el proxy de Cloudflare, creado el 21 de octubre de 2026; el sitio sigue en Vercel y su DNS no cambió.

## El contador anónimo del embudo

Para medir el recorrido del organizador (pedido de Nicolás del 22 de octubre de 2026: "medible y computable para mandarlo al SCF") sin nombres y sin rastreadores de terceros. Es la sección 4.8 de la arquitectura de métricas (`Tinkazo_Grants/arquitectura.md`); los eventos y sus propiedades son los de la 4.5, con los agregados del onboarding que aceptó la 4.9.

| Pedido | Qué hace |
| --- | --- |
| `POST /v1/contar` con `{"e", "p"?, "ref"?}`, hasta 512 bytes | Suma uno a lo de hoy y responde `204`. Solo desde `https://tinkazo.app` (y `www`); `400` si algo no está en la lista cerrada, `413` si pasa de 512 bytes, `429` pasado un tope |
| `GET /v1/conteos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` | Las sumas por día, crudas y públicas, desde cualquier origen: `[{"dia", "e", "p", "ref"?, "n"}]`. Sin fechas, los últimos 30 días (UTC); hasta 92 días y 5.000 filas por consulta. Se puede guardar 5 minutos |

**La lista cerrada** está en [`src/conteo.ts`](src/conteo.ts), y el sitio toma de ahí los tipos (`src/contar.ts`): un evento, una propiedad o un valor que no está en la lista no compila en el sitio, y el Worker lo rechaza entero.

| Evento | Cuándo lo manda el sitio | Propiedades |
| --- | --- | --- |
| `tutorial_open` | Se abre "¿Cómo se usa?" | `step` (1 a 4); `from`, opcional: `offer`, `button`, `menu`, `end` |
| `practice_done` | El ensayo o la demo llegaron al ganador | `kind`: `practice`, `demo` |
| `account_connected` | La primera cuenta conectada de la pestaña (retomar una sesión no cuenta) | `kind`: `google`, `email`, `freighter`, `test` |
| `list_ready` | La primera lista de dos o más de la pestaña, puesta por la persona | `source`: `paste`, `typed`, `csv`, `luma`; `size`: `2-9`, `10-49`, `50-199`, `200+` |
| `list_shown` | "Mostrar la lista a la sala" | — |
| `seal_sent`, `seal_confirmed`, `seal_failed` | Se pide sellar con cuenta, se confirma o falla | `network`: `mainnet`, `testnet`; en la falla, `error`: la clave de `errorKey` (`src/stellar/errores.ts`) |
| `draw_confirmed`, `draw_failed` | El sorteo anclado queda grabado o no se pudo grabar | `network`; en la falla, `error` (las mismas claves) |
| `share` | Se copia o se comparte el mensaje, se avisa al ganador o se muestra el QR en grande | `channel`: `copy`, `native`, `whatsapp`, `email`, `qr_big`, `event`; `ref` si el sorteo está anclado (un evento va sin `ref`) |
| `proof_open` | Se abre un comprobante anclado (con `ref`) o un enlace de evento (sin `ref`) | `via`: `long`, `short`, `qr` |
| `proof_verdict` | Termina la verificación de un comprobante anclado | `verdict`: `green`, `yellow`, `red`, `error`; `ref` siempre |

`ref` es `{"net", "contract", "id"}`: la red, el contrato y el número del sorteo, que ya son públicos en la cadena, y el contrato tiene que ser el oficial de esa red en `src/stellar/deployments.json`: un sorteo de otro contrato (un enlace fabricado) no se cuenta. Por eso, **cuando cambia `deployments.json` (el contrato de mainnet), el Worker se vuelve a desplegar**: hasta entonces, nada de mainnet con referencia entra. Ningún evento de antes del sello lleva nada que identifique a nadie. Lo que no está en la lista no se cuenta: por ejemplo, "Bajar la foto" del diálogo de compartir.

**Lo que guarda:** una fila por día (UTC), evento, propiedades y sorteo, con cuántas veces pasó. Nada más: ni el evento suelto, ni la hora, ni la dirección IP, ni el navegador, ni cookies, ni un identificador de persona, de equipo o de sesión. Cada conteo se escribe al llegar, una fila escrita por conteo: con el tope de 20.000 por día, el contador no puede usar más de una quinta parte de las 100.000 filas escritas por día de la cuenta, y los enlaces siguen teniendo las suyas. Juntarlos en memoria y escribir una vez por minuto, como sugiere §4.8, se probó el 22 de octubre y se descartó: un objeto quieto se apaga antes de su alarma y pierde lo que tenía, sin aviso, justo cuando hay poco movimiento. Fuera de la cadena no hay nada que una un paso con el siguiente, a propósito: el seguimiento por cuenta (cuánto tarda alguien en hacer su primer sorteo, quién vuelve) sale de la cadena, con el script de métricas.

**Lo que no puede evitar, y se dice:** cualquiera puede mandar conteos inventados con un script. Por eso los conteos son señal y no prueba: en la postulación van al lado de lo que sí está en la cadena, y se publican crudos.

**Los topes**, para que nadie lo llene ni le quite el plan gratis a los enlaces (los dos comparten las 100.000 filas escritas y los 5 millones de filas leídas por día de la cuenta):

- 1.000 conteos y 60 consultas por dirección y por hora, en memoria, como el tope de los enlaces: la IP no se guarda, y si el objeto se duerme vuelven a cero. En IPv6 cuenta el /64, no la dirección entera (con la entera, un solo bloque /64 daba millones de topes). Se recuerdan hasta 20.000 direcciones por hora; con el mapa lleno, una dirección nueva espera (antes se vaciaba, y vaciarlo se podía forzar).
- 20.000 conteos por día en total, y 2.000 combinaciones distintas por día (evento, propiedades y sorteo): con el día lleno, solo suman las que ya existen.
- 500 consultas por día que leen la base; una consulta repetida sale de la memoria durante 5 minutos.

**Lo que los topes no cuidan:** en el plan gratis, la cuenta de Cloudflare tiene 100.000 pedidos por día para todos sus Workers, y un conteo rechazado también es un pedido. Pasado eso, `c.tinkazo.app` deja de abrir enlaces y QR hasta la medianoche UTC. Por eso, antes de encenderlo, una de dos, que decide Nicolás (§4.8): Workers Paid (US$5 por mes; 10 millones de pedidos por mes) o una regla de límite de pedidos de Cloudflare delante de `/v1/contar`.

**Del lado del sitio** (`src/contar.ts`): solo en `tinkazo.app` (ni localhost, ni las vistas previas, ni los auditores), ni desde un navegador automatizado (`navigator.webdriver`), ni si el navegador pide que no lo sigan (`globalPrivacyControl` o `doNotTrack`). En la demo (`?demo=`) y en el ensayo salen solo `practice_done` y `tutorial_open`. Un verde de un contrato que no es oficial se cuenta como `red` (y el Worker, igual, no lo suma). Se manda con `navigator.sendBeacon` y un cuerpo de texto: sin consulta previa (CORS), sin esperar respuesta y sin frenar nada; si falla, no pasa nada. El QR de un comprobante lleva `?o=qr` antes del `#`, y la página del enlace corto pasa `?o=short`, para saber por dónde se abrió; la página lo saca de la dirección al abrir. Los términos lo cuentan (`tmMore2`, en `terminos.html` y `src/i18n.ts`).

### Desplegarlo y encenderlo

Desplegar espera el ok de Nicolás. Son tres pasos, y el sitio no manda nada hasta el último:

```bash
# 1. El Worker, con la clase nueva: la migración v2 crea el objeto del contador
#    y los enlaces no cambian. Desde esta carpeta, con la sesión de wrangler login.
npx wrangler@4 deploy
ADMIN_TOKEN=<el secreto> node probar.mjs https://c.tinkazo.app   # no suma conteos de prueba
curl -s https://c.tinkazo.app/v1/conteos                          # [] mientras nadie cuente
```

2. Lo que cuida los 100.000 pedidos por día (de arriba): Workers Paid o la regla de límite de pedidos delante de `c.tinkazo.app/v1/contar`.

3. En `src/contar.ts`, `CONTADOR = "https://c.tinkazo.app/v1/contar"`, y en el mismo commit la fecha de los términos (`tmMore4`, en `src/i18n.ts` en los dos idiomas y en `terminos.html`, y el `lastmod` de `terminos.html` en `public/sitemap.xml`): el día en que empieza a contar.

Después de subir el sitio, para ver que cuenta: abrir `https://tinkazo.app/?demo=wheel` en un navegador que no pida "no seguir" y, cuando salga el ganador, `GET /v1/conteos` tiene que traer un `practice_done` con `kind: demo` del día (hasta 5 minutos después, por la memoria de las consultas).

Para apagarlo: `CONTADOR = ""` en el sitio, sin tocar el Worker. Borrar lo contado no tiene camino en la API, a propósito: se haría con un despliegue que vacíe la tabla.
