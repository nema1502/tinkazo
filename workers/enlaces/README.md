# Enlaces cortos de comprobantes

Un Worker de Cloudflare en `c.tinkazo.app` que guarda el comprobante de un sorteo detrás de un id de 8 caracteres, para que el enlace que se comparte por WhatsApp sea corto y su QR se lea bien desde una foto.

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

`probar.mjs` crea un enlace, lo lee, prueba los límites, la redirección y el borrado con el permiso del enlace, y no deja nada guardado. Con `ADMIN_TOKEN` en el entorno prueba también el borrado a pedido; sin él, lo saltea.

La dirección `c.tinkazo.app` es un registro AAAA a `100::` con el proxy de Cloudflare, creado el 21 de octubre de 2026; el sitio sigue en Vercel y su DNS no cambió.
