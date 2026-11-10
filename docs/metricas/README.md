# Los números de la cadena

Cuántos sorteos se hicieron con Tinkazo, contados desde la cadena y no desde un contador que haya que creerle. Cualquiera puede recalcularlos con un script y le da lo mismo.

Los totales de cada red están en `totales-<red>.json` (hoy `totales-testnet.json`; `totales-mainnet.json` aparece cuando haya contrato en mainnet). No traen cuentas, listas ni nombres: cuántos, nunca quiénes.

## Qué se cuenta

| Número | Qué es en la cadena |
|---|---|
| Sorteos sellados | Un evento `sealed` del contrato: una llamada a `seal` que salió bien |
| Sorteos registrados | Un evento `drawn`: una llamada a `draw` que salió bien. El contrato verificó la firma BLS de drand y guardó los ganadores. Es la comprobación en cadena de cada sorteo |
| Organizadores distintos | Cuentas que firmaron al menos un `seal` |
| Organizadores que vuelven | Cuentas con sellos en dos o más días distintos, o en dos o más semanas (la semana va de lunes a domingo, UTC) |
| Lugares en listas | La suma de `count` de los sellos. **No son personas únicas**: la misma persona está en muchas listas |
| Cierres sin sortear | Listas selladas que no tienen registro una hora después de sellarse |
| Ganadores | La suma de los ganadores de los sorteos registrados |
| Por marca | Sellos cuyo texto empieza con `#fila`, con `#premios=N`, o sin marca |
| Tiempo hasta el primer sorteo | Desde el primer sello de una cuenta hasta su primer registro (mediana, percentil 90 y máximo) |
| Listas repetidas | La misma huella de lista sellada más de una vez |
| Transacciones y comisión | Cada `seal` y cada `draw` es una transacción; la comisión cobrada por la red está en stroops (10 000 000 stroops = 1 XLM). `patrocinadas` son las que pagó otra cuenta (Pollar) |

Los días, semanas y meses son UTC y salen de la hora en que cerró el ledger de la transacción. Un registro cuenta en el día en que se registró, no en el que se selló.

**No están acá** las aperturas de la página de comprobación, ni los videos, ni los clics: no pasan por la cadena. Esas viven en el contador y se publican aparte.

## Cómo leer los números: tres vistas

Testnet es el ensayo: cualquiera puede sellar en el contrato, y los auditores y las pruebas lo hacen todo el tiempo con una cuenta nueva cada vez. Por eso cada archivo trae tres vistas:

- `todas`: todo lo que hay en la cadena.
- `sinInternas`: sin las cuentas de `docs/cuentas-internas.json` (la de despliegue, las del equipo; solo direcciones con la etiqueta «interna», sin nombres de personas).
- `sinInternasNiEjemplo`: además, sin los sellos de la lista de ejemplo del sitio (la de `docs/vectors.json`). Es lo que sellan las pruebas, y como usan una cuenta nueva por corrida no se pueden descontar por cuenta. **Es una cota de arriba del uso real, no su medida**: quedan pruebas manuales con otras listas.

Con esto, las cuentas internas que faltan se agregan a `docs/cuentas-internas.json` en el commit en que se las reconoce, y los números se recalculan hacia atrás. El archivo también cuenta aparte lo descontado (`cuentasInternas`, `listasDeEjemplo`), para que se vea cuánto es.

Lo que pesa ante quien financia son los números de mainnet, que son los que no tienen ensayo mezclado. Los de testnet son la historia.

## Cómo recalcularlos

```bash
pnpm install
node scripts/metricas-cadena.mjs --red testnet --hasta-ledger <el ledger de corte del archivo> --totales /tmp/mis-totales.json
cmp /tmp/mis-totales.json docs/metricas/totales-testnet.json     # idéntico
```

`corte.ledger` dice dónde cortó el archivo. Con ese ledger sale el mismo archivo, byte por byte (se probó recalculando desde cero). Sin `--hasta-ledger` corta en el último ledger cerrado. En Actions, el flujo «Metricas de la cadena» hace lo mismo a mano (`workflow_dispatch`).

De dónde sale cada dato, para no creerle a un solo servidor:

1. **Eventos**: el índice de eventos del contrato de StellarExpert (todo el historial; el RPC de Stellar solo guarda unos 7 días). El índice solo dice dónde mirar.
2. **Transacciones**: cada evento se confronta con su transacción en Horizon, por el identificador del evento. De la transacción se decodifica el sobre (`envelope_xdr`): organizador, huella de la lista, cantidad, texto, hora de cierre y quién pagó la comisión.
3. **Comprobaciones que el script hace solo** (sale con error si alguna falla):
   - los números de sorteo de cada contrato van de 1 a N, sin huecos ni repetidos;
   - N coincide con `next_id - 1` que el contrato lleva en su instancia (leído del RPC);
   - cada evento tiene su transacción y los dos dicen lo mismo;
   - en la ventana de 7 días, el RPC cuenta los mismos sellos y registros que el índice.
4. Cuenta el contrato vigente y los anteriores de `src/stellar/deployments.json`. De un contrato anterior solo entra lo que llega a su `ultimoId`: lo que se selle después ya no es un sorteo de Tinkazo.

## Los datos crudos de testnet

El historial de testnet se borra el 16 de diciembre de 2026. Los eventos, las transacciones y la foto del día están guardados fuera del repo (privados, porque traen cuentas): `--crudos <carpeta>` los escribe, y `--desde-crudos <carpeta>` recalcula sin red. Los totales de este directorio son lo público; lo recalculable contra la red es todo lo de mainnet y, hasta el 16 de diciembre, lo de testnet.

## Cómo programarlo

El flujo `.github/workflows/metricas-cadena.yml` es solo manual. Para correrlo una vez por día hay que decidir dónde queda la foto, porque la corrida de Actions no commitea:

- La foto del día se guarda con `--crudos` en una carpeta fuera del repo, y `totales-<red>.json` se actualiza y se commitea (el historial de git guarda cada foto).
- Para programarlo: agregar un bloque `schedule` con un cron fuera de los minutos 0 y 30 en el flujo, o crear una tarea del sistema que corra `pnpm metricas:cadena -- --red mainnet --crudos <carpeta>` y commitee el archivo.

## Listar la actividad de una cuenta o un contrato

`actividadDe({ contrato })` y `actividadDe({ cuenta })`, en `scripts/lib/metricas-cadena.mjs`, devuelven eventos o transacciones con ledger y hora. Es la pieza para listar, por ejemplo, las cuentas que firmaron algo en un contrato. No decide qué cuenta como una inscripción: devuelve las piezas y quien consume filtra.

## Por qué Node y no otra cosa

El script es JavaScript de Node con el SDK de Stellar que el sitio ya usa. Alcanza: son unos 2 000 eventos y unas 2 000 transacciones por corrida, que baja en un par de minutos con 3 o 4 pedidos a la vez, y no hace falta un indexador propio ni una base de datos. Si algún día el volumen de mainnet lo supera, la salida es un indexador sobre Galexie o Hubble, y los totales que se verifican con este script no cambian.
