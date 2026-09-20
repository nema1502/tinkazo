# Modelo de amenazas

Qué puede salir mal en Tinkazo, quién podría hacerlo, qué lo impide hoy y qué no. Escrito con el método STRIDE, que agrupa las amenazas en seis familias: suplantación, alteración, repudio, filtración, denegación de servicio y elevación de privilegios.

Este documento existe por dos motivos. El primero es que el Stellar Community Fund lo pide como entregable obligatorio del segundo tramo. El segundo es mejor: **el producto vende que nadie puede arreglar un sorteo, y una afirmación así hay que poder defenderla por escrito.**

Lo que hay acá no son hipótesis: cada límite del diseño está anotado con lo que efectivamente pasa hoy, no con lo que nos gustaría que pasara.

## Qué estamos protegiendo

| Activo | Por qué importa |
|---|---|
| **El resultado del sorteo** | Es el producto. Si se puede torcer, no hay nada más que discutir |
| **La lista de participantes** | Son nombres de personas reales. No tienen por qué llegar a ningún servidor |
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
| **La red del evento** | Corta o intercepta el tráfico | No puede falsificar una firma |

## S — Suplantación

| Amenaza | Estado | Por qué |
|---|---|---|
| Sellar en nombre de otro organizador | **Cubierto** | `seal` exige `organizer.require_auth()`. Sin la firma de esa cuenta la transacción no entra |
| Hacer pasar una ronda inventada por una de drand | **Cubierto** | `draw` verifica la firma BLS12-381 contra la clave pública fija de quicknet, dentro del contrato. Una firma que no valida devuelve el error 8 |
| Un relay que devuelve otra ronda | **Cubierto** | El cliente comprueba que el número de ronda que volvió sea el pedido, y la firma se verifica igual |
| Un sitio clonado que dice ser Tinkazo | **Parcial** | Un clon puede mostrar lo que quiera, pero no puede escribir en el contrato sin la cuenta del organizador. Un comprobante anclado abierto en el sitio de verdad delata la diferencia. **En modo libre no hay defensa**, y eso es parte de lo que compra anclar |

## T — Alteración

| Amenaza | Estado | Por qué |
|---|---|---|
| Cambiar un nombre de la lista después de sellar | **Cubierto si está anclado** | La huella SHA-256 quedó en el contrato. Cualquier cambio da otra huella y la verificación lo marca en rojo |
| Lo mismo, en modo libre | **No cubierto, y se dice** | El comprobante trae la lista y la firma juntas, así que recomputar siempre cierra. Por eso la verificación da un veredicto **amarillo** y no verde: la cuenta está bien, pero nadie atestigua que esa fuera la lista original |
| Torcer la selección | **Cubierto** | La selección es determinista y está especificada en `docs/protocolo.md`. Hay vectores compartidos entre la implementación en Rust y la de TypeScript, y los dos tienen que pasarlos |
| Sortear dos veces buscando otro resultado | **Cubierto** | `draw` guarda el resultado y devuelve el error 2 si ya se hizo |
| Elegir una ronda que ya existe | **Cubierto** | `seal` exige que la ronda nazca al menos treinta segundos después, y como mucho treinta días |
| Un juego que muestre otro ganador | **Cubierto** | Los juegos reciben el ganador ya decidido. El auditor lo comprueba en cada juego: el nombre en pantalla tiene que ser el que fijó el protocolo |

### El ataque real: selección del compromiso

**Esta es la única forma conocida de torcer un sorteo de Tinkazo, y no está cerrada.**

Un organizador sella cinco listas distintas, cada una contra una ronda distinta, y después publica solo el comprobante de la que le dio el resultado que quería. Cada uno de esos sorteos es, por separado, perfectamente legítimo.

**Lo que hay hoy:**

- Todos los sellos son públicos bajo la dirección del organizador. Cualquiera puede enumerarlos en un explorador de bloques y ver que hubo cinco.
- El identificador del sorteo se anuncia antes de que exista la semilla, así que si el organizador lo dijo en voz alta, cambiarlo después se nota.
- Sellar cuesta, así que el ataque tiene un precio por intento. Bajo, pero no cero.

**Lo que falta:** una herramienta dentro del producto que enumere los sellos de una dirección y los muestre en la página de verificación. Hoy la defensa existe pero depende de que alguien sepa buscarla en un explorador, y eso no es una defensa: es una nota al pie.

Está en el tramo 2 del plan del fondo.

## R — Repudio

| Amenaza | Estado | Por qué |
|---|---|---|
| El organizador niega haber sellado | **Cubierto** | La transacción está firmada por su cuenta y queda en la cadena |
| El organizador dice que el resultado fue otro | **Cubierto** | El resultado lo guardó el contrato, no el organizador |
| Alguien niega que el faro publicó esa ronda | **Cubierto** | La firma se verifica contra la clave pública de quicknet, que es pública y fija |
| No queda registro de quién finalizó el sorteo | **Aceptado** | `draw` no pide permiso a propósito: cualquiera puede finalizar un sorteo pendiente, y eso es una función, no un descuido. Impide que un organizador retenga un resultado que no le gustó |

## I — Filtración de información

| Amenaza | Estado | Por qué |
|---|---|---|
| Los nombres llegan a la cadena | **Cubierto** | En la cadena viaja solo la huella. El contrato nunca ve un nombre |
| Los nombres llegan a los registros del hosting | **Cubierto** | El comprobante viaja en el fragmento de la URL, que el navegador no envía al servidor |
| Los nombres llegan a un tercero por el QR | **Cubierto desde el 20 de septiembre de 2026** | Se le pedía el QR a un servicio ajeno, mandándole la URL entera como parámetro de consulta. Los nombres salían del navegador igual, solo que a otro lado. Ahora el QR se dibuja en el navegador, y hay una comprobación que lo verifica |
| Los avatares de la lista salen a un servicio externo | **No cubierto** | Cada participante genera una petición a un servicio de avatares con su nombre en la URL. **Es una filtración real y está pendiente**. La solución es generar el avatar en el navegador a partir del nombre |
| Quien comparte el enlace expone la lista | **Aceptado y explícito** | El comprobante trae los nombres a propósito: sin ellos nadie puede recomputar. Quien comparte el enlace comparte la lista, y eso se dice |
| La huella filtra la lista | **Cubierto en la práctica** | SHA-256 de la lista canónica completa. Adivinar la lista exige adivinar todos los nombres, en orden, con la forma exacta |

## D — Denegación de servicio

| Amenaza | Estado | Por qué |
|---|---|---|
| Los relays de drand no responden | **Mitigado** | Hay cuatro y se rotan, con hasta doce intentos. El estado se muestra en pantalla con el número de intento, y al fallar el botón ofrece reintentar |
| **Randamu, el administrador corporativo de drand, cerró en febrero de 2026** | **Vigilado** | La red es operada por la League of Entropy, que es un conjunto de organizaciones independientes, no por una empresa. Los cuatro relays responden y la ronda última vuelve firmada. Pero el riesgo de abandono a largo plazo es real y hay que decirlo |
| El RPC de Stellar no responde | **Mitigado** | La verificación distingue "no pude leer el contrato" de "este sorteo no está anclado". Confundirlas acusaba al organizador por culpa del wifi |
| Se cae el hosting | **Mitigado** | El sitio es estático. Lo que quedó en la cadena sobrevive a que Tinkazo desaparezca, y el protocolo está especificado para que cualquiera lo reimplemente |
| Una lista enorme cuelga el navegador | **Parcial** | Probado con doscientos participantes en los seis juegos. Arriba de eso no está medido |
| Un sorteo que se queda sin finalizar | **Cubierto** | `draw` no pide permiso: la propia página de verificación le ofrece a quien abra el enlace finalizarlo |
| La pantalla se apaga en medio del sorteo | **Cubierto** | El estadio le pide al sistema que no apague la pantalla, y lo vuelve a pedir al volver de segundo plano |

## E — Elevación de privilegios

| Amenaza | Estado | Por qué |
|---|---|---|
| Alguien toma el control del contrato | **Cubierto por diseño** | El contrato **no tiene administrador, no se puede actualizar y no custodia fondos**. No hay privilegio que tomar |
| Vaciar los fondos del contrato | **No aplica** | Nunca tiene fondos |
| Un error deja el contrato inutilizable | **Mitigado** | Diecinueve tests, incluida una ronda real de quicknet. Los errores están numerados y son parte de la interfaz pública: nunca se renumeran |
| La renta se vence y el contrato desaparece | **Mitigado** | Cada sorteo paga la renta de sus dos entradas por ciento veinte días. La renta de la instancia y del código se renueva aparte con `extend`, nunca dentro de `seal` ni de `draw`. **Esto ya costó caro una vez**: extender la renta de la instancia arrastra la del código, y el primer sellado desplegado cobró quince XLM |

## Lo que se vigila en la cadena

Plan de monitoreo, que es el otro entregable del tramo 2.

| Qué se mira | Cómo | Qué dispara |
|---|---|---|
| Sellos por dirección | Eventos `sealed` del contrato | Varias listas selladas cerca en el tiempo por la misma dirección: posible selección de compromiso |
| Sorteos sin finalizar | Sellos con ronda ya pasada y sin `drawn` | Avisar a quien abra el comprobante de que puede finalizarlo |
| Errores de firma inválida | Error 8 | Un relay sirviendo basura, o alguien probando |
| Renta del contrato | Vencimiento de la entrada del código | Extender antes de que falten treinta días |
| Salud de los relays | Los cuatro, periódicamente | Si caen todos, el sorteo no se puede finalizar hasta que vuelvan |
| Costo real por sorteo | Comisión de las transacciones | Un salto indica un cambio de protocolo o del tamaño del contrato |

## Lo que está pendiente, en orden

1. **Los avatares salen a un servicio externo con el nombre de cada participante en la URL.** Es la filtración que queda y contradice lo que el producto promete. Se arregla generando el avatar en el navegador.
2. **La enumeración de sellos por dirección**, dentro de la página de verificación, para que la defensa contra la selección de compromiso no dependa de saber buscar en un explorador.
3. **Medir con más de doscientos participantes.**
4. **Un aviso cuando la renta del contrato se acerca al vencimiento.**

## Lo que decidimos no hacer

| Decisión | Por qué |
|---|---|
| No cifrar la lista en el comprobante | Sin los nombres nadie puede recomputar, y recomputar es el producto |
| No guardar nada en un servidor | Un servidor es algo en lo que habría que confiar, y el argumento entero es que no hace falta confiar en nadie |
| No hacer el contrato actualizable | Un contrato actualizable tiene un administrador, y un administrador es alguien que puede cambiar las reglas después |
| No usar el hash del ledger como semilla | Un validador puede influir en el margen, y no queda una firma que un tercero pueda verificar años después |
