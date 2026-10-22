# Despliegues del contrato `tinkazo-raffle`

Registro de cada despliegue. La dirección vigente por red también vive en `src/stellar/deployments.json`; ambos se actualizan en el mismo commit. El contrato es inmutable: una nueva versión es una nueva fila y una nueva dirección.

| Fecha | Red | Dirección del contrato | WASM (sha256) | Commit | Cuenta de despliegue | Notas |
|---|---|---|---|---|---|---|
| 2026-09-16 | testnet | `CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH` | `c9f3227ffb92ef04…` (11 688 bytes) | `fd558ce` | `GD6P7XJV…R526` | **Vigente.** Sorteo real `id=1`, ronda 32255926, ganadores `[11, 16, 0]` sobre la lista de `docs/vectors.json` |
| 2026-09-16 | testnet | `CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ` | `6008a5e42ca06079…` | `8c98866` | `GD6P7XJV…R526` | Reemplazado el mismo día: `seal`/`draw` extendían el TTL del código y el primer `seal` cobró 15,27 XLM |
| · | mainnet | pendiente (historia 5.1) | · | · | · | · |

Transacciones del despliegue vigente (testnet, explorables en [stellar.expert](https://stellar.expert/explorer/testnet)):

| Paso | Hash | Fee cobrado |
|---|---|---|
| Subida del WASM | `f7ce8d064af7d10c…` | 9 429 487 stroops = 0,943 XLM (renta mínima de 7 días en testnet) |
| Creación de la instancia | `92e00f8449a9251f…` | 21 285 stroops = 0,002 XLM |
| `seal` (id 1, ronda 32255926) | `468d58a2c9a07044…` | 988 823 stroops = **0,099 XLM** |
| `draw` (verificación BLS + selección) | `39c4fad01488269e…` | 827 191 stroops = **0,083 XLM** |
| `extend` (renta de instancia y código, 7 → 120 días) | `67e9b763fc86706a…` | 151 530 187 stroops = **15,15 XLM** |

## Costos medidos y proyección a mainnet

**Medición del 3 de octubre de 2026 (vigente).** Lo que cobró la red según Horizon, en los sorteos 151, 152, 159 y 160:

| Paso | Fee cobrado | En US$ (XLM a 0,215) |
|---|---|---|
| `seal` | 4 202 000 stroops ≈ **0,42 XLM** | ≈ 0,090 |
| `draw` | 3 433 000 stroops ≈ **0,34 XLM** | ≈ 0,074 |
| **Total por sorteo** | **≈ 0,76 XLM** | **≈ 0,16** |

El contrato es el mismo del 16 de septiembre. Lo que cambió es la renta de testnet: casi todo el fee es alquiler de almacenamiento, y la tarifa la pone la red. Lo de abajo es la medición original, que queda como historia; la proyección a mainnet usa los parámetros de esa fecha y hay que rehacerla al desplegar.


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

# Testnet, para probar: compila acá, despliega y registra la fila en esta tabla
scripts/deploy.sh testnet
```

En mainnet no se compila acá: se despliega el `.wasm` del release que arma GitHub Actions, tal cual. Otro compilador u otra máquina dan otro hash, y ese contrato ya no se puede verificar.

```bash
# 1. Un tag dispara .github/workflows/release.yml: pruebas, compilación, release y atestación
git tag v0.1.0 && git push origin v0.1.0

# 2. Bajar el .wasm del release (el nombre exacto del release sale en el resumen del workflow)
gh release download v0.1.0_tinkazo-raffle_cli28.1.0 --repo nema1502/tinkazo --pattern '*.wasm'
gh attestation verify tinkazo-raffle_v0.1.0.wasm --repo nema1502/tinkazo \
  --signer-repo stellar-expert/soroban-build-workflow

# 3. Desplegarlo. El script no despliega en mainnet un .wasm sin atestación de GitHub,
#    y al final compara el hash de la red con el del archivo.
stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"
scripts/deploy.sh mainnet --wasm tinkazo-raffle_v0.1.0.wasm
```

Antes, pasar las puertas del skill `deploy-stellar-mainnet` (historia 5.1).

## Verificar la compilación

Lo que se puede comprobar es que el `.wasm` que corre en la red salió de un commit público de este repositorio, compilado por GitHub Actions. No dice que el código sea correcto: para eso está el código.

1. **stellar.expert.** La página del contrato muestra «Source code» con el enlace al repositorio y al commit; su API, `https://api.stellar.expert/explorer/public/contract/<C…>`, devuelve `"validation": {"status": "verified", …}`. Lo marca el servicio de StellarExpert, que solo acepta lo compilado por `stellar-expert/soroban-build-workflow`: por eso el release usa ese workflow. La marca va por el hash del `.wasm`, así que vale en testnet y en mainnet para cualquier contrato con esos mismos bytes.
2. **Stellar Lab.** El explorador de contratos de [lab.stellar.org](https://lab.stellar.org) muestra «Verified Build» cuando la atestación de GitHub ([SEP-55](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0055.md)) coincide con el hash y con el repositorio que declara el contrato. No depende de stellar.expert.
3. **stellar-cli.** `stellar contract info build --contract-id <C…> --network mainnet` baja el `.wasm` de la red, lee `source_repo` y busca la atestación: muestra el repositorio, el commit, el workflow y la corrida. Con el archivo: `gh attestation verify <archivo.wasm> --repo nema1502/tinkazo --signer-repo stellar-expert/soroban-build-workflow`.
4. **Recompilarlo.** El `.wasm` guarda con qué se compiló (`stellar contract info meta --wasm <archivo>`: `rsver`, `cliver`). En Linux x86_64, con Rust 1.98.1 (lo fija `rust-toolchain.toml`) y stellar-cli 28.1.0:

```bash
git checkout <commit del release>
stellar contract build --optimize --package tinkazo-raffle --out-dir recompilado \
  --meta source_repo=github:nema1502/tinkazo
sha256sum recompilado/tinkazo_raffle.wasm      # el mismo que el del release
stellar contract fetch --id <C…> --network mainnet --out-file red.wasm
sha256sum red.wasm                              # y el mismo que el de la red
```

El workflow hace esa recompilación en otra máquina en cada release y falla si el hash no coincide. También sube al release el archivo de fuentes con su sha256 (`stellar contract build archive`), el dato que pide [SEP-58](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md) para que un verificador independiente lo recompile. El `.wasm` no lleva los campos de SEP-58 (`bldimg`, `bldopt`, `source_sha256`): el workflow de StellarExpert compila sin contenedor y no deja agregar metadatos propios. SEP-58 admite que esos datos vivan fuera del contrato, en un registro.

### Si StellarExpert no lo marca

Ese servicio es de StellarExpert y no depende de nosotros: entre fines de julio y el 13 de octubre de 2026 no verificó contratos ([soroban-build-workflow#9](https://github.com/stellar-expert/soroban-build-workflow/issues/9)). Si una hora después del release el contrato sigue sin marcar:

1. En la corrida, el paso «Respuesta de StellarExpert» del job «Comprobar el release» dice qué respondió: `{"ok":1}` es que lo recibió.
2. Reintentar con un tag nuevo sobre el mismo commit (por ejemplo `v0.1.0-r2`): compila los mismos bytes, publica otro release y vuelve a avisar.
3. Si aun así no lo marca, abrir un issue en `stellar-expert/soroban-build-workflow` con el hash, el commit y la corrida.

Mientras tanto la prueba sigue en pie: la atestación (caminos 2 y 3) y la recompilación (camino 4) no dependen de stellar.expert.

## Redes

| Red | RPC | Passphrase | Protocolo (2026-10-22) | TTL mínimo persistente |
|---|---|---|---|---|
| testnet | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` | 29 | 7 días |
| mainnet | `https://mainnet.sorobanrpc.com` (o un [proveedor](https://developers.stellar.org/docs/data/apis/rpc/providers)) | `Public Global Stellar Network ; September 2015` | 29 | 120 días |

Testnet se reinicia trimestralmente: los sorteos de prueba desaparecen y hay que redesplegar.
