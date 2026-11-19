# Despliegues del contrato `tinkazo-raffle`

Registro de cada despliegue. La dirección vigente por red también vive en `src/stellar/deployments.json`; ambos se actualizan en el mismo commit. El contrato es inmutable: una nueva versión es una nueva fila y una nueva dirección.

`deployments.json` es además **la lista oficial**: el contrato vigente de cada red (`contractId`) y los anteriores (`anteriores`), cada uno con el sha256 del `.wasm` que corre (`wasmSha256`). `verificar.html` y `evento.html` solo creen en el registro de uno de esos contratos, y solo si la instancia en la cadena corre ese `.wasm` (`src/stellar/oficiales.ts` y `src/stellar/registro.ts`, desde el 22 de octubre de 2026). Un contrato reemplazado pasa a `anteriores` y no se borra nunca: los comprobantes que se anclaron en él siguen verificando. Pasa con `ultimoId`, el último número que dio mientras era el del sitio: el contrato no tiene dueño y sigue aceptando sellos de cualquiera, y lo que se selle en él después no es un sorteo de Tinkazo (un anterior sin `ultimoId` no se acepta). Lo mismo cuando el sello se verifica por el historial de transacciones (cuando el estado del contrato ya venció, `src/stellar/historial.ts`): la transacción de un sello no trae el número del sorteo, así que el tope es otro, `ultimoLedger`, el `sealed_ledger` del sorteo `ultimoId`; lo que cae en un ledger posterior da rojo, y un anterior sin `ultimoLedger` no se acepta por historial. Se calcula al reemplazar un contrato, con `get_raffle(ultimoId).sealed_ledger` por simulación de solo lectura, y se cruza buscando en Horizon la transacción de ese `seal` (su `ledger` tiene que ser el mismo). Un contrato que no esté en la lista da rojo, aunque sea un despliegue legítimo del mismo código: por eso cada despliegue nuevo se agrega ahí en el mismo commit, con su `wasmSha256`. Mis sorteos (`src/ui/history.ts`) también lee todos los contratos de la lista, el vigente y los anteriores hasta su `ultimoId`: si no, los sorteos hechos antes de un cambio de contrato desaparecían del historial de otro equipo (el número de sorteo arranca en 1 en cada contrato, así que cada sello guarda también la dirección del suyo).

| Fecha | Red | Dirección del contrato | WASM (sha256) | Commit | Cuenta de despliegue | Notas |
|---|---|---|---|---|---|---|
| 2026-10-25 | testnet | `CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A` | `c2403e081fc2d91e…` (11 687 bytes) | `cf07189` | `GD6P7XJV…R526` | **Vigente.** Entradas de 7 días (`TTL_ENTRADA_*`, solo testnet). Medición y transacciones abajo. |
| 2026-09-16 | testnet | `CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH` | `c9f3227ffb92ef04…` (11 688 bytes) | `fd558ce` | `GD6P7XJV…R526` | Reemplazado el 25 de octubre (sus entradas duraban 120 días). Sigue en `anteriores` con `ultimoId` 936 y `ultimoLedger` 5381472 (la transacción `b5075505…`, cerrada el 25 de octubre de 2026 a las 12:22:27 UTC; `next_id` del contrato: 937). Sorteo real `id=1`, ronda 32255926, ganadores `[11, 16, 0]` sobre la lista de `docs/vectors.json` |
| 2026-09-16 | testnet | `CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ` | `6008a5e42ca06079…` | `8c98866` | `GD6P7XJV…R526` | Reemplazado el mismo día: `seal`/`draw` extendían el TTL del código y el primer `seal` cobró 15,27 XLM. Sigue en `anteriores` de `deployments.json` con `ultimoId` 1 y `ultimoLedger` 4709441 (tiene un sorteo, el `id=1`, la transacción `2d6b998c…`; `next_id` del contrato: 2) |
| 2026-11-11 | mainnet | `CANQLUVTYYZWHT2L75VDW27CWU2LKWB6EBK2AHSMHGIDRC5XSF2EVL3K` | `555c5a3810e284f4ae5c8b973ea9f1ed4dbda96bce4507865875acd1b6aa03c3` | 641e083 | `GA354A…VTQQ` | 11737 bytes |

Transacciones del despliegue del 16 de septiembre (`CD2SSHBU…`, testnet, explorables en [stellar.expert](https://stellar.expert/explorer/testnet)):

| Paso | Hash | Fee cobrado |
|---|---|---|
| Subida del WASM | `f7ce8d064af7d10c…` | 9 429 487 stroops = 0,943 XLM (renta mínima de 7 días en testnet) |
| Creación de la instancia | `92e00f8449a9251f…` | 21 285 stroops = 0,002 XLM |
| `seal` (id 1, ronda 32255926) | `468d58a2c9a07044…` | 988 823 stroops = **0,099 XLM** |
| `draw` (verificación BLS + selección) | `39c4fad01488269e…` | 827 191 stroops = **0,083 XLM** |
| `extend` (renta de instancia y código, 7 → 120 días) | `67e9b763fc86706a…` | 151 530 187 stroops = **15,15 XLM** |

## Versión 0.2.0, la de mainnet

La versión 0.2.0 del paquete (`contracts/raffle/Cargo.toml`) cambia dos cosas respecto del tag `v0.1.0`: el tope de ganadores sube de 32 a 300 (`MAX_WINNERS`) y las entradas del sorteo (`Raffle`, `Draw`) se renuevan con su propio umbral: cuando les quedan menos de 30 días, `seal`, `draw` y `extend` las dejan en 120 (`TTL_ENTRADA_THRESHOLD` y `TTL_ENTRADA_EXTEND_TO`; el `v0.1.0` usaba 60 y 120, y la variante de testnet del 25 de octubre, 2 y 7). El umbral de 30 es lo que queda de los 120 después de los 90 días que el contrato de premios lee un sorteo desde su `draw`: hasta ahí nadie tiene que renovar nada. Una prueba (`las_entradas_del_sorteo_viven_120_dias_y_extend_las_renueva_bajo_los_30`) comprueba que nacen con 120, que a los 89 días `extend` no las toca y que a los 91 las vuelve a dejar en 120.

La 0.2.0 renueva las entradas a 120 días en cualquier red. **En mainnet el costo medido no cambia**: la red crea toda entrada persistente nueva con su mínimo, que ya son 120 días (`min_persistent_ttl` de 2.073.600 ledgers, en `scripts/vigilar-red.base.json`), así que `seal` y `draw` ya pagaban la renta de 120 días, y el pedido de la 0.2.0 no hace nada al nacer la entrada (le quedan 120, sobre el umbral de 30). Las proyecciones de abajo (0,178 XLM por un sorteo de tres ganadores, 0,331 con 100 y 0,647 con 300) salen de esa renta y siguen valiendo. En testnet sí cambiaría: el mínimo es de 7 días, y el mismo pedido subiría cada entrada a 120 y pagaría unas 17 veces más renta, que es justo lo que la variante del 25 de octubre evitaba.

El paquete está en 0.2.0 porque el workflow de StellarExpert nombra el `.wasm` y el release con la versión del paquete: con el tag `v0.2.0` salen el release `v0.2.0_tinkazo-raffle_cli28.1.0` y el archivo `tinkazo-raffle_v0.2.0.wasm`. Con un tag que no coincida con la versión del paquete, el nombre del release agrega `_pkg<versión>`.

## Costos medidos y proyección a mainnet

**El despliegue en mainnet del 11 de noviembre de 2026** (`CANQLUVTYYZWHT2L75VDW27CWU2LKWB6EBK2AHSMHGIDRC5XSF2EVL3K`, la fila de mainnet de arriba), con el `.wasm` de 11.737 bytes del release `v0.2.0_tinkazo-raffle_cli28.1.0`, compilado en el commit `641e083`:

| Paso | Simulado | Cobrado |
|---|---|---|
| Subir el código | **16,3822 XLM** (simulación de solo lectura contra `https://mainnet.sorobanrpc.com`, el 10 de noviembre a las 23:51 de Bolivia, 03:51 UTC del 11) | **14,2453 XLM** (transacción `56ba56b0f79a685be9eb1fa612f34365a249135e73382ea4e7d1acf08a917205`, el 11 de noviembre a las 04:51 de Bolivia, 08:51 UTC) |
| Crear la instancia | 0,0209 XLM (la simulación de la CLI al enviar) | 0,0178 XLM (transacción `6dac74fe9905744be64f351f862f02928a8c577e6371ab0204e4c5b34cff452d`) |
| **Total** | | **14,2631 XLM** |

El estado de la red a esa hora: 1.608,0 de 3.000 MB (53,6 % del objetivo), bajando 2,70 MB por hora, en el protocolo 29. Está bajo los 2.000 MB, así que la renta por KB sigue en el piso y las proyecciones de abajo valen sin multiplicar. La cuenta de despliegue solo paga: el contrato no tiene administrador ni se actualiza.

**Medición del 3 de octubre de 2026 (vigente).** Lo que cobró la red según Horizon, en los sorteos 151, 152, 159 y 160:

| Paso | Fee cobrado | En US$ (XLM a 0,215) |
|---|---|---|
| `seal` | 4 202 000 stroops ≈ **0,42 XLM** | ≈ 0,090 |
| `draw` | 3 433 000 stroops ≈ **0,34 XLM** | ≈ 0,074 |
| **Total por sorteo** | **≈ 0,76 XLM** | **≈ 0,16** |

El contrato es el mismo del 16 de septiembre. Lo que cambió es la renta de testnet: casi todo el fee es alquiler de almacenamiento, y la tarifa la pone la red. Lo de abajo es la medición original, que queda como historia; la proyección a mainnet usa los parámetros de esa fecha y hay que rehacerla al desplegar.


Testnet y mainnet comparten los parámetros de renta (al 4 de noviembre de 2026, `fee_write1_kb` 437, `persistent_rent_rate_denominator` 1215). La diferencia es el TTL mínimo de una entrada persistente: **7 días en testnet, 120 días en mainnet** (`min_persistent_ttl` 120 960 vs 2 073 600 ledgers). Por eso en mainnet la subida del WASM paga de entrada la renta de 120 días.

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

## Costo según la cantidad de ganadores

**Medido y proyectado el 6 de noviembre de 2026**, para subir `MAX_WINNERS` de 32 a 300 en la versión que vaya a mainnet. Las filas de 3, 32, 50 y 100 se midieron con el tope en 100 (rama `sorteo-100-ganadores`); el tope quedó en 300 y las filas de 300 se midieron y proyectaron después con el mismo método. Nada se envió a ninguna red: lo de testnet y de mainnet son simulaciones de solo lectura. La selección, la serialización y el hash no cambian; es solo el tope.

**Qué crece con los ganadores y qué no.** El sello (`seal`) cuesta lo mismo con 3 que con 300 ganadores: la entrada `Raffle` guarda la cantidad, no la lista. El sorteo (`draw`) crece por dos cosas: la entrada `Draw` guarda la lista de ganadores (8 bytes por ganador) y su renta por 120 días, y el evento `Drawn` la repite. La cantidad de participantes casi no pesa: en la cadena solo va la huella de la lista. Lo único que depende de los participantes es cuántos hashes hace la selección: con muchos más participantes que ganadores son pocos más que `k`, y con `k = participantes` (el «modo orden», una permutación completa) son unos `k · H(k)`: unos 519 con 100 y unos 1.885 con 300 (con 100, en 3.000 pruebas con semillas al azar, de unos 290 a 1.200).

**1. En local, con el presupuesto de Soroban** (`cargo test -p tinkazo-raffle costo -- --nocapture`; con `TINKAZO_WASM=<archivo.wasm>` el contrato corre en la máquina virtual, que es lo que paga la red; el `.wasm` es el de `stellar contract build --optimize`, 11.687 bytes, los mismos que el desplegado, con otra constante). El límite de la red es de 400 millones de instrucciones y 40 MiB de memoria por transacción; la prueba exige quedar bajo la cuarta parte de los dos.

| Ganadores | Participantes | Instrucciones | % del límite | Memoria | Entrada `Draw` (bytes XDR) | Bytes escritos | Evento (bytes) |
|---|---|---|---|---|---|---|---|
| 3 | 18 o 1.000 | 27.387.766 | 6,8 % | 1,39 MB | 316 | 888 | 232 |
| 32 | 32 | 29.142.805 | 7,3 % | 1,44 MB | 548 | 1.120 | 464 |
| 32 | 1.000 | 27.889.872 | 7,0 % | 1,41 MB | 548 | 1.120 | 464 |
| 50 | 50 | 30.061.432 | 7,5 % | 1,47 MB | 692 | 1.264 | 608 |
| 50 | 1.000 | 28.233.015 | 7,1 % | 1,42 MB | 692 | 1.264 | 608 |
| 100 | 100 | 34.609.484 | 8,7 % | 1,60 MB | 1.092 | 1.664 | 1.008 |
| 100 | 1.000 | 29.152.733 | 7,3 % | 1,48 MB | 1.092 | 1.664 | 1.008 |
| **300** | **300** | **58.254.896** | **14,6 %** | 2,24 MB | **2.692** | 3.264 | 2.608 |
| 300 | 1.000 | 36.733.236 | 9,2 % | 1,93 MB | 2.692 | 3.264 | 2.608 |

Las filas de 300 se midieron con el `.wasm` de esta versión (20.656 bytes, optimizado con `stellar contract optimize`), que en las filas que se pueden comparar (3, 32 y 50 ganadores) da entre 0,2 y 4,9 % más instrucciones que el de 11.687 bytes de las filas de arriba.
`seal` en la máquina virtual: 524.529 instrucciones y 700 bytes escritos, con 3 o con 100 ganadores (537.032 y los mismos 700 bytes, con 3 o con 300, en el `.wasm` de las filas de 300). Con 100 de 100, la peor de 300 semillas (`peor_semilla_de_la_seleccion_con_el_tope_de_ganadores`) hace la selección en 10,4 millones de instrucciones, contra 4,8 de la semilla real: el sorteo entero queda en unos 40 millones (10 % del límite), todavía bajo la cuarta parte. Con 300 de 300 y el contrato como Rust nativo, la semilla real hace la selección en 13,5 millones y la peor de las 300 semillas en 33,2: el sorteo entero queda en 40,3 millones con la real y en 60,0 con la peor (15 % del límite), todavía bajo la cuarta parte. La peor semilla no se midió en la máquina virtual.

**2. Simulación en testnet con el contrato vigente** (`CDNWNY26…KYV3A`, tope 32, ledger 5.587.025 a 5.587.032, protocolo 30). Para `seal` con 3 y con 32 ganadores el fee es el mismo; con 33, 50 y 100 el contrato responde `Error(Contract, #4)` (`BadWinnerCount`), que prueba que el tope viejo vive en la red. Para `draw` se simuló sobre cuatro sorteos de ese contrato que seguían sin sortear, con su ronda de drand ya publicada (la firma salió de `api.drand.sh`). Con 50, 100 y 300 ganadores no hay forma de simular en la red hasta desplegar la versión nueva, así que esos salen del ajuste de abajo.

| Paso | Ganadores (participantes) | Fee simulado (stroops) | En XLM | Instrucciones | Bytes escritos | Renta y escritura del TTL |
|---|---|---|---|---|---|---|
| `seal` | 3 o 32 | 66.429 | 0,0066 | 695.647 | 632 | 60.943 |
| `draw` | 1 (18) | 64.953 | 0,0065 | 28.626.865 | 876 | 51.007 |
| `draw` | 2 (18) | 65.900 | 0,0066 | 28.646.046 | 884 | 51.926 |
| `draw` | 12 (40) | 75.391 | 0,0075 | 28.883.296 | 944 | 61.125 |
| `draw` | 32 (40) | 94.530 | 0,0095 | 29.826.379 | 1.104 | 79.522 |

Esta es la renta de 7 días de testnet, y el fee de `draw` queda en una recta exacta de la forma `5.934 + 114,98 · S` stroops de renta (con `S` los bytes de la entrada `Draw`, 392 con un ganador y 8 más por cada uno), que pasa por los cuatro puntos sin error. El resto del fee es fijo o casi: instrucciones (≈ 3 stroops cada 10.000), 2.500 por las dos entradas escritas, 1.831 + 124 por el tamaño de la transacción (624 bytes) y 2.500 por KB de eventos.

**3. Testnet y mainnet comparten los parámetros de fee y de renta** (testnet ya está en el protocolo 30 y mainnet sigue en el 29; el detector no registra cambios al 6 de noviembre desde la línea base del 4): la diferencia es el TTL mínimo de una entrada persistente, 7 días contra 120. La razón de las rentas se midió simulando la subida del mismo `.wasm` (11.687 bytes) en los dos RPC: 0,959 XLM en testnet y **16,373 XLM en mainnet** (la renta, sin la parte fija, sale 17,129 veces mayor; 120 sobre 7 da 17,143, menos de 0,1 % de diferencia). Y la renta por KB es la misma en las dos, el piso de 1.000 stroops, porque el estado vivo está bajo 2/3 del objetivo (testnet 4.417 de 7.000 MB, 63 %; mainnet 1.672 de 3.000 MB, 56 %). Con eso, mainnet = lo fijo + 17,129 veces lo que depende del tamaño de la entrada. Como control, la misma cuenta da para tres ganadores 0,0954 de `seal` y 0,0824 de `draw`, que coinciden con los 0,10 y 0,08 de la proyección del 16 de septiembre. En mainnet las entradas nacen con 120 días por el mínimo de la red, y la 0.2.0 también pide 120 (`TTL_ENTRADA_*`): el pedido no agrega costo allá.

| Ganadores (participantes) | `draw` testnet (7 días) | `draw` mainnet (120 días) | `seal` + `draw` mainnet | En US$ (XLM a 0,196) |
|---|---|---|---|---|
| 3 (18) | 0,0067 | 0,0824 | **0,178 XLM** | ≈ 0,035 |
| 32 (32) | 0,0095 (medido) | 0,1282 | **0,224 XLM** | ≈ 0,044 |
| 50 (50) | 0,0112 | 0,1566 | **0,252 XLM** | ≈ 0,049 |
| 100 (100) | 0,0161 | 0,2356 | 0,331 XLM | ≈ 0,065 |
| 100 (1.000) | 0,0159 | 0,2355 | 0,331 XLM | ≈ 0,065 |
| 300 (300) | 0,0355 | 0,5515 | **0,647 XLM** | ≈ 0,127 |

`seal` vale 0,0066 XLM en testnet (medido) y 0,0954 en mainnet (proyectado). Con 100 ganadores el sorteo cuesta cerca de 2,9 veces el de tres y el par completo 1,9 veces; de los 0,2356 XLM del `draw`, 0,2338 son renta de la entrada `Draw` por 120 días. Las filas de 300 salen de seguir esa recta (el `draw` crece 0,00158 XLM por ganador en mainnet y 0,000097 en testnet, la misma pendiente entre 3, 32, 50 y 100): con 300 ganadores el par completo cuesta 3,6 veces el de tres. Instrucciones y memoria casi no cuentan en el fee (36 millones de instrucciones son 0,0011 XLM).

**Si el estado de mainnet sube, el costo se multiplica, y con muchos ganadores se nota antes.** La renta por KB sale del piso al pasar 2/3 del objetivo (2.000 MB) y llega a ×10 en el objetivo (3.000 MB). Mismos datos que arriba, con la renta de cada nivel:

| Estado de mainnet | Renta por KB | 3 ganadores, `seal` + `draw` | 100 ganadores, solo `draw` | 100 ganadores, `seal` + `draw` | 300 ganadores, solo `draw` | 300 ganadores, `seal` + `draw` |
|---|---|---|---|---|---|---|
| hasta 2.000 MB (1.608 el 11 de noviembre de 2026) | ×1,0 | 0,178 XLM | 0,236 XLM | 0,331 XLM | 0,551 XLM | 0,647 XLM |
| 2.250 MB | ×3,25 | 0,571 | 0,760 | 1,068 | 1,786 | 2,094 |
| 2.500 MB (naranja) | ×5,5 | 0,963 | 1,285 | 1,804 | 3,020 | 3,539 |
| 3.000 MB (el objetivo) | ×10 | 1,749 | 2,334 | 3,278 | 5,489 | 6,433 |

El `draw` de muchos ganadores es el primero que cruza el tope de comisión por transacción del pagador de ese momento (el portero de comisiones o Pollar, según cuál esté encendido, ver [operacion.md](operacion.md)). En mainnet, la comisión de las cuentas que entran con Google la paga Pollar, con un tope de 2 XLM por transacción desde el 11 de noviembre de 2026 (antes era de 100): el `draw` de 100 ganadores lo cruza hacia los 2.840 MB y el de 300, hacia los 2.290 MB. Con el tope de 1 XLM del portero (`TOPE_TX_STROOPS`, que hoy atiende solo la red de prueba), serían hacia los 2.360 y los 2.090 MB. Con tres ganadores ningún tope se toca antes del objetivo. El 11 de noviembre de 2026 el estado bajaba 2,70 MB por hora, así que a ese ritmo ningún cruce tiene fecha; la pendiente la sigue el detector (`pnpm check:red`, niveles de arriba).

## Vigilancia de la red

El costo de guardar datos en Soroban lo pone la red, y la red lo cambia sin avisar. El 25 de octubre de 2026 el sello de testnet pasó de 0,7 a 69 XLM porque el estado vivo cruzó su objetivo (`soroban_state_target_size_bytes`, 4.000 MB), y a las 13:34 la SDF subió ese objetivo a 7.000 MB sin anunciarlo en ningún lado. La renta por KB depende del promedio del estado frente al objetivo: piso hasta 2/3 del objetivo, ×10 al 100 %, ×1.360 al 101 %.

`.github/workflows/vigilar-red.yml` corre `scripts/vigilar-red.mjs` cada media hora (minutos 13 y 43) y una vez al día (12:07 UTC), sin secretos y sin depender de ninguna laptop. Solo lee de los RPC públicos. Si hay algo nuevo, la corrida falla, y GitHub avisa por correo a quien editó el `cron` por última vez.

| Qué mira | Cómo | Cuándo falla |
|---|---|---|
| Los 17 parámetros de costo de Soroban y el protocolo, en las dos redes | Contra `scripts/vigilar-red.base.json` | La primera vez que ve un cambio: nombra el parámetro, los tres primeros campos (con el nombre del tipo de costo; el resto queda en «y N más»), el antes y el ahora, y en qué ledger cambió. Después pasa (queda en el nombre del paso) hasta que la red cambie otra vez, y en ese aviso dice qué cambió desde el último; la corrida diaria sigue fallando mientras la base esté vieja |
| El estado vivo: el promedio de la ventana de 30 muestras, que es lo que paga la renta | Contra los niveles de abajo: mainnet desde 2.000 MB, testnet desde 6.000 MB | Cuando el nivel cambia o es rojo (ver abajo) |
| La pendiente de 24 horas y las horas hasta el rojo | El promedio de hoy contra el del ledger de hace un día (`getLedgers` guarda 7 días) | Nunca: es información. La de 3 horas engaña, porque el estado crece en sierra |

Niveles de mainnet (objetivo 3.000 MB). Testnet tiene uno solo, rojo a 6.000 MB (objetivo 7.000 MB):

- **Amarillo, 2.000 MB** (2/3 del objetivo): la renta deja el piso. Mirar la pendiente.
- **Naranja, 2.500 MB:** el sello ya cuesta ≈ 0,5 XLM. Pedir ya que suban el objetivo: en mainnet exige un SLP y una votación, de 13 a 17 días desde la propuesta.
- **Rojo, 2.850 MB** (95 %): quedan 150 MB, de 13 a 19 horas al ritmo más alto de la semana. Al cruzar el objetivo la renta se multiplica y el tope de comisión del pagador corta los sellos.

El rojo nunca pasa del 95 % del objetivo vigente: si la red baja el objetivo, el aviso baja con él. Los niveles están en `src/stellar/red-umbrales.json`, compartidos con la app (que decide con ellos antes de sellar, en `src/stellar/chequeo-red.ts`); si el objetivo sube de verdad, hay que revisarlos.

**Cuándo falla la corrida** (y manda el correo), en tres líneas, para que el correo no se vuelva ruido:

- **Algo cambió, y se avisa una sola vez por cada cambio:** un parámetro de costo o el protocolo distinto de la línea base, **la primera vez que se ve ese estado de la red** (si la red cambia otra vez, avisa de nuevo y dice qué parámetros cambiaron desde el último aviso); o el nivel de alguna red respecto de la corrida anterior, hacia arriba o hacia abajo (ninguno → amarillo, amarillo → naranja, naranja → amarillo, amarillo → ninguno). **La excepción es el rojo, que falla en cada corrida.**
- **Recordatorio diario:** a las 12:07 UTC la corrida va con `--diario` y falla también si una red sigue en naranja (aunque no se haya movido), o si la línea base sigue vieja (aunque no haya cambiado nada). Puede caer poco después de un aviso, por ejemplo uno de las 11:43 y el recordatorio de las 12:07, a 24 minutos: se acepta.
- **No se pudo mirar** una red tras los reintentos: mainnet prueba `mainnet.sorobanrpc.com`, después `rpc.lightsail.network` y después `rpc.ankr.com` (de la lista de proveedores de la documentación de Stellar); testnet, solo el de la SDF.

El mismo nivel que antes (amarillo o naranja estables) pasa con código 0 y queda en la primera línea del log y en el nombre del paso, siempre con testnet primero («Nivel: testnet normal · mainnet amarillo (igual que antes)»). **Un cambio de parámetros avisa igual, una sola vez:** la primera corrida que ve un estado de la red distinto de la línea base falla (ese es el correo) y guarda su huella; las siguientes, con la misma huella, pasan y lo dicen en el nombre del paso («Nivel: testnet normal · mainnet normal · línea base vieja: testnet, contract_cost_params_cpu_instructions»); si la red vuelve a cambiar, la huella es otra y avisa de nuevo; y la corrida diaria de las 12:07 UTC sigue fallando mientras la base esté vieja, como recordatorio.

Lo que ya se avisó vive en la caché de Actions (clave rodante `vigilar-red-<corrida>`), en un archivo de una línea: el nivel de cada red y, por cada red con la línea base vieja, lo que se avisó: la huella del estado de la red (el sha256 de los 17 parámetros y el protocolo), la de la línea base contra la que se avisó y la de cada parámetro, para decir cuáles cambiaron entre un aviso y el siguiente. Se guarda aunque la corrida falle, y una red que no se pudo mirar o que no tiene línea base conserva lo de antes. Se olvida solo cuando la huella de la base cambia, es decir, cuando alguien commiteó una base nueva. Si la red coincide con la base una sola corrida (un RPC atrasado) o vuelve atrás de verdad, la entrada se queda: es inofensiva hasta la próxima base, y evita un segundo correo por el mismo estado. Sin caché, el nivel es «normal» y nada se avisó, y a mano, sin `--anterior`, cualquier nivel y cualquier cambio cuentan como nuevos. Códigos de salida: **0** sin novedades, **1** alarma, **2** no se pudo mirar o falta la línea base; los dos últimos hacen fallar la corrida.

**Cuando el cambio es legítimo** (la red cambió un parámetro y ya se entendió qué hace), se guarda lo de hoy como línea base y se commitea:

```bash
node scripts/vigilar-red.mjs                                    # qué cambió (también: pnpm check:red; --json para una línea de JSON)
node scripts/vigilar-red.mjs --actualizar-base [--red testnet]  # imprime el cambio contra la anterior y reescribe la línea base
git add scripts/vigilar-red.base.json && git commit
```

Mientras no se actualice, solo la corrida diaria sigue fallando; las demás pasan, porque el cambio ya se avisó. Cuando testnet se reinicia (cada tres meses) casi todo cambia: se actualiza su línea base con `--actualizar-base --red testnet`. GitHub desactiva los workflows programados de un repositorio público tras 60 días sin actividad, y las corridas programadas pueden demorarse cuando la plataforma está cargada.

**Mainnet recibió esa recalibración el 4 de noviembre de 2026** (ledger 65.305.114, protocolo 29 todavía): los mismos nueve valores que testnet, ahora iguales en las dos redes; la línea base de mainnet la tomó ese día. Ninguno es de `draw`, y la simulación del `draw` en testnet da 28,6 millones de instrucciones, un 7 % del límite de 400 millones por transacción.

**El camino cuando mainnet cambie** es el que se siguió con testnet el 26 de octubre de 2026. Según la SDF (anuncio en el canal #announcements del Discord de Stellar Developers, 26 de octubre de 2026), fue una recalibración menor del costo de instrucciones de algunas funciones del host, sobre todo criptográficas, y mainnet la recibe en un par de semanas. En la cadena (ledger 5.402.084) cambiaron diez valores de `contract_cost_params_cpu_instructions`. El protocolo 30 llega a testnet el 3 de noviembre y a mainnet el 23, y con él cambia `protocol_version`; no es solo eso, ver el paso 2. Siempre igual:

1. Llega **un** correo de GitHub, la corrida «Vigilar la red de Stellar» fallida, con «PARÁMETROS CAMBIADOS» en el nombre del paso «Nivel: …» y, en la anotación, el comando que actualiza la base de esa red. El log muestra los tres primeros campos de cada parámetro y «y N más»; `node scripts/vigilar-red.mjs --red mainnet --json` muestra todo (cada campo con su nombre, el antes, el ahora y el ledger). Las corridas de media hora siguientes pasan y dicen «línea base vieja: mainnet, …»; la diaria de las 12:07 UTC lo recuerda con otro correo.
2. Entender qué cambió. En `contract_cost_params_cpu_instructions` y en `contract_cost_params_memory_bytes`, cada campo lleva el nombre de su tipo de costo (`cpu[10] verifyEd25519Sig.const_term`); los nombres están en `scripts/lib/tipos-de-costo.mjs`, los 86 del protocolo 29. Lo que importa es que no cambie ninguno de los que usa `draw` (`contracts/raffle/src/drand.rs`): `computeSha256Hash`, `bls12381HashToG1`, `bls12381Pairing`, `bls12381DecodeFp`, `bls12381EncodeFp` y las cuatro comprobaciones de puntos de G1 y G2 (`bls12381G1CheckPointOnCurve`, `bls12381G1CheckPointInSubgroup`, `bls12381G2CheckPointOnCurve` y `bls12381G2CheckPointInSubgroup`). El 26 de octubre cambiaron `verifyEd25519Sig`, `computeEd25519PubKey`, `int256Mul`, `int256Pow`, `int256Shift`, `bls12381G1Mul`, `bls12381G2Mul`, `bn254G1Mul` y `bn254G1ProjectiveToAffine`: ninguno es de `draw`. Si cambia alguno de los de `draw`, antes de aceptarlo hay que volver a medir lo que cuesta (sección «Costos medidos y proyección a mainnet»). Con el protocolo 30 hay que revisar además dos cosas: si trae ajustes de configuración nuevos (un id por encima de `MAX_SETTING_ID`, hoy 20, en `scripts/lib/vigilar-red.mjs`: hay que subir ese número para que el detector los lea) y si las listas de costo suman tipos (los nuevos salen con el número hasta regenerar la lista de nombres, con el comando que está en `tipos-de-costo.mjs`). El aviso de `protocol_version` no trae ledger: no es un ajuste de configuración.
3. Guardar lo de hoy de esa red como línea base y revisar el diff: tienen que estar solo los parámetros del aviso y ninguno más (y la fecha de `updated`).
4. Commitear solo `scripts/vigilar-red.base.json`, por ejemplo «La línea base del detector toma la recalibración de mainnet del …», y subirlo a `main`, con el ok que pide [operacion.md](operacion.md): el workflow programado solo lee `main`, así que hasta entonces el aviso sigue, el recordatorio diario incluido.
5. La corrida siguiente a la subida ya no ve diferencias: no avisa, no recuerda y se olvida lo avisado (cambió la huella de la base). Si la red cambia otra vez antes de actualizar la base, avisa de nuevo.

```bash
node scripts/vigilar-red.mjs --red mainnet --json              # paso 1: todo lo que cambió, sin cortar
node scripts/vigilar-red.mjs --actualizar-base --red mainnet   # paso 3: imprime el cambio y reescribe la línea base
git diff scripts/vigilar-red.base.json                         # solo los parámetros del aviso y la fecha
git add scripts/vigilar-red.base.json && git commit            # paso 4
```

**Latido.** Si el detector mismo calla (el cron se saltea o GitHub desactiva el workflow) no llega ningún correo: por eso el último paso de `vigilar-red.yml` hace `curl` a la dirección del secreto `HEALTHCHECK_URL`, también cuando la corrida falla; sin el secreto no hace nada.
En healthchecks.io el chequeo va con período de 30 minutos y gracia de 90, para que mande un correo si pasan 2 horas sin latido; el secreto se carga con `gh secret set HEALTHCHECK_URL --repo nema1502/tinkazo` (el chequeo lo crea quien dirige el proyecto).

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
git tag v0.2.0 && git push origin v0.2.0

# 2. Bajar el .wasm del release (el nombre exacto del release sale en el resumen del workflow)
gh release download v0.2.0_tinkazo-raffle_cli28.1.0 --repo nema1502/tinkazo --pattern '*.wasm'
gh attestation verify tinkazo-raffle_v0.2.0.wasm --repo nema1502/tinkazo \
  --signer-repo stellar-expert/soroban-build-workflow

# Antes del paso 3, el prevuelo, que no gasta nada: corre las pruebas (unos 5 minutos, con un
# tope de 15 por corrida que, si se vence, dice que fue por tiempo), compara la huella del
# .wasm bajado, mira que la cuenta de despliegue exista y que lo que puede gastar (el saldo
# menos su reserva mínima) alcance la cifra de la simulación del día con un 10 % de margen, y
# termina con la orden de deploy.sh. Lleva las cuatro opciones: sin alguna, esa línea sale
# «ojo» en vez de verde. Si las pruebas ya se corrieron aparte ese día, --sin-pruebas las saltea.
pnpm preflight:mainnet -- --wasm tinkazo-raffle_v0.2.0.wasm --sha256 <sha256 del .wasm del release> \
  --account <G de la cuenta de despliegue> --necesario <XLM de la simulación del día>

# 3. Desplegarlo. En mainnet el script pide la identidad (no acepta tinkazo-deployer, que es
#    la de la red de prueba) y la huella del .wasm del release: si el archivo no la tiene,
#    corta antes de llamar a stellar. Tampoco despliega un .wasm sin atestación de GitHub,
#    y al final compara el hash de la red con el del archivo. Después, en el mismo commit,
#    la dirección y el sha256 del .wasm van a deployments.md y a src/stellar/deployments.json:
#    sin eso, la verificación no cree en el contrato nuevo.
stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"
# Primero con --ensayo: valida, compara la huella, consulta la atestación, la dirección de la
# identidad y el alias, e imprime la orden y la fila, sin desplegar ni escribir nada. No mira el
# saldo: la G que imprime tiene que ser la misma que se pasó al prevuelo con --account.
scripts/deploy.sh mainnet tinkazo-mainnet --wasm tinkazo-raffle_v0.2.0.wasm \
  --sha256 <sha256 del .wasm del release> --ensayo
scripts/deploy.sh mainnet tinkazo-mainnet --wasm tinkazo-raffle_v0.2.0.wasm \
  --sha256 <sha256 del .wasm del release>
```

**Si el despliegue se corta.** El error de la CLI queda a la vista. Si el script no llegó a imprimir `contrato: C…`, antes de volver a correrlo hay que mirar si el contrato se creó igual, de dos maneras: con `stellar contract alias show tinkazo-mainnet --network mainnet` y con las últimas operaciones de la cuenta de despliegue en Horizon o en stellar.expert (el script imprime los dos enlaces). Las dos hacen falta: la CLI guarda el alias recién cuando la transacción se confirmó, así que un corte mientras esperaba deja el contrato creado y sin alias. En mainnet el script se niega a desplegar si el alias ya apunta a un contrato, pero sin alias no tiene cómo saberlo. Si aparece un contrato recién creado, se retoma con `--id`. Si ya lo imprimió, el contrato existe: se retoma con `scripts/deploy.sh mainnet <identidad> --wasm … --sha256 … --id <C…>` (el script imprime esa orden completa), que lee el contrato, compara el `.wasm` de la red y escribe la fila sin desplegar otro. Nunca se vuelve a correr sin `--id`. Para que nadie lo haga con apuro, el script deja una marca en `.despliegue/<red>.en-curso` (ignorada por git) antes de desplegar y la borra recién al registrar la fila: mientras esté, se niega a desplegar sin `--id` (con Ctrl+C también imprime la pista). Si se comprobó que no se creó ningún contrato, se borra a mano. Una transacción que todavía no se confirmó no aparece en las operaciones: hay que buscar su hash y esperar unos minutos antes de dar por hecho que no entró.

La fila lleva la huella entera, y en mainnet el script imprime al final la entrada de `src/stellar/deployments.json` lista para pegar en lugar de `"mainnet": null`, con la misma huella: no se copia a mano. La guardia de la CI exige que la huella de la entrada sea, carácter por carácter, la de la fila de mainnet. El script también muestra qué versión de la CLI corre y descarta `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` y `STELLAR_NETWORK` de la consola, para que la red salga solo de `--network`.

Antes de agregar la entrada de mainnet a `src/stellar/deployments.json`, `node scripts/ensayo-entrada-oficial.mjs` la ensaya: pone una entrada inventada con la misma forma (la dirección de 32 bytes en cero), corre tipos, pruebas y build (en una carpeta temporal, sin pisar `dist/`) y deja la lista como estaba, también si falla o se corta. Los únicos rojos que acepta son los que se arreglan copiando al HTML los textos de `src/i18n-modo-oficial.ts`, y los lista con la página y la clave. Si una corrida se corta de golpe, la siguiente devuelve la lista al arrancar; `--restaurar` lo hace sin correr nada más. Una prueba da rojo si la dirección inventada llega a commitearse.

Si el despliegue reemplaza a otro contrato, el anterior pasa a `anteriores` en el mismo commit, con los dos topes que lo cierran (sin ellos, `oficiales.ts` no lo acepta, o no lo acepta por historial): `ultimoId` es `next_id − 1` y `ultimoLedger` es el `sealed_ledger` de ese sorteo. Los dos salen por simulación de solo lectura, sin firmar nada:

```bash
stellar contract invoke --id <C anterior> --network <red> --source-account <cualquiera> --send=no -- next_id
stellar contract invoke --id <C anterior> --network <red> --source-account <cualquiera> --send=no -- get_raffle --raffle_id <ultimoId>
```

y se cruza con Horizon: la transacción de ese `seal` está en `https://horizon-testnet.stellar.org/ledgers/<ultimoLedger>/transactions` (o `horizon.stellar.org` en mainnet) y su hora de cierre es el `sealed_at`. Hacerlo apenas se reemplaza el contrato: mientras no se cierre, cualquiera puede seguir sellando en él.

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
2. Reenviar el aviso con el workflow «Reenviar el aviso de verificación». Manda el mismo pedido, sin compilar ni crear otro release. Conviene repetirlo después de desplegar en mainnet, con el `.wasm` ya en la red. El commit, la corrida y el hash no tienen valor por defecto, porque son los de un release en particular; para el `v0.2.0`:

   ```bash
   gh workflow run reenviar-verificacion.yml \
     -f commit="$(git rev-list -n 1 v0.2.0)" \
     -f corrida="$(gh run list --workflow release.yml --json databaseId,headBranch --jq '.[] | select(.headBranch=="v0.2.0") | .databaseId')" \
     -f hash="$(sha256sum tinkazo-raffle_v0.2.0.wasm | cut -d' ' -f1)"
   ```
3. Si aun así no lo marca, escribir en `stellar-expert/soroban-build-workflow` con el hash, el commit y la corrida.

Mientras tanto la prueba sigue en pie: la atestación (caminos 2 y 3) y la recompilación (camino 4) no dependen de stellar.expert.

## Redes

| Red | RPC | Passphrase | Protocolo (2026-11-11) | TTL mínimo persistente |
|---|---|---|---|---|
| testnet | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` | 30 | 7 días |
| mainnet | `https://mainnet.sorobanrpc.com` (o un [proveedor](https://developers.stellar.org/docs/data/apis/rpc/providers)) | `Public Global Stellar Network ; September 2015` | 29 (el 30 se vota el 23 de noviembre) | 120 días |

Testnet se reinicia trimestralmente: los sorteos de prueba desaparecen y hay que redesplegar.
