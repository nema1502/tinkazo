# Enlace de evento

Un evento suele tener varios sorteos: un premio por cada cosa, o uno por cada tanda. El enlace de evento junta esos sorteos en un solo enlace, para que quien lo abre los revise todos de una vez, sin pegar un comprobante por cada uno.

Es la página [evento.html](../evento.html). Como el comprobante de un sorteo, el enlace lleva todo después del `#`: el fragmento de una dirección no se envía a ningún servidor, así que los nombres quedan en el navegador de quien lo abre.

## Cómo se arma

Desde **Mis sorteos**, la cuenta ve sus sorteos de dos maneras, y las dos conviven:

- **Eventos con nombre** (abajo). Los arma quien organiza: les pone nombre y les suma los sorteos que quiera, de cualquier fecha.
- **Grupos por fecha.** Los sorteos de la cuenta que no están en un evento con nombre, ordenados por el momento del sello, forman un grupo mientras la diferencia entre dos consecutivos sea de **doce horas o menos**. Una pausa de más de doce horas empieza otro grupo. Las cuentas no se mezclan nunca.

En los dos casos solo entran los sorteos que tienen comprobante. Un sorteo que no se hizo, o que no tiene el enlace de su comprobante, queda fuera del evento y se sigue viendo en la lista de siempre.

El botón **Compartir el evento** copia el mensaje con el enlace a la página. Un evento con nombre usa su nombre en lugar de la fecha:

```text
Sorteos del 20 de octubre de 2026 (4 sorteos), todos verificables.
Si querés verificarlos, entrá acá:
https://tinkazo.app/evento.html#…

Sorteado con Tinkazo · https://tinkazo.app
```

Cuando el evento se reparte en varios enlaces, el botón dice cuántos (**Compartir el evento (3 partes)**), y el mensaje trae un enlace por parte.

- Un evento no tiene tope de sorteos. Se reparte en **varios enlaces** cuando uno pasaría de unos 8 mil caracteres (unos cuatro sorteos de 200 personas). Cada enlace dice cuál es (**Parte 1 de 3**, y así; en la página, en el título y en la pestaña), y ningún sorteo queda afuera.

## Eventos con nombre

Quien organiza puede agrupar sorteos bajo un nombre, para mandarlos juntos y revisarlos después. Todo se hace en **Mis eventos**, arriba de la lista:

- **Crear**: con el nombre, en el formulario de arriba. También con **Ponerle nombre** en un grupo por fecha: el grupo pasa a ser un evento con nombre, con los mismos sorteos y el nombre de la fecha, que se puede cambiar.
- **Sumar sorteos**: cada sorteo con comprobante tiene un selector, **Sumar a un evento…**. El sorteo sale de la lista suelta y se ve dentro del evento. No se hace de nuevo: el evento guarda su enlace de comprobante y sus ganadores, y un sorteo no se repite dentro del mismo evento.
- **Ver la lista**: cada evento se despliega en sus sorteos, con el premio, la fecha, quién ganó, **Ver comprobante**, **Compartir** y **Quitar del evento**. Quitar un sorteo no lo borra: vuelve a la lista de Mis sorteos.
- **Renombrar** (**Guardar el nombre**) o **borrar** el evento (**Borrar el evento**, con confirmación). Al borrarlo, sus sorteos vuelven a la lista de Mis sorteos.
- **Compartir el evento** abre el diálogo de la sección de abajo, con el mensaje y una imagen con el QR por cada parte.

Los eventos viven en este equipo, igual que el historial: en el almacenamiento del navegador, por red y por cuenta (`tinkazo.eventos.<red>`). Están **fuera de la cadena**: no se sellan, el contrato no cambia y el protocolo tampoco. "Borrar de este equipo" borra también los eventos de la cuenta; los sorteos anclados siguen en la cadena, y los que no lo están se pierden como el resto del historial.

Se evaluó anotar el id del evento en el campo `meta` de cada sorteo, para que el evento se viera desde otro equipo. No se hizo: hoy `meta` guarda el premio que muestra la página de verificación, así que el id cambiaría lo que se ve como premio, y el contrato de mainnet v1 es inmutable. Queda como opción si hace falta ver los eventos desde otro equipo.

## Compartir otra vez

Un comprobante se puede compartir cuantas veces haga falta, desde Mis sorteos (**Compartir**, en cada sorteo) y desde la página de verificación (**Compartir este sorteo**). No cambia el comprobante ni el enlace: sale del enlace y de los ganadores, así que quien vuelve días después con solo el enlace tiene lo mismo.

Lo que se comparte es lo mismo que sale en la pantalla del sorteo:

- **El mensaje**, en el idioma de quien comparte: quién ganó, entre cuántos, el premio, el enlace de verificación y el pie. Se copia, o se manda por WhatsApp (el enlace de WhatsApp lo abre con el texto puesto).
- **La imagen con el QR**, un PNG de 1080 × 1350: el título (el premio, o el nombre del evento), quién ganó, el QR del enlace y «Escaneá y comprobalo vos». Se dibuja en el navegador, como el QR, sin servicios de afuera. En el celular, **Compartir la imagen con el QR** abre el menú del sistema con la imagen y el mensaje; en la computadora, **Bajar la imagen con el QR** la baja.

Un QR no lleva más de unos 2.900 caracteres de enlace. Un sorteo con muchas personas puede pasar de ese tamaño: entonces no hay imagen, y el mensaje trae el enlace igual. Lo mismo pasa en la pantalla de «Mostrar en grande», que dibuja el mismo QR.

Un evento de varias partes muestra un QR por cada parte que cabe, y el diálogo avisa de las que no. Como cada parte pasa de unos 8 mil caracteres, casi nunca entra en un QR (ver «Decisiones abiertas»).

## Qué se comprueba sin la cadena

La página rehace en el navegador de quien la abre, sorteo por sorteo, lo que no necesita la cadena:

1. **La prueba de la ronda (firma BLS).** La firma BLS de la ronda pública de drand quicknet se verifica con la clave pública del faro. Si no verifica, el sorteo no cuadra.
2. **El ganador.** La firma da la semilla (el SHA-256 de la firma). Con esa semilla y la huella de la lista se rehace la selección del protocolo, y tiene que dar los mismos ganadores que dice el enlace.
3. **La huella de la lista.** Se recalcula desde los nombres del enlace, con la lista canónica del protocolo, y se muestra para poder compararla con la que quedó en la cadena.

Si los tres cuadran, el sorteo cuadra. El veredicto de arriba dice si cuadran todos: «Los sorteos cuadran», «Cuadran, pero no todos están anclados», «Hay sorteos que no cuadran» o «Falta comprobar algún sorteo».

## Qué no se comprueba sin la cadena

- **Que la lista sea la que se selló.** Sin la cadena no hay con qué compararla: quien armó el enlace pudo poner otra lista y la página la rehace igual, porque todo cierra consigo mismo. Lo que prueba que la lista no cambió es la huella que el contrato guardó al sellar. Para eso está el enlace de cada sorteo, **Verificarlo en la cadena**, que abre [verificar.html](../verificar.html) con su comprobante y lo compara con el contrato.
- **Los otros sellos de quien organiza.** La página de verificación los muestra; el enlace de evento no.
- **Los sorteos sin anclar.** Un sorteo que no se ancló en Stellar no tiene testigo: su lista es la que trae el enlace, y nada más. Mientras haya alguno, el veredicto es amarillo.
- **Una firma que no llega.** Solo pasa si el enlace no trae la firma de una ronda y la red de drand no responde: el sorteo queda «sin conexión», y al recargar la página se vuelve a intentar.

## Privacidad

- El enlace lleva **los nombres de todas las personas** de cada sorteo que trae, y los ganadores. Quien lo recibe ve las listas completas. Compartilo solo con quien tenga que revisar esos sorteos, igual que un comprobante.
- La foto para compartir (`src/ui/foto.ts`) lleva el QR del enlace: quien la tenga abre el comprobante, con la lista entera de cada sorteo. Así lo pidió Nicolás el 21 de octubre de 2026 («mandar también la foto de los ganadores con un QR para comprobarlo y verlo todo»), y el diálogo de compartir lo dice. Hasta ese día había una imagen para redes sin QR; salió.
- Compartir intenta primero el enlace corto (`tinkazo.app/c/…`, [workers/enlaces](../workers/enlaces/README.md)): el evento entero va en un solo enlace, y en Cloudflare queda una copia cifrada en el navegador, con la clave solo en el enlace, que Tinkazo no puede leer. No vence, para que el evento se pueda volver a revisar, y Mis sorteos no lo borra: si alguien necesita que se borre, lo pide a hola@tinkazo.app. Si el servicio no contesta, el evento va en las partes de siempre.
- La página del evento no guarda nada, no envía nada y no consulta la cadena. Solo los enlaces de «Verificarlo en la cadena» abren otra página, la de cada comprobante.
- Revisar un evento es gratis y no hace falta cuenta.

## Límites

- El enlace crece con los nombres, porque cada sorteo lleva su lista entera. Medido con listas de 200 personas con nombres distintos, 4 sorteos pesan unos 8 KB y 30 sorteos unos 50 KB. Algunos chats cortan los enlaces muy largos al pegarlos: por eso se comparte con el enlace corto, y sin él, en partes; si igual pasa, cada sorteo sigue teniendo su propio comprobante, que se abre desde Mis sorteos con «Ver comprobante».
- Un sorteo que pesa más que ese tamaño, por ejemplo uno con miles de personas, va en un enlace propio: queda entero, aunque ese enlace sea largo.
- El QR tiene un tope de unos 2.900 caracteres: un enlace más largo no tiene imagen, pero se sigue pudiendo copiar y mandar.
- El título y el mensaje se escriben en el idioma de quien comparte. La página los muestra tal cual.
- Los eventos con nombre viven en el navegador de quien los armó: en otro equipo no aparecen. Su enlace de evento sí se puede abrir desde cualquier lado.

## Decisiones abiertas

- **QR por parte.** El presupuesto de 8 mil caracteres por enlace deja casi todas las partes de un evento grande sin QR, porque el QR tope está en unos 2.900. Bajar el presupuesto a ese tamaño daría un QR a cada parte, a cambio de más enlaces. Es presentación: el protocolo no cambia. Lo decide quien organiza el producto.
- **El id del evento en `meta`.** No se hizo, por lo que se dice arriba. Si más adelante hace falta ver un evento desde otro equipo, es la opción.

## Formato

El texto después del `#` es igual al de un comprobante (`src/protocol/proof.ts`): `z` seguido de la compresión deflate en base64url, o `r` seguido del JSON en base64url si comprimir no ayuda. El JSON es:

```json
{
  "v": 1,
  "kind": "evento",
  "titulo": "Sorteos del 20 de octubre de 2026",
  "sorteos": [
    { "v": 2, "names": ["…"], "round": 32254977, "signature": "…", "prize": "Libro", "sealedAt": 1792500000, "ganadores": ["…"] }
  ],
  "mas": 3
}
```

- Cada sorteo es su comprobante completo más `ganadores`: los nombres que salieron, en orden. `net`, `contract` e `id` aparecen solo si el sorteo está anclado.
- Una versión que la página no conoce se rechaza entera: no muestra nada a medias.

## Implementación

- `src/protocol/evento.ts` (formato y partes), `src/ui/agrupar.ts` (los grupos por fecha), `src/ui/eventos.ts` (los eventos con nombre, en este equipo), `src/ui/history.ts` (Mis sorteos y Mis eventos), `src/ui/compartir.ts` (los mensajes y el diálogo), `src/ui/foto.ts` (la foto con el QR), `src/enlace-corto.ts` y `c.html` (el enlace corto), `src/ui/qr.ts` (el QR), `src/evento.ts` (la página).
- Pruebas: `src/protocol/evento.test.ts`, `src/ui/agrupar.test.ts`, `src/ui/eventos.test.ts`, `src/ui/compartir.test.ts` (los mensajes son los mismos que `summary` y `summaryEvento`, en es y en), `src/mensaje.test.ts` y `src/evento-textos.test.ts`.
