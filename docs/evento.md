# Enlace de evento

Un evento suele tener varios sorteos: un premio por cada cosa, o uno por cada tanda. El enlace de evento junta esos sorteos en un solo enlace, para que quien lo abre los revise todos de una vez, sin pegar un comprobante por cada uno.

Es la página [evento.html](../evento.html). Como el comprobante de un sorteo, el enlace lleva todo después del `#`: el fragmento de una dirección no se envía a ningún servidor, así que los nombres quedan en el navegador de quien lo abre.

## Cómo se arma

Desde **Mis sorteos**, la cuenta ve sus sorteos agrupados por evento:

- Los sorteos de una misma cuenta, ordenados por el momento del sello, forman un evento mientras la diferencia entre dos consecutivos sea de **doce horas o menos**. Una pausa de más de doce horas empieza otro evento. Las cuentas no se mezclan nunca.
- Solo entran los sorteos que tienen comprobante. Un sorteo que no se hizo, o que no tiene el enlace de su comprobante, queda fuera del evento y se sigue viendo en la lista de siempre.
- La cabecera dice «Sorteos del» y la fecha del primero, y cuántos son. El botón **Compartir el evento** copia este mensaje, con el enlace a la página:

```text
Sorteos del 20 de octubre de 2026 (4 sorteos), todos verificables.
Si querés verificarlos, entrá acá: https://tinkazo.app/evento.html#…

Sorteado con Tinkazo · https://tinkazo.app
```

- Un evento no tiene tope de sorteos. Se reparte en **varios enlaces** cuando uno pasaría de unos 8 mil caracteres (unos cuatro sorteos de 200 personas). Cada enlace dice cuál es (parte 1 de 3, y así), y ningún sorteo queda afuera.

## Qué se comprueba sin la cadena

La página rehace en el navegador de quien la abre, sorteo por sorteo, lo que no necesita la cadena:

1. **La firma de la ronda.** La firma BLS de la ronda pública de drand quicknet se verifica con la clave pública del faro. Si no verifica, el sorteo no cuadra.
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
- La página no guarda nada, no envía nada y no consulta la cadena. Solo los enlaces de «Verificarlo en la cadena» abren otra página, la de cada comprobante.
- Revisar un evento es gratis y no hace falta cuenta.

## Límites

- El enlace crece con los nombres, porque cada sorteo lleva su lista entera. Medido con listas de 200 personas con nombres distintos, 4 sorteos pesan unos 8 KB y 30 sorteos unos 50 KB. Algunos chats cortan los enlaces muy largos al pegarlos; si pasa, cada sorteo sigue teniendo su propio comprobante, que se abre desde Mis sorteos con «Ver comprobante».
- Un sorteo que pesa más que ese tamaño, por ejemplo uno con miles de personas, va en un enlace propio: queda entero, aunque ese enlace sea largo.
- El título y el mensaje se escriben en el idioma de quien comparte. La página los muestra tal cual.

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

Implementación: `src/protocol/evento.ts` (formato), `src/ui/agrupar.ts` (los eventos de una cuenta), `src/evento.ts` (la página). Las pruebas están en `src/protocol/evento.test.ts`, `src/ui/agrupar.test.ts`, `src/mensaje.test.ts` y `src/evento-textos.test.ts`.
