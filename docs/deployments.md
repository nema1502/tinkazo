# Despliegues del contrato `tinkazo-raffle`

Registro de cada despliegue. La dirección vigente por red también vive en `src/stellar/deployments.ts`; ambos se actualizan en el mismo commit. El contrato es inmutable: una nueva versión es una nueva fila y una nueva dirección.

| Fecha | Red | Dirección del contrato | Hash del WASM | Commit | Cuenta de despliegue | Notas |
|---|---|---|---|---|---|---|
| — | testnet | pendiente (historia 1.4) | — | — | — | — |
| — | mainnet | pendiente (historia 5.1) | — | — | — | — |

## Costos medidos

| Red | Fecha | `seal` (fee) | `draw` (fee, instrucciones) | Total por sorteo |
|---|---|---|---|---|
| testnet | pendiente | — | — | — |

## Cómo desplegar

```bash
# Identidad de la CLI (vive en ~/.config/stellar o en .stellar/, ambos fuera del repo)
stellar keys generate tinkazo-deployer --network testnet --fund

# Compilar y desplegar
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/tinkazo_raffle.wasm \
  --source-account tinkazo-deployer \
  --network testnet
```

`scripts/deploy.sh <red>` automatiza estos pasos y agrega la fila a esta tabla.

## Redes

| Red | RPC | Passphrase | Protocolo (2026-09-16) |
|---|---|---|---|
| testnet | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` | 28 |
| mainnet | proveedor (ver [directorio de RPC](https://developers.stellar.org/docs/data/apis/rpc/providers)) | `Public Global Stellar Network ; September 2015` | 27 |

Testnet se reinicia trimestralmente: los sorteos de prueba desaparecen y hay que redesplegar.
