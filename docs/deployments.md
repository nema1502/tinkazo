# Despliegues del contrato `tinkazo-raffle`

Registro de cada despliegue. La dirección vigente por red también vive en `src/stellar/deployments.json`; ambos se actualizan en el mismo commit. El contrato es inmutable: una nueva versión es una nueva fila y una nueva dirección.

| Fecha | Red | Dirección del contrato | WASM (sha256) | Commit | Cuenta de despliegue | Notas |
|---|---|---|---|---|---|---|
| 2026-09-16 | testnet | `CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH` | `c9f3227ffb92ef04…` (11 688 bytes) | `fd558ce` | `GD6P7XJV…R526` | **Vigente.** Sorteo real `id=1`, ronda 32255926, ganadores `[11, 16, 0]` sobre la lista de `docs/vectors.json` |
| 2026-09-16 | testnet | `CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ` | `6008a5e42ca06079…` | `8c98866` | `GD6P7XJV…R526` | Reemplazado el mismo día: `seal`/`draw` extendían el TTL del código y el primer `seal` cobró 15,27 XLM |
| — | mainnet | pendiente (historia 5.1) | — | — | — | — |

Transacciones del despliegue vigente (testnet, explorables en [stellar.expert](https://stellar.expert/explorer/testnet)):

| Paso | Hash | Fee cobrado |
|---|---|---|
| Subida del WASM | `f7ce8d064af7d10c…` | 9 429 487 stroops = 0,943 XLM (renta mínima de 7 días en testnet) |
| Creación de la instancia | `92e00f8449a9251f…` | 21 285 stroops = 0,002 XLM |
| `seal` (id 1, ronda 32255926) | `468d58a2c9a07044…` | 988 823 stroops = **0,099 XLM** |
| `draw` (verificación BLS + selección) | `39c4fad01488269e…` | 827 191 stroops = **0,083 XLM** |
| `extend` (renta de instancia y código, 7 → 120 días) | `67e9b763fc86706a…` | 151 530 187 stroops = **15,15 XLM** |

## Costos medidos y proyección a mainnet

Testnet y mainnet comparten hoy los parámetros de renta (`fee_write1_kb` 875, `persistent_rent_rate_denominator` 1215). La diferencia es el TTL mínimo de una entrada persistente: **7 días en testnet, 120 días en mainnet** (`min_persistent_ttl` 120 960 vs 2 073 600 ledgers). Por eso en mainnet la subida del WASM paga de entrada la renta de 120 días.

| Concepto | Medido en testnet | Proyección mainnet | En US$ (XLM a 0,196) |
|---|---|---|---|
| Subir el WASM (11,4 KB) | 0,943 XLM por 7 días | **15,86 XLM** por 120 días (simulado el 2026-09-16 contra el RPC de mainnet) | ≈ 3,11 |
| Crear la instancia | 0,002 XLM | ≈ 0,01 XLM | < 0,01 |
| Mantener el contrato vivo (`extend` cada ≈ 60 días) | 15,15 XLM por 113 días | ≈ 0,134 XLM/día ≈ **49 XLM/año** | ≈ 9,6 al año |
| `seal` por sorteo | 0,099 XLM | ≈ 0,10 XLM (la entrada ya nace con 120 días) | ≈ 0,019 |
| `draw` por sorteo | 0,083 XLM | ≈ 0,08 XLM | ≈ 0,016 |
| **Total por sorteo** | **0,18 XLM** | **≈ 0,18 XLM** | **≈ 0,036** |

Notas:
- La verificación BLS es barata: la parte no reembolsable de `draw` (CPU, lectura, tamaño) fue de 29 672 stroops, 0,003 XLM. Es posible gracias a las funciones nativas de BLS12-381 del host, incorporadas por [CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md) en el protocolo 22. Casi todo el fee de `seal` y `draw` es renta de las dos entradas persistentes por 120 días.
- La renta del código depende del tamaño del módulo compilado, no del WASM crudo: un contrato de 11,4 KB paga como si ocupara unos 110 KB. Mantenerlo chico importa.
- `extend` puede llamarlo cualquiera; el mantenedor lo corre cuando el TTL baja de 60 días. Si nadie lo hace y las entradas se archivan, la siguiente transacción las restaura pagando la renta (protocolo 23+).

## Cómo desplegar

```bash
# Identidad de la CLI: se guarda en ~/.config/stellar/identity/ (fuera del repo)
stellar keys generate tinkazo-deployer --network testnet --fund

# Compilar, desplegar y registrar la fila en esta tabla
scripts/deploy.sh testnet
```

Para mainnet, la CLI no trae RPC preconfigurado: `stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"` y luego `scripts/deploy.sh mainnet`. Antes, pasar las puertas del skill `deploy-stellar-mainnet` (historia 5.1).

## Redes

| Red | RPC | Passphrase | Protocolo (2026-09-19) | TTL mínimo persistente |
|---|---|---|---|---|
| testnet | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` | 28 | 7 días |
| mainnet | `https://mainnet.sorobanrpc.com` (o un [proveedor](https://developers.stellar.org/docs/data/apis/rpc/providers)) | `Public Global Stellar Network ; September 2015` | 28 | 120 días |

Testnet se reinicia trimestralmente: los sorteos de prueba desaparecen y hay que redesplegar.
