# El servicio de campañas (#182)

Un Worker con un Durable Object con SQLite: empresas (con identificadores opacos), campañas, eventos por ciudad, pasos, premios, quien organiza cada evento y su estado; las bases armadas con los datos y publicadas con su huella; la invitación a quien organiza y el informe de cierre. Es lo que libera `GET /v1/campanas` para el comprobante y las entregas (#176) y el informe del panel de la empresa (#183).

Se despliega desde la raíz con `npx wrangler@4 deploy -c wrangler-campanas.toml`, con la palabra de quien mantiene el proyecto.

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `POST /v1/empresas` | Con la clave de administración (`ADMIN_TOKEN`, secreto de Wrangler): crea una empresa y devuelve su identificador opaco `{id}`. Sin clave cargada contesta `503 apagado`. |
| `POST /v1/empresas/<id>/campanas` | Con el secreto de esa empresa (`SECRETO_<ID>`, en mayúsculas): carga `{cupo, organizadora, campana}`. `campana` es la configuración que valida `leerCampana` de `src/campana/modelo.ts` (la misma forma que firma la sala); `cupo` es cuántas personas admite el evento (hasta 300, lo que admite una sala) y `organizadora` la cuenta G de quien organiza, si el alta la nombra. Guarda la campaña, sus pasos, sus premios, sus bases con su huella y responde `{evento, huellaBases, organizadora}`. |
| `GET /v1/campanas` | El inventario público, con CORS abierto: una campaña por evento, con lo que cada una declaró. |
| `GET /v1/campanas/<evento>/bases` | Las bases publicadas: `{documento, huella, publicado}`. La huella es SHA-256 del JSON canónico (`src/campana/huella-de-bases.ts`, el vector fijo de #170). |
| `GET /v1/campanas/<evento>/invitacion` | La invitación a quien organiza: `{evento, organizadora, enlace}`, con el enlace del panel (`ENLACE_BASE/?campana=<evento>`). |
| `GET /v1/campanas/<evento>/informe` | El informe de cierre, sin la lista (ver abajo). |

Errores: `400 {motivo:"cupo"|"campana"|"organizadora"|"cuerpo", campo?}`, `401 {motivo:"clave"|"secreto"}`, `404 {motivo:"empresa"|"no-existe"}`, `405 {motivo:"metodo"}`, `409 {motivo:"evento-repetido"}`, `413 {motivo:"cuerpo"}`, `503 {motivo:"apagado"|"secreto"}` (sin clave de administración, o sin el secreto de esa empresa cargado con `wrangler secret put`).

## Los secretos (S6)

Cada empresa se identifica por su identificador opaco y se autentica con su propio secreto de Wrangler: después de crear la empresa, `wrangler secret put SECRETO_<ID>` con el identificador en mayúsculas. El código no guarda nombres ni secretos: los lee del entorno al atender el pedido, y una empresa sin su secreto cargado no puede cargar campañas (`503 secreto`). La comparación es en tiempo constante, sobre las huellas SHA-256 de los dos textos.

## El aviso a comisiones (S5)

Al guardar un alta, el servicio le pasa a comisiones **solo lo que el alta decidió**, por el enlace completo que trae `COMISIONES_URL`:

```json
{"evento":"…","empresa":"<id opaco>","cupo":300,"horas":{"abreMs":0,"cierraMs":0,"sorteoMs":0,"recibirHastaMs":0},"estado":"abierta"}
```

Con `COMISIONES_SECRETO` cargado va en `Authorization: Bearer`. El aviso es de solo escritura: no espera nada, no se reintenta y un fallo suyo se anota sin tumbar el alta. Las rutas del servicio de comisiones no se tocan (S8): cuando ese lado defina su ruta de entrada, `COMISIONES_URL` apunta a ella sin cambiar acá nada más.

## Las tablas del depósito

`empresas` (identificador opaco), `campanas` (evento, empresa, cupo, organizadora, estado, configuración), `pasos`, `premios` (una fila por premio, con su monto en unidades de siete decimales) y `bases` (documento, huella, publicación). Todo el SQL vive en `src/datos.ts`. El reloj entra como argumento: las pruebas lo corren a mano.

## Qué sabe y qué no sabe

- **El inventario es honesto:** `contrato` y `promo` son lo que declaró el archivo de cada campaña (`null` cuando no lo declaró). La designación de contratos de premios que Tinkazo acepta queda vacía hasta #167: este inventario no dice qué contratos son oficiales, eso lo sigue decidiendo `src/stellar/deployments.json`.
- **El informe no lleva la lista:** cuenta `{cantidades: {anotadas, cupo}, ganadoras, premios: {cuantos, recibidos, porRecibir}}` y nada de cuentas ni nombres. Mientras el servicio de entregas (#176) no le informe qué premios se entregaron, `recibidos` es 0 y todo queda por recibir.

## Pruebas

`pnpm vitest run workers/campanas` corre la suite del servicio: cada tabla y ruta, la huella contra `huellaDeBases`, el aviso a comisiones (con y sin enlace, y con un enlace que falla), y una segunda empresa cargada por la API, sin tocar código (S7).
