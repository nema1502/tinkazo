# El portero de Tinkazo

Un Worker de Cloudflare (`tinkazo-patrocinio`, en `p.tinkazo.app`) que **cuenta y paga las comisiones de `seal` y `draw`** con su propio fee-bump, con un tope por cuenta y un tope general por día. Así los límites los pone Tinkazo y no dependen de lo que ofrezca ningún proveedor de cuentas: quien tiene sesión podía pedirle a su proveedor que pague desde un script propio, sin pasar por nuestra página, y un tope puesto en la página no frena a nadie.

Es un script aparte del de los enlaces (`tinkazo-enlaces`) y del de la sala (`tinkazo-sala`), en la misma cuenta: un error de despliegue o de uso acá no puede tumbar los comprobantes ni la sala. La cuenta comparte los 100.000 pedidos por día del plan gratis (ver [Plan y gasto](#plan-y-gasto)).

**Comprobar un sorteo no depende de este servicio.** `verificar.html` no lo llama. Si se cae, no se puede sellar con patrocinio, pero todo lo ya hecho se sigue comprobando, y quien paga su comisión (Freighter, una cuenta con saldo) no pasa por acá.

**Estado:** probado con `wrangler dev` y testnet. No está desplegado, no tiene DNS, y el navegador todavía no lo usa (`src/stellar/patrocinador.ts` y las pantallas son la parte 2). Desplegar y el DNS piden la palabra de quien mantiene el proyecto.

## Cómo funciona

El navegador arma la transacción, la simula y la firma **sin patrocinio**, y la manda acá. El portero:

1. mira si está prendido (y quién rige);
2. la pasa por la **lista blanca estricta** y verifica la firma, sin tocar nada;
3. si ese hash ya estaba pagado, devuelve el mismo resultado sin contar dos veces (el navegador reintenta);
4. mira que **la cuenta la haya abierto nuestra app**;
5. la simula, para no pagar lo que va a fallar (`AlreadyDrawn`, `RoundNotReady`);
6. **reserva** el cupo de la cuenta y el presupuesto general, de una vez;
7. la envuelve en un fee-bump que paga su cuenta patrocinadora, la firma con su llave acotada y la manda a la red.

De lo más barato a lo más caro: la IP y el tamaño se miran antes de leer nada, y la red solo se consulta (pasos 4 y 5) después de la lista blanca.

### La lista blanca

Todo lo que no está acá da `400` (o `403`) sin gastar cupo:

- una sola operación `invokeHostFunction`, sin origen propio y **sin memo**, de una transacción común (ni fee-bump ni versión vieja) y de una cuenta común (no multiplexada);
- el contrato oficial de `src/stellar/deployments.json` de la red (el vigente: un contrato anterior no se paga), con `seal` o `draw`, nunca `extend` ni otra cosa;
- los argumentos con la forma exacta del contrato; en `seal`, `organizer` es la cuenta de origen; las autorizaciones son solo las de esa cuenta;
- con datos de recursos, **sin entradas para restaurar**, con `resourceFee` y total por debajo del tope (1 XLM) y con la inclusión declarada por debajo de la oferta del fee-bump;
- ventana de tiempo de 5 minutos o menos, que no haya vencido;
- las firmas, contra el hash de **esta** red y contra los firmantes y umbrales que la cadena dice de la cuenta de origen: vale si la suma de los pesos de las firmas válidas alcanza el umbral **medio** (el que pide una invocación de contrato). La maestra con su peso sigue valiendo, y una cuenta con dos firmas de dos o con firmantes aparte también. Se verifican a lo sumo **5** firmas por pedido. La cuenta se lee de la cadena en cada pedido, a lo sumo una vez;

### La cuenta tiene que ser de la app

Se lee de la cadena (`getLedgerEntries`, campo `extXdr`) que el patrocinador de la reserva de la cuenta sea la billetera de fondos del proveedor de cuentas (`PATROCINADORES_APP`). Sin eso, cualquiera con llaves propias entraría. Se recuerda (400 días). Freighter sigue pagando lo suyo.

- **En testnet** la lista nace con la billetera de Pollar (`GAYWGZ4P…DGKU`, medido el 20 de octubre de 2026). Esa billetera es **compartida**: cualquier app de Pollar abre cuentas que pasan este control, y no se puede distinguir cuál. Sirve para probar; no es una defensa. Además se acepta `CUENTAS_PRUEBA` (cuentas de friendbot).
- **En mainnet** el control solo vale con una billetera de fondos **exclusiva de Tinkazo**, separada de las demás apps de Pollar. La lista nace vacía y **vacía no deja pasar a nadie**: hay que cargarla (`PATROCINADORES_APP`) antes de encender. `CUENTAS_PRUEBA` se ignora en mainnet aunque la variable esté puesta.
- Una cuenta ya vista queda recordada aunque su patrocinio cambie después.

### Los topes

| Tope | Valor | Cómo se cambia |
| --- | --- | --- |
| Sellos por cuenta y por mes (UTC) | **20**; 50 para `CUENTAS_VERIFICADAS` | `MAX_SELLOS_MES`, `MAX_SELLOS_VERIFICADA`, o en caliente por `PUT /v1/patrocinio/ajustes` |
| Sorteos por cuenta y por mes | el doble de sus sellos (40, 100). **Sortear no se frena por el cupo de sellos**; este tope solo corta un abuso | |
| General, en ventana móvil de 24 h | **15 XLM** (`150000000` stroops) | `TOPE_GENERAL_STROOPS`, o por ajustes |
| Por transacción | 1 XLM de recursos y de total | `TOPE_TX_STROOPS` |
| Inclusión que declara la transacción, y oferta del fee-bump | **10.000 stroops** por operación (100 veces la base de la red). La oferta es siempre esta, nunca lo que declara el cliente; una inclusión declarada por encima no se paga, porque la red exige una oferta igual o mayor | `INCLUSION_BUMP_STROOPS` |
| Recursos declarados | hasta **1,5 veces lo que simula la red más 50.000 stroops**; por encima, `400 fee-alta` | `MARGEN_RECURSOS_STROOPS` |
| Guardado para el sorteo de cada sello | **82.000 stroops** fijos: lo que costó un `draw` en testnet (54.251, el 2 de noviembre de 2026) más la mitad. En mainnet se mide y se carga antes de encender | `RESERVA_SORTEO_STROOPS` |
| Cuánto dura lo guardado para un sorteo sin hacer | **6 horas** | |
| Alerta del saldo de la patrocinadora | **20 XLM** (más que el tope de un día) | `SALDO_ALERTA_STROOPS` |
| Ventana de la transacción | 300 s | `VENTANA_MAX_S` |
| Pedidos de pago por dirección y por hora | 240 (una wifi de evento con varios organizadores comparte dirección), en memoria, sin guardar la IP (en IPv6, el /64). Las consultas de cupo tienen su propio contador, de 600. El tope de verdad es la regla de Cloudflare de abajo | `POR_IP_POR_HORA` |

**Qué se estima y qué se guarda.** Al reservar, un `seal` cuenta `estimado = 1,5 × lo simulado + 50.000 + 2 × 10.000` (el techo de recursos que acepta, más dos ofertas de inclusión) y **guarda aparte el monto fijo de su sorteo**. Ninguno de los dos sale de lo que declara el cliente: un cliente que declare 1 XLM no retiene más fondo que uno que declare lo justo (el de 1 XLM ni siquiera entra). Cuando la red cierra el sello, su gasto pasa a lo real, pero lo guardado para el sorteo se queda en el monto fijo hasta que el sorteo cierre (el costo del sello es otro costo que el del sorteo); ahí deja de contar y el gasto pasa al real del sorteo. Así 8 sellos retienen a lo sumo 8 montos fijos, y una cuenta no puede inmovilizar el fondo de todos sin sortear.

Un `seal` se acepta solo si queda presupuesto para él y para su sorteo. Un `draw` de un sello ya aceptado usa lo guardado **hasta el doble del monto fijo** y, si cabe ahí, no vuelve a pedirle nada al presupuesto (lo sellado siempre se puede sortear); lo que su estimado pase de ahí se comprueba contra el presupuesto del día como un pedido nuevo (si no hay, `503 fondo`). Antes un sorteo con un sello guardado tenía «falta cero» y no comparaba su propio estimado con nada: con sellos baratos y sorteos de recursos inflados el gasto real pasaba el tope sin límite propio. Ahora el estimado sale de la simulación (los recursos inflados se rechazan) y el peor caso queda acotado: el gasto no pasa del presupuesto más una reserva fija por cada sello aceptado. Pasadas las 6 horas sin sortear, lo guardado se suelta: el sorteo se paga del presupuesto del día si hay, y si no el navegador lo paga con la cuenta de la persona o espera. Así, con el tope general casi lleno, un `seal` se rechaza y un `draw` de un sello reciente pasa.

Respuestas de `POST /v1/patrocinio` (cuerpo `{"xdr": "<base64>"}` hasta 8 KB, desde `tinkazo.app`, `www`, las vistas de Vercel o `localhost`):

| Código | Cuerpo | Cuándo |
| --- | --- | --- |
| `200` | `{hash, status, quedan, quedanSorteos}` | Mandada a la red. `hash` es el de la transacción interna, el que consulta `envio.ts`. `status` es `PENDING` o `DUPLICATE` (el mismo hash otra vez, o la red ya la había cerrado: trae también `estado`). `quedan` son los sellos que le quedan a la cuenta este mes |
| `429` | `{motivo:"cupo-cuenta", que, liberaEn, max}` | La cuenta llegó a su tope del mes. `que` es `"sellos"` o `"sorteos"`. `liberaEn` es el primer instante del mes siguiente, en ms. No reintentable hasta entonces |
| `429` | `{motivo:"cupo-ip"}` | Demasiados pedidos de esa dirección en la hora (también en `/cupo`). Reintentable más tarde |
| `503` | `{motivo:"fondo", codigo?}` | Tope general lleno, o la cuenta patrocinadora sin saldo (`codigo` trae el nombre del rechazo de la red). Reintentable más tarde: el cupo no se gastó |
| `503` | `{motivo:"apagado", rige:"pollar"\|"ninguno"}` | Apagado (`rige:"ninguno"`), o devuelto a Pollar (`rige:"pollar"`), o la red no tiene contrato |
| `503` | `{motivo:"apagado", detalle:"sin-llave"}` | La llave del Worker no está o no se pudo leer (sin `rige`). Ver `/cupo`: dice `motivo:"config"` |
| `400` | `{motivo:"no-permitida", razon, detalle}` | La lista blanca. `razon`: `xdr`, `no-permitida`, `ventana`, `fee-alta` (con `detalle:"inclusion"`, `"recursos"`, `"total"`), `restaurar`, `firma` (`detalle:"sin-firma-valida"` o `"peso-insuficiente"`), `tamano`. `ventana/vencida` es reintentable armando la transacción de nuevo; el resto no |
| `400` | `{motivo:"fee-alta", detalle:"recursos"}` | Los recursos que declara la transacción pasan de 1,5 veces lo que simuló la red más el margen. Se vuelve a simular y a armar |
| `400` | `{motivo:"fallaria", detalle}` | La simulación dice que el contrato va a fallar (por ejemplo `AlreadyDrawn`: el sorteo ya lo hizo otro): no se paga ni se cuenta |
| `400` | `{motivo:"rechazada", codigo}` | La red la rechazó sin que entrara (secuencia mal, por ejemplo): el cupo vuelve. Reintentable armando de nuevo |
| `403` | `{motivo:"cuenta-ajena"}` / `{motivo:"origen"}` | La cuenta no la abrió nuestra app / pedido desde otro sitio |
| `500` | `{motivo:"interno"}` | Un error nuestro; queda en la bitácora. Si pasó antes de mandar, el cupo vuelve |
| `502` | `{motivo:"red", detalle}` | Ningún RPC contestó, o `TRY_AGAIN_LATER`. Si no se sabe si llegó, sigue contando hasta que la alarma lo resuelva. Reintentable con el mismo XDR |

Si Cloudflare corta el pedido por CPU (error 1102), el navegador recibe un fallo de red sin cuerpo ni cabeceras CORS: hay que tratar "error de red sin cuerpo" como reintentable con el mismo XDR. Un pedido puede tardar hasta unos 48 s en el peor caso (tres llamadas al RPC de 8 s, con paso al segundo RPC), así que el plazo del cliente tiene que ser mayor.

`GET /v1/patrocinio/cupo?cuenta=G…` (abierto, solo lectura) dice `{prendido, motivo?, rige:"portero"|"pollar", red, mes, sellos:{usados,max,quedan}, sorteos:{…}, liberaEn}`. El sitio lo usa para frenar sin desplegar: **decide primero por `rige` y recién después por `prendido`**. **`prendido` significa «el portero paga»**: es `false` con `motivo:"apagado"` si se apagó, con `motivo:"config"` si falta la llave del Worker, la cuenta patrocinadora o el contrato (o, en mainnet, la lista de billeteras de la app), y con `motivo:"pollar"` (y `rige:"pollar"`) si se devolvió a Pollar. Así una llave mal pegada no hace que el sitio ofrezca un patrocinio que va a dar `503`, y si `rige` es `pollar` el sitio usa a Pollar sin intentar el portero (que daría `503`). Un fallo al leer la llave sale en la bitácora (`wrangler tail`), nunca con la llave. Una cuenta mal escrita da `400 {motivo:"cuenta"}`.

**Si la red la rechaza sin que entre, el cupo vuelve; si entró y falló, se pagó y cuenta.** Lo que queda en el aire lo resuelve una alarma del objeto cada 20 s (`getTransaction` por el hash interno; si no apareció y pasaron 10 minutos del vencimiento, no entró nunca y se devuelve; el margen es largo porque un RPC atrasado puede decir que no la ve cuando sí entró). **La alarma se pide apenas se reserva**, antes de importar la llave y de mandar, y un objeto que arranca con cosas en el aire la vuelve a armar: una reserva de un objeto que murió en el medio se resuelve contra la red o se devuelve al vencer, no queda colgada. Entre un reintento y otro, antes de reenviar se mira si la red ya la cerró.

## La llave acotada

La cuenta patrocinadora es propia y tiene dos llaves, con la llave de la propia cuenta en peso 0:

| Llave | Peso | Quién la tiene |
| --- | --- | --- |
| Fría | 2 | Quien mantiene el proyecto. Mueve el dinero |
| La del Worker | 1 | Es el secreto `CLAVE_PATROCINADOR` |

Umbrales: bajo 1, medio 2, alto 2. Un fee-bump pide el umbral bajo (alcanza con la llave del Worker); un pago, el medio; cambiar llaves o umbrales o vaciar la cuenta, el alto. **Una llave del Worker filtrada solo puede quemar comisiones hasta lo cargado**, no sacar el dinero. La cuenta guarda solo el tramo del día (unos 60 XLM como mucho); el resto va en la cuenta fría.

**Prueba 3.8, hecha en testnet** (`probar.mjs`): con la llave del Worker, un pago, un `accountMerge`, un `setOptions` que se da más peso y otro que baja los umbrales son **rechazados por la red**. El resultado es `txFailed` con `opBadAuth`, no `txBadAuth`: la transacción pasa el umbral bajo (el peso 1 alcanza) y es la operación la que pide el medio o el alto. Con la llave fría, el mismo pago sale. En mainnet esto se crea una vez con la llave fría en la mano de quien mantiene el proyecto; ver la hoja de operación.

## La regla de límite de Cloudflare (WAF): el tope de verdad por dirección

El contador por dirección del Worker vive en memoria y es de cada nodo de Cloudflare: un atacante repartido entre nodos lo esquiva, y un Worker que se reinicia lo olvida. Sirve contra el script torpe, no contra un abuso. **El tope por dirección de verdad es una regla de límite en la zona `tinkazo.app`, delante de `p.tinkazo.app`**, que no vive en este código y la carga quien mantiene el proyecto en el panel de Cloudflare (Seguridad, WAF, Reglas de límite de tasa):

| Campo | Valor |
| --- | --- |
| Expresión | `(http.host eq "p.tinkazo.app" and http.request.method eq "POST" and http.request.uri.path eq "/v1/patrocinio")` |
| Cuenta por | Dirección IP (`ip.src`) |
| Umbral | 20 pedidos en 10 segundos (el período que deja el plan gratis; con un plan de pago, 240 por hora) |
| Acción | Bloquear, 10 segundos (el plan gratis solo deja ese tiempo) |

Una segunda regla, si el plan deja más de una: la misma expresión con `http.request.method eq "GET" and http.request.uri.path eq "/v1/patrocinio/cupo"`, 60 pedidos en 10 segundos. Un pedido bloqueado ahí no llega al Worker y no cuenta como pedido de la cuenta (ver [Plan y gasto](#plan-y-gasto)).

## Lo que guarda

El objeto `Patrocinio` (SQLite, uno por red) guarda cuentas (G…), el mes y el contador, los hashes pagados con su resultado (`reservado`, `enviado`, `ok`, `fallo`, `devuelto`), lo estimado y lo real que cobró la red, lo guardado para sorteos y las cuentas que ya se vieron como de la app. **No guarda nombres, listas, direcciones IP ni nada que identifique a una persona más allá de su cuenta de Stellar**, que ya es pública en la cadena. `uso` se purga a los 35 días. Todo sale como JSON por `GET /v1/patrocinio/exportar` (con la clave de administración). El código que decide está en funciones sin Cloudflare (`cupos.ts`, `servicio.ts`, `lista-blanca.ts`), con reloj falso en las pruebas; las clases del objeto solo llaman a `cupos.ts`, sin SQL afuera, para poder migrar.

## Administración

Con `Authorization: Bearer <ADMIN_TOKEN>` (secreto de 32 caracteres o más; si no está cargado, estos caminos no existen):

| Pedido | Qué hace |
| --- | --- |
| `POST /v1/patrocinio/apagar` | Nadie patrocina: `503 apagado` |
| `POST /v1/patrocinio/pollar` | Devuelve el patrocinio a Pollar: el portero no paga y `/cupo` dice `rige:"pollar"` |
| `POST /v1/patrocinio/encender` | Vuelve el portero |
| `PUT /v1/patrocinio/ajustes` `{"clave","valor"}` | `max_sellos_mes`, `tope_general_stroops` (hasta 100 XLM; más hay que desplegar) o `tope_tx_stroops` (no más que el tope configurado); rige en el pedido siguiente |
| `GET /v1/patrocinio/estado` | Modo, **saldo de la cuenta patrocinadora leído de la red** (`balanceStroops`), `alerta:true` si está por debajo de `SALDO_ALERTA_STROOPS` o no se pudo leer, gasto de 24 h, lo que está en el aire |
| `GET /v1/patrocinio/exportar` | Todas las tablas, en JSON |

`APAGADO=1` como variable apaga aunque el objeto diga otra cosa.

## Probar

```bash
cd workers/patrocinio
node preparar-testnet.mjs        # una vez: crea en testnet la cuenta patrocinadora con su llave acotada; escribe .dev.vars y .prueba.json (no se versionan)
npx wrangler@4 dev --port 8793 --var POR_IP_POR_HORA:300
node probar.mjs http://127.0.0.1:8793          # 88 chequeos: un sello y un sorteo reales patrocinados con una cuenta de 0 XLM, una cuenta de dos firmas de dos, recursos inflados, y todo lo demás
node probar.mjs http://127.0.0.1:8793 --ip     # aparte: el tope por dirección (lo agota; el de las consultas de cupo es otro)
npx wrangler@4 dev --port 8794 --var CLAVE_PATROCINADOR:no-es-una-llave
node probar.mjs http://127.0.0.1:8794 --llave-mala   # aparte: con la llave mal pegada /cupo dice prendido:false, motivo config; devuelto a Pollar, motivo pollar
pnpm exec vitest run workers/patrocinio        # desde la raíz: 99 pruebas de unidad sin red (lista blanca, cupos en SQLite, servicio con una red de mentira)
```

`probar.mjs` solo habla con testnet y con un `wrangler dev` local (rechaza otra cosa). Gasta unos centavos de XLM de prueba y deja un sello y un sorteo con la marca `prueba-portero` en el contrato oficial de testnet. Las cuentas de 0 XLM las abre una "billetera de Pollar de prueba" propia, con el mismo mecanismo de patrocinio de reservas que usa Pollar, así que el portero las reconoce como de la app sin necesitar a Pollar. Las llaves de prueba son de testnet y no se usan en otra red.

Lo que cubren las pruebas de unidad y no `probar.mjs` (por no gastar sellos de verdad): el sello 20 pasa y el 21 da `429`, el reloj corriendo hasta el mes siguiente, treinta pedidos a la vez de una cuenta, cinco veces el mismo hash, el objeto que se reinicia con los conteos intactos, el peor caso de las reservas (sellos baratos y sorteos inflados, ocho sellos con el fee declarado al máximo), la reserva de un objeto muerto antes de mandar y la alarma del saldo. `probar.mjs` prueba el `429` con el cupo bajado a 1 por la ruta de ajustes.

## Cifras de arranque y CPU

Medidas el 2 de noviembre de 2026 con `@stellar/stellar-sdk/base` 17.3.0 (el XDR y el armado de transacciones; **las firmas se verifican y se hacen con WebCrypto**, porque la versión en JavaScript puro del SDK arma tablas de puntos en la primera firma y se come el presupuesto de CPU):

| | Medido | Límite del plan gratis |
| --- | --- | --- |
| Tamaño del paquete | 1416,73 KiB (207,38 KiB comprimido) | 3 MiB comprimido |
| Arranque (`wrangler check startup`, local) | 87,7 ms activos, 15,3 ms de recolección de basura | 1 s |
| CPU por pedido, en caliente (Node 24, mediana): leer y verificar la transacción | 0,5 ms | 10 ms |
| CPU por pedido, en caliente: pedido entero, con el fee-bump firmado y los cupos en SQLite | 4,7 ms (máximo 7,6) | 10 ms |
| El primer pedido de un objeto recién despertado (todo en frío) | 7,6 a 10 ms, **más** 3,5 a 5 ms de importar la llave: **11 a 15 ms** | 10 ms |

La CPU **no está medida en Cloudflare**: `wrangler dev` no la informa y el reloj de workerd no avanza mientras corre código, así que se midió en Node (el mismo V8, criptografía nativa) como aproximación. **El primer pedido en frío no entra en el plan gratis** (11 a 15 ms contra 10): Cloudflare lo corta con el error 1102, sin cuerpo JSON ni CORS. Y un objeto con poco tráfico se desaloja, así que en un stand muchos pedidos serán en frío. Por eso **el plan de US$5 (30 s de CPU) es el paso 1, antes de desplegar**, no después. Medir la CPU real es lo primero que hay que hacer al desplegar (`wrangler tail` o el panel de la cuenta).

## Plan y gasto

Corre con Durable Objects con SQLite (plan gratis: 100.000 pedidos y 100.000 filas escritas por día en toda la cuenta; con el plan de US$5, 1 millón de pedidos y 50 millones de filas escritas por mes). Estimaciones, no medidas en Cloudflare:

- **Un sello**: 1 pedido al Worker, 1 al objeto, 3 salidas a la red (leer la cuenta, que se hace en cada pedido por sus firmantes y umbrales; simular; mandar) y unas 2 vueltas de la alarma. Cuenta como unos 4 pedidos de la cuenta y unas 10 filas escritas.
- **Un sorteo completo** (sello, sorteo y dos consultas de cupo): unos 10 pedidos y unas 20 filas escritas.
- Contra el tope general de 15 XLM por día (unos 80 sorteos completos a precio de mainnet), el plan gratis alcanza de sobra: lo que limita es el dinero, no los pedidos. Con los 100.000 pedidos de la cuenta compartidos con los enlaces y la sala, **un abuso con scripts gasta el mismo cupo que abre los comprobantes**: por eso el plan de US$5 antes de mainnet y una regla de límite de Cloudflare (WAF) delante de `p.tinkazo.app`, que no vive en este código.
- Un pedido rechazado también cuenta como pedido.

## Hoja de operación

Todo se hace con la URL y la clave de administración (`ADMIN_TOKEN`, el secreto de 32 caracteres o más que se cargó con `wrangler secret put`). Desde la terminal o desde el celular:

```bash
export P=https://p.tinkazo.app
export T=<ADMIN_TOKEN>      # la cabecera es: Authorization: Bearer $T

# Apagar (se cae el servicio, se ve un abuso, o hay un evento y no se quiere arriesgar). Es lo urgente:
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/patrocinio/apagar
# Volver a encender el portero:
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/patrocinio/encender
# Devolver el patrocinio a Pollar (el portero no paga; /cupo dice rige:"pollar"):
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/patrocinio/pollar
# Estado: modo, saldo de la patrocinadora, alerta, gasto de 24 h, lo que está en el aire:
curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/estado
# Exportar todo (guardar el JSON fuera del repositorio):
curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/exportar -o exporte-$(date +%F).json
# Cambiar un tope sin desplegar (max_sellos_mes, tope_general_stroops, tope_tx_stroops); rige en el pedido siguiente:
curl -fsS -X PUT -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"clave":"tope_general_stroops","valor":100000000}' $P/v1/patrocinio/ajustes
```

- **Cargar fondos en mainnet**: mandar XLM a la cuenta patrocinadora (`CUENTA_PATROCINADORA`) **desde la cuenta fría**, en tramos de 40 a 60 XLM, nunca todo junto. Con la CLI de Stellar y la identidad de la fría: `stellar tx new payment --source-account <fria> --destination <CUENTA_PATROCINADORA> --asset native --amount <stroops> --network mainnet` (40 XLM son `400000000`; la ayuda de la CLI manda si la forma cambió: `stellar tx new payment --help`), o con Stellar Lab. Después `estado`: el saldo tiene que haber subido y `alerta` ser `false`. Sin saldo, la red contesta `txInsufficientBalance` y el portero da `503 fondo` y devuelve el cupo. En testnet `preparar-testnet.mjs` crea la cuenta y `probar.mjs` muestra cómo se mueve el dinero con la fría.
- **Rotar la llave del Worker** (si se sospecha que se filtró): con la fría, agregar una llave nueva de peso 1 y quitar la vieja (peso 0): `stellar tx new set-options --source-account <fria> --signer <G_NUEVA> --signer-weight 1 --network mainnet`, y lo mismo con la vieja en peso `0`. Después `npx wrangler@4 secret put CLAVE_PATROCINADOR` con la secreta nueva, y `estado` para ver que `llave` es la nueva. Lo peor que pudo hacer la vieja es gastar comisiones hasta lo cargado.
- **Volver a Pollar**: `curl ... /pollar`, y en el panel de Pollar (app de Tinkazo, Wallets, Sponsorship, pestaña Stellar, Contract sponsorship rules) prender la regla para `seal` y `draw` del contrato oficial, con un tramo chico de fondos. Para volver al portero: `curl ... /encender` y apagar esa regla. El nombre exacto de los botones del panel de Pollar puede cambiar y no se verificó para esta versión.
- **Si se perdió la clave de administración**: cargar una nueva con `npx wrangler@4 secret put ADMIN_TOKEN` (32 caracteres o más, por ejemplo `openssl rand -hex 32`); rige en el pedido siguiente.
- **Si el Worker mismo no contesta o no se puede entrar**: en el panel de Cloudflare, Workers, `tinkazo-patrocinio`, quitar la ruta `p.tinkazo.app/*` (el sitio, al no recibir respuesta de `/cupo`, deja de ofrecer el patrocinio y cada uno paga lo suyo), o `npx wrangler@4 deploy --var APAGADO:1` (apaga aunque el objeto diga otra cosa).
- **Si cambia el contrato oficial**: se actualiza `src/stellar/deployments.json` y se vuelve a desplegar este Worker, que lee el contrato de ahí al empaquetarse.

### Bitácora y alerta del fondo

- **Bitácora**: `wrangler.toml` tiene `[observability]` prendido y el portero escribe una línea de JSON por hecho clave: `reservado`, `enviado`, `resultado`, `devuelto`, `alarma`, y los `error-config`, `error-envio`, `error-interno`, `error-saldo` (estos salen como error). Con `npx wrangler@4 tail` o en el panel. **Nunca lleva direcciones IP, nombres, cuentas ni llaves**: solo nombres fijos, cifras y los primeros 8 caracteres del hash.
- **Alerta del fondo**: `GET /v1/patrocinio/estado` devuelve el saldo leído de la red y `alerta:true` por debajo de `SALDO_ALERTA_STROOPS` (20 XLM) o si no se pudo leer. Un paso del workflow diario de la red (`.github/workflows/vigilar-red.yml`) lo llama y falla si hay alerta o si no contesta: **está comentado hasta que exista el despliegue**, con el `curl` listo. Para activarlo: descomentarlo y cargar el secreto `PORTERO_ADMIN_TOKEN` en GitHub.

## Desplegar y encender (pendiente de la palabra de quien mantiene el proyecto)

1. **Pasar la cuenta de Cloudflare al plan de US$5 antes de desplegar** (el pedido en frío no entra en el plan gratis, ver [Cifras](#cifras-de-arranque-y-cpu)).
2. Crear la cuenta patrocinadora de mainnet con dos llaves (la fría de peso 2, la del Worker de peso 1, umbrales 1, 2 y 2, y su propia llave en 0), como hace `preparar-testnet.mjs` en testnet, y comprobar sus pesos en la cadena. Medir lo que cuesta un `draw` en mainnet y cargar `RESERVA_SORTEO_STROOPS` con ese costo más la mitad.
3. `npx wrangler@4 secret put CLAVE_PATROCINADOR` y `ADMIN_TOKEN`; cargar `CUENTA_PATROCINADORA` y `PATROCINADORES_APP` (la billetera de fondos **exclusiva** de la app de mainnet) como variables; poner `RED = "mainnet"` y completar `mainnet` en `src/stellar/deployments.json`.
4. `npx wrangler@4 deploy` y el registro AAAA `p` a `100::` con el proxy de Cloudflare, como con `c` y `s`. Poner la regla de límite delante de `p.tinkazo.app` (ver arriba).
5. Probar contra producción antes de abrirlo, con una cuenta de prueba, y mirar `/cupo` (tiene que decir `rige:"portero"` y `prendido:true`) y `/estado` (`alerta:false`).
6. Activar el paso de la alerta en el workflow diario.
7. **Los términos** (`terminos.html`, `tmMore1` y `tmMore4`) tienen que decir que, para cuidar el fondo, se cuenta cuántos sellos hizo cada cuenta y que no se guardan nombres. Los tiene que leer quien mantiene el proyecto antes de subir.

## Límites conocidos de esta versión

- Si el contrato necesita que se restauren entradas archivadas, el portero no las paga: lo hace la cuenta de mantenimiento del contrato (`pnpm check:renta`).
- El presupuesto estima cada transacción con el techo que acepta (1,5 veces lo simulado más un margen) y lo corrige con lo real que cobró la red cuando la alarma la ve cerrar. Es conservador a propósito.
- **Una fila devuelta no vuelve a contar.** Si la red rechazó un pedido (se devolvió) y, por una carrera entre dos pedidos del mismo hash, la transacción terminó entrando, el cobro no se suma al presupuesto: solo se anota lo que cobró la red. Lo ve la alerta del saldo, que lee la cadena. Es raro y está acotado por el tope de cada cuenta.
- El tope por dirección del Worker es por nodo y en memoria: un atacante repartido entre muchos nodos de Cloudflare lo esquiva. La defensa es la regla de Cloudflare (WAF) de arriba y, sobre todo, el tope general en dinero.
- Una cuenta que ya llegó a su tope del mes igual dispara la lectura de la cuenta y la simulación antes de recibir el `429`: no toca el fondo, sí la cuota del RPC.
- El cambio de mes es limpio: 20 sellos el último día a las 23:59 UTC y 20 más a las 00:00 son legítimos. Es el diseño.
- Un tercero puede mandar el `draw` de un sello ajeno (el contrato no pide firma para sortear): lo cuenta contra su propio cupo, nunca contra el del organizador, y el resultado es el mismo. Cuando el organizador llega, su `draw` falla en la simulación con `AlreadyDrawn` y recibe `400 fallaria`: el cliente tiene que tratar eso como «ya sorteado, mirá el resultado».
- El origen permitido incluye cualquier `tinkazo-*.vercel.app` y `localhost`: la comprobación de `Origin` no es una defensa (un script puede mentirlo), lo es la lista blanca. Conviene listar las vistas previas reales cuando se encienda en mainnet.
- `@stellar/stellar-sdk` está fijado en `17.3.0` exacto (sin `^`) en el `package.json` de la raíz y en el lockfile, porque las cifras de CPU de arriba son de esa versión: subirlo es un cambio a propósito y obliga a volver a medir.
- La llave del Worker se importa extraíble para leer su parte pública (un paso por un JWK); no se registra ni se devuelve en ningún lado. Riesgo teórico menor.
- `/exportar` y `/estado` devuelven todo en una respuesta, sin paginar.
- El contador de pedidos por dirección y la lista de cuentas vistas (400 días) no se pueden consultar desde afuera.
- Falta ver con la custodia de mainnet de Pollar (dos firmas de dos, si se confirma) que una cuenta real firme como se espera; la lectura de firmantes y umbrales ya está probada con cuentas de testnet con la maestra en cero.
- La oferta de inclusión del fee-bump es fija (`INCLUSION_BUMP_STROOPS`); no lee `getFeeStats`. Si la red sube mucho el precio de inclusión, la red rechaza el fee-bump (`txInsufficientFee`), el portero devuelve el cupo y da `400 rechazada`.
