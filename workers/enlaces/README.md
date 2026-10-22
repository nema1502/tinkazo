# Enlaces cortos de comprobantes

Un Worker de Cloudflare en `c.tinkazo.app` que guarda el comprobante de un sorteo detrás de un id de 8 caracteres, para que el enlace que se comparte por WhatsApp sea corto y su QR se lea bien desde una foto.

- **Lo que guarda son bytes opacos.** El navegador cifra el comprobante antes de mandarlo, y la clave viaja en el fragmento del enlace (`tinkazo.app/c/<id>#<clave>`), que el navegador nunca envía al servidor. Tinkazo no puede leer los nombres.
- **No hay que confiar en él para verificar.** La página del comprobante vuelve a calcular el sello de la lista y lo compara con el que está en Stellar. Si el servicio se cae, el enlace largo de siempre sigue funcionando.
- **Dónde guarda:** Durable Objects con SQLite, en la misma cuenta de Cloudflare. Son consistentes apenas escriben (un enlace recién creado abre al instante en cualquier país) y entran en el plan gratis: 5 GB por cuenta, 100.000 filas escritas y 5 millones leídas por día. Los enlaces se reparten en 62 objetos según el primer carácter del id, porque en el plan gratis cada objeto llega a 1 GB, y un objeto aparte lleva los cupos. No usa R2: para activarlo, Cloudflare pide cargar un medio de pago.

## La API

| Pedido | Qué hace |
| --- | --- |
| `POST /v1` con el cuerpo binario (hasta 256 KB) | Crea el enlace. Responde `201 {"id", "borrar"}`. Solo desde tinkazo.app, www, las vistas de Vercel y localhost |
| `GET /v1/<id>` | Devuelve los mismos bytes, desde cualquier origen |
| `DELETE /v1/<id>` con `Authorization: Bearer <borrar>` | Lo borra |
| `GET /<id>` | Redirige a `https://tinkazo.app/c/<id>`; el navegador conserva el fragmento |

Límites: 256 KB por enlace, 60 altas por hora por dirección IP (se cuentan en memoria, sin guardar la IP) y 20.000 altas por día en total.

## Probar y desplegar

```bash
# En local (workerd, sin tocar Cloudflare)
npx wrangler@4 dev --port 8787
node probar.mjs http://localhost:8787

# Desplegar (con la sesión de wrangler login de la cuenta de Tinkazo)
npx wrangler@4 deploy
node probar.mjs https://c.tinkazo.app
```

`probar.mjs` crea un enlace, lo lee, prueba los límites, la redirección y el borrado, y no deja nada guardado.

La dirección `c.tinkazo.app` es un registro AAAA a `100::` con el proxy de Cloudflare, creado el 21 de octubre de 2026; el sitio sigue en Vercel y su DNS no cambió.
