# Premios que se cobran, y avisos por correo

Propuesta, no decisión. Escrita el 25 de septiembre de 2026 para pensarla antes de construir nada. Reemplaza, si se aprueba, a la sección "Sobre pagar a los ganadores con USDC" de [epics.md](epics.md), que decía que no.

## Lo que se quiere

1. Traer la lista desde Luma, con los correos.
2. Avisar a todos por correo cuando se sortea, y al ganador en particular.
3. Que el ganador pueda **cobrar** el premio desde ese correo: en USDC sobre Stellar, sin haber tenido nunca una billetera.

## Lo que no se negocia

Las dos razones por las que antes se dijo que no siguen valiendo, así que el diseño las tiene que respetar:

- **Los participantes no necesitan nada para participar.** Ni billetera, ni cuenta, ni saber qué es Stellar. Solo el que gana, y solo si quiere cobrar en USDC, pasa por un alta, y esa alta tiene que ser "entrar con Google".
- **Tinkazo no custodia dinero.** Ni el contrato ni un servidor nuestro guardan fondos en ningún momento. El dinero va de la cuenta del organizador al ganador, y las reglas las pone Stellar, no nosotros.

Y una tercera, que sale de la promesa del producto: **la lista no llega a nuestro servidor.** Los correos menos que los nombres.

## 1. La lista desde Luma

Luma deja exportar los invitados de un evento como CSV. Lo sensato:

- Tomar **nombre** para la lista que se sella, y **correo** solo para avisar. El correo nunca entra en el sello: la huella es pública, y una lista de correos no se tiene que poder reconstruir ni probar.
- Filtrar por quienes **hicieron check-in**, con un botón para usar todos los aprobados. "Entre los que vinieron" es el caso más pedido en un evento.
- Los correos quedan en el navegador del organizador, como hoy la lista.

Falta: el CSV real de un evento, para ver las columnas exactas. Nicolás pasa links de eventos propios.

## 2. Los avisos

Tres caminos, de menos a más infraestructura:

| Camino | Cómo | Servidor | Límite |
|---|---|---|---|
| **A. Texto listo para Luma** | Tinkazo arma el anuncio del resultado y el del ganador; el organizador los pega en el envío masivo de Luma | Ninguno | Un paso manual. Pero el correo sale de Luma, que los invitados ya conocen: no cae en spam |
| **B. El correo del organizador** | `mailto:` con el texto armado (ya existe para el ganador) | Ninguno | Para todos no sirve: los clientes de correo cortan con cien destinatarios |
| **C. Envío desde Tinkazo** | Una función mínima que manda con Resend o Postmark, sin guardar nada | Uno chico, sin base de datos | Hace falta dominio propio con SPF y DKIM, y cuidar el abuso: solo organizadores con sesión, solo a los correos de la lista que sellaron, uno por persona y sorteo |

**Recomendación: A primero, C después si hace falta.** A se hace en un día, no rompe nada y resuelve el caso real.

Un detalle que convierte el aviso en algo que ninguna otra herramienta tiene: **a cada participante, su prueba.** "Estuviste en la lista sellada en el puesto 37; el sorteo se hizo con la ronda 32.507.924; verificalo acá." Cada uno puede comprobar que estuvo, no solo que el ganador existe.

## 3. El premio que se cobra

### El mecanismo: un saldo reclamable con vencimiento

Stellar tiene **saldos reclamables** (*claimable balances*, [CAP-23](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0023.md), [guía](https://developers.stellar.org/docs/build/guides/transactions/claimable-balances)): una operación que aparta fondos para uno o más reclamantes, cada uno con una condición. Y **reservas patrocinadas** ([CAP-33](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md), [guía](https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves)): una cuenta paga las reservas de otra. El organizador, desde su propia cuenta:

1. Genera en su navegador un **par de llaves nuevo**, que es el "cupón".
2. Crea un saldo reclamable de X USDC con dos reclamantes: **el cupón**, que puede cobrar antes de una fecha, y **el propio organizador**, que puede recuperarlo después de esa fecha.
3. Pone la llave secreta del cupón en el enlace del correo del ganador, **después del `#`**. Lo que va después del `#` no viaja al servidor: queda en el navegador de quien abre el enlace.

El ganador abre el enlace, entra con Google (Pollar le crea la cuenta) y firma una sola transacción que da de alta la cuenta del cupón con reservas patrocinadas, cobra el saldo, le pasa el USDC a su cuenta y cierra la del cupón. Todo o nada.

Lo que sale de esto:

- **No custodiamos nada.** El dinero sale de la cuenta del organizador y llega a la del ganador. Tinkazo arma la transacción, no la ejecuta con fondos propios.
- **Vence solo.** Si nadie cobra, el organizador recupera el premio después de la fecha, sin pedirle nada a nadie.
- **El contrato del sorteo no se toca.** Sigue sin fondos, sin admin y sin actualizaciones. El sorteo es el comprobante de por qué ese premio fue a esa persona.
- **Se puede comprobar.** El saldo reclamable es público en la cadena: cualquiera ve que el premio existe y está apartado, antes de que el ganador lo cobre.

Lo que no resuelve, dicho claro: **quien tenga el enlace, cobra.** Un correo reenviado es un premio regalado. Para premios chicos alcanza; para grandes, un segundo factor (un código que el organizador dice en voz alta en el evento, o que el enlace pida entrar con el mismo correo al que se mandó).

### Las reservas

Una cuenta nueva en Stellar necesita 1 XLM de reserva, y medio más por la línea de confianza al USDC. El ganador no tiene XLM. Dos salidas, a medir con Pollar:

- que Pollar patrocine las reservas de sus cuentas nuevas, o
- que el saldo reclamable del organizador lleve, además del USDC, unos 2 XLM para las reservas.

### Cobrar en plata

USDC en una cuenta de Stellar se puede pasar a moneda local por los anclas del ecosistema. **Qué opciones hay en Bolivia está por verificar** antes de prometerlo en ninguna pantalla: el caso de MoneyGram con USDC, qué países cubre hoy, y si hay anclas locales.

## El negocio

- **El sorteo, gratis, como hoy.** Es lo que trae organizadores.
- **El premio que se cobra, con una comisión chica por premio** (del orden de un 1%, o un monto fijo bajo), cobrada en la misma transacción que crea el saldo reclamable, a una cuenta de Tinkazo. Queda en la cadena, a la vista.
- **Premios de patrocinadores.** Una marca fondea el premio y aparece en el estadio y en el correo. Es el minuto del evento en que todos miran la pantalla.

Y para el Stellar Community Fund, el argumento más fuerte que puede tener el proyecto: **gente que nunca usó Stellar recibe USDC en su primer sorteo, entrando con Google, sin instalar nada.**

## Antes de construir

1. **Legal.** En Bolivia los sorteos promocionales están regulados. Hay que saber qué pide la norma para un sorteo gratuito entre asistentes de un evento, y qué cambia si el premio es dinero. Esto se consulta con alguien del área, no se supone.
2. **El CSV de Luma** real.
3. **Pollar**: si patrocina reservas, y si su SDK permite firmar la transacción de cobro junto con la llave del cupón.
4. **Cobrar en Bolivia**: qué anclas y qué opciones reales hay.

## El orden que propongo

| Paso | Qué | Servidor | Dinero |
|---|---|---|---|
| 1 | Importar el CSV de Luma, filtrar por check-in, correos solo en el navegador | No | No |
| 2 | Textos listos para el envío de Luma: resultado para todos, con la prueba de cada uno, y aviso al ganador | No | No |
| 3 | Cobro en testnet, con USDC de prueba, de punta a punta | No | De prueba |
| 4 | Con lo legal claro: cobro en mainnet y la comisión | No | Sí |
| 5 | Si hace falta: envío de correos desde Tinkazo | Uno chico | No |
