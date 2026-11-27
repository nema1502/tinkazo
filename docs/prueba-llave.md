# Prueba de la llave

Una prueba, solo en la red de prueba, de que una persona puede crear una llave con el desbloqueo de su aparato, sellar una lista con ella y sortear, sin contraseña, sin billetera y sin que Tinkazo guarde nada suyo. Issue 301.

## Qué es y qué mide

La persona crea una llave (una passkey) con su huella, su cara o la clave de su aparato. De esa llave nace una cuenta de contrato en la red de prueba, con la llave como único firmante: Tinkazo no queda como firmante ni como administrador. Con esa cuenta se sella una lista de ejemplo en el contrato vigente de la red de prueba (`docs/deployments.md`) y, cuando nace la ronda, se sortea.

Paga todo una cuenta descartable que se crea en el navegador y fondea el grifo de la red de prueba. No hay servidor nuestro, ni retransmisor, ni llaves nuestras. La llave solo firma la entrada de autorización de `seal`.

La prueba mide, en cada paso (crear la cuenta, sellar, sortear), lo que cobró la red y lo que escribió, leído de lo que contesta la red y sin estimar nada: total, inclusión, recursos, alquiler, instrucciones y bytes escritos. Las cifras son de la red de prueba. No son el precio de la red principal: en la red de prueba las entradas nacen con la vida mínima (120.960 ledgers) y no con los 2.073.600 publicados para la principal. Lo que se traslada son los bytes y las entradas, no los XLM.

## Lo que hay que saber del kit

La prueba usa el kit de cuentas inteligentes de Stellar (`smart-account-kit`, versión exacta en `package.json`) sobre las cuentas de contrato de OpenZeppelin v0.8.0. El propio kit dice en su README y en su política de seguridad que no tiene una auditoría independiente de terceros y que sus fallas pueden causar transacciones no autorizadas o la pérdida del acceso. Por eso esto es solo una prueba en la red de prueba, con listas de ejemplo y nada de valor.

El desplegador compartido que trae el kit tiene una llave pública: cualquiera puede cambiarle los firmantes. La prueba lo mira antes de cada recorrido (`scripts/lib/previo-llave.mjs`) y no sigue si cambió.

## Dónde vive

- La página está en `prueba/llave/index.html`, en una carpeta y no en la raíz a propósito: ninguna comprobación de las páginas del sitio la recorre.
- El código está en `src/prueba-llave/`. Nada del sitio de hoy lo importa (`src/prueba-llave/aislamiento.test.ts`).
- Solo `puente-kit.ts` importa el kit. Entre el kit, que trae su propio SDK de Stellar, y el resto de la prueba, que usa el del sitio, solo pasan cadenas base64.

## Cómo se arma y cómo se abre

La página solo entra al armado con `VITE_PRUEBA_LLAVE=1` y además en una vista previa de Vercel (`VERCEL_ENV=preview`) o en la revisión automática de GitHub. En producción no entra nunca, y si alguien pone la variable en una publicación de producción, la construcción falla. Sin la variable, el armado falla si algún trozo trae algo de la prueba.

En ejecución, la página solo carga el kit en una lista cerrada de anfitriones: `localhost`, `127.0.0.1` y el alias de rama de una vista previa. En cualquier otro (el sitio, sus subdominios, la dirección de producción de Vercel, el alias de la rama principal y las direcciones únicas de cada despliegue) muestra que la prueba no está ahí y no baja el kit.

`pnpm dev` no sirve para esta página: el plugin es solo de armado. Se prueba con el armado y la vista previa:

```bash
VITE_PRUEBA_LLAVE=1 GITHUB_ACTIONS=true pnpm build
pnpm preview
# http://localhost:4173/prueba/llave/
```

Una vista previa de la rama de la prueba no se promueve a producción. Si por error se promoviera sin reconstruir, la lista de anfitriones la deja sin funcionar en producción.

La llave queda atada al anfitrión exacto donde se creó. En una vista previa y en `localhost` conviven las llaves de la prueba con las de recuperación del sitio, y el selector del aparato puede mostrar las dos: la pantalla dice cuál elegir. Conviene probar en el teléfono en un anfitrión que no use la recuperación.

## Entrar desde otro aparato

Con la misma llave (la que comparten, por ejemplo, el teléfono y la computadora), una persona entra a su cuenta de prueba desde el otro aparato y sella desde ahí. No se usa ningún índice ajeno: el kit se abre con `indexerUrl: false`.

Cómo se entra, con un desbloqueo para entrar y otro para sellar:

1. La persona elige su llave. El kit pide el desbloqueo una sola vez.
2. Con la respuesta de la llave, la página calcula la dirección de la cuenta. Sale de la llave y del desplegador compartido: es el SHA-256 de 112 bytes (la clave de la red, el tipo de creación, el desplegador y la sal, que es el SHA-256 de los bytes de la credencial).
3. Lee la instancia de esa cuenta en la red. La instancia dice en qué ledger se escribió por última vez, y en las cuentas medidas ese es el de la creación. Si la instancia no está (se mira dos veces, con 2 s de pausa) no hay cuenta. Si su vida ya pasó, la cuenta terminó.
4. Busca en ese ledger la transacción que creó la cuenta. Primero en el historial de la red de prueba (por el ledger exacto, unos 100 KB) y, si el historial no lo tiene, en el RPC (con pedidos de 20 en 20, que corta en el primer ledger mayor). Reconoce la creación porque la dirección que sale de su desplegador y su sal es la de la cuenta. El hash y el ledger salen de la red, nunca de lo que diga una respuesta.
5. Le deja al kit lo que encontró (el hash, el ledger y el código de nacimiento) como una pista que solo vive en memoria. Es una capa sobre el almacén del kit: la pista se ve con `get`, nunca se escribe sola y se borra cuando el kit guarda el registro ya verificado. La misma respuesta de la llave le sirve al kit de prueba de que la llave es de quien entra, así que no hace falta otro desbloqueo.
6. El kit verifica todo contra la red en su modo más estricto: la transacción por su hash, que cree una sola cuenta con ese desplegador y esa sal, que el código de nacimiento esté entre los aceptados, que el constructor tenga un solo firmante y sin políticas, que la llave sea ese firmante y que la regla viva de la cuenta la tenga como firmante.
7. La página agrega una revisión propia, más estricta, en las tres formas de conectar (entrar, conectar una llave de este aparato y retomar la sesión): una sola regla creada en toda la historia de la cuenta, un solo firmante, ninguna política y sin vencimiento. Si no se cumple, se desconecta, se borra lo guardado de esa llave y no se usa la cuenta. Es la prueba en código de que Tinkazo no quedó como firmante ni como administrador.

Lo que nunca se hace: dar por aprobada una cuenta guardando la huella de los argumentos del constructor (con ella el kit dejaría de comprobar el desplegador, la sal y las políticas) ni guardar una clave pública que no salga del nacimiento verificado. Una prueba lo vigila. La fuente de la pista no importa para la seguridad, porque el kit no confía en ella: si faltara o fuera falsa, el kit cae cerrado.

Qué ve la persona: una pantalla por estado, con un título, una línea y un botón principal, en español y en inglés. Elige la llave y ve Buscando tu cuenta. Si todo sale bien llega a Tu cuenta está lista. Si no, ve una de cuatro pantallas: no hay una cuenta con esa llave, la cuenta ya terminó, la cuenta no se pudo comprobar (por cuidado no se usa) o no se pudo llegar a la red ahora (se prueba de nuevo). El motivo técnico queda en las medidas y nunca en la pantalla.

Con `?fuente=historial` o `?fuente=rpc` en la dirección de la página, la cuenta se busca solo en esa fuente. Sirve para probar las dos con la misma llave. Cualquier otro valor se ignora, y eso no afloja nada de lo que verifica el kit.

### Límites

1. La vida de una cuenta en la red de prueba es la mínima, 120.960 ledgers, unos 7 días (`red.ts`). Se midió en tres cuentas que sellar y sortear no la extienden. Pasada esa semana la cuenta no se puede usar en ningún aparato. Restaurarla no entra en esta prueba.
2. La pista es el último ledger que modificó la instancia. En las tres cuentas medidas es el de la creación, aunque ya hubieran sellado y sorteado. Una mejora del código o una restauración la cambiarían (esto se deduce y no se probó), y entonces se cae cerrado en la pantalla de que no se pudo comprobar la cuenta.
3. El historial de la red de prueba guarda historia desde el ledger 128 y no hay garantía de que siga así. El kit también depende de él para la historia vieja.
4. El contador de reglas cuenta las que se crearon alguna vez. Sumar una regla y quitarla deja la cuenta afuera de esta prueba para siempre.
5. El orden interno del kit sostiene el único desbloqueo: pide la llave, lee el almacén y después mira la instancia. `kit-orden.test.ts` lo vigila con el kit de verdad y el recorrido lo recorre. Si una versión nueva lo cambia, la pista no llega a tiempo, el kit no tiene de dónde sacarla y cae cerrado.
6. En la prueba de que la llave es de quien entra, el kit exige la verificación de usuario solo si se lo piden. El pedido sale con la verificación obligatoria y lo hace cumplir el navegador. Queda anotado y no se toca.

### Un aparato que no comparte la llave

Queda fuera de esta prueba. Un iPhone y una computadora con Windows, por ejemplo, no comparten sus llaves: el segundo aparato no tiene la llave y ninguna búsqueda lo arregla. Sumar una segunda llave a la cuenta tampoco alcanza con este kit: dice que la recuperación en un aparato nuevo acepta solo la llave primaria, que una secundaria sirve solo donde quedó guardada su asociación verificada y que el contrato actual no puede probar que un aparato nuevo consintió una llave agregada después. Haría falta, como mínimo, una pantalla en el aparato que ya tiene la llave para agregar la del otro, y una forma de que el aparato nuevo pruebe esa asociación sin su almacenamiento local. Eso pide un cambio en el kit o en el contrato de la cuenta. Usar desde la computadora la llave del teléfono con la opción del navegador de usar una llave de otro aparato es la misma llave y entra por este camino, pero no se midió.

## La revisión automática

- `ci.yml`, trabajo de calidad (el que exige la rama principal): después del armado del sitio, `scripts/check-sin-prueba-de-llave.mjs dist` comprueba que no trae nada de la prueba. Después se arma con la prueba (`dist-llave`) y `--presente` comprueba que trae la página, el kit y las marcas: es el control de que la revisión no está vacía.
- `scripts/lib/sin-prueba-de-llave.test.mjs` corre en `pnpm test` con rutas de la forma real del almacén de pnpm, con barras y con contrabarras.
- `prueba-llave.yml`, aparte y sin frenar nada: corre el recorrido automático de verdad contra la red de prueba, con Chrome sin pantalla y un autenticador virtual, y deja `medidas-llave.json` como artefacto durante 14 días. Depende del grifo, de la red de prueba y del servicio de azar público, y por eso puede fallar sin que el sitio tenga nada roto.

El recorrido sale con 0 si dio bien, con 1 si la prueba falló y con 2 si no se pudo medir (la red de prueba cambió, el grifo, la red o el servicio de azar no contestaron, o la red no se pudo leer al entrar). Si la página no carga o se acaba el tiempo del recorrido, sale con 1, y lo que nunca se llegó a medir cuenta como falla.

Después del recorrido principal prueba entrar desde otro aparato con varios navegadores, uno después del otro y nunca dos a la vez, cada uno con su perfil nuevo:

- El primero hace el recorrido de siempre. Al terminar se leen las llaves de su autenticador virtual.
- El segundo es otro aparato: no tiene nada guardado de la página y sí la misma llave. Entra buscando en el historial, sella una lista desde ahí, borra lo guardado y vuelve a entrar buscando en el RPC.
- El tercero tiene una llave que no tiene cuenta y tiene que llegar a la pantalla de que no hay cuenta.

Los pasos que mide son siete: `otro-aparato`, `misma-cuenta`, `un-desbloqueo-al-entrar`, `segundo-sello`, `dos-fuentes`, `sin-cuenta` y `sin-indice` (ningún pedido de esos navegadores va a un índice ajeno). Durante las primeras corridas buenas son informativos: se anotan y se muestran, y no cambian el código de salida. Después de tres corridas buenas pasan a los checks que cuentan, en un cambio aparte, con las fechas de esas corridas anotadas abajo.

No se prueba en el recorrido: una cuenta de más de unos 7 días (cuando la única fuente posible es el historial y el RPC ya no tiene la transacción), una instancia reescrita y el selector de un aparato real con varias llaves del mismo sitio. Lo cubren las pruebas de unidad y las pantallas.

## Recibir y mandar monedas de prueba

Un modo más de la misma página, `/prueba/llave/?modo=premio`. Sin ese parámetro la página hace lo de siempre. Muestra el camino que haría una persona que gana algo, sin que haya ningún sorteo detrás: crea su billetera con la llave, le llegan monedas de prueba y las manda a otra cuenta. Todo en la red de prueba.

### Qué hace la persona

1. Toca Crear mi billetera y usa su huella, su cara o su clave. Le llegan 10 monedas de prueba solas, sin otro desbloqueo.
2. Toca Mandar mis monedas. La llave aprueba el envío con un solo desbloqueo y las monedas salen a una cuenta de prueba que pide nota. Si el enlace no trae un destino, la página arma esa cuenta en el momento.
3. Ve cuántas monedas llegaron, a qué cuenta (los últimos cuatro caracteres) y con qué nota. Un botón abre lo que costó cada paso.

Con el destino en el enlace se muestra la dirección entera antes del desbloqueo. Los parámetros valen solo en esta página y solo en la red de prueba:

- `?modo=premio`: el modo. Cualquier otro valor se ignora.
- `?destino=`: una cuenta G, una dirección M o un contrato C, con su control. Sin él, el destino lo arma la página.
- `?nota=`: un número de 1 a 20 dígitos que no pase del mayor de 64 bits, solo con una G.
- `?fuente=historial` o `?fuente=rpc`: como antes.

Un destino o una nota mal escritos muestran una pantalla con un botón que abre la prueba sin ellos, y no se pide nada. Nada se adivina ni se arregla.

### El activo

Son monedas de prueba del contrato de activo del XLM de la red de prueba. Usa el mismo mecanismo que usaría un dólar digital en otra red: la función `transfer(from, to, amount)` de un contrato de activo, hacia y desde una dirección de contrato. Para una cuenta de contrato el saldo vive en el almacenamiento del contrato de activo y no en una línea de confianza. Si el destino es una dirección M, el contrato saca de ella un número y lo deja en el evento de la transferencia junto al monto. Se eligió el XLM de prueba porque la cuenta descartable ya lo tiene del grifo, no pide línea de confianza ni emisor y no suma ningún tercero.

Fuentes leídas el 27 de noviembre de 2026: la página del contrato de activo de Stellar (sección Sending to a muxed address) y la de las cuentas de contrato, en developers.stellar.org.

### Cómo se cuida

- El premio se paga por un registro que se anota una sola vez, al crear la billetera en ese aparato. Nunca se paga por leer un saldo en cero. Recargar, volver a entrar o mandar no pagan otro premio. Si el saldo es cero y no hay registro (otro aparato), la pantalla dice que no hay monedas y ofrece crear otra billetera.
- Antes de pedir el desbloqueo, la página comprueba que lo que va a firmar la llave es exactamente la transferencia pedida: el contrato, la función, el origen, el destino, el monto y ninguna llamada de más. Después de ensamblar la transacción comprueba de nuevo la operación, la autorización firmada y un tope a la comisión por recursos.
- El pago y el envío se guardan con su hash antes de mandarse. Solo se arma otro sobre cuando la red dijo que el anterior no entró ni puede entrar.
- Después de mandar hay solo dos salidas: se sabe que entró o queda Mirar de nuevo. Ninguna lectura posterior (saldos, cobro, evento) lleva a una pantalla de falla ni arma otra transferencia.
- Un destino del enlace que es una G sin nota se mira en el historial. Si pide nota, no se manda sin ella. Si el historial no contesta, tampoco se manda.
- Los desbloqueos se cuentan con el contador del navegador y no con un número fijo.

### Lo que demuestra y lo que no

Demuestra, con medidas:

- Que una cuenta de contrato nacida de una llave recibe un activo por `transfer`, cuánto cuesta crear su entrada de saldo y hasta cuándo vive.
- Que esa cuenta manda con un solo desbloqueo, con la comisión pagada por otra cuenta, a una cuenta que pide nota, con el número de nota dentro de una dirección M, y que la nota aparece en el evento de la transferencia.
- Cómo vuelve la raíz de la entrada de autorización cuando el destino es una M: la M tal cual (exacta) o la G de abajo (normalizada). Cualquiera de las dos pasa y el recorrido anota cuál fue.

No demuestra, y la página lo dice:

- Quién ganó. No hay sorteo: la página paga a quien abre el modo, desde una cuenta del grifo. Probar quién ganó y pagar una sola vez por ganador desde un servicio no se ejercita acá.
- Que se pague una sola vez entre aparatos o entre dos pestañas a la vez. El registro vive en el aparato y no tiene candado. Con dos pestañas, tocar Probar de nuevo en el mismo segundo podría pagar dos veces.
- Que un exchange acredite. La cuenta que pide nota es una cuenta de prueba nuestra. Desde un contrato la nota solo puede ser un número de 64 bits dentro de una dirección M, porque una transacción que invoca un contrato lleva MEMO_NONE. La documentación oficial dice además que hoy los exchanges no aceptan transferencias que salen de contratos. Una corrida en verde no quiere decir que un exchange acepte esto.
- El dólar digital: la línea de confianza de una cuenta de destino y las banderas del emisor no entran, porque el XLM no las tiene.

### La revisión automática de recibir y mandar

Después de lo de otro aparato, el recorrido abre otro navegador con su propia llave y tres cargas de la página. Antes prepara una cuenta de destino con el grifo, le pone la marca de que pide nota y espera a verla en el historial.

1. Carga 1: con el destino en el enlace, crea la billetera y recibe. Toca Mandar mis monedas y llega a la pantalla de que esa cuenta pide una nota: no se movió ninguna moneda.
2. Carga 2: la página sin destino. Vuelve a entrar y no se paga otro premio. Manda al destino que arma la página, con un solo desbloqueo.
3. Carga 3: recarga. No hay monedas y no se paga otro premio.

Los saldos y la nota los lee el propio recorrido en la red de prueba, por un camino que no usa nada del código de la página. Mide los segundos, el cobro entero de cada paso, los saldos de las dos puntas, la vida de la entrada de saldo, los desbloqueos, la forma de la raíz y la nota que quedó en la red.

Los diez pasos son `premio-crear`, `premio-recibir`, `premio-pide-nota`, `premio-sin-doble`, `premio-mandar`, `premio-un-desbloqueo`, `premio-nota`, `premio-saldos`, `premio-sin-doble-tras-mandar` y `premio-raiz`. Son informativos como los de otro aparato: pasan a contar en el código de salida después de tres corridas buenas, en un cambio aparte y con las fechas anotadas abajo. Si el grifo o la red de prueba no contestan en una lectura propia del recorrido, se anota como falla ajena. Si el tiempo de la revisión se acaba, el archivo de medidas queda con lo medido hasta ahí y el recorrido sale con 1.

### Lo que midió la primera corrida

Los diez pasos dieron bien en la primera corrida (27 de noviembre de 2026, red de prueba, Chrome sin pantalla con autenticador virtual). Cifras en la unidad mínima, que son 7 decimales de la moneda de prueba. No se proyectan a otra red.

| Paso | Total | Inclusión | Recursos | Alquiler | Instrucciones | Bytes escritos | Segundos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crear la cuenta | 173.166 | 100 | 14.002 | 159.064 | 3.051.892 | 1.040 | 10 |
| Recibir el premio | 159.616 | 100 | 6.204 | 153.312 | 242.286 | 368 | 5 |
| Mandar las monedas | 331.844 | 100 | 11.505 | 320.239 | 5.421.336 | 440 | 11 |
| Cuenta de destino de la página | 200 | 200 | 0 | 0 | 0 | 0 | 5 |

- Recibir crea la entrada de saldo de la billetera (224 bytes persistentes y su vida). Esa entrada quedó con vida hasta el ledger 6.470.204, unos 518.000 ledgers por delante del de la corrida. Es distinta de la vida mínima de las entradas de la cuenta, y la fija el contrato de las monedas.
- Mandar escribe además una entrada temporal de 72 bytes (la autorización de un solo uso), que es lo que más pesa en su alquiler.
- Un solo desbloqueo al mandar, contado por el navegador. La raíz de la entrada de autorización volvió exacta: la dirección M tal cual, con la nota adentro.
- La nota pedida (1234567890) quedó en el evento de la transferencia y la página la leyó de ahí. Los saldos de las dos puntas coinciden con lo esperado: la billetera de 10 monedas a cero y la cuenta de destino de 2 a 12, sin que el destino pagara ninguna comisión.
- Esta parte del recorrido tardó 40 segundos y la corrida entera 214.

### Límites y lo que no se comprobó

- Las monedas que llegan a la cuenta de destino que arma la página quedan ahí: su llave vive solo en la memoria de esa carga. Son de prueba.
- La vida de la entrada de saldo y de la cuenta en la red de prueba es la mínima. Pasada una semana, entrar da la pantalla de cuenta terminada. Restaurar no entra en esta prueba.
- No se prueban las notas de texto (desde un contrato no se pueden), los destinos de otro tipo, mandar a un contrato en vivo ni mandar desde otro aparato en vivo. Lo cubren las pruebas de unidad.
- Contestado por la primera corrida: la raíz con una M vuelve exacta, el RPC de la red de prueba trae los eventos dentro de la respuesta de la transacción y la regla de la cuenta acepta una transferencia firmada con la llave.
- Sin comprobar: qué hace la lectura de una entrada de saldo ya vencida (la página la muestra igual y la red la restaura al usarla, pero no se midió), y que otro destino del enlace (una M, una C) llegue igual de punta a punta en vivo.

## Desacuerdo abierto: el borrado de la red de prueba

El sitio dice en varias cadenas y pruebas que la red de prueba se borra el 16 de diciembre de 2026. La documentación oficial de Stellar sobre las redes (sección del reinicio de datos de la red de prueba) dice, leída el 25 de noviembre de 2026, que no hay más reinicios previstos para 2026. La página de esta prueba no nombra fechas de borrado, y esta prueba no toca el texto del sitio: queda para decidir cuál vale.

## Fecha de la última corrida buena

Las corridas buenas del recorrido entero contra la red de prueba, con el paso de otro aparato, se anotan acá a mano. Hacen falta tres para que esos pasos cuenten en el código de salida.

1. 25 de noviembre de 2026. Salió con 0. La otra llave entró por el historial y por el RPC, las dos al ledger de la creación de la cuenta, con un solo desbloqueo cada una. Desde el otro aparato se selló una lista y una llave sin cuenta llegó a la pantalla de que no hay cuenta. Ningún pedido fue a un índice ajeno.

2. 27 de noviembre de 2026. Los diez pasos de recibir y mandar dieron bien en la primera corrida. La corrida entera salió con 1 porque la verificación del comprobante marcó que esa misma lista de ejemplo ya estaba sellada por otra cuenta del contrato a esa hora. No viene de recibir ni de mandar.
3. 27 de noviembre de 2026, minutos después. Salió con 0: lo de siempre, lo de otro aparato y los diez pasos de recibir y mandar dieron bien. La verificación del comprobante dio verde, así que el aviso de la corrida anterior fue de una coincidencia con otro uso del contrato.

## Lo que no entra

La red principal y sus direcciones, el proveedor de cuentas, el portero y el servicio de patrocinio, los dólares digitales (entran monedas de prueba, no dólares), fondear la cuenta de contrato desde afuera de esta prueba, llaves secundarias, firmantes nuevos, políticas, sumar una segunda llave, entrar desde un aparato que no comparte la llave, restaurar una cuenta que ya terminó, extender la vida del código compartido y cambiar el sitio de hoy o su verificación.
