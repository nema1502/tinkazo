# Los sellos que llegan a través de otro contrato — métricas de la cadena (issue #190)

`scripts/metricas-cadena.mjs` compara cada sello con su transacción esperando una llamada directa a `seal` del
contrato del sorteo. En testnet, la corrida del 18 de noviembre marca 8 sellos posteriores al número 570 del contrato
vigente como «no coinciden» y con eso da por malos todos los números. Son sellos de otro contrato que llama al `seal`
del sorteo adentro (el de premios ensaya así sus listas). Hay que reconocerlos, contarlos marcados y dejar intacta la
regla dura.
Base: `origin/main` 136c8ca4. Rama `guido/issue190`, worktree `.worktrees/i190`.
Runner: Vitest (`pnpm test`, acá con el binario del checkout principal porque el worktree no tiene `node_modules`) y la
corrida real: `node scripts/metricas-cadena.mjs --red testnet`.

## Specs

S1. "Confirmar la causa con los ocho casos."
S2. "Que un sello hecho a través de otro contrato se reconozca, por la llamada anidada o por su evento, y se cuente marcado como tal."
S3. "Que un sello que de verdad no coincide siga fallando."
S4. "Pruebas sin red con una transacción directa, una anidada y una que no coincide."
S5. "La corrida en la red de pruebas termina con todas las comprobaciones bien."
S6. "En la red de pruebas, la corrida del 18 de noviembre marca 8 sellos posteriores al número 570 del contrato vigente que no coinciden con su transacción" — la causa: son sellos hechos por otro contrato que llama al `seal` del sorteo adentro.

## Decisions

D1. La confirmación sale de la cadena y no del RPC: el recurso de transacciones de Horizon no trae `result_meta_xdr`,
así que los argumentos de la llamada anidada no están disponibles. Lo que sí está: el evento `sealed` lo emitió el
contrato del sorteo (prueba de que su `seal` corrió en esa transacción) y el organizador del evento es el contrato que
la transacción invocó. Con `seal` exigiendo la firma del organizador (`organizer.require_auth()` en
`contracts/raffle/src/lib.rs`), un organizador que es un contrato igual al contrato invocado es un sello anidado.
D2. Se reconoce por la combinación de las dos cosas, no por el nombre de la función: el nombre `seal` del contrato que
llama es una casualidad del contrato de premios y no se usa como regla. Un sello anidado se marca con
`selloViaContrato` y se cuenta en `sellosAnidados` de cada período y del total.
D3. `decodificarLlamada` deja de decodificar los argumentos de un `seal` que no tiene la firma del sorteo (seis
argumentos: organizador, huella, cantidad, ganadores, ronda, texto). Antes armaba campos falsos con los argumentos del
`seal` de otro contrato; el texto de la marca de un sello anidado no se puede leer de la transacción y cuenta como
sin marca.

## Tasks

- T1 | S1, S6 | inline: mirar las 8 transacciones reales de testnet (índice de StellarExpert + Horizon, sin clientes nuevos) y clasificar todos los sellos posteriores al 570 | done: 548 sellos posteriores al 570, 540 directos y exactamente 8 por otro contrato — 571 y 572 (`CD5UZXNV…`), 582 a 586 (`CCJGBEFC…`) y 587 (`CD3FDTS7…`); en los 8 el organizador del evento es el contrato invocado por la transacción, que salió bien y cuyo `seal` tiene tres argumentos (número interno, lista de cuentas, ronda), no los del sorteo
- T2 | S3, S4 | inline: pruebas sin red en `scripts/lib/metricas-cadena.test.mjs` con sobres XDR de verdad (directo, anidado y dos que no coinciden) | done: RED 3 de 4 nuevas fallan (anidado marcado, directo sin marca, `decodificarLlamada` sin argumentos falsos); la de la regla dura ya pasaba y se conserva
- T3 | S2, S3 | inline: `contratoQueSella` + `unir` (directo, anidado o problema), `sellosAnidados` en los períodos y `anidadosDe` para la línea del informe | done: GREEN 50/50
- T4 | S5 | inline: corrida real contra testnet, en dos pasadas con `--crudos` (Horizon limita a 2000 pedidos cada 5 minutos) y sin escribir los totales versionados | done: todas las comprobaciones `ok`, 8 sellos por otro contrato informados
- T5 | S3, S5 | inline: comprobación diferencial con los mismos crudos contra el código de la base (copia fuera del repo) | done: base `MAL 8 problemas` y salida 1; con el cambio, todo `ok` y los números iguales (2055 sellos, 919 registros)
- T6 | S2 | inline: docs (`docs/metricas/README.md`: fila de la tabla, cómo llega un sello y la comprobación) y este documento | done

## Log

L1 — Issue #190 (verbatim): "En la red de pruebas, la corrida del 18 de noviembre marca 8 sellos posteriores al número 570 del contrato vigente que no coinciden con su transacción, y con eso da por malos todos los números. Lo más probable es que sean sellos hechos por otro contrato que llama al del sorteo, como hace el contrato de premios en sus ensayos."
L2 — Causa confirmada (T1). Los ocho, con su transacción:

| sello | transacción | contrato que llamó |
|---|---|---|
| 571 | `d18bcea4e16ac1d045e2a4e6c6f4a9faded9ad096ee144c49fe74d5d76997393` | `CD5UZXNVKZILVXEF2AGZSJUUVUN74AACXZPAZFY7HOPKOHFK6F6Y3PPE` |
| 572 | `c79f39e075e63502601a1efb110ba4df64f1ba7660e1bdd277ddd52ff2bacfb9` | `CD5UZXNVKZILVXEF2AGZSJUUVUN74AACXZPAZFY7HOPKOHFK6F6Y3PPE` |
| 582 | `3b0b58f31a90851aeaa103582f26c36c0458579af31f3d1aad35159f8f96790b` | `CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY` |
| 583 | `914aafa9950b29f49bae1fa91e2dbdbbce275a7d1648f412202b03aaf83c1d78` | `CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY` |
| 584 | `2f97041831c5d87db4a47ab5bee9959205bca7aed4e2bca89ea5f3e981191638` | `CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY` |
| 585 | `889bfbd472a4395e634481d139954043b69edce9cc9e4e614e48bdfdfd351a14` | `CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY` |
| 586 | `3f1055d5ec8b8f27bb97ca1db0cb388d3f7f8c9f594370a2f5c58150ae44134e` | `CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY` |
| 587 | `d2dd1bc5160f8647027d7518e73cb2c475f93876e4700ff32dcea421b98c682a` | `CD3FDTS72H5E63UIXSLAFCRBJGFEFS4C7GT6JMMP2ODZJTVO6AS44A7P` |

Todos: transacción en éxito, una sola operación, invocación del `seal` del contrato de la tercera columna con tres
argumentos (`u64` interno, `vec` de cuentas `G…`, `u64` de ronda); el evento `sealed` lo emitió el contrato del sorteo
`CDNWNY26…` con el organizador igual a ese contrato. Ninguno de los otros 540 sellos posteriores al 570 presentó el
problema: son llamadas directas al `seal` del sorteo con los seis argumentos.
L3 — Pruebas (T2, T3): RED 3 fallas observadas con el código de la base (anidado marcado, directo sin marca,
`decodificarLlamada` devolviendo `organizador: "1"` del `seal` ajeno); GREEN 50/50 en
`scripts/lib/metricas-cadena.test.mjs`. `check-escritura` y `check-glosario`, aprobados.
L4 — Corrida real (T4, S5), dos pasadas con `--crudos` en `/tmp` por el límite de Horizon (2000 pedidos cada 300 s):
corte 5810158, 2974 eventos, «ok 2974 de 2974 eventos con su transacción de Horizon», «ok los eventos y las
transacciones coinciden», «-- 8 sellos llegaron a través de otro contrato (válidos, contados aparte): CCJGBEFC,
CD3FDTS7, CD5UZXNV», «ok el RPC y el índice cuentan 222 sellos y 117 registros en la ventana de unos 7 días». Números
totales iguales a los de la base con los mismos datos: 2055 sellos, 919 registros.
L5 — Diferencial (T5): con los mismos crudos, el código de 136c8ca4 da «MAL 8 problemas, el primero: el sello
CDNWNY26…#571 no coincide…» y sale con 1; con el cambio, todas las comprobaciones en `ok`. Los totales de
`docs/metricas/totales-testnet.json` no se reescribieron en esta rama: los actualiza la corrida que se commitea aparte.
