# Modelo de amenazas

> **En una línea:** el número que decide el sorteo no existe cuando se cierra la lista, y un contrato en Stellar lo verifica. Eso está cerrado. Lo que queda abierto es humano, y tiene dos formas: armar mal la lista antes de sellar ([abajo](#el-ataque-más-común-inflar-la-lista-antes-de-sellar)) y sellar varias veces para publicar el resultado que conviene ([abajo](#el-ataque-real-selección-del-compromiso)). Contra las dos, todo se muestra antes de que exista el número: la lista a la sala, con un QR para buscarse, y el número del sorteo en las fotos.

Qué puede salir mal en Tinkazo, quién podría hacerlo, qué lo impide hoy y qué no. Escrito con el método STRIDE, que agrupa las amenazas en seis familias: suplantación, alteración, repudio, filtración, denegación de servicio y elevación de privilegios.

Existe porque **el producto promete que cualquiera puede comprobar un sorteo, y una promesa así hay que poder defenderla por escrito**, incluido lo que todavía no impide.

Lo que hay acá no son hipótesis: cada límite del diseño está anotado con lo que efectivamente pasa hoy, no con lo que nos gustaría que pasara.

## Qué estamos protegiendo

| Activo | Por qué importa |
|---|---|
| **El resultado del sorteo** | Es el producto. Si se puede torcer, no hay nada más que discutir |
| **La lista de participantes** | Son nombres de personas reales. No tienen por qué llegar en claro a ningún servidor: la única copia que se guarda es la del enlace corto, cifrada en el navegador |
| **El comprobante** | Es lo que deja a un tercero rehacer el sorteo años después |
| **La cuenta del organizador** | Firma las transacciones y paga las comisiones |

## Quién podría atacar

| Actor | Qué puede hacer | Qué no |
|---|---|---|
| **El organizador** | Elige la lista, cuándo sella y qué publica | No puede elegir la semilla: no existe cuando sella |
| **Un participante** | Ve el comprobante y lo recomputa | No firma nada ni toca el contrato |
| **Un mirón cualquiera** | Lee todo lo que está en la cadena, finaliza sorteos pendientes | No puede sellar por otro |
| **Un relay de drand** | Sirve o no sirve una ronda | No puede firmar una ronda falsa: la firma se verifica contra la clave pública |
| **La red de drand** | Firma las rondas | Necesitaría comprometer el umbral de la League of Entropy |
| **Quien hospeda el sitio** | Podría servir un sitio distinto | No puede tocar lo que ya quedó en la cadena |
| **El servicio de enlaces cortos** (`c.tinkazo.app`, de Tinkazo, en Cloudflare) | Guarda y devuelve la copia cifrada de un comprobante; ve la dirección IP de quien la arma o la abre, cuándo, el id y cuánto pesa; la borra a pedido | Leerla: la clave va en el fragmento del enlace y nunca le llega. Cambiarla sin que se note: el cifrado la autentica y la página rehace el sorteo |
| **Cloudflare** | Lo mismo que el servicio, como proveedor; además podría caerse, perder los datos o cerrar la cuenta | Leer las listas: tampoco tiene la clave |
| **Quien tiene el enlace corto, la foto o el QR** | Abre el comprobante con la lista entera, como con el enlace largo | Cambiar el resultado |
| **La red del evento** | Corta o intercepta el tráfico | No puede falsificar una firma. Si corta la lectura de Stellar, un comprobante anclado queda en "no pude comprobarlo", sin ganador ni botón de compartir |
| **El RPC de Stellar** (en testnet, el de la SDF; en mainnet, `mainnet.sorobanrpc.com`, de un tercero) | Contesta lo que guarda la cadena | Contestar con lo de otro contrato: cada entrada dice de qué contrato, con qué clave y de qué duración es, y la verificación exige que sea la pedida. **Lo que sí podría** un RPC comprometido es inventar un sello y un resultado: con una sola fuente no hay forma de notarlo. Antes de mainnet hace falta pedir lo mismo a dos RPC de operadores distintos |
| **Horizon** (el historial de transacciones; en testnet el de la SDF, en mainnet `horizon.stellar.org`) | Contesta qué transacciones entraron, si salieron bien y cuándo cerró su ledger. Desde el 25 de octubre de 2026 la verificación lo usa cuando el contrato ya no guarda el sorteo | Cambiar lo que mandó una transacción: se recalcula el hash del sobre y tiene que ser el pedido. **Lo que sí podría** un Horizon comprometido es decir que entró una transacción que nunca entró, o inventarle la hora de cierre: con una sola fuente no hay forma de notarlo, igual que con el RPC. Se le cree lo mismo que al RPC y se dice. **Cuánto guarda**, medido el 25 de octubre de 2026: el Horizon público de mainnet, unos 413 días en una ventana que avanza (la SDF lo describe cerca del final de su vida); el RPC de Soroban, 7 días; el de testnet se borra entero el 16 de diciembre de 2026. Esta versión usa una sola fuente: una segunda fuente independiente y los sobres de las transacciones dentro del comprobante están previstos para más adelante, y no están hechos |

## S: Suplantación

| Amenaza | Estado | Por qué |
|---|---|---|
| Sellar en nombre de otro organizador | **Cubierto** | `seal` exige `organizer.require_auth()`. Sin la firma de esa cuenta la transacción no entra |
| Hacer pasar una ronda inventada por una de drand | **Cubierto** | `draw` verifica la firma BLS12-381 contra la clave pública fija de quicknet, dentro del contrato. Una firma que no valida devuelve el error 8 |
| Un relay que devuelve otra ronda | **Cubierto** | El cliente comprueba que el número de ronda que volvió sea el pedido, y la firma se verifica igual |
| Un sitio clonado que dice ser Tinkazo | **Parcial** | Un clon puede mostrar lo que quiera en su propia página, también una verificación en verde, pero no puede escribir en el contrato sin la cuenta del organizador. Lo que no puede es engañar a la página de verdad: desde el 22 de octubre de 2026, `verificar.html` y `evento.html` de tinkazo.app solo creen en el registro de un contrato de Tinkazo (`src/stellar/deployments.json`) cuya instancia corre el `.wasm` oficial, así que un comprobante anclado abierto ahí delata la diferencia. **Hasta esa fecha esto no era cierto**: la verificación le creía al enlace la dirección del contrato, y evento no leía la cadena. Queda lo que depende de la persona: abrir el comprobante en tinkazo.app y no en el dominio del clon. **En modo libre no hay defensa**, y eso es parte de lo que compra anclar |
| Un comprobante que apunta a un contrato propio | **Cubierto desde el 22 de octubre de 2026** | Antes un contrato de veinte líneas en testnet, que devolviera el sorteo que su dueño quisiera, salía "El sorteo cuadra y está en Stellar" (se reprodujo con uno de verdad, `scripts/check-verificacion.mjs`). Ahora la verificación (`src/protocol/verificacion.ts`) exige que la red y el contrato sean de la lista oficial y lee de la cadena qué `.wasm` corre su instancia: si no es el oficial, rojo, sin leer nada más de lo que guarda |
| Un enlace de evento con anclas inventadas | **Cubierto desde el 22 de octubre de 2026** | `evento.html` pintaba "Anclado en Stellar" y el verde con que el enlace trajera red, contrato y número. Ahora lee la cadena para cada sorteo, con la misma verificación que `verificar.html`: un ancla ajena o un número cuyo sello no coincide da rojo; lo que no se pudo leer, amarillo |
| Un evento que se viste de otra cosa | **Parcial** | El nombre del evento lo escribe quien arma el enlace: era el titular de la página, con el color del veredicto ("✅ Todo cuadra" se leía verde aunque la caja dijera que no). Desde el 22 de octubre de 2026 el titular es el veredicto y el nombre va aparte, como "Nombre que puso quien compartió el enlace"; un sorteo repetido en el enlace da rojo, cada tarjeta dice el número del sorteo, y si los sellaron varias cuentas se avisa. Sigue pudiendo juntar sorteos legítimos de otros bajo cualquier nombre |
| Un contrato anterior que sigue abierto | **Cubierto desde el 22 de octubre de 2026** | El contrato no tiene dueño ni se puede apagar: el que se reemplazó el 16 de septiembre sigue aceptando sellos de cualquiera. Cada contrato anterior lleva en `deployments.json` el último número que dio siendo el del sitio (`ultimoId`), y lo que se selle después da rojo |
| Un hash de transacción falso en el comprobante (`stx`) | **Cubierto desde el 25 de octubre de 2026** | Con `stx` y sin el sorteo en el estado del contrato, el sello se lee del historial (`src/stellar/historial.ts`, protocolo §7.1). El hash del sobre que contesta Horizon tiene que ser el pedido (se recalcula con la passphrase de la red): la respuesta de otra transacción, o un sobre armado a mano, no coincide. Un hash que Horizon no conoce, o que no se pudo leer, da "no confirmado" (amarillo) y nunca verde ni "no está": con un 404 no se distingue "nunca existió" de "esa fuente ya no la guarda"; uno que existe y no es un sello de este sorteo da rojo. Lo que no son 64 hexadecimales se descarta al leer el enlace |
| Un comprobante que cita el `seal` de un contrato propio, o uno que la red rechazó | **Cubierto desde el 25 de octubre de 2026** | La transacción tiene que ser una llamada a `seal` de un contrato de `deployments.json` y tiene que haber salido bien. Un `seal` en un contrato ajeno da rojo aunque haya entrado, y una transacción fallida no selló nada: rojo |
| Un contrato anterior que sigue abierto, visto por el historial | **Cubierto desde el 25 de octubre de 2026** | La transacción de un sello no trae el número del sorteo, así que el tope `ultimoId` no se puede aplicar. Cada contrato anterior lleva `ultimoLedger`, el ledger de su último sello oficial, y lo que cae después da rojo. Un anterior sin `ultimoLedger` no se acepta por historial |
| El número del sorteo en un comprobante verificado por historial | **Abierto, y se dice** | La transacción de un sello no trae el número (lo devuelve el contrato): el mismo sello sale verde con cualquier número en el enlace, sea 1, 9, 170 o el mayor posible. Por eso, cuando el verde viene del historial, la interfaz no presenta el número como comprobado: identifica el sorteo por la fecha en que cerró el ledger y por el código corto de la transacción, y el número va aparte, como "el que figura en el comprobante". En un evento, el mismo sello con números distintos cuenta como uno solo |
| Horizon no contesta, o ya no guarda la transacción | **Cubierto desde el 25 de octubre de 2026** | Si el estado ya no tiene el sorteo y el historial no se puede leer (sin red, límite de pedidos, una respuesta que no se entiende, HTTP 410 porque esa fuente ya no guarda algo tan antiguo, o HTTP 404), el resultado es "no confirmado", con el motivo en lenguaje simple. Nunca "no está" ni rojo: una fuente que no contesta, o que ya olvidó, no prueba que el sorteo no exista. "No está" queda para el comprobante sin hash del sello, donde no hay nada que consultar |
| El estado del contrato y el historial no cuentan lo mismo | **Cubierto desde el 25 de octubre de 2026** | Con el sorteo en el estado, manda el estado; si la transacción que cita el comprobante dice otra cosa del sello (quién, huella, cantidad, ganadores, ronda, hora, ledger o premio), rojo. Si el historial no contesta, no cambia nada |
| Un enlace corto que lleva a otra página | **Cubierto** | Al abrirlo, el navegador solo acepta una ruta de `verificar.html` o `evento.html` de este mismo sitio (`src/enlace-corto.ts`): un enlace corto no puede mandar a otro dominio |

## T: Alteración

| Amenaza | Estado | Por qué |
|---|---|---|
| Cambiar un nombre de la lista después de sellar | **Cubierto si está anclado** | La huella SHA-256 quedó en el contrato. Cualquier cambio da otra huella y la verificación lo marca en rojo |
| Lo mismo, en modo libre | **No cubierto, y se dice** | El comprobante trae la lista y la firma juntas, así que recomputar siempre cierra. Por eso la verificación da un veredicto **amarillo** y no verde: la cuenta está bien, pero nadie atestigua que esa fuera la lista original |
| Torcer la selección | **Cubierto** | La selección es determinista y está especificada en `docs/protocolo.md`. Hay vectores compartidos entre la implementación en Rust y la de TypeScript, y los dos tienen que pasarlos |
| Sortear dos veces buscando otro resultado | **Cubierto** | `draw` guarda el resultado y devuelve el error 2 si ya se hizo |
| Reintentar a ciegas hasta que salga el resultado buscado (el ataque de `try_call` sobre el PRNG de la red que describe [rs-soroban-sdk#1748](https://github.com/stellar/rs-soroban-sdk/issues/1748)) | **No aplica** | Tinkazo no usa el PRNG de la red. El resultado sale de la firma de una ronda de drand que no existe cuando se sella y que es una sola por ronda: cada intento de `draw` da exactamente lo mismo, y el contrato guarda el primero |
| Elegir una ronda que ya existe | **Cubierto** | `seal` exige que la ronda nazca al menos treinta segundos después, y como mucho treinta días. La verificación lo vuelve a comprobar con la hora del sello que guardó la cadena, no con la del enlace |
| Sellar con menos gente que la lista, para que los últimos no puedan ganar | **Cubierto desde el 22 de octubre de 2026** | El contrato no ve los nombres: guarda la huella y la cantidad que le dicen. Sellada la lista de diez con cantidad cinco, solo los cinco primeros pueden salir, y con un ganador la página daba verde una de cada dos veces. Ahora la verificación exige que la cantidad del sello sea la de la lista canónica del enlace |
| Mostrar en un comprobante en verde otro número, otra ronda o una lista "de más" | **Cubierto desde el 22 de octubre de 2026** | La verificación compara la ronda del enlace con la del sello, la firma y la semilla con las grabadas, y exige que la lista del enlace ya venga canónica: un nombre que se cae al canonicalizar ("Ana, Juan Pérez" se sella como "Ana") se vería en la lista y en el buscador sin haber estado |
| Un juego que muestre otro ganador | **Cubierto** | Los juegos reciben el ganador ya decidido. El auditor lo comprueba en cada juego: el nombre en pantalla tiene que ser el que fijó el protocolo |
| El servicio de enlaces cortos cambia el comprobante | **Cubierto** | La copia va cifrada con AES-GCM, que la autentica: sin la clave, cualquier cambio hace que no se pueda abrir ("Este enlace no se puede abrir"). Y lo que se abre es el comprobante de siempre: la página rehace el sorteo y, si está anclado, lo compara con Stellar |

### El ataque real: selección del compromiso

**Es la única forma conocida de torcer un sorteo de Tinkazo con la lista ya sellada, y no está cerrada.** Antes de sellar hay otra, más común: inflar la lista (más abajo).

Un organizador sella cinco listas distintas, cada una contra una ronda distinta, y después publica solo el comprobante de la que le dio el resultado que quería. Cada uno de esos sorteos es, por separado, perfectamente legítimo.

**Lo que hay hoy:**

- Todos los sellos son públicos bajo la dirección del organizador. Cualquiera puede enumerarlos en un explorador de bloques y ver que hubo cinco.
- El identificador del sorteo se anuncia antes de que exista la semilla, así que si el organizador lo dijo en voz alta, cambiarlo después se nota.
- Sellar cuesta, así que el ataque tiene un precio por intento. Bajo, pero no cero.

**Lo que se hizo el 20 de septiembre de 2026:** la página de verificación ahora **trae y muestra los otros sellos recientes de esa misma dirección**, al lado del veredicto. Si el organizador selló cinco listas, se ven las cinco, con cuánta gente tenía cada una y contra qué ronda. La fila del sorteo que se está mirando va marcada.

**Lo que se hizo el 21 de septiembre de 2026:** la lista ya no sale de los eventos del RPC, que duran siete días, sino del estado del contrato, que no tiene ventana. Se ven todos los sellos de esa dirección que siguen en la cadena. Y la página marca sola las dos señales:

- **La misma huella de lista**, sellada otra vez. Es la forma directa del ataque y no tiene otra lectura.
- **La misma cantidad de gente** con otra huella. Es más débil: puede ser otro sorteo del mismo evento. Pero es lo que queda si el organizador reordena los nombres para cambiar la huella, porque el protocolo no ordena la lista (§1). Por eso se marca y se explica, sin acusar.

**Los límites, que hay que decir:** una entrada cuyo alquiler se venció se archiva y deja de aparecer hasta que alguien la restaure, y se recorren como mucho los últimos dos mil sorteos del contrato. Y si el RPC no contesta, la sección no aparece: decir "hay uno solo" sin haber podido mirar sería peor que callar. **Tampoco se revisan en el verde por historial** (desde el 25 de octubre de 2026): si el contrato ya no guarda el sorteo, esa sección no aparece y el detalle técnico lo dice. Enumerar los sellos de una lista exige leer el estado del contrato; la transacción de un sello no los trae. Por eso la misma lista sellada dos veces, en rondas y cuentas distintas, sale verde las dos veces por historial: hoy solo se detecta mirando el estado vivo del contrato, mientras exista.

**Lo que se hizo el 4 de octubre de 2026:**
- Durante la espera, el número del sorteo se muestra bien grande ("Sorteo #170 en Stellar · anotalo o sacale una foto"). Así queda en las fotos de la sala antes de que exista el número que decide, y si después aparece otro sello, todos tienen el número del bueno.
- La verificación ya leía los últimos dos mil sorteos del contrato y descartaba los de otras cuentas. Ahora marca también la misma huella sellada desde **otra cuenta**, así que cambiar de cuenta ya no esconde la forma directa del ataque.
- La lista de ejemplo del sitio no dispara la alarma: la sella cualquiera que prueba con su cuenta.

**Lo que se hizo el 22 de octubre de 2026** (revisión adversarial de la verificación estricta):
- La misma lista sellada otra vez, por la misma cuenta o por otra, ya no deja el verde como si nada: `verificar.html` baja a amarillo ("Cuadra, pero esta lista se selló más de una vez").
- Se marca también la forma que reordena la lista para cambiar la huella y la sella desde otra cuenta: otra cuenta, la misma cantidad de gente y una ronda a menos de diez minutos. Es un aviso, no un amarillo: puede ser otro evento a la misma hora.
- `evento.html` tiene la misma defensa: para cada sorteo, los sellos de la misma lista que no están en el enlace (amarillo) y los parecidos de otra cuenta (aviso). Antes no tenía ninguna.

**Lo que sigue faltando:** el ataque no está cerrado, solo es mucho más visible. Cerrarlo del todo exigiría que el organizador anuncie el identificador del sorteo por un canal que él no controle antes de sellar, y eso Tinkazo no lo puede imponer.

### El ataque más común: inflar la lista antes de sellar

El sello impide cambiar la lista **después**. No impide que se arme mal **desde el principio**. Quien organiza elige qué nombres entran, y puede meter a un amigo tres veces con variantes ("Ana Quispe", "ana quispe", "Ana Quispe M."), sumar nombres de relleno o dejar afuera a alguien que vino. Es más común que la selección del compromiso, porque no hace falta saber nada de cadenas: alcanza con editar un texto. Agregado el 29 de septiembre de 2026, después de que una revisión externa marcó que faltaba.

**Lo que hay hoy:**

- **La lista puede salir de un tercero.** La ventana de importar toma el export de Luma y propone solo a los que hicieron check-in, que es un registro que el organizador no escribe a mano. En el primer export real que se probó, de 67 inscritos vinieron 35.
- **Los repetidos se ven.** La ventana junta los nombres que son iguales sin tildes ni mayúsculas y pregunta si es la misma persona. Por defecto entra una vez.
- **La lista entera viaja en el comprobante.** Cualquiera de la sala puede buscarse y contar cuántas veces aparece cada nombre.

**Lo que se hizo el 4 de octubre de 2026:** la lista se puede mostrar a la sala **antes de sellar**. Va a pantalla completa en el proyector, numerada y con los repetidos marcados, y trae un QR que abre la misma lista en el celular de cada uno, con un buscador. El enlace lleva la lista en el fragmento, como el comprobante, así que no pasa por ningún servidor. Abajo se ve el principio de la huella: cuando se sella, la huella del sorteo tiene que empezar igual. El comprobante también tiene el buscador ("estás en el puesto 37 de 120"). El que está dos veces o el que falta se descubre solo, y antes del sello, cuando todavía se puede arreglar.

**Lo que falta:** que cada participante reciba su propia prueba ("estuviste en el puesto 37 de 120"), que es lo que deja a una persona descubrir que la dejaron afuera sin tener que leer la lista entera. Está en el plan de los próximos 30 días, en el kit para organizadores. Y el protocolo no ordena la lista (§1), así que reordenar los nombres cambia la huella sin cambiar a nadie: un protocolo v3 podría ordenar la lista canónica y pedir en el contrato que una misma dirección no selle dos veces la misma huella, lo que cerraría también la forma directa de la selección del compromiso. Ninguna de las dos cosas impide que alguien invente un nombre: eso solo lo ve la sala.

## R: Repudio

| Amenaza | Estado | Por qué |
|---|---|---|
| El organizador niega haber sellado | **Cubierto** | La transacción está firmada por su cuenta y queda en la cadena |
| El organizador dice que el resultado fue otro | **Cubierto** | El resultado lo guardó el contrato, no el organizador |
| Alguien niega que el faro publicó esa ronda | **Cubierto** | La firma se verifica contra la clave pública de quicknet, que es pública y fija |
| No queda registro de quién finalizó el sorteo | **Aceptado** | `draw` no pide permiso a propósito: cualquiera puede finalizar un sorteo pendiente, y eso es una función, no un descuido. Impide que un organizador retenga un resultado que no le gustó |

## I: Filtración de información

| Amenaza | Estado | Por qué |
|---|---|---|
| Los nombres llegan a la cadena | **Cubierto** | En la cadena viajan la huella de la lista, la cantidad de entradas, cuántos ganadores, la ronda, la hora del sello y su número de bloque, el premio o título que escribiste, la dirección de quien organiza y el número del sorteo; y, al sortear, la prueba que publicó la ronda, el número que decidió la ronda, la hora del sorteo, si ya se sorteó, su número de bloque y las posiciones de los ganadores. El contrato nunca ve un nombre |
| Los nombres llegan a los registros del hosting | **Cubierto** | El comprobante viaja en el fragmento de la URL, que el navegador no envía al servidor |
| Los nombres llegan a un tercero por el QR | **Cubierto desde el 20 de septiembre de 2026** | Se le pedía el QR a un servicio ajeno, mandándole la URL entera como parámetro de consulta. Los nombres salían del navegador igual, solo que a otro lado. Ahora el QR se dibuja en el navegador, y hay una comprobación que lo verifica |
| Los avatares de la lista salen a un servicio externo | **Cubierto desde el 20 de septiembre de 2026** | Cada participante generaba una petición a un servicio de avatares con su nombre en la dirección: con doscientos inscritos, doscientas peticiones con nombres reales adentro. Ahora el avatar sale de un hash del nombre y se dibuja en el navegador. **Comprobado: la única petición que sale durante un sorteo es la ronda del faro** (compartir o mostrar en grande, después, va además al servicio de enlaces cortos) |
| Quien comparte el enlace expone la lista | **Aceptado y explícito** | El comprobante trae los nombres a propósito: sin ellos nadie puede recomputar. Quien comparte el enlace comparte la lista, y eso se dice |
| La huella filtra la lista | **Cubierto en la práctica** | SHA-256 de la lista canónica completa. Adivinar la lista exige adivinar todos los nombres, en orden, con la forma exacta |
| Quien tiene la foto, el QR o el enlace corto ve la lista | **Aceptado y explícito** | Es lo mismo que con el enlace largo, pero más fácil: el QR del enlace corto se lee desde el fondo de la sala o desde una foto del proyector, y desde el 21 de octubre de 2026 no hay una imagen sin QR (la "Imagen para redes" salió). El diálogo de compartir lo dice ("Quien tenga la foto o el enlace puede ver la lista entera"), y también los términos y la página para clases |
| El servicio de enlaces cortos lee las listas | **Cubierto** | El navegador cifra el comprobante con AES-GCM y una clave nueva de 16 bytes por enlace, y la clave viaja solo en el fragmento de `tinkazo.app/c/<id>#<clave>`, que el navegador no envía. **El límite es el de siempre:** si alguien tomara el sitio, podría servir una página que lea la clave al abrir el enlace, igual que hoy podría leer el fragmento del enlace largo. Por eso el código es abierto |
| Lo que el servicio ve aunque no lea | **Aceptado** | Cloudflare, y con él el Worker, ve la dirección IP de quien arma o abre un enlace, cuándo, el id y cuánto pesa la copia, que da una idea del largo de la lista. El Worker usa la IP solo para el cupo por hora, en memoria, y no guarda registros: `wrangler.toml` no prende la observabilidad |
| Una copia que no vence | **Aceptado, y se dice** | Queda para que el sorteo se pueda volver a comprobar. La interfaz no la borra (cortaba la verificación de todos los que la tenían y se tocaba sin querer): se pide a hola@tinkazo.app y Tinkazo la borra con el secreto del Worker. Borrarla no le quita la lista a quien ya la abrió: su navegador guarda el enlace largo |
| Adivinar enlaces cortos ajenos | **Cubierto en la práctica** | El id tiene 8 caracteres de base 62 (unos 2 × 10¹⁴) y, sin la clave, lo que devuelve el servicio no dice nada |

## La fecha que le pone vencimiento a todo: 16 de diciembre de 2026

**Testnet se borra entera.** La documentación de Stellar anuncia el reset para el 16 de diciembre de 2026 a las 17:00 UTC, con dos semanas de aviso, y ese reset borra las entradas de ledger, las transacciones y la historia, en Core, en Horizon y en el RPC.

Lo que eso significa para Tinkazo, sin adornos:

- La dirección del contrato desaparece y hay que desplegar otro.
- **Todos los comprobantes anclados que se hayan compartido dejan de verificar.** No degradan: mueren. Quien abra el enlace ve "no pude comprobarlo".
- Los identificadores de sorteo vuelven a empezar en uno, así que un comprobante viejo puede terminar apuntando a un sorteo **distinto** del contrato nuevo. Eso es peor que no verificar.
- El README y la presentación dicen que el registro sobrevive a que Tinkazo desaparezca. En testnet eso no es cierto.

**La consecuencia práctica:** los sorteos de prueba pueden seguir en testnet, pero **el primer sorteo con gente de afuera tiene que estar en mainnet**. Si una comunidad sortea en octubre y en diciembre abre el enlace y no hay nada, el daño es peor que no haber anclado nunca.

Mitigación parcial, ya hecha: **el comprobante lleva siempre la firma de la ronda**, esté anclado o no. Así, aunque el contrato desaparezca, la matemática se puede rehacer y el veredicto baja a amarillo en vez de morir. Lo que se pierde con el reset es el testigo, no la cuenta.

**El historial de transacciones tampoco sobrevive a ese reset, ni dura para siempre.** Desde el 25 de octubre de 2026 el comprobante lleva además el hash de la transacción del sello, y con él la verificación puede seguir en verde cuando el estado del contrato ya venció (siete días en testnet, 120 en mainnet), leyendo el historial de Horizon. Pero Horizon de testnet se borra el 16 de diciembre junto con todo lo demás: el hash no resucita nada ahí. En mainnet, el Horizon público guarda unos 413 días (medido el 25 de octubre de 2026, una ventana que avanza) y la SDF lo describe cerca del final de su vida: pasada la ventana, o si esa fuente desaparece, el resultado vuelve a ser "no confirmado". No hay otra fuente todavía; una segunda fuente independiente y los sobres de las transacciones dentro del comprobante están previstos para más adelante.

## D: Denegación de servicio

| Amenaza | Estado | Por qué |
|---|---|---|
| Los relays de drand no responden | **Mitigado** | Hay cuatro y se rotan, con hasta doce intentos. El estado se muestra en pantalla con el número de intento, y al fallar el botón ofrece reintentar |
| **Randamu, el administrador corporativo de drand, cerró en febrero de 2026** | **Vigilado** | La red es operada por la League of Entropy, que es un conjunto de organizaciones independientes, no por una empresa. Los cuatro relays responden y la ronda última vuelve firmada. Pero el riesgo de abandono a largo plazo es real y hay que decirlo |
| El RPC de Stellar no responde | **Mitigado** | La verificación distingue "no pude leer el contrato" de "este sorteo no está anclado". Confundirlas acusaba al organizador por culpa del wifi |
| Se cae el hosting | **Mitigado** | El sitio es estático. Lo que quedó en la cadena sobrevive a que Tinkazo desaparezca, y el protocolo está especificado para que cualquiera lo reimplemente |
| Se cae el servicio de enlaces cortos | **Mitigado, con un hueco** | Compartir y mostrar en grande no esperan más de cinco segundos y siguen con el enlace largo: el sorteo no depende del servicio. El hueco: un enlace corto que ya se compartió no abre mientras dure la caída, y quien lo recibió solo tiene ese. El comprobante largo sigue andando, y quien organiza lo tiene en Mis sorteos («Ver comprobante»), en el equipo donde sorteó, para mandarlo de nuevo. Si el servicio desapareciera para siempre, mueren los enlaces cortos y no los largos |
| Abusar del servicio: gastar sus cupos o llenarlo | **Parcial** | Crear un enlace exige el origen del sitio, pero eso solo frena a otras páginas web: un script manda el encabezado que quiera (`probar.mjs` lo hace). Los límites que valen son 256 KB por enlace, 60 altas por hora por dirección IP, contadas en memoria (si el objeto se duerme vuelven a cero), y 2.000 por día en total (eran 20.000 hasta el 26 de octubre de 2026). Quien gaste el cupo del día deja sin enlace corto al resto hasta el día siguiente, y se comparte el largo. Como nada vence, 2.000 enlaces de 256 KB por día (512 MB) llenan los 5 GB del plan gratis en unos diez días de abuso seguido (con el tope anterior alcanzaba un día), y limpiarlos pide una herramienta que hoy no existe: el borrado a pedido va de a un id |
| Una lista enorme cuelga el navegador | **Parcial** | El auditor exigente corre los diez juegos del selector, y también los que salieron de él, con doscientos participantes en cada auditoría (la ruleta también: desde el 21 de octubre de 2026 llega a doscientos) y mide que cierren y sigan fluidos. Con quinientos y mil se midió a mano el 22 de septiembre en tres juegos. Arriba de eso no está medido |
| Un sorteo que se queda sin finalizar | **Cubierto** | `draw` no pide permiso: la propia página de verificación le ofrece a quien abra el enlace finalizarlo |
| La pantalla se apaga en medio del sorteo | **Cubierto** | El estadio le pide al sistema que no apague la pantalla, y lo vuelve a pedir al volver de segundo plano |

## E: Elevación de privilegios

| Amenaza | Estado | Por qué |
|---|---|---|
| Alguien toma el control del contrato | **Cubierto por diseño** | El contrato **no tiene administrador, no se puede actualizar y no custodia fondos**. No hay privilegio que tomar |
| Vaciar los fondos del contrato | **No aplica** | Nunca tiene fondos |
| Un error deja el contrato inutilizable | **Mitigado** | Diecinueve tests, incluida una ronda real de quicknet. Los errores están numerados y son parte de la interfaz pública: nunca se renumeran |
| El RPC de mainnet se cae o desaparece | **Abierto** | `mainnet.sorobanrpc.com` es de un tercero: la SDF no ofrece un RPC público de mainnet. Si se cae, el sitio no puede sellar ni anclar, aunque el modo libre sigue sorteando y la verificación por drand sigue funcionando en el navegador. Los comprobantes ya emitidos no se pierden: están en la cadena y cualquier otro RPC los lee. Mitigación parcial hecha: el endpoint vive en un solo lugar (`RPC_URLS` en `src/stellar/config.ts`) para que rotarlo sea un cambio de una línea. Falta una lista de respaldo con reintento, que es trabajo pendiente antes de mainnet |
| La renta se vence y el contrato desaparece | **Mitigado en parte** | Desde el 25 de octubre de 2026, un comprobante con el hash de la transacción del sello (`stx`) puede seguir verificando por el historial de Stellar aunque el estado del contrato ya haya vencido, mientras esa fuente guarde la transacción (unos 413 días en el Horizon público de mainnet; protocolo §7.1): mantenerlo vivo deja de ser lo único que sostiene el verde, pero no es para siempre. Cada sorteo paga la renta de sus dos entradas por ciento veinte días. La renta de la instancia y del código se renueva aparte con `extend`, nunca dentro de `seal` ni de `draw`. **Esto ya costó caro una vez**: extender la renta de la instancia arrastra la del código, y el primer sellado desplegado cobró quince XLM |
| Alguien borra enlaces cortos ajenos | **Cubierto** | Borrar pide el permiso de ese enlace (16 bytes al azar, que el servicio guarda solo como huella y que la interfaz ya no usa) o el secreto de administración, que se compara en tiempo constante, tiene que medir 32 caracteres o más y, si no está cargado, no existe. Con el secreto se puede borrar cualquier enlace: no se versiona ni se comparte |

## Lo que se vigila en la cadena

El plan de monitoreo, para cuando esté en mainnet.

| Qué se mira | Cómo | Qué dispara |
|---|---|---|
| Sellos por dirección | Eventos `sealed` del contrato | Varias listas selladas cerca en el tiempo por la misma dirección: posible selección de compromiso |
| Sorteos sin finalizar | Sellos con ronda ya pasada y sin `drawn` | Avisar a quien abra el comprobante de que puede finalizarlo |
| Errores de firma inválida | Error 8 | Un relay sirviendo basura, o alguien probando |
| Renta del contrato | Vencimiento de la entrada del código | Extender antes de que falten treinta días |
| Salud de los relays | Los cuatro, periódicamente | Si caen todos, el sorteo no se puede finalizar hasta que vuelvan |
| Costo real por sorteo | Comisión de las transacciones | Un salto indica un cambio de protocolo o del tamaño del contrato |

## Lo que está pendiente, en orden

2. ~~Medir con más de doscientos participantes~~: hecho el 22 de septiembre de 2026. Con mil, el sorteo corre a sesenta cuadros por segundo y se ancla igual; el límite real es cuándo deja de leerse la lista en pantalla, no el rendimiento. Números en [epics.md](epics.md), historia 7.11.
3. **Un aviso cuando la renta del contrato se acerca al vencimiento.**
4. ~~Reconstruir el historial desde el estado del contrato~~: hecho el 21 de septiembre de 2026, para el historial del organizador y para los sellos de la página de verificación.
5. **El abuso del servicio de enlaces cortos**, si aparece: un tope por enlace más chico (un evento de treinta sorteos de doscientas personas pesa unos 50 KB), un vencimiento para lo que nadie abre y una forma de limpiar de a muchos. Mientras, se mira en el panel de Cloudflare cuántas altas hay por día y cuánto espacio se usa.
6. **Una segunda fuente para el historial, y los sobres de las transacciones dentro del comprobante.** Hoy el verde por historial depende de una sola fuente (Horizon) y de que esa fuente conserve la transacción. Previsto, sin hacer ni decidido: cambia el formato del comprobante y se resuelve más adelante.

## Lo que decidimos no hacer

| Decisión | Por qué |
|---|---|
| No cifrar la lista en el comprobante | Sin los nombres nadie puede recomputar, y recomputar es el producto. El enlace corto guarda una copia cifrada, pero la clave va con el enlace: quien lo tiene, la lee |
| No guardar nada legible en un servidor | Un servidor es algo en lo que habría que confiar, y el argumento entero es que cada paso se puede comprobar. Desde el 21 de octubre de 2026 hay uno, el de los enlaces cortos ([architecture.md](architecture.md), D-18), y por eso guarda la copia cifrada, sin la clave, y no decide nada: la página rehace el sorteo igual |
| No ofrecer en la interfaz borrar un enlace corto | Borrarlo deja sin comprobante a todos los que ya lo recibieron (el grupo, la foto, el proyector), puede parecer que se esconde un resultado y se toca sin querer. Se borra a pedido, escribiendo a hola@tinkazo.app |
| No hacer el contrato actualizable | Un contrato actualizable tiene un administrador, y un administrador es alguien que puede cambiar las reglas después |
| No usar el hash del ledger como semilla | Un validador puede influir en el margen, y no queda una firma que un tercero pueda verificar años después |
