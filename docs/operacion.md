# Operación: qué hacer si algo cae

Cómo se nota que una pieza falló y qué tocar. Subir, desplegar y firmar esperan la aprobación de quien mantiene el proyecto. Costos y niveles: [deployments.md](deployments.md). Revisado el 10 de noviembre de 2026.

## RPC de Stellar

**Se nota:** «Sellar» se queda esperando o falla por la red; el detector dice «no se pudo mirar». El RPC de mainnet es de un tercero (`mainnet.sorobanrpc.com`).

1. Probá el reemplazo: `curl -s -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' <url>`. Segundo RPC (los del detector): `https://rpc.lightsail.network` o `https://rpc.ankr.com/stellar_soroban`.
2. Cambiá `RPC_URLS.mainnet` en `src/stellar/config.ts`, `RPC` en `scripts/check-renta.mjs`, `rpcUrls` en `scripts/lib/vigilar-red.mjs` y `MAINNET_RPC` en `scripts/preflight-mainnet.mjs`. Corré `pnpm typecheck` y `pnpm test`, y subí.
3. `RPC_LISTAS` (salto automático al segundo RPC) y `red-umbrales.json` (los números de la red, no URLs) ya están en `main`.

## Pollar (Google y comisión patrocinada)

**Se nota:** falla el ingreso con Google, o el sello de una cuenta sin XLM falla por saldo o por tope.

El patrocinio de comisiones tiene dos vías y solo una paga en cada momento: el portero de comisiones (sección siguiente) o la app de Pollar. **Lo que sigue vale solo mientras pague la app de cuentas de Pollar**; cuando pague el portero, usá su hoja de operación.

- **Tope:** el Max fee de la app en el panel de Pollar corta el patrocinio cuando la tarifa real lo supera: el patrocinio se apaga sin avisar.
- **Saldo:** la billetera patrocinadora de Pollar necesita XLM de sobra; el panel la muestra.
- **Qué hacer:** recargala; subí el Max fee solo si el costo real lo justifica; mientras tanto, entrar con Freighter, que paga con su cuenta.
- **Política si la red no deja sellar** (ya está en `main`): «volver a probar»; después «pagar con mi cuenta» (paga quien organiza); al final «Seguir sin sello», con confirmación y el comprobante marcado como no comprobable en la cadena.

## Portero de comisiones

Servicio propio (`workers/patrocinio`): revisa el pedido de sello del sitio, lo manda como una transacción que paga la comisión con su propia cuenta y lleva los cupos por cuenta y por mes.

**Quién paga ahora:** el portero o Pollar, según cuál esté encendido. Pedile el cupo al servicio con una cuenta de Stellar válida (una mal escrita da `400`): `curl -s "https://p.tinkazo.app/v1/patrocinio/cupo?cuenta=<cuenta>"`. Mirá el campo `rige`, que dice `portero` o `pollar` y se decide primero. Si dice `portero`, mirá también `prendido`: con `false` el portero no está pagando y `motivo` dice por qué (`apagado` o `config`). Hoy esa dirección atiende solo la red de prueba (el campo `red` lo dice).

**Cuándo usa el sitio al portero:** en Prueba, cuando el build trae `VITE_PATROCINIO_URL_TESTNET` (o la vieja `VITE_PATROCINIO_URL`); sin ninguna de las dos, solo en `tinkazo.app` y `www.tinkazo.app`, con `https://p.tinkazo.app`. En Oficial, solo cuando el build trae `VITE_PATROCINIO_URL_MAINNET`: la vieja no vale ahí y no hay dirección por defecto. Sin portero para la red, paga Pollar.

**Se nota:** el sello de una cuenta nueva falla y la respuesta del servicio dice por qué:

- **Cupo de la cuenta en el mes:** `429` con `motivo:"cupo-cuenta"`. El campo `que` dice si se acabaron los `sellos` o los `sorteos`, y `liberaEn` cuándo vuelve (el mes siguiente).
- **Cupo de la dirección en la hora:** `429` con `motivo:"cupo-ip"`. Se reintenta más tarde.
- **Cupo general (el tope de gasto de un día):** `503` con `motivo:"fondo"`, sin `codigo`.
- **Saldo del servicio** (la cuenta del portero quedó sin XLM para pagar comisiones): `503` con `motivo:"fondo"` y un `codigo` con el rechazo de la red.

Si hay que cortar ya: **apagar el servicio** (el pedido «Apagar») o **devolver el pago a Pollar** (el pedido «Devolver el patrocinio a Pollar» y el apartado «Volver a Pollar»); los tres están en la sección «Hoja de operación» del README del portero.

**Qué hacer:** la [Hoja de operación del portero](../workers/patrocinio/README.md#hoja-de-operación) mantiene la única copia de los pedidos completos: encender, apagar, volver a Pollar, cargar fondos y rotar la llave.

## Worker de enlaces (`c.tinkazo.app`)

**Se nota:** un enlace corto no abre (`curl -i https://c.tinkazo.app/v1/<id>`). El sorteo no depende de él: el enlace largo (`tinkazo.app/c/…#clave`) sigue andando y está en Mis sorteos.

**Qué hacer:** si fue un pico, esperar: los cupos diarios (2.000 altas; 100.000 pedidos de la cuenta gratis) se liberan a la medianoche UTC. Si se rompió, en `workers/enlaces`: `npx wrangler@4 deploy` y `ADMIN_TOKEN=… node probar.mjs https://c.tinkazo.app`. Redesplegar también cuando cambia el contrato de mainnet en `deployments.json`. Detalle: [`workers/enlaces/README.md`](../workers/enlaces/README.md).

## drand (la semilla)

**Se nota:** el sorteo queda en «esperando la ronda» y el botón ofrece reintentar. El sitio rota entre cuatro relays (`api.drand.sh`, `api2`, `api3`, `drand.cloudflare.com`) con hasta doce intentos.

**Qué hacer:** `curl -s https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/latest`. Si callan los cuatro, no hay nada que arreglar: la lista ya está sellada, la ronda objetivo es fija y su firma no vence, así que el sorteo se completa después, cuando algún relay conteste. Que quien organiza espere y reintente.

## Renta del contrato

**Se nota:** `pnpm check:renta` sale con error si a la instancia o al código les quedan menos de 30 días. Vencida, el próximo sello restaura pagando la renta.

**Qué hacer**, cada ≈ 60 días (extiende cualquiera; paga quien firma):

```bash
stellar contract extend --id <contrato> --ledgers-to-extend 2073600 --durability persistent --source <cuenta> --network mainnet
stellar contract extend --wasm-hash <sha256 del .wasm> --ledgers-to-extend 2073600 --source <cuenta> --network mainnet
```

2.073.600 ledgers son ≈ 120 días. Volvé a correr `pnpm check:renta`. **Costo de hoy:** ≈ US$0,7 por mes de renta y ≈ US$0,03 por sorteo; si el estado de la red se llena, se multiplica.

## Detector de la red

`vigilar-red.yml` corre `scripts/vigilar-red.mjs` cada media hora; **que la corrida falle es el aviso** (correo de GitHub). Avisa una sola vez por cada cambio de parámetros o de nivel; el rojo falla en cada corrida, y la de las 12:07 UTC (`--diario`) falla también con naranja estable o con la línea base vieja. A mano: `pnpm check:red`. Niveles de mainnet (objetivo 3.000 MB):

- **Amarillo, 2.000 MB:** la renta deja el piso. Mirá la pendiente y las horas hasta el rojo.
- **Naranja, 2.500 MB:** el sello cuesta ≈ 0,5 XLM. Pedí ya que suban el objetivo (SLP y votación, de 13 a 17 días).
- **Rojo, 2.850 MB:** quedan 13 a 19 horas. Al cruzar el objetivo la renta se multiplica y el tope de comisión del pagador corta los sellos: avisá a quien tenga eventos y aplicá la política de la vía que pague (portero o Pollar).

Parámetro cambiado y entendido: `node scripts/vigilar-red.mjs --actualizar-base --red <la red que cambió>` y commit de `scripts/vigilar-red.base.json`; mientras no se actualice, las corridas pasan («línea base vieja: …» en el nombre del paso) y solo la diaria sigue fallando. Si el detector mismo calla, el latido (`HEALTHCHECK_URL`) manda un correo a las 2 horas. El camino paso a paso para cuando cambie mainnet, y el latido: [deployments.md](deployments.md#vigilancia-de-la-red).

## Vercel (el sitio)

**Se nota:** tinkazo.app da error tras una subida. **Qué hacer:** volver a la última versión buena, en el panel (Deployments, «Instant Rollback») o con `vercel rollback <url de esa versión>`. En Hobby solo a la anterior; en Pro, a cualquiera. Después, las subidas nuevas no salen solas hasta promover una (`vercel promote`). Subí el arreglo con la aprobación de quien mantiene el proyecto.

## Dominio tinkazo.app

Registrado en Cloudflare el 16 de octubre de 2026. **Renovarlo por varios años, con renovación automática:** lo hace quien mantiene el proyecto. Si se pierde, mueren los enlaces compartidos (`tinkazo.app/c/…`, `c.tinkazo.app/…` y sus QR), hola@tinkazo.app y los orígenes que aceptan Pollar y el Worker.

## Quién entra a qué

Hoy, solo quien mantiene el proyecto; quien se sume se anota acá, con el nombre del lugar y nunca la llave.

- **Código y CI:** la cuenta de GitHub del proyecto; el único secreto de los workflows es el opcional `HEALTHCHECK_URL`.
- **Sitio:** cuenta de Vercel y la CLI `vercel` de su máquina.
- **Worker, dominio, DNS:** cuenta de Cloudflare y `wrangler login`; el secreto `ADMIN_TOKEN`, en su gestor de contraseñas.
- **Pollar:** su panel; las llaves de la app, en `.env.local` (git la ignora).
- **Contrato:** identidad `tinkazo-deployer` de la CLI de Stellar, en `~/.config/stellar/identity/`, fuera del repo.
- **Latido:** la cuenta de healthchecks.io que cree quien mantiene el proyecto.
