# Operación: qué hacer si algo cae

Cómo se nota que una pieza falló y qué tocar. Subir, desplegar y firmar esperan el ok de Nicolás. Costos y niveles: [deployments.md](deployments.md). Revisado el 26 de octubre de 2026.

## RPC de Stellar

**Se nota:** «Sellar» se queda esperando o falla por la red; el detector dice «no se pudo mirar». El RPC de mainnet es de un tercero (`mainnet.sorobanrpc.com`).

1. Probá el reemplazo: `curl -s -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' <url>`. Segundo RPC (los del detector): `https://rpc.lightsail.network` o `https://rpc.ankr.com/stellar_soroban`.
2. Cambiá `RPC_URLS.mainnet` en `src/stellar/config.ts`, `RPC` en `scripts/check-renta.mjs`, `rpcUrls` en `scripts/lib/vigilar-red.mjs` y `MAINNET_RPC` en `scripts/preflight-mainnet.mjs`. Corré `pnpm typecheck` y `pnpm test`, y subí.
3. `RPC_LISTAS` (salto automático al segundo RPC) y `red-umbrales.json` (los números de la red, no URLs) vienen en la rama `contingencia-red`.

## Pollar (Google y comisión patrocinada)

**Se nota:** falla el ingreso con Google, o el sello de una cuenta sin XLM falla por saldo o por tope.

- **Tope:** Max fee de la app en el panel de Pollar: 1 XLM en mainnet (100 en testnet). Pollar ofrece unas 3 veces la tarifa: pasado ≈ 0,33 XLM de sello, el patrocinio se apaga sin avisar.
- **Saldo:** la billetera patrocinadora (su dirección, en el panel) necesita XLM de sobra: `node scripts/verificar-patrocinio.mjs --red mainnet --billetera G…`.
- **Qué hacer:** recargala; subí el Max fee solo si el costo real lo justifica; mientras tanto, entrar con Freighter, que paga con su cuenta.
- **Política si la red no deja sellar** (viene en `contingencia-red`): «volver a probar»; después «pagar con mi cuenta» (paga quien organiza); al final «Seguir sin sello», con confirmación y el comprobante marcado como no comprobable en la cadena.

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

`vigilar-red.yml` corre `scripts/vigilar-red.mjs` cada media hora; **que la corrida falle es el aviso** (correo de GitHub). A mano: `pnpm check:red`. Niveles de mainnet (objetivo 3.000 MB):

- **Amarillo, 2.000 MB:** la renta deja el piso. Mirá la pendiente y las horas hasta el rojo.
- **Naranja, 2.500 MB:** el sello cuesta ≈ 0,5 XLM. Pedí ya que suban el objetivo (SLP y votación, de 13 a 17 días).
- **Rojo, 2.850 MB:** quedan 13 a 19 horas. Al cruzar el objetivo la renta se multiplica y el tope de Pollar corta los sellos: avisá a quien tenga eventos y aplicá la política de Pollar.

Parámetro cambiado y entendido: `node scripts/vigilar-red.mjs --actualizar-base` y commit de `scripts/vigilar-red.base.json`. Si el detector mismo calla, el latido (`HEALTHCHECK_URL`) manda un correo a las 2 horas: [deployments.md](deployments.md#vigilancia-de-la-red).

## Vercel (el sitio)

**Se nota:** tinkazo.app da error tras una subida. **Qué hacer:** volver a la última versión buena, en el panel (Deployments, «Instant Rollback») o con `vercel rollback <url de esa versión>`. En Hobby solo a la anterior; en Pro, a cualquiera. Después, las subidas nuevas no salen solas hasta promover una (`vercel promote`). Subí el arreglo con el ok de Nicolás.

## Dominio tinkazo.app

Registrado en Cloudflare el 16 de octubre de 2026. **Renovarlo por varios años, con renovación automática:** lo hace Nicolás. Si se pierde, mueren los enlaces compartidos (`tinkazo.app/c/…`, `c.tinkazo.app/…` y sus QR), hola@tinkazo.app y los orígenes que aceptan Pollar y el Worker.

## Quién entra a qué

Hoy, solo Nicolás; quien se sume se anota acá, con el nombre del lugar y nunca la llave.

- **Código y CI:** cuenta de GitHub `nema1502`; el único secreto de los workflows es el opcional `HEALTHCHECK_URL`.
- **Sitio:** cuenta de Vercel y la CLI `vercel` de su máquina.
- **Worker, dominio, DNS:** cuenta de Cloudflare y `wrangler login`; el secreto `ADMIN_TOKEN`, en su gestor de contraseñas.
- **Pollar:** su panel; las llaves de la app, en `.env.local` (git la ignora).
- **Contrato:** identidad `tinkazo-deployer` de la CLI de Stellar, en `~/.config/stellar/identity/`, fuera del repo.
- **Latido:** la cuenta de healthchecks.io que cree Nicolás.
