# La sala del stand

Un Worker de Cloudflare en `s.tinkazo.app` para que la gente de un stand escanee un QR, escriba su nombre o apodo en el celular y lo vea aparecer en la pantalla grande. **Solo alimenta rondas de ejemplo** (el modo stand del sitio): esos nombres nunca van a un sorteo sellado ni a un comprobante.

Es un script aparte (`tinkazo-sala`) del de los enlaces (`tinkazo-enlaces`, en `workers/enlaces`), en la misma cuenta: un error de despliegue acá no puede tumbar los enlaces de los comprobantes. La cuenta, en cambio, comparte los 100.000 pedidos por día del plan gratis (ver [Plan y gasto](#plan-y-gasto)).

- **Lo que guarda son bytes cifrados.** El navegador de la pantalla genera una clave (AES-GCM, 16 bytes) y la pone en el QR, después del `#`: `s.tinkazo.app/<id>#<clave>`. El fragmento no llega a ningún servidor. El celular cifra el nombre con esa clave antes de mandarlo, así que el servicio no puede leerlo.
- **No guarda** nombres en claro, la clave, direcciones IP, navegador ni hora por persona. El token de la pantalla se guarda solo como huella SHA-256. Para contar las salas que arma cada dirección guarda, a lo sumo una hora, una huella de la dirección con una sal de esa hora (no se puede devolver a la dirección).
- **Se borra solo:** una alarma a las 10 horas de creada hace `deleteAll()`; antes, «Cerrar la sala» hace lo mismo. Los nombres cifrados quedan en el objeto hasta entonces (no 5 minutos): una compu que se cuelga en una feria no puede perder la lista, y el servicio sigue sin poder leerlos.
- **Quitar un nombre** con un toque lo saca también del objeto.
- **El filtro de palabras corre en la pantalla** (`src/sala/filtro.ts`), no acá: ningún servidor lee los nombres. Lo que coincide queda en «Para revisar».

## La API

| Pedido | Qué hace | Límite |
| --- | --- | --- |
| `POST /v1/sala` | Crea la sala: `201 {"id", "token", "vence"}`. Solo desde `tinkazo.app`, `www`, las vistas de Vercel y `localhost` | 5 por dirección y por hora; 100 por día en total |
| `POST /v1/sala/<id>` | Un nombre cifrado en `text/plain` (base64url, de 30 a 256 bytes): `201 {"n"}`. Es lo que manda la página del celular | 400 por sala; 120 por minuto por sala |
| `GET /v1/sala/<id>/nombres?desde=N` | Los nombres cifrados desde `N`: `[{"n","d"}]`. Con `Authorization: Bearer <token>`. Lo usa la pantalla al recargarse y, si el WebSocket se cae, cada 3 s | |
| `DELETE /v1/sala/<id>/nombres/<n>` | Saca un nombre. Con el token | |
| `GET /v1/sala/<id>/pantalla` | WebSocket hacia la pantalla. El token va en el primer mensaje (`{"t":"hola","token"}`), no en la dirección. Una pantalla a la vez: la que se presenta desplaza a la anterior (cierre 4000). Un token malo cierra con 4401 | hasta 6 sockets sin presentarse |
| `DELETE /v1/sala/<id>` | Cierra la sala y borra todo. Con el token | |
| `GET /<id>` | La página del celular: un HTML con su CSS y su JS adentro, en español y en inglés. Sin bajar el sitio, sin depender de Vercel y sin CORS | |

Mensajes del socket hacia la pantalla: `{"t":"listo","hay":N}`, `{"t":"nombre","n","d"}`, `{"t":"quitado","n"}`. Un `ping` de texto se contesta solo con `pong` sin despertar al objeto.

**Los topes viven en los objetos, porque ahí son exactos:** 400 nombres por sala (exacto, en SQLite) y 120 por minuto (en memoria: si el objeto se desaloja a mitad de un minuto, ese minuto caben otros 120; solo frena el ritmo, el de 400 no se reinicia); 5 salas por dirección por hora (en IPv6, por bloque /64) y 100 por día en un objeto aparte (`Cupos`), los dos en su SQLite: dormirse o reiniciarse no los pone en cero. El límite es por sala y no por dirección porque todo un recinto puede salir por una sola IP.

### Muchas direcciones

Los topes de los objetos frenan a una dirección y a una sala, no a quien reparte sus pedidos entre muchas direcciones. Esa defensa es una regla de límite de pedidos de Cloudflare (WAF) delante de `s.tinkazo.app`, que se pone al desplegar y no vive en este código.

### Sobre el binding de límite de pedidos

Cloudflare tiene un binding `[[ratelimits]]`, pero solo admite ventanas de 10 o 60 segundos y sus conteos son aproximados, por ubicación. No puede decir «5 por hora» ni «100 por día», así que **no se usa** para esto. La documentación que leí el 1-nov-2026 no dice si corre en el plan gratis. Si hiciera falta cuidar la cuenta de un abuso de pedidos, la regla de límite de Cloudflare (WAF) delante de `s.tinkazo.app` es lo que sirve, y es la misma decisión que sigue pendiente para el contador.

## Plan y gasto

Corre con `wrangler dev` y entra en el plan gratis: Durable Objects con SQLite (100.000 pedidos, 5 millones de filas leídas y 100.000 escritas por día en la cuenta; 13.000 GB-s de duración). Con WebSocket con hibernación un socket quieto no cobra tiempo; los mensajes entrantes cuentan 20 a 1 contra los pedidos, y los salientes no se cobran.

Cuentas de una feria (estimaciones, no medidas): 300 nombres son unos 300 pedidos más la pantalla. La consulta de respaldo (cada 3 s) solo corre mientras el socket está caído: una pantalla con el socket caído 1 hora son 1.200 pedidos. **Lo que sí hay que decidir:** un pedido rechazado también cuenta, y un abuso con scripts podría gastar el mismo cupo que abre los comprobantes. Antes de usarlo en un evento: Workers Paid (US$5 por mes) o una regla de límite delante de `s.tinkazo.app`. **Nada de esto pide el plan de US$5 para probarse.**

## Probar

```bash
# En local (workerd, sin tocar Cloudflare). VIDA_PRUEBA_MS acorta la vida de la sala para probar la alarma.
npx wrangler@4 dev --port 8792 --var VIDA_PRUEBA_MS:4000
node probar.mjs http://127.0.0.1:8792            # unos 40 chequeos; deja dos salas
node probar.mjs http://127.0.0.1:8792 --cupos    # el tope de 5 salas por hora (queda guardado: para repetirlo, otra carpeta con --persist-to o esperar una hora)
node probar.mjs http://127.0.0.1:8792 --tope     # 400 nombres por sala: cinco minutos
```

De punta a punta, con Chrome (desde la raíz del repo): `pnpm build && pnpm preview --port 4391`, `wrangler dev --port 8792 --var VIDA_PRUEBA_MS:600000` y `CDP_PORT=9733 node scripts/probar-sala.mjs --base http://localhost:4391 --sala http://127.0.0.1:8792`. El sitio solo acepta otro servicio con `?sala=` y desde `localhost`.

`VIDA_PRUEBA_MS` solo existe si se pasa con `--var`; en producción no está y la vida es de 10 horas.

## Limitaciones conocidas de esta versión

- En una ronda de ejemplo, el cartel final dice «Salió», pero las tarjetas de los juegos y parte del relato todavía dicen «Gana». Es solo presentación; no cambia nada de lo que se elige.
- El filtro de palabras (`src/sala/filtro.ts`) es una lista corta y corre en la pantalla: no atrapa todo, alguien tiene que mirarla.
- Los nombres repetidos se descartan en la lista canónica de la ronda; las variantes salen marcadas como repetidas.

## Desplegar y encender

Son los pasos, en este orden:

```bash
# 1. El Worker, desde esta carpeta, con la sesión de wrangler login de la cuenta de Tinkazo.
#    s.tinkazo.app es un dominio propio del Worker: el despliegue crea el registro DNS y el certificado.
npx wrangler@4 deploy
# 2. Probarlo contra producción (crea dos salas y las cierra o vencen solas):
node probar.mjs https://s.tinkazo.app
```

Corre en el plan gratis de Workers. Cada dirección puede crear pocas salas por hora (`Cupos`), y si alguna vez hiciera falta cuidar el cupo diario de la cuenta, la regla de límite de Cloudflare delante de `s.tinkazo.app` es lo que sirve.
