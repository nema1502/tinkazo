# El portero de Tinkazo

Un Worker de Cloudflare (`tinkazo-patrocinio`, en `p.tinkazo.app`) que **cuenta y paga las comisiones de `seal` y `draw`** con su propio fee-bump, con un tope por cuenta y un tope general por día. Así los límites los pone Tinkazo y no dependen de lo que ofrezca ningún proveedor de cuentas: quien tiene sesión podía pedirle a su proveedor que pague desde un script propio, sin pasar por nuestra página, y un tope puesto en la página no frena a nadie.

Es un script aparte del de los enlaces (`tinkazo-enlaces`) y del de la sala (`tinkazo-sala`), en la misma cuenta: un error de despliegue o de uso acá no puede tumbar los comprobantes ni la sala. La cuenta comparte los 100.000 pedidos por día del plan gratis (ver [Plan y gasto](#plan-y-gasto)).

**Comprobar un sorteo no depende de este servicio.** `verificar.html` no lo llama. Si se cae, no se puede sellar con patrocinio, pero todo lo ya hecho se sigue comprobando, y quien paga su comisión (Freighter, una cuenta con saldo) no pasa por acá.

**Estado:** desplegado en testnet en `p.tinkazo.app`. El sitio lo usa en `tinkazo.app` y `www.tinkazo.app` cuando el build no trae `VITE_PATROCINIO_URL` (`src/stellar/patrocinio-config.ts`): nunca en localhost ni en vistas previas, y solo en testnet. Con esa dirección por defecto el portero no es condición para sellar: si no contesta o no entiende `/cupo`, el sitio paga como antes con Pollar; si contesta que está apagado, sin fondo o sin configuración, se respeta. Con la variable puesta a mano sigue cerrado ante la duda.

## Cómo funciona

El navegador arma la transacción, la simula y la firma **sin patrocinio**, y la manda acá. El portero:

1. mira si está prendido (y quién rige);
2. la pasa por la **lista blanca estricta** y verifica la firma, sin tocar nada;
3. si ese hash ya estaba pagado, devuelve el mismo resultado sin contar dos veces (el navegador reintenta);
4. mira que **la cuenta la haya abierto nuestra app**;
5. la simula, para no pagar lo que va a fallar (`AlreadyDrawn`, `RoundNotReady`);
6. **reserva** el cupo de la cuenta (con el plan del equipo, si lo tiene: ver [El plan del equipo sube el cupo](#el-plan-del-equipo-sube-el-cupo)) y el presupuesto general, de una vez;
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
| Sellos por cuenta y por mes (UTC) | **20**; 50 para `CUENTAS_VERIFICADAS`; **50 con el plan del equipo activo** (lo dice el Worker de la cuenta, ver abajo) | `MAX_SELLOS_MES`, `MAX_SELLOS_VERIFICADA`, o en caliente por `PUT /v1/patrocinio/ajustes`. El cupo del plan sale de `workers/cuenta/src/reglas.ts` |
| Sorteos por cuenta y por mes | el doble de sus sellos (40, 100); **100 con el plan del equipo**. **Sortear no se frena por el cupo de sellos**; este tope solo corta un abuso | |
| General, en ventana móvil de 24 h | **15 XLM** (`150000000` stroops) | `TOPE_GENERAL_STROOPS`, o por ajustes |
| Por transacción | 1 XLM de recursos y de total | `TOPE_TX_STROOPS` |
| Inclusión que declara la transacción, y oferta del fee-bump | **10.000 stroops** por operación (100 veces la base de la red). La oferta es siempre esta, nunca lo que declara el cliente; una inclusión declarada por encima no se paga, porque la red exige una oferta igual o mayor | `INCLUSION_BUMP_STROOPS` |
| Recursos declarados | hasta **1,5 veces lo que simula la red más 50.000 stroops**; por encima, `400 fee-alta` | `MARGEN_RECURSOS_STROOPS` |
| Guardado para el sorteo de cada sello | **82.000 stroops** fijos: lo que costó un `draw` en testnet (54.251, el 2 de noviembre de 2026) más la mitad. En mainnet se mide y se carga antes de encender | `RESERVA_SORTEO_STROOPS` |
| Cuánto dura lo guardado para un sorteo sin hacer | **6 horas** | |
| Alerta del saldo de la patrocinadora | **20 XLM** (más que el tope de un día) | `SALDO_ALERTA_STROOPS` |
| Ventana de la transacción | 300 s | `VENTANA_MAX_S` |
| Pedidos de pago por dirección y por hora | 240 (una wifi de evento con varios organizadores comparte dirección), en memoria, sin guardar la IP (en IPv6, el /64). Las consultas de cupo tienen su propio contador: 3.000 en mainnet, como las altas (todo un stand sale por la misma wifi y el sitio pregunta el cupo antes de cada sello y cada sorteo), y 600 en testnet (`cupoPorHora`, `src/por-ip.ts`). El tope de verdad es la regla de Cloudflare de abajo | `POR_IP_POR_HORA` |

### El plan del equipo sube el cupo

Quien compró el plan del equipo (5 USDC, 30 días, ver `workers/cuenta/README.md`) tiene mientras dure **50 sellos y 100 sorteos por mes** en lugar de 20 y 40: el sitio dice "50 sorteos propios por 30 días". El portero no guarda quién tiene plan: se lo pregunta al Worker de la cuenta.

- **El contrato entre los dos Workers** es un solo recurso público y de solo lectura: `GET <CUENTA_URL>/v1/cuenta/<cuenta>/plan` → `{activo:true, vence, cupo:{sellos, sorteos}}` o `{activo:false}`. `vence` en ms.
- **Cuándo se pregunta.** Al calcular los topes de una cuenta: en cada `POST /v1/patrocinio` (antes de reservar, nunca en medio, así reservar sigue siendo una sola jugada) y en cada `GET /cupo`. Por eso `/cupo` y el "Te quedan N sorteos gratis este mes" del sitio ya muestran el cupo del plan.
- **Tiempo máximo: 1,5 segundos.** Pasado eso se corta la consulta y vale el cupo de siempre.
- **Caché en memoria del objeto** (no se guarda en el SQLite): 5 minutos por cuenta si tiene plan (y nunca más allá de su `vence`), **1 minuto si no lo tiene**. La de «sin plan» es corta a propósito: quien llegó a su tope, compra el plan y vuelve a sellar no tiene que esperar cinco minutos. Las preguntas en curso por la misma cuenta se comparten, y la caché no pasa de 5.000 cuentas.
- **Si el Worker de la cuenta falla, el portero no se entera**: un corte, un tiempo agotado, un error (`4xx`/`5xx`, incluido su tope por dirección) o una respuesta que no tiene la forma de siempre se tratan igual, como "no se pudo saber": **cupo de siempre, el pedido sigue y se paga**. Tras una falla no se vuelve a preguntar por ninguna cuenta durante 30 segundos, así una caída cuesta una espera de 1,5 s y no una por pedido. Queda `plan-sin-respuesta` (con un motivo fijo: `tiempo`, `red`, `http-503`, `forma`, `largo`) en la bitácora, sin cuentas.
- **El plan solo sube, nunca baja**: el cupo es el más alto entre el de siempre (o el de una cuenta verificada, o el ajustado por administración) y el del plan. Una respuesta con cupos fuera de 0 a 1.000 se descarta como rota.
- **No cambia nada más**: ni el tope general en dinero, ni la regla de que la cuenta la abrió nuestra app, ni el interruptor. El plan no abre una puerta, sube un contador.
- **Se enciende con `CUENTA_URL`** (`https://cuenta.tinkazo.app`). Vacía, que es como nace, no se pregunta nada y todas las cuentas tienen el cupo de siempre. Solo se acepta `https` (o `http` en localhost para probar) y solo el origen, sin ruta: una dirección mal escrita se ignora y queda `error-config` con `falta:["cuenta-url"]` en la bitácora. En local, con los dos Workers en `wrangler dev`, la dirección es `http://127.0.0.1:<puerto>` y no `http://localhost:<puerto>`: con `localhost` el Worker prueba primero la dirección IPv6, donde `wrangler dev` no escucha, y el portero se rinde a los 1,5 segundos con `plan-sin-respuesta` (motivo `tiempo`) y deja el cupo de siempre (se vio en el ensayo del 6 de noviembre de 2026).
- **Mes calendario, no 30 días.** El cupo mensual es por mes UTC como siempre: con el plan vigente el tope de cada mes es 50. Lo que la cuenta ya usó ese mes cuenta contra ese 50.

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

`GET /v1/patrocinio/cupo?cuenta=G…` (abierto, solo lectura) dice `{prendido, motivo?, rige:"portero"|"pollar", red, mes, sellos:{usados,max,quedan}, sorteos:{…}, liberaEn}`. El sitio lo usa para frenar sin desplegar: **decide primero por `rige` y recién después por `prendido`**. **`prendido` significa «el portero paga»**: es `false` con `motivo:"apagado"` si se apagó, con `motivo:"config"` si falta la llave del Worker, la cuenta patrocinadora o el contrato (o, en mainnet sin las altas, la lista de billeteras de la app), y con `motivo:"pollar"` (y `rige:"pollar"`) si se devolvió a Pollar. Así una llave mal pegada no hace que el sitio ofrezca un patrocinio que va a dar `503`, y si `rige` es `pollar` el sitio usa a Pollar sin intentar el portero (que daría `503`). Un fallo al leer la llave sale en la bitácora (`wrangler tail`), nunca con la llave. Una cuenta mal escrita da `400 {motivo:"cuenta"}`.

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

El objeto `Patrocinio` (SQLite, uno por red) guarda cuentas (G…), el mes y el contador, los hashes pagados con su resultado (`reservado`, `enviado`, `ok`, `fallo`, `devuelto`), lo estimado y lo real que cobró la red, lo guardado para sorteos y las cuentas que ya se vieron como de la app. **No guarda nombres, listas, direcciones IP ni nada que identifique a una persona más allá de su cuenta de Stellar**, que ya es pública en la cadena. Si `CUENTA_URL` está cargada, le manda esa misma dirección pública al Worker de la cuenta para saber si tiene el plan, y recuerda la respuesta en memoria (no en el SQLite) unos minutos. `uso` se purga a los 35 días. Todo sale como JSON por `GET /v1/patrocinio/exportar` (con la clave de administración). El código que decide está en funciones sin Cloudflare (`cupos.ts`, `servicio.ts`, `lista-blanca.ts`), con reloj falso en las pruebas; las clases del objeto solo llaman a `cupos.ts`, sin SQL afuera, para poder migrar.

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
node probar.mjs http://127.0.0.1:8793          # 89 chequeos: un sello y un sorteo reales patrocinados con una cuenta de 0 XLM, una cuenta de dos firmas de dos, recursos inflados, y todo lo demás
node probar.mjs http://127.0.0.1:8793 --ip     # aparte: el tope por dirección (lo agota; el de las consultas de cupo es otro)
npx wrangler@4 dev --port 8794 --var CLAVE_PATROCINADOR:no-es-una-llave
node probar.mjs http://127.0.0.1:8794 --llave-mala   # aparte: con la llave mal pegada /cupo dice prendido:false, motivo config; devuelto a Pollar, motivo pollar
pnpm exec vitest run workers/patrocinio        # desde la raíz: 133 pruebas de unidad sin red (lista blanca, cupos en SQLite, servicio con una red de mentira, y el plan del equipo con un Worker de la cuenta de mentira)
```

`probar.mjs` solo habla con testnet y con un `wrangler dev` local (rechaza otra cosa). Cada sello apunta a una ronda que nace 90 s después de armarlo, y la prueba dice con cuánto margen llegó al ledger: el contrato pide 30 s o más (`RoundTooSoon`), y con el RPC público de testnet lento el camino entero (simular, el portero y el ledger) se come de 17 a 23 s (medido el 8 de noviembre de 2026). Con los 45 s de antes el ensayo del 6 de noviembre no quedaba en verde. Gasta unos centavos de XLM de prueba y deja un sello y un sorteo con la marca `prueba-portero` en el contrato oficial de testnet. Las cuentas de 0 XLM las abre una "billetera de Pollar de prueba" propia, con el mismo mecanismo de patrocinio de reservas que usa Pollar, así que el portero las reconoce como de la app sin necesitar a Pollar. Las llaves de prueba son de testnet y no se usan en otra red.

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

Para un evento con el portero de mainnet, la hoja es [docs/operacion.md](../../docs/operacion.md): qué preparar, qué mirar cada hora, con qué número se frena y cómo cortar. Lo de abajo es la operación de todos los días.

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
- **Si el Worker mismo no contesta o no se puede entrar**: en el panel de Cloudflare, Workers, `tinkazo-patrocinio`, quitar el dominio `p.tinkazo.app` (el sitio, al no recibir respuesta de `/cupo`, deja de ofrecer el patrocinio y cada uno paga lo suyo), o `npx wrangler@4 deploy --var APAGADO:1` (apaga aunque el objeto diga otra cosa).
- **Si cambia el contrato oficial**: se actualiza `src/stellar/deployments.json` y se vuelve a desplegar este Worker, que lee el contrato de ahí al empaquetarse.

### Bitácora y alerta del fondo

- **Bitácora**: `wrangler.toml` tiene `[observability]` prendido y el portero escribe una línea de JSON por hecho clave: `reservado`, `enviado`, `resultado`, `devuelto`, `alarma`, `plan-sin-respuesta` (el Worker de la cuenta no contestó: se usó el cupo de siempre), y los `error-config`, `error-envio`, `error-interno`, `error-saldo` (estos salen como error). Con `npx wrangler@4 tail` o en el panel. **Nunca lleva direcciones IP, nombres, cuentas ni llaves**: solo nombres fijos, cifras y los primeros 8 caracteres del hash.
- **Alerta del fondo**: `GET /v1/patrocinio/estado` devuelve el saldo leído de la red y `alerta:true` por debajo de `SALDO_ALERTA_STROOPS` (20 XLM) o si no se pudo leer. Un paso del workflow diario de la red (`.github/workflows/vigilar-red.yml`) lo llama y falla si hay alerta o si no contesta: **está comentado hasta que exista el despliegue**, con el `curl` listo. Para activarlo: descomentarlo y cargar el secreto `PORTERO_ADMIN_TOKEN` en GitHub.
- **La vigilancia del portero de mainnet**: un workflow aparte, `.github/workflows/vigilar-portero.yml`, que corre hasta una vez por hora, cuando GitHub lo dispara (y a mano con `workflow_dispatch`). Llama a `https://pm.tinkazo.app/v1/patrocinio/estado` con la clave de operar y lo revisa con `scripts/lib/vigilar-portero.mjs`: falla si los créditos de Pollar están por debajo del piso más 1.000, si la patrocinadora está baja (`alerta`), si hay más de 10 firmas sin explicar o si el patrocinio de la app en Pollar no está todo apagado, y también si algo de eso no se pudo leer o si contesta un portero que no es el de mainnet. Es el respaldo de la mirada a mano de [operacion.md](../../docs/operacion.md), no la alarma. Corre con el Environment `vigilancia` de GitHub, que solo ve `main`: la clave de operar (`PORTERO_MAINNET_ADMIN_TOKEN`, el `ADMIN_TOKEN` de `--env mainnet`) se carga ahí y no entre los secretos del repositorio, que cualquier workflow de cualquier rama puede leer. Está prendido pero no hace nada, y sale bien, mientras esa clave no esté en el Environment. Para mirarlo a mano: `curl -fsS -H "Authorization: Bearer $T" https://pm.tinkazo.app/v1/patrocinio/estado -o e.json && node scripts/lib/vigilar-portero.mjs e.json`.

## Desplegar y encender (pendiente de la palabra de quien mantiene el proyecto)

1. **Pasar la cuenta de Cloudflare al plan de US$5 antes de desplegar** (el pedido en frío no entra en el plan gratis, ver [Cifras](#cifras-de-arranque-y-cpu)).
2. Crear la cuenta patrocinadora de mainnet con dos llaves (la fría de peso 2, la del Worker de peso 1, umbrales 1, 2 y 2, y su propia llave en 0), como hace `preparar-testnet.mjs` en testnet, y comprobar sus pesos en la cadena. Medir lo que cuesta un `draw` en mainnet y cargar `RESERVA_SORTEO_STROOPS` con ese costo más la mitad.
3. El portero de mainnet es **otro Worker**, `tinkazo-patrocinio-mainnet` en `pm.tinkazo.app`, con su propio objeto: la sección `[env.mainnet]` de `wrangler.toml`, que ya trae `RED = "mainnet"` y sus variables. Lo de arriba del archivo sigue siendo el de testnet en `p.tinkazo.app` y se despliega como siempre, sin `--env`. Para mainnet: `npx wrangler@4 secret put CLAVE_PATROCINADOR --env mainnet` y `ADMIN_TOKEN --env mainnet` (y, para las altas, `CUPONES_TOKEN`, `POLLAR_SECRETO` y `CUPON_SECRETO`, igual); cargar `CUENTA_PATROCINADORA` y `POLLAR_APP_ID` en `[env.mainnet.vars]`, y completar `mainnet` en `src/stellar/deployments.json`. Con `ALTAS = "1"` la puerta mira solo el libro de cuentas y `PATROCINADORES_APP` queda vacía a propósito (ver «Altas y cupones»).
4. `npx wrangler@4 deploy --env mainnet`: el despliegue crea el registro y el certificado de `pm.tinkazo.app` (dominio propio de Cloudflare, `custom_domain` en `wrangler.toml`), sin registro AAAA a mano. Poner la regla de límite delante de `pm.tinkazo.app` (ver arriba).
5. Probar contra producción antes de abrirlo, con una cuenta de prueba, y mirar `/cupo` (tiene que decir `rige:"portero"` y `prendido:true`) y `/estado` (`alerta:false`).
6. Para que el plan del equipo suba el cupo: con el Worker de la cuenta ya desplegado (`workers/cuenta/README.md`), cargar `CUENTA_URL = "https://cuenta.tinkazo.app"` en `wrangler.toml` y volver a desplegar. Comprobar con `/cupo?cuenta=<una cuenta con plan>`: `sellos.max` tiene que decir 50. Sin esta variable el portero se comporta como siempre.
7. Activar el paso de la alerta en el workflow diario.
8. **Los términos** (`terminos.html`, `tmMore1` y `tmMore4`) tienen que decir que, para cuidar el fondo, se cuenta cuántos sellos hizo cada cuenta y que no se guardan nombres. Los tiene que leer quien mantiene el proyecto antes de subir.

## Altas y cupones (solo mainnet)

Lo que sigue nace apagado y vale solo en el portero de mainnet: en testnet sus variables se ignoran y el portero hace lo de siempre.

- **`ALTAS = "1"`** prende el libro de cuentas: la tabla `cuenta_app` con `permanente = 1`, que se escribe cuando el servidor confirma un cupón, un pago o un alta a mano. Con el libro prendido, **la puerta mira solo el libro**: ni una cuenta ya vista ni una abierta por la billetera de fondos de Pollar alcanzan, y lo que no está en el libro da `403 {motivo:"cuenta-ajena"}`. Lo del libro no se purga nunca. Con `ALTAS = "0"` y `PATROCINADORES_APP` vacía, el portero de mainnet no le paga a nadie.
- **`ALTAS_PAGO`** (órdenes de pago) y **`SORTEO_SERVIDOR`** (el `draw` que manda el servidor) solo se prenden con `ALTAS = "1"` y con lo que necesitan bien escrito: `PRECIOS` y `CUENTA_COBROS` el pago, `CUENTA_SORTEADORA` el sorteo. Un `PRECIOS` mal escrito no vende nada. Lo que falta sale en la bitácora como `error-config` con `faltaAltas` (nombres fijos, sin valores).
- **En mainnet los sorteos del mes son tantos como los sellos** (en testnet, el doble).
- **Los cupones** (`src/altas.ts`): 12 caracteres del alfabeto de Crockford, que se leen sin espacios ni guiones, en mayúsculas, con la O como 0 y la I o la L como 1 (`src/cupon-codigo.ts`, sin dependencias, y su vector `src/cupon-vectores.json`, que tienen que pasar también el sitio y la herramienta). En la base queda solo la huella, HMAC-SHA256 con `CUPON_SECRETO`: rotar el secreto anula los cupones vivos. Se crean por lote, con 1 a 50 sorteos por cupón (el paquete de 50 que se vende por fuera) y dos techos en el código por día: 500 usos nuevos y 500 sorteos prometidos (usos por sorteos), aunque cada código vaya en un lote propio. El canje es una sola transacción, sin `await` en el medio: la misma persona con el mismo cupón recibe lo mismo sin gastar otro uso; si no, `cupon-no-existe`, `cupon-anulado`, `cupon-vencido`, `cupon-usado` o `lote-usado` (uno por persona y por lote), sin escribir nada. Si pasa, abre el alta, da los sorteos del cupón y, con la cuenta, la ata y la mete en el libro. Anular un lote no le quita nada a quien ya canjeó.
- **Los sorteos oficiales** (tabla `derechos`): cada persona tiene los que le dio un cupón, un pago o administración, cada lote con su vencimiento y un `ref` único (el mismo `ref` otra vez no suma). Con `ALTAS = "1"`, **cada `seal` gasta uno** (dos con más de 50 ganadores), del lote sin vencer que vence primero, en la misma jugada síncrona que el cupo del mes y el presupuesto; sin sorteos que alcancen da `402 {motivo:"sin-sorteos", vencieron}` sin mandar ni contar nada. Un `draw` no gasta ninguno. Si la red rechaza el sello sin que entre, el sorteo vuelve a su lote (`consumos` anota de qué lote salió cada uno); si entró y falló, cuenta. Cada `seal` que paga el portero queda además en `sellos_portero` con el organizador, la huella de la lista y la ronda (los argumentos 0, 1 y 4), en la misma transacción: es lo que va a mirar el portero para pagar solo los `draw` de sellos suyos. Si la red lo rechaza sin que entre, o entra y falla, la fila se borra.
- **Quién es la persona** (`src/pollar.ts`): el sitio manda el token de la sesión de Pollar en `Authorization: Bearer`, y el portero lo verifica con `POST /v3/tokens/verify` y la llave `POLLAR_SECRETO` (exige la app de mainnet, la red principal y que no haya vencido). Lo que no tiene forma de token no llega a Pollar. El resultado se recuerda 60 s por la huella del token; el token no se guarda ni se anota. La cuenta de Stellar sale del verify o de la fila exacta de la persona en `GET /v3/users`, nunca del navegador. Cada llamada a Pollar espera 8 s como máximo.
- **Las rutas** (`src/rutas-altas.ts`), solo en mainnet: `POST /v1/alta/estado` (`{acceso, cuenta, abierta, pedido, sorteos:{quedan, proximoVence}, orden, fondeo}`; si la persona tiene alta, ata su cuenta y la mete en el libro; si el alta ya tiene una cuenta atada y la que trae el verify de Pollar en esta sesión es otra, `409 cuenta-de-otro` sin escribir nada) y `POST /v1/alta/cupon` `{cupon}` (`{ok, repetido, sorteosSumados, sorteos, sigue:"crear-billetera"|"abrir"|"activar"|"lista"}`; con el alta atada a otra cuenta que la del verify, el mismo `409 cuenta-de-otro`, sin canjear ni escribir nada, para que el sitio no active una cuenta que no está en el libro). Primero se espera todo lo que hay que esperar (Pollar, la huella, la red) y después se escribe de una vez, sin `await` en el medio. Errores: `401 sesion`, `403 otra-app`, `502 pollar`, `503 apagado` (con `ALTAS = "0"`, o con `detalle:"config"` si falta la llave de Pollar, la app o `CUPON_SECRETO`), `400 forma`, `404 cupon-no-existe`, `410 cupon-vencido {vence}` o `cupon-anulado`, `409 cupon-usado`, `lote-usado` o `cuenta-de-otro`, y `429 intentos {reintentarEn}` (en ms). Los topes de intentos son tres: 5 códigos fallidos por persona y por hora; 200 códigos fallidos por dirección y por hora, que frenan solo el canje (`/v1/alta/estado` nunca se traba por dirección); y 200 tokens con forma de token que Pollar rechazó (inventados, vencidos o de la app de Prueba) por dirección y por hora, que frenan solo que se le pregunte a Pollar por un token nuevo de esa dirección. Un pedido sin token, o con uno sin forma de token, da `401 sesion` sin preguntar ni contar nada, y una sesión que Pollar ya dio por buena nunca se traba por dirección: en una wifi de evento, quien manda basura no traba a quien ya entró. Lo que queda: con 200 tokens inventados con forma, quien todavía no entró por esa dirección espera la hora (o entra por los datos del celular). Además, la puerta del Worker corta en `429 {motivo:"cupo-ip"}` (sin `reintentarEn`) pasados 3.000 pedidos a `/v1/alta/*` por dirección y por hora, en memoria de cada nodo: es para todo un stand junto. En mainnet, los pagos de `/v1/patrocinio` por dirección suben a 600 por hora (`POR_IP_POR_HORA`; en testnet siguen en 240). En testnet las rutas no existen (404, como siempre). El preflight de estas rutas suma `Authorization`.
- **El piso de créditos.** `piso = CREDITOS_POR_SORTEO × (sorteos prometidos sin usar ni vencer) + CREDITOS_POR_ALTA × (altas sin activar) + 300`. Un canje nuevo pasa solo si los créditos de Pollar (`GET /v3/billing/credits`, `available`, recordado 60 s), menos lo que suma ese canje, no quedan por debajo del piso; si no, `503 {motivo:"altas-pausadas"}` y **el cupón no se gasta**. Con Pollar caído vale el último saldo leído durante 10 minutos (guardado en el ajuste `creditos_ultimo`, así sobrevive a un reinicio del objeto); después, lo nuevo se pausa. Con el ajuste `altas_pausadas` en `1`, también. **Lo ya canjeado nunca se frena**: el canje repetido, `/v1/alta/estado` y el sello no miran el piso. Cada pausa sale en la bitácora como `alta-pausa` con su motivo (`piso`, `creditos` o `a-mano`). `GET /v1/patrocinio/estado` suma `creditos`, `creditosLeidos`, `piso`, `margen` (créditos menos piso) y `altasPausadas`, para mirarlos cada hora el día del evento.
- **Cuánto cargar y qué mirar el día de un evento.** El piso reserva siempre el peor caso (40 por cada sorteo prometido, aunque la gente use uno solo), y usar un sorteo no libera margen: baja el piso y el saldo a la vez. Lo que sí come margen sin que el piso lo reserve son los 15 créditos de cada ingreso con Google en Oficial (la billetera se crea al entrar) y cada reintento de firma (20). Por eso cada tarjeta canjeada se come, en el peor caso, 165 de margen: 15 del ingreso, 120 de sus 3 sorteos y 30 del alta. La cuenta, antes de abrir el stand y cada hora: **`margen` ≥ 165 × tarjetas sin canjear + 15 × curiosos esperados + 20 × reintentos esperados**. Para 40 tarjetas y cien curiosos: 300 de base + 40 × 165 + 1.500 + unos 300 de reintentos = **8.700**; para 30, unos **7.100**. Una cuenta admitida a mano también suma al piso (40 por sorteo): el día del evento, admitirla con pocos sorteos (3 a 5) y sumarle el resto después. Si `margen` no alcanza, cada canje nuevo da `503 altas-pausadas` (el cupón no se pierde, pero esa persona no sortea ese día): cargar créditos o pausar el reparto de tarjetas. La alerta de créditos bajos de Pollar va en piso + 165 × tarjetas que faltan, no en un número fijo.
- **El servidor de Pollar y el de Horizon van fijos en el código** (`src/servidores.ts`), no en una variable: el repositorio es público y una variable cambiada mandaría la llave a otro lado. Una ruta que no es limpia o una redirección fallan sin seguir.
- **Los pagos** (`src/cobros.ts`), con `ALTAS_PAGO = "1"`, `PRECIOS` y `CUENTA_COBROS` (la cuenta que recibe; el Worker no tiene su llave). Quien llega de afuera pide `POST /v1/alta/orden` `{producto}` (`alta`, `p10` o `p50`) con su sesión y recibe su orden: `{orden:{id, producto, usdc, sorteos, destino, nota:"tk:o:ABCD2345", memoId, enlace, vence}}`, con un id de 8 caracteres del alfabeto de los cupones (40 bits al azar), 72 horas para pagar y el enlace de pago SEP-7 (`web+stellar:pay?…`, con la nota y el emisor de Circle). Una orden abierta por persona y por producto: pedirla otra vez da la misma. Quien ya tiene acceso no compra el primer paquete (`409 ya-tiene-acceso`). Una orden nueva no nace con el pago apagado (`503 pago-apagado`), con la venta pausada (`503 venta-pausada`) ni bajo el piso de créditos (`503 altas-pausadas`). `POST /v1/alta/pago` `{orden}` lee los pagos nuevos en Horizon y contesta `{pagada:true, sorteos, sigue}` o `{pagada:false, recibido, total, minimo}`; una orden de otra persona es `404 orden`, y Horizon caído, `502 red` sin marcar nada. `/v1/alta/estado` trae la orden abierta en `orden`, con lo que ya llegó (`recibido`). Una orden pagada a medias no se esconde al vencer: `/estado` la sigue trayendo y pedir `/orden` otra vez devuelve la misma, con la misma nota y otras 72 horas, hasta 30 días desde que se creó. Si la persona tiene una orden sin pagar de esos 30 días, `/estado` y `/orden` leen antes los pagos nuevos (como mucho una vez cada 5 segundos para todo el objeto; si Horizon no contesta, siguen con lo que ya se sabía): quien pagó y cerró la pantalla sin tocar «Ya pagué» vuelve y ya tiene su acceso. `GET /v1/alta/precios` es abierta, con caché de 5 minutos: `{red, pago, alta:{usdc, sorteos, dias}, paquetes}`.
  - **Qué cuenta como pago**: solo USDC de Circle; lo que llega convertido de otra moneda vale lo que llegó. La nota se lee como un cupón (sin espacios ni guiones, en mayúsculas, la O por 0, la I o la L por 1) con el prefijo `tk:o:` (o `tk:0:`) sin distinguir mayúsculas; también vale la nota numérica (`MEMO_ID`, el id de la orden como número de 40 bits, para los exchanges que solo aceptan números). Desde el 95 % del monto la orden queda pagada, dos pagos de la misma orden suman y un pago de al menos el 95 % a una orden ya pagada da otro paquete igual. Una orden vencida que se paga se respeta. Una orden pagada da el alta (si la persona no tenía) y sus sorteos por los días del producto; con `ALTAS_PAGO = "0"` se siguen leyendo y pagando las órdenes que ya existen.
  - **Ningún pago se pierde ni sirve dos veces**: cada operación de Horizon se anota una sola vez, en `pagos` (atada a una orden, que es de una sola persona) o en `pagos_sueltos`: sin nota, una nota que no es de ninguna orden, otro activo, o lo que sobra de una orden. Lo suelto se lista, se asigna a una orden o se marca devuelto por administración; devolver lo hace a mano quien tiene la llave de `CUENTA_COBROS`.
  - **La lectura**: `GET /accounts/<CUENTA_COBROS>/payments?order=asc&limit=200&include_failed=false&join=transactions` desde el cursor guardado (`cobros_cursor`), hasta 5 páginas por vuelta, como mucho una vez cada 5 segundos para todo el objeto (en el medio se contesta con lo último leído). El cursor y los pagos de cada vuelta se escriben en la misma transacción, y el cursor nunca retrocede. Horizon va fijo en el código.
- **La fase 2: el servidor abre la cuenta** (`POST /v1/alta/abrir`, con la sesión y `{}`). Sirve con `POLLAR_FONDEO = "diferido"` (Pollar en `DEFERRED`), cuando la cuenta en la red ya no se abre sola al entrar: el portero le pide a Pollar `POST /v3/wallets/fund` con la billetera de Stellar que Pollar dice para esa persona (nunca la del navegador), y con una billetera de Turnkey Pollar deja un pedido que la persona aprueba en su sesión («Activar»). Responde `{estado:"pedido"}` (el `requestId` queda en el alta, que pasa a `pedida` y sigue contando en el piso hasta que la cuenta exista), `{estado:"abierta"}` (la cuenta ya está en la red, o Pollar contesta `WALLET_ALREADY_FUNDED`) o `{estado:"no-hace-falta"}` (con fondeo inmediato no se llama a Pollar). Errores: `403 sin-acceso` (sin cupón, pago ni alta a mano: no se llama a nadie), `409 sin-billetera` (todavía no creó la billetera, o Pollar no la conoce), `503 sin-creditos` (Pollar contestó 402), `502 pollar`, y `429 espera {reintentarEn}`: a Pollar se le pide como mucho una vez por minuto por alta. No mira el piso: es de quien ya canjeó o pagó. La bitácora suma `alta-abrir` con el resultado, nunca la cuenta ni el pedido.
- **La vigilancia de firmas.** Cada firma de una cuenta de Google le cuesta 20 créditos a Tinkazo, la pida nuestro sitio o un programa armado por fuera. `GET /v1/patrocinio/estado` compara, en las últimas 24 horas, las firmas que cobró Pollar (los movimientos `cosign.signature` de `GET /v3/billing/credits?since=…&limit=200`) con las que explican nuestros números: los sellos que llegaron al portero desde cuentas del libro (también los que la red rechazó: se firmaron), los sorteos que mandó la persona (con `SORTEO_SERVIDOR = "1"` no cuentan, porque los firma la sorteadora) y las activaciones del día (altas que pasaron a abiertas después de nacer). Suma `firmasSinExplicar` (lo cobrado menos lo explicado, nunca menos de cero; `null` si Pollar no contestó), `firmas` (`{cobradas, explicadas, sellos, sorteos, activaciones, completo, desde}`; `completo: false` si vinieron 200 movimientos y puede haber más) y `patrocinioPollar` (`{esperado, prendidos}`, leído de `GET /v3/treasury/sponsorship`: se espera todo apagado, y `prendidos` nombra las banderas `sponsor_…` que no lo están; `null` si no se pudo leer). Más de 10 sin explicar sale en la bitácora como `error-firmas`, y el patrocinio prendido como `error-patrocinio` (solo cifras). Es una cota, no una cuenta exacta: una firma que el portero rechazó antes de reservar (la simulación falla) y la que Pollar cobre al aprobar otra cosa quedan sin explicar, y una cuenta admitida a mano que firma con su propia billetera se cuenta como explicada. La forma de cada movimiento y el código de la respuesta del patrocinio están por confirmar con Pollar: lo que no se entiende no cuenta, y un patrocinio sin banderas no se da por apagado. La vigilancia diaria de la CI lo mira (ver «Bitácora y alerta del fondo»).
- **El cupo que ve el sitio.** Con `ALTAS = "1"`, `GET /v1/patrocinio/cupo?cuenta=G…` suma `oficial:{acceso, sorteos:{quedan, proximoVence:{fecha, cuantos}}|null}`: `acceso` es si la cuenta está en el libro, y los sorteos son los oficiales sin usar ni vencer. `sellos.quedan` pasa a ser lo menor entre el tope del mes y esos sorteos (fuera del libro, 0), así el sitio no pide una firma que el portero va a rechazar. Con `ALTAS = "0"` y en testnet, `/cupo` sigue igual.

### Altas y cupones: la administración

Solo en mainnet con `ALTAS = "1"` (`src/admin.ts`); en testnet `/v1/admin/` no existe. **Dos claves, cada una para lo suyo**: `CUPONES_TOKEN` crea y anula cupones y da sorteos; `ADMIN_TOKEN` (la de siempre) pausa y reanuda las altas, mira el estado y exporta. La clave de operar no crea cupones ni da sorteos, y la de cupones no pausa nada. Las dos son secretos del Worker de 32 caracteres o más (`npx wrangler@4 secret put CUPONES_TOKEN --env mainnet`); si una no está cargada, sus rutas no existen (404), y si son iguales lo de cupones no se atiende (`503 claves-iguales`) hasta separarlas.

| Pedido | Clave | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `POST /v1/admin/cupones` | Cupones | `{lote, codigos:[hasta 500], sorteos, dias, vence, usos}` (`vence` en ms) | `{creados, repetidos}`; pasado el techo del día, `400 techo` |
| `GET /v1/admin/cupones?lote=` | Cupones | | `{lote, creados, canjeados, cuentas, sorteosUsados, vence, anulado, anulados}`; `404 lote` |
| `POST /v1/admin/cupones/anular` | Cupones | `{lote}` o `{codigo}` | `{anulados}`. Lo ya canjeado sigue valiendo |
| `POST /v1/admin/altas` | Cupones | `{cuenta, sorteos, dias, ref}` | Admite una cuenta que ya existe y le da sus sorteos con `ref` `admin:<ref>`: `{ok, repetido, altaNueva, sorteos}`. El mismo `ref` para otra cuenta, `409 ref-usado` |
| `POST /v1/admin/altas/pausar` y `/reanudar` | Operar | | `{pausadas}`. Pausadas, un canje nuevo da `503 altas-pausadas` sin gastar el cupón |
| `POST /v1/admin/derechos` | Cupones | `{cuenta, sorteos, dias, ref}` | Suma sorteos a una cuenta que ya está en el libro (`ref` `admin:<ref>`): `{ok, repetido, sorteos}`. Fuera del libro, `409 fuera-del-libro`; el mismo `ref` para otra cuenta, `409 ref-usado` |
| `POST /v1/admin/ordenes/pagada` | Cupones | `{orden, metodo:"a-mano"\|"qr-bs", ref}` | Una orden pagada por fuera: queda pagada y da lo mismo que un pago en USDC. `{ok, repetido}`; `404 orden` |
| `GET /v1/admin/sueltos` | Cupones | | `{sueltos:[{operacion, tx, de, activo, monto, cantidad, nota, motivo, estado, orden, ref, ms}]}`, los que faltan resolver. Lee antes los pagos nuevos de Horizon (si no contesta, suma `horizon:false`). Si hay órdenes pagadas a medias, suma `parciales:[{id, producto, recibido, total, minimo, creada, vence, vencida}]`, vencidas o no y sin la persona: lo que llegó está atado a su orden y no figura en los sueltos. Se completan con la misma nota, se marcan pagadas a mano (`ordenes/pagada`) o se devuelven a mano |
| `POST /v1/admin/sueltos/asignar` | Cupones | `{operacion, orden}` o `{operacion, devuelto:true, ref}` | Asigna un suelto de USDC (sin nota o con una nota desconocida) a una orden, `{ok, pagada, sobrante}`, o lo marca devuelto, `{ok, repetido}`. Lo que no es USDC y lo que sobra de una orden no se asignan (`409 no-asignable`): se devuelven |
| `POST /v1/admin/ventas/pausar` y `/reanudar` | Operar | | `{ventaPausada}`. Pausada (la red en amarillo), no hay órdenes nuevas; las abiertas siguen |

- Lo que pide Pollar el portero, con la llave secreta y 8 s como máximo cada vez: `POST /v3/tokens/verify`, `GET /v3/users`, `GET /v3/billing/credits` (el saldo y los movimientos), `GET /v3/treasury/sponsorship` (solo lectura) y, en la fase 2, `POST /v3/wallets/fund`. Nada más.
- Los códigos llegan en claro y el portero guarda solo su huella: rotar `CUPON_SECRETO` anula todos los cupones vivos.
- **Techos en el código**, aunque se filtre la clave de cupones: 500 usos de cupones nuevos y 500 sorteos que prometen esos cupones (usos por sorteos, ajuste `cupones_sorteos_dia:`), 50 altas a mano y 500 sorteos dados a mano por día (UTC). Los sorteos dados a mano incluyen los de `derechos` y los de las órdenes marcadas pagadas a mano (un pago en USDC no cuenta: llegó la plata). Pasado uno, `400 {motivo:"techo"}` y no se escribe nada. Un cupón trae de 1 a 50 sorteos. Anular un lote no quita los sorteos ya canjeados: si una clave filtrada llenó el piso, la pausa dura hasta cargar créditos o hasta que venzan.
- Un alta a mano de una cuenta que ya es de una persona (entró con un cupón) le suma los sorteos a esa persona, sin otra alta. Si la cuenta todavía no existe en la red, el alta queda autorizada y cuenta para el piso de créditos.
- `GET /v1/patrocinio/estado` suma `altas24h` (altas de las últimas 24 horas), `cuponesHoy` (canjes del día UTC), `cuponesCreadosHoy` (usos creados hoy, contra el techo), `pagosSueltos` (los que faltan resolver) y `ventaPausada`. `GET /v1/patrocinio/exportar` suma, en mainnet, las tablas de las altas: huellas de cupones, canjes, altas, derechos, consumos, sellos, órdenes y pagos.
- **La bitácora** suma `alta-canje` (con el lote, los sorteos y si fue un alta nueva), `alta-pausa` (con el motivo: `piso`, `creditos` o `a-mano`), `alta-reanudar`, `error-pollar` (con la llamada y el código), `admin-cupones`, `admin-anular` y `admin-alta`; con los pagos, `alta-orden` (con el producto), `alta-pago` (con el producto y si fue otro paquete igual), `pago-suelto` (con el motivo), `error-horizon`, `admin-derechos`, `admin-pagada`, `admin-suelto` y `venta-pausa`. Nunca el id de la orden ni su nota. Toda línea pasa por `src/registrador.ts`, que saca los campos que nombran a una persona y tapa cuentas y llaves de Stellar, correos, tokens, llaves de Pollar y códigos de cupón aunque vengan adentro de un texto: nunca va el id de Pollar, el token, el correo, el código ni la cuenta.

### Altas y cupones: la herramienta

`scripts/cupones.mjs`, desde la raíz del repositorio, con la clave de cupones en la variable `TINKAZO_CUPONES_TOKEN` (nunca en el comando). Habla con `https://pm.tinkazo.app`; `--base http://127.0.0.1:8793` para probar con `wrangler dev`.

```bash
# 30 cupones para el sábado y 10 de reserva: códigos y tarjetas FUERA del repositorio
node scripts/cupones.mjs crear --lote space-apps-14nov --cantidad 30 --sorteos 3 --dias 60 \
  --vence 2026-12-14 --salida C:/cupones-privados
node scripts/cupones.mjs crear --lote space-apps-14nov-reserva --cantidad 10 --sorteos 3 --dias 60 \
  --vence 2026-12-14 --salida C:/cupones-privados
node scripts/cupones.mjs estado --lote space-apps-14nov          # --json para el informe
node scripts/cupones.mjs anular --lote space-apps-14nov-reserva
node scripts/cupones.mjs anular --codigo K7M2-9QXA-4HTR
# Darle acceso a una cuenta que ya existe
node scripts/cupones.mjs admitir --cuenta G... --sorteos 20 --dias 60 --ref pruebas-internas
# Con los pagos: sumar sorteos a una cuenta del libro, una orden pagada por fuera y los pagos sueltos
node scripts/cupones.mjs dar --cuenta G... --sorteos 10 --dias 365 --ref venta-qr-0001
node scripts/cupones.mjs pagada --orden ABCD2345 --metodo qr-bs --ref comprobante-0001
node scripts/cupones.mjs sueltos                                 # --json para guardarlos
node scripts/cupones.mjs asignar --operacion 123456789 --orden ABCD2345
node scripts/cupones.mjs devuelto --operacion 123456789 --ref devolucion-0001
```

- `crear` genera los códigos con `crypto.getRandomValues`, escribe `<lote>.csv` (código y enlace) y `<lote>-tarjetas.html` y recién entonces los manda al portero; si el portero no los crea, borra lo que escribió. No pisa un lote que ya está en la carpeta. `--vence` es el último día para canjear, hasta las 23:59 de Bolivia; `--usos` (1 por defecto) cuántas personas pueden usar cada código.
- **Se niega a escribir dentro de un repositorio de git**, y en especial dentro de este (también desde una copia de trabajo): los códigos en claro valen sorteos y el repositorio es público.
- Las tarjetas van ocho por hoja A4: el frente con «Tinkazo», el QR del enlace (`https://tinkazo.app/?red=oficial#cupon=<código>`) y los textos en castellano y en inglés; el dorso con lo que hay que hacer si el QR no abre y el código. Imprimir al 100 %, a doble faz girando por el borde largo, y llevarlas en sobre o boca abajo: una foto del QR o del código lo canjea.
- `dar` suma sorteos a una cuenta que ya está en el libro (si no, el portero contesta `409 fuera-del-libro`: va `admitir`). `pagada` marca una orden pagada por fuera (`qr-bs`, el cobro en bolivianos por QR, o `a-mano`), con la orden escrita como venga (`ABCD2345`, `tk:o:abcd-2345`); da lo mismo que un pago en USDC y cuenta contra el techo de sorteos dados a mano. `sueltos` lista los pagos que no se pudieron atar a una orden, con su operación, monto, motivo, nota, quién lo mandó y la transacción, y las órdenes pagadas a medias, con lo que llegó y lo que falta; `asignar` ata uno de USDC a una orden y `devuelto` lo marca devuelto después de mandar la devolución a mano desde la cuenta de cobros (la herramienta no mueve plata). Las cinco van con la clave de cupones.
- Pausar o reanudar las altas va con la clave de operar, a mano: `curl -fsS -X POST -H "Authorization: Bearer $T" https://pm.tinkazo.app/v1/admin/altas/pausar`.

## El sorteo del servidor (solo mainnet)

Nace apagado. Se prende con `ALTAS = "1"`, `SORTEO_SERVIDOR = "1"`, `CUENTA_SORTEADORA` (la G… desde la que sale el `draw`) y el secreto `CLAVE_SORTEADORA` (su llave, que pega quien mantiene el proyecto con `npx wrangler@4 secret put CLAVE_SORTEADORA --env mainnet`). La sorteadora es una cuenta propia con unos 2 XLM: si su llave se filtra, firma solo por ella. Sin la llave, la bitácora dice `error-config` con `faltaAltas:["clave-sorteadora"]` y la ruta da `503 apagado`. En testnet `/v1/sorteo` no existe.

- **`POST /v1/sorteo`** `{sorteo:"1234", firma:"<192 caracteres en hexadecimal>"}`, abierta desde los orígenes del sitio y sin sesión (`src/sorteadora.ts`). La firma es la de la ronda **sin comprimir**, los 96 bytes que pide `draw`, como ya la arma el navegador: el Worker no descomprime nada (no hay cuenta de BLS en su CPU) y la firma la comprueba el contrato en la simulación. Responde `200 {hash, status}` o `200 {ya:true}`; errores `400 cuerpo`, `403 no-es-nuestro`, `403 origen`, `400 fallaria` (la firma no pasa), `409 ronda-no-lista` con `reintentarEn` (la hora del ledger todavía no llegó a la de la ronda: se reintenta), `503 fondo` o `apagado`, `502 red`, `429 cupo-cuenta` o `cupo-ip` (por dirección, con el mismo tope que los pagos, `POR_IP_POR_HORA`).
- **Solo sellos del portero.** Lee el sorteo con una simulación de `get_raffle` (solo lectura, no se paga) y exige que el organizador esté en el libro y que haya una fila de `sellos_portero` con el mismo organizador, huella de la lista y ronda. Si no, `403 no-es-nuestro` sin simular el `draw` ni reservar nada. La misma regla vale, con `ALTAS = "1"` y aunque `SORTEO_SERVIDOR` esté apagado, para el `draw` que manda la persona por `POST /v1/patrocinio`: así nadie sella con Freighter y le pasa al portero el sorteo de 300 ganadores (unos 0,55 XLM contra 0,095 del sello, que compiten con los sellos del stand por el tope general). Si la red no deja leer el sorteo, `502 red` y no se paga: el sitio reintenta. `sellos_portero` se llena desde el primer sello del portero de mainnet, así que ningún sorteo legítimo se queda afuera. Para el plan B, si la lectura de `get_raffle` fallara en la red principal, `SOLO_SELLOS_PORTERO = "0"` en `[env.mainnet]` y desplegar vuelve a lo de antes (el `draw` de una cuenta del libro se paga sea de quien sea el sorteo, dentro del tope general); lo mal escrito no la apaga.
- **Antes de pagar**: ya sorteado (`get_raffle` lo dice, o la simulación da `AlreadyDrawn`), `{ya:true}`; un `draw` de ese sello que ya va en camino, el mismo hash con `status:"DUPLICATE"` sin mandar otro. Una firma que no pasa la simulación da `400 fallaria` y no reserva nada.
- **Quién paga y contra quién cuenta.** La transacción interna sale de la sorteadora con los recursos que dio la simulación y la inclusión base de la red (100); va envuelta en el fee-bump de siempre, que paga la patrocinadora. Cuenta **contra el organizador**: su tope de sorteos del mes (en mainnet, tantos como los sellos) y lo guardado para **ese** sello (no el primero de la cuenta). La sorteadora no tiene cupo propio. Un `draw` nunca gasta sorteos oficiales.
- **Las secuencias**: una cola en la memoria del objeto, un envío detrás del otro. Stellar Core guarda una sola transacción pendiente por cuenta de origen (desde el protocolo 19; a confirmar en testnet con dos `draw` seguidos), así que, tomado un envío, la respuesta sale enseguida con el hash pero la cola no manda el siguiente hasta que el anterior entra: le pregunta a la red cada segundo, hasta diez veces (un ledger cierra en unos 5 s). Dos sorteos a la vez salen con secuencias seguidas, el segundo unos segundos después. Si el anterior no aparece en el plazo, la secuencia se relee de la red (la bitácora dice `sorteo-sin-confirmar`). La secuencia se lee también la primera vez y después de cualquier rechazo. Con `txBadSeq` (alguien usó la sorteadora por fuera, o el objeto se reinició), se devuelve lo reservado, se relee la cuenta y se reintenta una vez; si vuelve a pasar, `502 red`. Un corte al mandar deja la reserva para la alarma, como en los pagos.
- **La red ocupada no es falta de plata.** `TRY_AGAIN_LATER` y `txInsufficientFee` (una secuencia que ya tiene otra pendiente, o la comisión por debajo de lo que pide la red en ese momento) dan `502 {motivo:"red", detalle:"ocupada"}`, con lo reservado devuelto: el sitio lo reintenta con espera. Solo `txInsufficientBalance` es `503 fondo`.
- **La bitácora** suma `sorteo-servidor` (con el comienzo del hash, el estimado y el intento), y usa los de siempre para el envío (`enviado`, `rechazada-por-la-red`, `error-envio`). Nunca la cuenta del organizador ni la de la sorteadora.
- **La persona no firma el sorteo**, así que no le cuesta a Tinkazo una firma de Pollar (20 créditos): con `SORTEO_SERVIDOR = "1"` la vigilancia de firmas deja de contar los `draw` como explicados, y un sorteo que el sitio igual le haga firmar a una cuenta de Google aparece en `firmasSinExplicar`. Al prenderlo, bajar `CREDITOS_POR_SORTEO` de 40 a 20 (el piso).
- `RESERVA_SORTEO_STROOPS` tiene que ser la de mainnet (el `draw` medido allá, más la mitad) antes de prender esto: la de testnet se queda corta.

## Límites conocidos de esta versión

- Si el contrato necesita que se restauren entradas archivadas, el portero no las paga: lo hace la cuenta de mantenimiento del contrato (`pnpm check:renta`).
- El presupuesto estima cada transacción con el techo que acepta (1,5 veces lo simulado más un margen) y lo corrige con lo real que cobró la red cuando la alarma la ve cerrar. Es conservador a propósito.
- **Una fila devuelta no vuelve a contar.** Si la red rechazó un pedido (se devolvió) y, por una carrera entre dos pedidos del mismo hash, la transacción terminó entrando, el cobro no se suma al presupuesto: solo se anota lo que cobró la red. Lo ve la alerta del saldo, que lee la cadena. Es raro y está acotado por el tope de cada cuenta.
- El tope por dirección del Worker es por nodo y en memoria: un atacante repartido entre muchos nodos de Cloudflare lo esquiva. La defensa es la regla de Cloudflare (WAF) de arriba y, sobre todo, el tope general en dinero.
- **El plan tarda en notarse un rato**: el portero recuerda un minuto que una cuenta no tiene plan (y cinco que lo tiene), y el KV del Worker de la cuenta puede tardar hasta un minuto en verse desde otro lugar. Quien activa el plan puede tener que reintentar a los dos minutos. Con el Worker de la cuenta caído, quien tiene plan vuelve a su cupo de 20 en cuanto se acaba lo que el portero recordaba (a lo sumo cinco minutos): es el costo de no bloquear nunca por esa falla.
- **`/cupo` con cuentas inventadas gasta consultas del plan.** Cada cuenta nueva que se consulta (una dirección válida, que un script genera sin costo) hace una consulta al Worker de la cuenta. Un script que pida miles puede agotar el tope por dirección de ese Worker (6.000 por hora, todas desde la misma dirección) y, mientras dure, quienes tienen plan vuelven al cupo de siempre (una pausa de 30 s cada vez que el Worker de la cuenta contesta `429`). No toca el dinero ni deja pasar a nadie de más. La defensa es la regla de Cloudflare ya puesta delante de `/cupo` (60 pedidos en 10 s por dirección).
- Una cuenta que ya llegó a su tope del mes igual dispara la lectura de la cuenta y la simulación antes de recibir el `429`: no toca el fondo, sí la cuota del RPC.
- El cambio de mes es limpio: 20 sellos el último día a las 23:59 UTC y 20 más a las 00:00 son legítimos. Es el diseño.
- **El sorteo del servidor no reconoce todavía un `draw` que ya entró si el RPC está atrasado**: si `get_raffle` y la simulación todavía no ven el resultado, se puede mandar un segundo `draw` que la red rechaza con `AlreadyDrawn` y cobra. Lo acota el tope de sorteos del mes del organizador. Lo que va en camino sí se reconoce (el mismo hash).
- Un tercero puede mandar el `draw` de un sello ajeno (el contrato no pide firma para sortear): lo cuenta contra su propio cupo, nunca contra el del organizador, y el resultado es el mismo. Cuando el organizador llega, su `draw` falla en la simulación con `AlreadyDrawn` y recibe `400 fallaria`: el cliente tiene que tratar eso como «ya sorteado, mirá el resultado».
- El origen permitido incluye cualquier `tinkazo-*.vercel.app` y `localhost`: la comprobación de `Origin` no es una defensa (un script puede mentirlo), lo es la lista blanca. Conviene listar las vistas previas reales cuando se encienda en mainnet.
- `@stellar/stellar-sdk` está fijado en `17.3.0` exacto (sin `^`) en el `package.json` de la raíz y en el lockfile, porque las cifras de CPU de arriba son de esa versión: subirlo es un cambio a propósito y obliga a volver a medir.
- La llave del Worker se importa extraíble para leer su parte pública (un paso por un JWK); no se registra ni se devuelve en ningún lado. Riesgo teórico menor.
- `/exportar` y `/estado` devuelven todo en una respuesta, sin paginar.
- El contador de pedidos por dirección y la lista de cuentas vistas (400 días) no se pueden consultar desde afuera.
- Falta ver con la custodia de mainnet de Pollar (dos firmas de dos, si se confirma) que una cuenta real firme como se espera; la lectura de firmantes y umbrales ya está probada con cuentas de testnet con la maestra en cero.
- La oferta de inclusión del fee-bump es fija (`INCLUSION_BUMP_STROOPS`); no lee `getFeeStats`. Si la red sube mucho el precio de inclusión, la red rechaza el fee-bump (`txInsufficientFee`), el portero devuelve el cupo y da `400 rechazada`.
