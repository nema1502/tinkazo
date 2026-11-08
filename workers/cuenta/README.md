# La cuenta de Tinkazo: monedas, tiendita y plan del equipo

Un Worker de Cloudflare (`tinkazo-cuenta`, en `cuenta.tinkazo.app`) con un libro en KV, una entrada por cuenta de Stellar. Lleva tres cosas: las **monedas** (puntos), la **tiendita** del stand (canjear monedas por cosas) y el **plan del equipo** (5 USDC, 30 días, que sube el cupo del portero de 20 a 50 sorteos propios por mes). **No está desplegado**: desplegar, crear el KV y el DNS esperan la palabra de quien mantiene el proyecto.

Es un script aparte de los otros (enlaces, portero, sala, música): un error acá no puede tumbarlos.

## Las reglas, fijas

- Las monedas son **puntos**. Se ganan usando Tinkazo. **No se compran directamente, no se transfieren, no se cambian por dinero y nunca compran chances en ningún sorteo.** En el Worker no existe ningún camino que haga nada de eso (hay una prueba que lo mira).
- El dinero es USDC en la cuenta de la persona. Tinkazo no lo guarda. Lo único que se cobra es el plan del equipo, y es un pago común a la cuenta de planes, que el Worker comprueba contra la red antes de activar nada.
- Los números viven en `src/reglas.ts` y los toma de ahí también el sitio: una regla cambia en un solo lugar.

| Se gana | Monedas | Tope por cuenta | Cómo se comprueba |
| --- | --- | --- | --- |
| `primer_sorteo`: su primer sorteo | 20 | 1 | Por la palabra del sitio, y la cuenta tiene que existir en la red |
| `primera_carga`: sus primeros dólares digitales | 50 | 1 | **Por Horizon**: un pago de USDC (del emisor oficial) de 1 o más, de otra cuenta, que no sea un premio ni un cupón de Tinkazo (nota `tk:…`) |
| `plan`: activar el plan del equipo | 50 | 1 | Solo al activar el plan, nunca por pedido |
| `comprobar`: comprobar un resultado | 5 | 5 veces (un mismo resultado, una vez, si manda `ref`) | Por la palabra del sitio, y la cuenta tiene que existir |
| `invitar`: invitar a un equipo que sorteó | 10 | 1 | **Definida, sin evento**: todavía no existe un enlace de invitación. El Worker la rechaza (`400 tipo`) hasta que exista |

## La API

Solo desde `https://tinkazo.app`, `www`, las vistas de Vercel y `localhost` (cabecera `Origin`). Todo en JSON, hasta 512 bytes por pedido, `Cache-Control: no-store`.

| Pedido | Qué hace |
| --- | --- |
| `GET /v1/monedas/<cuenta>` | `{cuenta, saldo, hechos, historial (10), canjes (10), catalogo, plan}`. Una cuenta nueva da saldo 0 y no escribe nada |
| `POST /v1/monedas/<cuenta>/evento` con `{tipo, ref?}` | `200 {acreditado, monedas?, saldo, motivo?}`. `motivo`: `ya`, `tope`, `sin-pago`, `sin-cuenta`. `400 tipo` si no es una regla abierta. `502 red` si Horizon no contesta (nunca acredita sin saber) |
| `POST /v1/monedas/<cuenta>/canje` con `{codigo, id?}` y `Authorization: Bearer <token de quien organiza>` | Descuenta si alcanzan las monedas y anota el canje con la hora. `409 {error:"saldo", saldo, falta}` si no alcanzan. `401` sin token, `403` con uno que no es, `503` si el Worker no tiene huellas cargadas, `400 codigo` si no está en la tiendita |
| `GET /v1/plan/<cuenta>` | `{plan}`: `{inicio, vence, tx}` o `null` |
| `GET /v1/cuenta/<cuenta>/plan` | **Público y de solo lectura** (no pide `Origin`: lo consulta el portero, otro Worker). `{activo:true, vence, cupo:{sellos:50, sorteos:100}}` si el plan está vigente (`vence` en ms, como en el resto de la API), o `{activo:false}` (sin plan, vencido o cuenta que nunca vimos). Un `Cache-Control: public, max-age=30`. `400 cuenta`, `405`, `429 cupo-ip` (6.000 por hora y por dirección, aparte de los otros contadores) y `503 libro` si el KV no contesta. No escribe nada |
| `POST /v1/plan/<cuenta>/activar` | Mira en Horizon los pagos a la cuenta de planes con la nota `tk:plan:<últimos 8 caracteres de la cuenta>` y 5 USDC o más; activa 30 días con el más viejo que no se usó y regala las 50 monedas (una vez). `200 {activado, plan, monedas, saldo}`; `activado:false` con `motivo` `sin-pago` o `ya`; `503` si no hay cuenta de planes |

Los códigos de error y el resto de las formas están en `src/servidor.ts` y en sus pruebas.

### La tiendita

El catálogo sale de la variable `CANJES` (JSON: `[{"codigo","es","en","costo"}]`, hasta 20, costo entero de 1 a 10.000). Si falta o algo no cuadra, vale el de siempre: `chocolate` 20, `stickers` 50, `logo-en-el-show` 100, `nombre-en-el-cartel` 200. El sitio lo lee en `GET /v1/monedas/<cuenta>`, así que cambiar un costo no pide subir el sitio.

**Quién canjea.** Solo quien organiza: el Worker guarda las **huellas SHA-256** de los tokens de organización (secreto `HUELLAS_ORGANIZADORES`, separadas por comas) y compara en tiempo constante. El token nunca está en el navegador de quien participa; quien atiende el stand lo escribe una vez y se recuerda solo en esa pestaña.

```bash
# Un token de organización (se lo guarda quien atiende el stand) y su huella (la que va al Worker)
node -e "const t=require('node:crypto').randomBytes(24).toString('base64url');console.log('token:',t);console.log('huella:',require('node:crypto').createHash('sha256').update(t).digest('hex'))"
npx wrangler@4 secret put HUELLAS_ORGANIZADORES   # una o varias huellas, separadas por comas
```

**Idempotencia.** Cada canje lleva un `id` que manda el aparato de quien organiza. Con el mismo `id` una segunda vez no descuenta: devuelve el canje que ya estaba (`repetido:true`). Así un doble toque, o un reintento porque la respuesta no llegó, no cobra dos veces. Se recuerdan los últimos 30 por cuenta.

### El plan del equipo

5 USDC, 30 días, 50 monedas de regalo (una sola vez por cuenta). No se paga desde Tinkazo ni se firma nada acá: el sitio muestra a qué cuenta pagar (`CUENTA_PLANES`), con qué nota y un QR de pago (SEP-7); la persona paga desde Meru o su billetera. El Worker **vuelve a leer la red por su cuenta** antes de activar:

- la nota tiene que ser exacta (`tk:plan:` y los últimos 8 caracteres de la cuenta de quien compra), el pago de 5 USDC o más, del emisor oficial, exitoso y a la cuenta de planes;
- un pago activa **una sola vez**: la transacción queda anotada en la cuenta (`usadas`) y en una entrada `t:<hash>` que dice a qué cuenta pertenece, así que no sirve para otra;
- repetir "Ya pagué" no vuelve a activar ni a regalar; un segundo pago distinto renueva (suma 30 días al vencimiento si sigue vigente, o desde hoy si venció) y no repite las monedas.

Qué da el plan, hoy:

- queda anotado en la cuenta, con inicio, vencimiento y el enlace a la transacción;
- regala las 50 monedas (una vez);
- **sube el cupo del portero** mientras está vigente: **50 sellos y 100 sorteos por mes** en lugar de 20 y 40 (`PLAN.cupo` en `src/reglas.ts`, el único lugar donde viven esos números). Es lo que el sitio dice: "50 sorteos propios por 30 días (el plan gratis da 20 por mes)". El portero lo averigua con el recurso de abajo y el panel lo refleja solo, porque "Te quedan N sorteos gratis este mes" sale del `/cupo` del portero.

El nombre del equipo en el show sigue figurando como "próximamente" en el sitio, y el logo ya es gratis para todos.

**Un matiz, para no prometer de más.** El portero cuenta por mes calendario (UTC), no por los 30 días del plan: mientras el plan está vigente, el tope de cada mes es 50, y lo que la cuenta ya usó ese mes con el plan gratis cuenta contra ese 50. Un plan que cruza el cambio de mes da hasta 50 en cada mes, así que casi siempre da más de 50 en sus 30 días; solo da menos si se compra a principios de un mes de 31 días después de haber usado sorteos ese mismo mes.

### Lo que consulta el portero

`GET /v1/cuenta/<cuenta>/plan` es el único contrato entre este Worker y `workers/patrocinio`. Contesta solo `activo`, `vence` y `cupo`, nada del saldo ni de los canjes. Lee el KV una vez y no escribe.

```json
{ "activo": true, "vence": 1793000000000, "cupo": { "sellos": 50, "sorteos": 100 } }
{ "activo": false }
```

Del lado del portero (`workers/patrocinio/src/plan.ts`): espera como máximo 1,5 segundos, guarda la respuesta en memoria (5 minutos si hay plan, nunca más allá de `vence`; 1 minuto si no hay) y, ante cualquier falla de este Worker (corte, tiempo, error, respuesta rota), **usa el cupo de siempre y sigue**. El plan solo puede subir un cupo, nunca bajarlo. El portero sabe de este Worker solo por su variable `CUENTA_URL`; vacía, no pregunta nada. Como el KV puede tardar hasta un minuto en verse desde otro lugar, un plan recién activado puede demorar un poco en notarse en el portero.

## Cómo se guarda

KV `CUENTAS`: `c:<cuenta>` con `{saldo, hechos, historial (20), canjes (20), ids, refs, plan}` y `t:<hash>` por cada pago de plan usado. **Una escritura por operación.** Nada de nombres, correos ni IP: solo la dirección pública de la cuenta, que ya es pública en la cadena (los términos lo dicen).

## Límites, y lo que no cuidan

- Por dirección IP y por hora, en memoria (en IPv6, por /64): 240 lecturas, 60 escrituras (eventos y activar plan) y 240 canjes. Si el Worker se reinicia, vuelven a cero, y cada nodo tiene el suyo: es una molestia para el guion torpe, no una defensa.
- **KV no es transaccional.** Dos pedidos a la vez para la misma cuenta y la misma regla pueden acreditar dos veces (el Worker vuelve a leer después de esperar a Horizon para achicar la ventana). Dos canjes a la vez con ids distintos podrían descontar de más o de menos. El riesgo es chico mientras las monedas no valgan dinero y los canjes los haga una persona en el stand. **Si algún día las monedas se gastan en algo que cueste de verdad, hay que pasar el libro a un Durable Object** (el portero ya usa uno).
- **¿Se pueden juntar monedas con cuentas inventadas?** Las reglas por la palabra del sitio (`primer_sorteo`, `comprobar`) exigen que la cuenta exista en la red (en mainnet cuesta al menos 1 XLM de reserva por cuenta) y tienen tope por cuenta. `primera_carga` se puede repetir con el mismo dólar pasando por varias cuentas propias. No importa mientras las monedas solo valgan una cosa del stand; cuando valgan más, mirar de dónde viene el pago.
- El plan gratis de KV tiene **1.000 escrituras por día** y 100.000 lecturas. Un evento de un día entra de sobra; si el uso crece, pasar a Workers Paid.
- **El recurso del plan es público**: cualquiera puede saber si una dirección tiene el plan activo y hasta cuándo. La dirección ya es pública y el pago al Worker de planes también está en la cadena; no hay nombres ni correos. Su tope por dirección (6.000 por hora) es alto a propósito, porque el portero hace todas sus consultas desde la misma dirección; con la caché del portero hace falta una consulta por cuenta cada pocos minutos.
- Para el tope de pedidos de la cuenta de Cloudflare (100.000 por día para todos los Workers del plan gratis), vale lo que dice `workers/enlaces/README.md`.

## Probar y desplegar

```bash
# Las pruebas (sin Cloudflare ni red: libro, Horizon y reloj de mentira)
pnpm exec vitest run workers/cuenta

# En local (workerd), con .dev.vars que no se versiona: RED, CUENTA_PLANES, HUELLAS_ORGANIZADORES
npx wrangler@4 dev --port 8794   # desde esta carpeta; el sitio con VITE_MONEDAS=1 y VITE_CUENTA_URL=http://localhost:8794
```

Para desplegar (con la autorización de quien mantiene el proyecto):

1. `npx wrangler@4 kv namespace create CUENTAS` y pegar el `id` en `wrangler.toml` (hoy dice `PEGAR-ACA-EL-ID-DEL-KV`).
2. En `wrangler.toml`: `RED` (`testnet` o `mainnet`: de qué red se leen los pagos, y con qué USDC) y `CUENTA_PLANES` (la cuenta que cobra el plan, la misma que va en `VITE_CUENTA_PLANES` del sitio). Con `CUENTA_PLANES` vacía, el plan está apagado.
3. `npx wrangler@4 secret put HUELLAS_ORGANIZADORES` (ver arriba). Sin huellas, nadie canjea.
4. `npx wrangler@4 deploy`. `cuenta.tinkazo.app` se crea sola (dominio propio).
5. Para que el plan suba el cupo: cargar `CUENTA_URL = "https://cuenta.tinkazo.app"` en el portero (`workers/patrocinio/wrangler.toml`, ver su README) y volver a desplegarlo. Sin eso el plan sigue anotándose, pero el cupo del portero no cambia. Y comprobarlo con `curl https://cuenta.tinkazo.app/v1/cuenta/<una cuenta con plan>/plan`.
6. Recién después, prender el sitio: `VITE_MONEDAS=1` (monedas, tiendita y canjear), `VITE_RAMPA=meru` (cargá tu saldo) y, solo con el visto bueno escrito, `VITE_PLAN_EQUIPO=1` con `VITE_CUENTA_PLANES`. Las tres nacen apagadas.

Un solo Worker lee una sola red. Para mainnet, un despliegue aparte (o cambiar `RED` y `CUENTA_PLANES`) con su propio KV: los saldos de testnet no pasan a mainnet.
