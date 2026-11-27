# El premio y los avisos

Qué hace Tinkazo con lo que se reparte, cómo se le avisa a cada participante y por qué hoy Tinkazo no mueve dinero. Nació el 25 de septiembre de 2026 como una propuesta de premios que se cobraban en USDC. El 22 de octubre de 2026 esa propuesta se pospuso: el USDC queda como una opción para más adelante, de otra forma y sin custodia (la constancia de entrega, más abajo). Acá queda lo que sigue en pie.

## Lo que hace Tinkazo, y lo que no

- **Decide a quién le toca.** Un libro, una entrada, un turno para exponer, un cupo en un viaje, una beca. Quien organiza escribe qué se sortea antes de sellar, y eso queda en el sello, a la vista.
- **No lo entrega.** Lo entrega quien organiza, como siempre. Si es dinero (una beca, un viático), lo paga desde su cuenta, por fuera de Tinkazo.
- **No toca dinero.** Ni el contrato ni un servidor nuestro guardan fondos, y de lo que se reparte Tinkazo no se queda con nada: el premio va entero de quien organiza a quien ganó. Lo único que cobra es el costo del servicio de una campaña de empresa, y así se paga hoy: la empresa manda un pago directo desde su cuenta, antes de abrir la inscripción, y se suma a lo que carga, así que nunca sale del premio ni de quien participa (ver abajo, El costo del servicio de una campaña).
- **Participar es gratis, siempre.** Nadie pone plata para entrar, así que nadie gana la plata de otro.

## Por qué hoy no hay premios en dinero

En septiembre se propuso que quien ganara cobrara un premio en USDC desde un enlace, entrando con Google, con un saldo reclamable que el organizador apartaba desde su cuenta. Por ahora no se hace, por tres razones:

1. **Desde afuera se lee como un juego por plata**, aunque entrar sea gratis y nadie ponga nada. Y un premio en dinero con fines de propaganda es justo lo que regulan Brasil, Colombia y México ([legal.md](legal.md)).
2. **Rompe la promesa de que nadie necesita nada.** Para cobrar, quien gana necesita una cuenta, y un momento de dos segundos se vuelve una fila.
3. **Cambia lo que es Tinkazo.** Una herramienta que no toca dinero se revisa en una tarde. Una que lo mueve pide otra auditoría y otro modelo de amenazas.

Para quien paga por su cuenta, el sorteo igual sirve: el comprobante dice por qué le tocó a esa persona.

## La opción que sigue abierta: la constancia de entrega

El USDC no está descartado. Si más adelante varias comunidades lo piden, lo que se estudia no es que Tinkazo pague, sino una **constancia de entrega**: que quien organiza deje anotado, a la vista y desde su cuenta, que le entregó el premio a quien ganó (por ejemplo, con un pago en USDC de su cuenta a la de esa persona).

- **Sin custodia.** El dinero va de la cuenta de quien organiza a la de quien ganó. Ni el contrato ni un servidor nuestro lo guardan o lo mueven, y Tinkazo no se queda con ninguna parte.
- **Entrar sigue siendo gratis.** Nadie pone plata para participar.
- **Sin fecha.** Antes de hacerlo hay que volver sobre las tres razones de arriba y revisar el marco legal ([legal.md](legal.md)) con un abogado.

## El costo del servicio de una campaña, y el pago directo (cómo se paga hoy)

En una campaña de empresa con premios, lo que Tinkazo cobra es un porcentaje del total de los premios, con un mínimo, y se lo cobra a la empresa, nunca a quien participa. Los números no se escriben a mano en ninguna pantalla: salen de la configuración del build (`VITE_COMISION_PB`, `VITE_COMISION_MINIMO` y la cuenta de cobros en `VITE_COMISION_CUENTA`), la misma para el panel de la empresa, la portada y la sala.

- **El pago directo:** la empresa paga desde su propia cuenta (la de Google usando el panel de la empresa, o cualquier otra billetera) un pago clásico a la cuenta de cobros de Tinkazo, con la nota numérica del evento (`notaDeLaComision`). La billetera de la empresa firma el pago, y Tinkazo no lo firma ni lo guarda: por eso no toca el dinero. El pago va aparte del premio: lo que la empresa carga es el total (premios más servicio), y quien ganó recibe el premio entero.
- **La activación al pagar:** la sala del evento comprueba el pago en la red (que recibió la cuenta de cobros, con la nota del evento, desde la cuenta de quien organiza) y recién entonces firma sola el archivo de la campaña y la inscripción abre. Sin pago, no hay campaña activa. La mecánica está en [workers/sala, Activar una campaña al pagar](../workers/sala/README.md).
- **La lista de la campaña:** de cada persona anotada se guarda una huella (calculada con una clave propia de la sala, nunca su identificador), su cuenta y su nombre cifrado, que ningún servidor nuestro puede leer. Quien organiza la revisa y puede quitar a alguien con su motivo, y el estado público cuenta las salidas por motivo, sin decir quiénes. Para el sorteo se sella la lista de cuentas, ordenadas: en la red queda solo la huella de esa lista, sin nombres, y la lista misma va en el comprobante del sorteo.
- **La línea de persona (campañas que se anotan sin billetera):** una campaña puede declarar en su texto firmado que se anota por persona y no por cuenta. En ese modo, que queda apagado salvo que se prenda aparte, cada persona entra a la lista con una línea de persona en lugar de una cuenta. Es un texto de 29 caracteres que empieza con `p1:` y sale de la persona con la sal de esa campaña, que es de la sala y desaparece con ella. No es un correo ni una cuenta, no deja adivinar quién es y la misma persona tiene otra línea en la campaña siguiente, así que nadie puede seguirla de una a otra. Para el sorteo es una línea más: se ordena y se sella como cualquier otra, y el contrato y el protocolo no cambian. La forma y los vectores de prueba están en [vectors-persona.json](vectors-persona.json), y el código en `workers/sala/src/linea-persona.ts`. Quien se identifica lo hace con su cuenta de Google, que la sala comprueba sola (`workers/sala/src/identidad-google.ts`), y no queda guardado ni su correo ni su identificador. Las campañas sin ese campo siguen como siempre. Por ahora quien gana en una campaña de personas no recibe un aviso por correo, porque la línea no dice a quién escribir, y la sal que la produce se borra con la sala a las 24 horas. En una campaña de personas no se manda correo ni se guarda nada para volver a la persona: quien gana se entera al abrir la página, y quien organiza la nombra y le entrega el premio en el evento.
- **El premio en mano (campañas de personas):** una campaña de personas no tiene una cuenta a quien pagarle, así que en lugar de montos dice qué se sortea con un texto. Va en el campo `premio_en_mano` del archivo firmado, uno en español y otro en inglés, de 1 a 60 caracteres cada uno, y todos los `premios` valen `"0"`. Ese texto es el que se ve en el celular, en la pantalla grande, en el cuadro del sorteo y en las bases. No hay monto, ni costo del servicio, ni pago desde el panel: el panel de pagos no aparece, tampoco con `VITE_PAGOS` prendida. Quien organiza entrega el premio en mano, en el evento, a quien ganó, y responde por entregarlo. Si quien ganó no está, las bases dicen que decide quien organiza.
- **El código de entrega (campañas de personas):** para entregar el premio a quien ganó y no a quien dice serlo, cada ganadora tiene un código de cuatro cifras. Sale de su línea de persona con la sal de la campaña, se calcula de nuevo en cada consulta y no se guarda en ninguna parte ni se escribe en ningún registro. No se repite entre las ganadoras de una campaña. Lo ven solo quien ganó, en su celular, y quien organiza, en su panel, que lo pide a la sala con el token de la campaña. No es una llave ni una prueba de identidad: es la comprobación del momento en el stand. Con la sal borrada, a las 24 horas de crear la sala, ya no se puede calcular. El cálculo y sus vectores están en `workers/sala/src/linea-persona.ts` y en [vectors-persona.json](vectors-persona.json).
- **Quién sella:** la cuenta que organiza la campaña, y la sala solo da por bueno el sello de la lista de las personas anotadas, sin las quitadas (`workers/sala/src/campana.ts`, motivos `organizador-distinto` y `lista-distinta`). Está dicho en los Términos.
- **Quién firma una campaña de personas:** a diferencia de las de cuentas, una campaña de personas no se activa sola al pagar. La sala rechaza siempre la activación de un archivo que traiga `identidad` o `premio_en_mano`, con los interruptores como estén. La firma Tinkazo a mano con el firmador (`scripts/campana-firmar.mjs`), que además exige que lleve su `premio_en_mano`: una campaña de personas con premios en dólares no se firma. Tampoco lleva costo del servicio.

Participar sigue siendo gratis en todos los casos: el costo del servicio lo paga la empresa, y el premio llega entero a quien ganó.

## El pago del premio y el panel de ganadores, detrás de una bandera (6 de noviembre de 2026)

Para el primer sorteo en mainnet (Space Apps Santa Cruz, 14 de noviembre) se construyó la parte de la constancia de entrega que se puede probar sin resolver nada más: quien organiza paga el premio en USDC desde su cuenta, y cualquiera ve en la red si se pagó. **La bandera está prendida en producción (leído el 25 de noviembre de 2026, ver la tabla de banderas de [operacion.md](operacion.md)).** Las tres razones de arriba y el marco legal ([legal.md](legal.md)) siguen en pie: prenderlo es una decisión de quien dirige el proyecto, con revisión legal, y no cambia lo que Tinkazo es. Tinkazo no guarda ni mueve dinero: arma el pago, la billetera de quien organiza lo firma y la red lo recibe.

- **La bandera:** `VITE_PAGOS=1`. La del registro de equipos (`VITE_EQUIPOS`) no la prende. Apagada, el sitio no pide nada de esto a la red ni baja su código.
- **El pago:** un pago clásico de Stellar en USDC, de la cuenta de quien organiza a la cuenta de quien ganó, con una nota de texto: `tk:premio:<número del sorteo>:<puesto>`, con el puesto desde 0 (el primero en salir es el 0). En mainnet el activo es el USDC de Circle (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, contrato `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`); en testnet, el USDC de prueba de Circle o el que se ponga en `VITE_PAGOS_ACTIVO=CODIGO:EMISOR`.
- **Cuándo aparece "Pagar premio":** en la pantalla del resultado, para quien tiene su cuenta abierta, y solo en las filas cuyo ganador es una cuenta `G…` (56 caracteres que validan como dirección). Con Varial (antes Freighter) o con la cuenta de prueba de testnet se firma ahí mismo. Con una cuenta de Google (Pollar) no se firma desde la página, a propósito: se muestra el pago listo para firmarlo en una billetera aparte. La lista de firmas que Pollar confirma (`atenderFirmas`) no incluye el pago de un premio.
- **Antes de pedir la firma** se mira la red: si la cuenta ganadora no existe o no tiene USDC activado, se dice en palabras simples y se ofrece "Avisarle" (copiar un mensaje). No se usan saldos reclamables en esta versión; es el paso que sigue para ganadores sin cuenta lista.
- **El estado, para cualquiera** (pantalla del resultado y comprobante): **Pagado** si hay en la red un pago en USDC a esa cuenta, con esa nota, que salió bien y de una de las cuentas que pagan; **Pendiente** si no lo hay; **Vencido** a los 7 días del sorteo. Si la red no contesta se dice "Sin consulta": nunca se muestra Vencido por una consulta que falló. Se busca en Horizon y, si no contesta, en el RPC. Una consulta al abrir y un botón "Actualizar".
- **Quién cuenta como pagadora:** la cuenta que selló el sorteo, la que tiene la sesión abierta y las de `VITE_PAGOS_CUENTAS` (direcciones separadas por comas, para una cuenta de evento que paga sin ser la que selló). Una nota igual puesta por otra cuenta no hace Pagado a un premio.
- **Lo que no prueba:** que la cuenta que recibió sea de verdad la de quien ganó. Eso lo confirma quien ganó; la página lo dice.
- **El comprobante** solo muestra el panel cuando el contrato guarda el sorteo (el número del sorteo está atestiguado). Con el sello leído del historial no se muestra.
- **Límites:** el RPC de respaldo guarda unos siete días; Horizon de mainnet, unos 413. Los nombres o etiquetas de las cuentas, si este dispositivo los conoce, son los que dejó el registro de equipos en esta pestaña (`sessionStorage["tinkazo.equipos.etiquetas"]`, pares `[cuenta, nombre]`); es la misma clave que usa el show.

**Nota del 6 de noviembre de 2026, a la espera de la lectura de quien dirige el proyecto.** Las promesas de este documento no se cambiaron. Para el piloto de Space Apps se dejó escrito qué hace cada pieza con el dinero, para que la lectura legal parta de los hechos: (1) el cupón es un pago de 1 stroop de XLM desde la cuenta del evento, que firma la billetera de quien organiza; (2) el premio en USDC lo firma la billetera de quien organiza (Varial, o la cuenta de prueba en testnet) y Tinkazo solo arma la transacción: no la firma ni la guarda, y no pasa por ningún servidor nuestro; (3) el plan del equipo (5 USDC) es el pago de un servicio a la cuenta de planes de Tinkazo y no compra chances; (4) las monedas son puntos que no se cambian por dinero. Nada de esto está prendido en producción: se prende al construir, con las banderas de `.env.example`.

## La lista desde Luma

Hecho. La importación toma el nombre para la lista que se sella y propone a quienes hicieron check-in; deja usar a todos los aprobados o marcar a mano. El archivo, con sus correos, se lee en el navegador del organizador y no sale de ahí.

El correo nunca entra en el sello: la huella es pública, y una lista de correos no se tiene que poder reconstruir ni probar.

## Los avisos

Tres caminos, de menos a más infraestructura:

| Camino | Cómo | Servidor | Límite |
|---|---|---|---|
| **A. Texto listo para Luma** | Tinkazo arma el anuncio del resultado y el aviso a quien le tocó; el organizador los pega en el envío masivo de Luma | Ninguno | Un paso manual. Pero el correo sale de Luma, que los invitados ya conocen: no cae en spam |
| **B. El correo del organizador** | `mailto:` con el texto armado (ya existe para el ganador) | Ninguno | Para todos no sirve: los clientes de correo cortan con cien destinatarios |
| **C. Envío desde Tinkazo** | Una función mínima que manda con Resend o Postmark, sin guardar nada | Uno chico, sin base de datos | Hace falta dominio propio con SPF y DKIM, y cuidar el abuso: solo organizadores con sesión, solo a los correos de la lista que sellaron, uno por persona y sorteo |

**Recomendación: A primero, C después si hace falta.** A se hace en un día, no rompe nada y resuelve el caso real.

Lo que más vale del aviso: **a cada participante, su prueba.** "Estuviste en la lista sellada en el puesto 37; el sorteo se hizo con la ronda 32.507.924; verificalo acá." Cada uno puede comprobar que estuvo, no solo que quien ganó existe.

## El orden

| Paso | Qué | Servidor | Estado |
|---|---|---|---|
| 1 | Importar el CSV de Luma, filtrar por check-in, correos solo en el navegador | No | Hecho |
| 2 | Las bases del sorteo, generadas, y los términos de uso y privacidad (ver [legal.md](legal.md)) | No | Hecho |
| 3 | Textos listos para el envío de Luma: el resultado para todos, con la prueba de cada uno, y el aviso a quien le tocó | No | Va en el kit para organizadores |
| 4 | Si hace falta: envío de correos desde Tinkazo | Uno chico | Sin fecha |
| 5 | El costo del servicio de la campaña, cobrado con pago directo, y la activación al pagar | La sala de Cloudflare | Hecho |
