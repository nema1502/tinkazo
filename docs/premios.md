# El premio y los avisos

Qué hace Tinkazo con lo que se reparte, cómo se le avisa a cada participante y por qué hoy Tinkazo no mueve dinero. Nació el 25 de septiembre de 2026 como una propuesta de premios que se cobraban en USDC. El 22 de octubre de 2026 esa propuesta se pospuso: el USDC queda como una opción para más adelante, de otra forma y sin custodia (la constancia de entrega, más abajo). Acá queda lo que sigue en pie.

## Lo que hace Tinkazo, y lo que no

- **Decide a quién le toca.** Un libro, una entrada, un turno para exponer, un cupo en un viaje, una beca. Quien organiza escribe qué se sortea antes de sellar, y eso queda en el sello, a la vista.
- **No lo entrega.** Lo entrega quien organiza, como siempre. Si es dinero (una beca, un viático), lo paga desde su cuenta, por fuera de Tinkazo.
- **No toca dinero.** Ni el contrato ni un servidor nuestro guardan fondos, y Tinkazo no se queda con nada de lo que se reparte: ni un porcentaje ni un monto fijo.
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
