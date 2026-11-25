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

## Desacuerdo abierto: el borrado de la red de prueba

El sitio dice en varias cadenas y pruebas que la red de prueba se borra el 16 de diciembre de 2026. La documentación oficial de Stellar sobre las redes (sección del reinicio de datos de la red de prueba) dice, leída el 25 de noviembre de 2026, que no hay más reinicios previstos para 2026. La página de esta prueba no nombra fechas de borrado, y esta prueba no toca el texto del sitio: queda para decidir cuál vale.

## Fecha de la última corrida buena

Las corridas buenas del recorrido entero contra la red de prueba, con el paso de otro aparato, se anotan acá a mano. Hacen falta tres para que esos pasos cuenten en el código de salida.

1. 25 de noviembre de 2026. Salió con 0. La otra llave entró por el historial y por el RPC, las dos al ledger de la creación de la cuenta, con un solo desbloqueo cada una. Desde el otro aparato se selló una lista y una llave sin cuenta llegó a la pantalla de que no hay cuenta. Ningún pedido fue a un índice ajeno.

## Lo que no entra

La red principal y sus direcciones, el proveedor de cuentas, el portero y el servicio de patrocinio, premios y dólares digitales, fondear la cuenta de contrato, llaves secundarias, firmantes nuevos, políticas, sumar una segunda llave, entrar desde un aparato que no comparte la llave, restaurar una cuenta que ya terminó, extender la vida del código compartido y cambiar el sitio de hoy o su verificación.
