# Kit del organizador — tarea 3
Rama aislada `guido/kit-organizador`, base `6c583e98ee0864be13297297f7521097cc494b53`, origin/main comprobado por job54.
Entrega: página existente, guía A4, tarjetas ES/EN y PR propio sin integrar ni desplegar. El material editorial completo y literal está en L1.

## Specs
S1. “Implementá **una sola tarea** en Tinkazo: completar el kit del organizador.” “Trabajá en tu propio worktree y en la rama `guido/kit-organizador`, creada desde `main` actualizado.” “Esta tarea tiene su propio PR a `main`; no mezcles cambios de otras tareas.”
S2. “Completá la página existente `sorteo-para-meetup.html`. Donde el texto nuevo coincida con los cinco pasos actuales, prevalece el texto de Guido.” “Conservá las secciones «Por qué se puede comprobar» y «Qué pasa con los nombres». Añadí un identificador estable a la primera para enlazarla desde el QR de las tarjetas.”
S3. “Sí, apruebo las cuatro correcciones del Kit en español e inglés: los dos textos reales de botones, Chromecast desde computadora y «Advanced» en Luma. El resto del texto de Guido queda intacto y no se cambian botones de la app.” L3 fija las cuatro correcciones aprobadas; L1 sigue siendo la fuente literal para todo lo demás. “**Usá el texto de Guido, copiado abajo, sin reescribir frases.**” “Los textos entre «» y comillas rectas identifican botones de la app. Comprobá que coincidan con la interfaz en el idioma correspondiente. Si encontrás una diferencia, reportala y proponé el cambio concreto antes de modificar el texto de Guido.” “Toda frase visible debe existir en español e inglés en el mismo cambio. No uses el punto medio `·` en texto visible.” Fuente ES, EN y tarjeta: L1, sin resumir ni sustituir su contenido.
S4. “Sí, apruebo las cuatro correcciones del Kit en español e inglés: los dos textos reales de botones, Chromecast desde computadora y «Advanced» en Luma.” Esta aprobación de L4 prevalece únicamente sobre esas cuatro frases de L1. “Las indicaciones sobre HDMI, Chromecast y Luma se conservan tal como las entregó. Hay dudas técnicas sobre ellas: comprobá los pasos que puedas y explicá cualquier discrepancia en el informe y el PR, con fuente oficial; no cambies esas frases por iniciativa propia. Si impiden entregar una guía fiable, dejá el punto claramente identificado para decisión de producto.” “El GDG de Tarija debe poder seguir la guía sin tener a alguien de Tinkazo en la sala.”
S5. “Una guía bilingüe navegable e imprimible en A4, dentro de la página existente, y una tarjeta de mesa bilingüe con la marca Tinkazo y un QR fijo que abra directamente «Por qué se puede comprobar».” “La tarjeta debe permitir imprimir varias unidades por hoja A4 y leerse a un metro en blanco y negro. Elegí entre tarjeta plana o tipo carpa según lo que imprima y se lea mejor.”
S6. “La navegación a la sección de comprobación funciona desde el QR impreso. El QR es estático e igual para todos los eventos; apunta a la URL pública real de la página con su fragmento, no a una URL de vista previa. Conservá margen de silencio y contraste suficiente para que se escanee en impresión blanco y negro.” “La vista de impresión A4 de la guía no corta la tabla «Si algo falla» ni la plantilla de bases de forma que se pierda contenido. Los enlaces siguen siendo legibles en papel. Las tarjetas caben varias por hoja y mantienen tamaño de letra y QR utilizables.”
S7. “Verificá en navegador la versión de pantalla, la impresión o PDF A4, la tarjeta y el destino del QR. Revisá la vista previa de Vercel en computadora y celular. Si hay un celular físico disponible, probá al menos una ruta de proyección; indicá exactamente qué probaste y qué quedó sin probar.” “Ejecutá `pnpm typecheck`, `pnpm test` y `pnpm build` antes de subir. Agregá pruebas útiles para la navegación, idioma o impresión si el repositorio permite verificarlas sin duplicar la implementación. Incluí evidencia concreta de resultados en el PR.”
S8. “Usá el autor Git exacto `Guido Salazar Vargas <guido.salazar.vargas7@gmail.com>`. Escribí commits en español y sin notas personales. Abrí un PR a `main` y avisá cuando esté lista la vista previa. La integración la hacemos nosotros.” “No crees otra página para la guía ni cambies el flujo del sorteo, el cálculo del ganador, el sellado o el Worker.” “No reescribas el texto proporcionado ni cambies botones de la app para acomodar la guía sin una decisión de producto.” “No mezcles la encuesta, la página de marca ni los arreglos de juegos en este PR.” “No despliegues producción ni integres el PR.”
S9. “Si la pregunta de confianza de la tarea 2 ya está integrada en `main` antes de que cierres este PR, señalá la línea adicional para el mensaje de Luma indicada por Guido. Mantené las ramas independientes; no copies código de la tarea 2.”

## Tasks
- T1 | S1–S4,S9 | parent + bounded read-only research: contrastar interfaz/fuentes, conservar copy y resolver discrepancias reales | done: auditoría observada y cuatro correcciones aprobadas expresamente en L4 | commit: 66a2d793b2a5bf3cde75f9b2e8c97a0d72fd6e33
- T2 | S2–S5,S8 | bounded worker with T3; guía literal/A4 | done: fuente136unidades,153focalizadas/fullgates,140assertionsbrowser y PDFnativoES/EN4páginas sinpérdidas | commit: fec3c682d39f37bbfe9156f7c77c166215df6de2
- T3 | S3,S5,S6,S8 | same Kit worker; tarjeta bilingüe y QR fijo local | done implementation/digital: dos tarjetas completas/1A4, ambosQR delrasterdecodificados; lectura física1m no probada, límite de aceptación en T4 | commit: fec3c682d39f37bbfe9156f7c77c166215df6de2
- T4 | S1–S9 | parent gates + commits/PR/preview, sin integración | in_progress: pruebas digitales y main fresco aprobados; preparar PR, CI, preview auténtica y declarar límites físicos | commit: pending

## Log
L1 — User request (verbatim):

# Prompt para Gentle Shell: tarea 3, kit del organizador

Implementá **una sola tarea** en Tinkazo: completar el kit del organizador. Trabajá en tu propio worktree y en la rama `guido/kit-organizador`, creada desde `main` actualizado. Esta tarea tiene su propio PR a `main`; no mezcles cambios de otras tareas.

## Problema

El organizador de un meetup necesita poder preparar y ejecutar un sorteo sin ayuda de Tinkazo, desde una computadora o un celular, y llevar una guía impresa y tarjetas para las mesas. La página actual `sorteo-para-meetup.html` tiene pasos breves, pero no contiene todo el material operativo que entregó Guido.

## Contexto y decisiones

- Completá la página existente `sorteo-para-meetup.html`. Donde el texto nuevo coincida con los cinco pasos actuales, prevalece el texto de Guido.
- Conservá las secciones «Por qué se puede comprobar» y «Qué pasa con los nombres». Añadí un identificador estable a la primera para enlazarla desde el QR de las tarjetas.
- **Usá el texto de Guido, copiado abajo, sin reescribir frases.** Las indicaciones sobre HDMI, Chromecast y Luma se conservan tal como las entregó. Hay dudas técnicas sobre ellas: comprobá los pasos que puedas y explicá cualquier discrepancia en el informe y el PR, con fuente oficial; no cambies esas frases por iniciativa propia. Si impiden entregar una guía fiable, dejá el punto claramente identificado para decisión de producto.
- Los textos entre «» y comillas rectas identifican botones de la app. Comprobá que coincidan con la interfaz en el idioma correspondiente. Si encontrás una diferencia, reportala y proponé el cambio concreto antes de modificar el texto de Guido.
- Toda frase visible debe existir en español e inglés en el mismo cambio. No uses el punto medio `·` en texto visible.
- El GDG de Tarija debe poder seguir la guía sin tener a alguien de Tinkazo en la sala.
- Si la pregunta de confianza de la tarea 2 ya está integrada en `main` antes de que cierres este PR, señalá la línea adicional para el mensaje de Luma indicada por Guido. Mantené las ramas independientes; no copies código de la tarea 2.

## Resultado esperado

Una guía bilingüe navegable e imprimible en A4, dentro de la página existente, y una tarjeta de mesa bilingüe con la marca Tinkazo y un QR fijo que abra directamente «Por qué se puede comprobar». La tarjeta debe permitir imprimir varias unidades por hoja A4 y leerse a un metro en blanco y negro. Elegí entre tarjeta plana o tipo carpa según lo que imprima y se lea mejor.

## Criterios de aceptación

1. El contenido de las cinco secciones de Guido y la tarjeta están completos en español e inglés, sin alterar sus frases. La guía mantiene las dos secciones existentes indicadas arriba.
2. La navegación a la sección de comprobación funciona desde el QR impreso. El QR es estático e igual para todos los eventos; apunta a la URL pública real de la página con su fragmento, no a una URL de vista previa. Conservá margen de silencio y contraste suficiente para que se escanee en impresión blanco y negro.
3. La vista de impresión A4 de la guía no corta la tabla «Si algo falla» ni la plantilla de bases de forma que se pierda contenido. Los enlaces siguen siendo legibles en papel. Las tarjetas caben varias por hoja y mantienen tamaño de letra y QR utilizables.
4. Verificá en navegador la versión de pantalla, la impresión o PDF A4, la tarjeta y el destino del QR. Revisá la vista previa de Vercel en computadora y celular. Si hay un celular físico disponible, probá al menos una ruta de proyección; indicá exactamente qué probaste y qué quedó sin probar.
5. Ejecutá `pnpm typecheck`, `pnpm test` y `pnpm build` antes de subir. Agregá pruebas útiles para la navegación, idioma o impresión si el repositorio permite verificarlas sin duplicar la implementación. Incluí evidencia concreta de resultados en el PR.
6. Usá el autor Git exacto `Guido Salazar Vargas <guido.salazar.vargas7@gmail.com>`. Escribí commits en español y sin notas personales. Abrí un PR a `main` y avisá cuando esté lista la vista previa. La integración la hacemos nosotros.

## Qué no cambiar

- No crees otra página para la guía ni cambies el flujo del sorteo, el cálculo del ganador, el sellado o el Worker.
- No reescribas el texto proporcionado ni cambies botones de la app para acomodar la guía sin una decisión de producto.
- No mezcles la encuesta, la página de marca ni los arreglos de juegos en este PR.
- No despliegues producción ni integres el PR.

## Referencias para comprobar pasos externos

- Luma, descarga de invitados: https://help.luma.com/p/download-guest-csv
- Luma, avisos a asistentes: https://help.luma.com/p/sending-or-scheduling-event-blasts
- Google, transmisión desde Chrome en computadora: https://support.google.com/chromecast/answer/3228332?hl=en-GB
- Google, transmisión de pantalla Android: https://support.google.com/chromecast/answer/6059461?hl=en
- Apple, iPhone a una pantalla por cable: https://support.apple.com/guide/iphone/connect-to-a-display-with-a-cable-iph93af723b9/ios
- Apple, duplicar pantalla con AirPlay: https://support.apple.com/en-us/102661
- DENSO WAVE, margen del QR: https://www.qrcode.com/en/howto/code.html/index.html
- MDN, impresión CSS: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing

## Texto de Guido para incorporar

El texto que sigue es el material fuente. Respetá las frases de las secciones ES, EN y de la tarjeta. Las notas finales son instrucciones de implementación.

# Kit del organizador: el texto (es y en)

Guido: este es el texto para la tarea 3. Va en sorteo-para-meetup.html, en la versión para imprimir y en la tarjeta de las mesas.

- Dónde va. No es otra página: completá la que hay. Donde se pise con los cinco pasos cortos de hoy, manda este texto. Las secciones "Por qué se puede comprobar" y "Qué pasa con los nombres" quedan como están.
- Los botones. Lo que va entre «» es el texto exacto de un botón de la app. Están comprobados el 1-nov. Si cambiás un botón, cambialo acá también.
- Las reglas de siempre. Toda frase va en es y en en en el mismo cambio. En lo visible, nada de punto medio (·). Si querés cambiar una frase, avisame antes.
- Para quién es. El GDG de Tarija va a sortear solo con esto, sin nosotros en la sala. Tiene que alcanzar sin preguntarnos nada.

---

# ES

## Hacé el sorteo de tu evento en 5 pasos

Participar es gratis y tu gente no instala nada. Solo vos necesitás una cuenta.

### 1. Antes del evento

Tu cuenta. Entrá a tinkazo.app con Chrome y tocá «Entrar con Google». El sorteo queda a tu nombre: hacelo con tu propia cuenta, no con la de otra persona.

Ensayá. Tocá «Probar con un ejemplo». Es igual al sorteo de verdad, con una lista de mentira, y no se graba nada. Hacelo una vez con el proyector y el sonido.

Publicá las bases. Copiá este texto, completá lo que está entre corchetes y pegalo en Luma o donde avises del evento:

> Sorteo de [premio], [fecha], en [evento]
> 1. Participar es gratis. No hay que comprar nada ni crear ninguna cuenta.
> 2. Entran quienes hayan hecho check-in hasta el momento del sorteo. Sale [cantidad] ganador/es.
> 3. Antes de sortear, la lista se muestra en la sala y se cierra. Desde ahí no cambia.
> 4. Quien gana sale de un número público que nace después de cerrar la lista: nadie lo conoce antes, ni la organización.
> 5. El juego en pantalla solo muestra el resultado. No decide nada.
> 6. Después compartimos un enlace para que cualquiera compruebe el resultado desde su celular. Ese enlace muestra los nombres de la lista.
> 7. El premio lo entrega [organización]. Tinkazo es la herramienta.

Si tu evento cobra entrada, o en tu país un sorteo pide permiso, consultalo antes: la responsabilidad del sorteo es de quien organiza.

Probá el lugar. Compu al proyector, volumen arriba, y mirá que se oiga en toda la sala. Llevá el celular con datos: es tu respaldo si falla el wifi.

### 2. En el evento

Con Luma. Cuando cierres el check-in:
1. En Luma: «Manage», pestaña «Guests», «Download CSV». Luma te manda un código al correo: tené el correo abierto.
2. En Tinkazo: abrí «Premio, cuántos ganan y subir CSV» y tocá «Desde Luma».
3. Dejá marcado «Los que vinieron» y tocá «Usar estos […] nombres». Si alguien vino y no le hicieron check-in, marcalo a mano.

Sin Luma. Copiá los nombres, uno por línea, y tocá «Pegar lista».

Después, cada premio:
1. En «Premio, cuántos ganan y subir CSV», escribí el premio y cuántos ganan. Hacelo ahora: después no se cambia.
2. Tocá «Mostrar la lista a la sala». Cada uno se busca con el QR. Si falta alguien, se arregla ahora.
3. Tocá «Cerrar» y «Sellar la lista». La pantalla se pone en grande sola.
4. Esperá unos 45 segundos. Decí en voz alta: «La lista ya no cambia, y el número que decide todavía no existe». Si querés otro juego, tocá «Cambiar de juego».
5. El sorteo arranca solo y termina con quien ganó y un QR. Dejalo a la vista para que la sala lo escanee.
6. Tocá «Cerrar» y «Siguiente premio» si queda otro. La lista sigue sin quienes ya ganaron.

### 3. Desde el celular

Primero girá el celular y subí el volumen. En iPhone, sacá también el modo silencio. Dejalo enchufado.

- Cable HDMI (el que menos falla). Adaptador de tu celular a HDMI. No depende del wifi.
- Espejar la pantalla. Android: «Transmitir» o «Smart View». iPhone: «Duplicar pantalla». El celular y la pantalla, en el mismo wifi.
- Chromecast. En Chrome: los tres puntos, «Transmitir», y elegí tu pantalla. También en el mismo wifi.

### 4. Si algo falla
Nada de esto cambia a quien gana: una vez sellada la lista, el resultado ya no depende de vos.

| Qué pasa | Qué hacés |
|---|---|
| Google no te deja entrar | Abrí la página en Chrome, no dentro de otra app, o entrá con tu correo. |
| Dudás de la conexión | Antes de sellar, tocá «¿La red está bien?». Si el wifi anda mal, pasate a los datos del celular. |
| Aparece «Probar ahora» en lugar de sellar | Tocalo y esperá un poco. La app también vuelve a probar sola. |
| Se cortó la espera o el sorteo | Tocá «Reintentar el sorteo». Quien gana no cambia. |
| Se cerró o se recargó la página | Volvé a entrar, con la misma cuenta y en el mismo navegador, y tocá «Sortear ahora». |
| Se salió de la pantalla grande | Tocá «Mostrar la espera en grande». Si ya salió el número, tocá «Lanzar el sorteo». |
| No se oye | Volumen de la compu y del proyector. En el celular, sacá el modo silencio. |

Si la red no deja sellar. Primero esperá y probá de nuevo. Si no alcanza, tenés dos salidas honestas:
- Sortear más tarde con la misma lista. Avisalo a la sala. Es lo mejor si el premio importa.
- «Seguir sin sello». El sorteo se hace igual, pero nadie va a poder comprobarlo, y así lo dice el resultado. Decilo en voz alta antes de sortear.

Sin nada de internet, ni wifi ni datos, no se puede sortear: queda la primera salida.

Nunca uses el ejemplo ni el ensayo como sorteo oficial. No se graban y nadie los puede comprobar.

### 5. Después

Avisale a todos. En Tinkazo tocá «Compartir el resultado». Con varios premios, en «Mis sorteos» tocá «Compartir el evento». Copiá el mensaje y, en Luma, pegalo en un aviso desde «Manage», pestaña «Blasts» (Luma deja hasta 7 días después del evento). Agregale esto arriba:

> ¡Gracias por venir! Acá está el resultado. Abrí el enlace para comprobarlo desde tu celular y buscá tu nombre en la lista.

Mandanos tres cosas. Nos ayudan a seguir ofreciendo Tinkazo gratis:
1. El enlace del resultado, con el nombre y la fecha del evento.
2. Una foto de la sala o de la pantalla, con el permiso de quienes salgan.
3. Tres respuestas:
   - ¿Pudiste hacerlo sin ayuda? ¿Dónde te trabaste?
   - ¿Tu gente confió en el resultado? ¿Alguien lo comprobó?
   - ¿Lo volverías a usar en tu próximo evento?

¿Dudas? Escribinos a hola@tinkazo.app.

---

# EN

## Run your event's draw in 5 steps

Entry is free and your people install nothing. Only you need an account.

### 1. Before the event

Your account. Go to tinkazo.app in Chrome and tap "Sign in with Google". The draw goes under your name: use your own account, not someone else's.

Rehearse. Tap "Try it with a sample". It works just like the real draw, with a pretend list, and nothing is recorded. Do it once with the projector and sound on.

Publish the rules. Copy this text, fill in the brackets and paste it on Luma or wherever you announce the event:

> [Prize] draw, [date], at [event]
> 1. Entry is free. Nothing to buy and no account to create.
> 2. Everyone checked in by the time of the draw takes part. [Number] winner(s) will be drawn.
> 3. Before the draw, the list is shown to the room and closed. After that it doesn't change.
> 4. The winner comes from a public number that appears after the list closes: nobody knows it in advance, not even the organizers.
> 5. The game on screen only shows the result. It decides nothing.
> 6. Afterwards we share a link so anyone can check the result from their phone. That link shows the names on the list.
> 7. [Organization] hands over the prize. Tinkazo is the tool.

If your event charges admission, or your country requires a permit for draws, check first: the draw is the organizer's responsibility.

Test the room. Connect your computer to the projector, turn the volume up and make sure the whole room can hear it. Bring your phone with mobile data as a backup in case the wifi fails.

### 2. At the event
With Luma. When check-in closes:
1. On Luma: "Manage", "Guests" tab, "Download CSV". Luma emails you a code, so keep your email open.
2. On Tinkazo: open "Prize, how many win and upload CSV" and tap "From Luma".
3. Leave "Those who came" selected and tap "Use these […] names". If someone came but wasn't checked in, tick them by hand.

Without Luma. Copy the names, one per line, and tap "Paste list".

Then, for each prize:
1. In "Prize, how many win and upload CSV", type the prize and how many win. Do it now: you can't change it later.
2. Tap "Show the list to the room". Everyone finds themselves with the QR. If someone is missing, fix it now.
3. Tap "Close" and "Seal the list". The screen goes big on its own.
4. Wait about 45 seconds. Say out loud: "The list can't change now, and the number that decides doesn't exist yet." For a different game, tap "Change game".
5. The draw starts on its own and ends with the winner and a QR. Leave it up so the room can scan it.
6. Tap "Close" and "Next prize" if there is another. The list carries on without those who already won.

### 3. From a phone

First turn your phone sideways and turn the volume up. On iPhone, also turn silent mode off. Keep it plugged in.

- HDMI cable (the most reliable). An adapter from your phone to HDMI. It doesn't depend on the wifi.
- Screen mirroring. Android: "Cast" or "Smart View". iPhone: "Screen Mirroring". Phone and screen on the same wifi.
- Chromecast. In Chrome: the three dots, "Cast", and pick your screen. Same wifi here too.

### 4. If something goes wrong

None of this changes the winner: once the list is sealed, the result no longer depends on you.

| What happens | What you do |
|---|---|
| Google won't let you in | Open the page in Chrome, not inside another app, or sign in with your email. |
| You're unsure about the connection | Before sealing, tap "Is the network OK?". If the wifi is bad, switch to your phone's mobile data. |
| "Try now" appears instead of the seal button | Tap it and wait a little. The app also retries on its own. |
| The wait or the draw got cut off | Tap "Try the draw again". The winner doesn't change. |
| The page closed or reloaded | Sign in again, with the same account and in the same browser, and tap "Draw now". |
| You left the big screen | Tap "Show the wait on the big screen". If the number is already out, tap "Run the draw". |
| No sound | Check the computer's and projector's volume. On a phone, turn silent mode off. |

If the network won't let you seal. First wait and try again. If that isn't enough, you have two honest ways out:
- Draw later with the same list. Tell the room. This is the best choice if the prize matters.
- "Continue without a seal". The draw still happens, but nobody will be able to check it, and the result says so. Say it out loud before drawing.

With no internet at all, neither wifi nor mobile data, the draw can't run: take the first way out.

Never use the sample or the rehearsal as the official draw. They aren't recorded and nobody can check them.

### 5. Afterwards

Tell everyone. In Tinkazo, tap "Share the result". With several prizes, go to "My draws" and tap "Share the event". Copy the message and, on Luma, paste it into an announcement from "Manage", "Blasts" tab (Luma allows this for up to 7 days after the event). Add this on top:

> Thanks for coming! Here's the result. Open the link to check it from your phone and find your name on the list.

Send us three things. They help us keep Tinkazo free:
1. The link to the result, with the event's name and date.
2. A photo of the room or the screen, with the permission of anyone in it.
3. Three answers:
   - Could you do it without help? Where did you get stuck?
   - Did your people trust the result? Did anyone check it?
   - Would you use it again at your next event?

Questions? Write to us at hola@tinkazo.app.

---

# La tarjeta para las mesas
Una tarjeta chica, para imprimir varias en una hoja A4. Proponé el diseño: puede ser plana o doblada como carpa. Que se lea a un metro, en blanco y negro, y con la marca de Tinkazo.

El QR lleva a la sección "Por qué se puede comprobar" de sorteo-para-meetup.html. Ponele un id a esa sección para que el enlace caiga ahí. El QR va fijo, el mismo para todos los eventos.

## ES

> Este sorteo se puede comprobar
>
> Hoy sorteamos: ______
>
> 1. La lista se cierra antes de sortear. Desde ahí no cambia.
> 2. Quien gana sale de un número público que nadie conoce antes, ni la organización.
> 3. Al final, escaneá el QR de la pantalla y buscá tu nombre.
>
> Participar es gratis.
>
> [QR] Cómo funciona
>
> tinkazo.app

## EN

> This draw can be checked
>
> Today's prize: ______
>
> 1. The list is closed before the draw. After that it doesn't change.
> 2. The winner comes from a public number nobody knows in advance, not even the organizers.
> 3. At the end, scan the QR on the screen and find your name.
>
> Entry is free.
>
> [QR] How it works
>
> tinkazo.app

---

# Notas para vos

- La pregunta a los participantes (tarea 2). Si entra en el comprobante antes del 13-nov, sumá una línea al mensaje para Luma de la sección 5.
- Luma. Los pasos salen de su ayuda: [bajar el CSV](https://help.luma.com/p/download-guest-csv) y [avisos](https://help.luma.com/p/sending-or-scheduling-event-blasts). No los probé en una cuenta, y los nombres de sus botones pueden cambiar con el idioma.
- «Usar estos […] nombres». En la app lleva la cantidad real de nombres.
- Imprimir. La guía se imprime en A4 y el organizador la lleva al evento. Que no se corten ni la tabla de "Si algo falla" ni las bases, y que los enlaces se lean impresos.
- Lo que no probé. Los menús de Android, iPhone y Chromecast cambian según el sistema y la marca. Si podés, probá al menos uno con un celular de verdad.

L2 — Main refreshed by job54: origin/main and clean kit branch both6c583e98ee0864be13297297f7521097cc494b53. No implementation or borrowed sibling commits. User's new full Guido copy supersedes the earlier plan-only/Nicolás-copy wait. Technical external checks and UI-label comparison precede copy changes; no physical phone/projector is available through this coding host, so browser emulation/PDF proof must not be claimed as physical projection.

L3 — Read-only audit mvy412r8-s-g7iu finished; parent retrieved report and spot-checked official Chrome and Luma Blasts sources. User only requested status of worktrees/Arreglos meanwhile; that does not authorize resuming paused Arreglos. No Kit implementation, tests, commits or preview yet. Product decision is now surfaced; T1 blocked, no active Kit worker/job.

Confirmed app labels use real mounted UI. Most supplied phrases match, including dynamic import count, conditional retry/unsealed, spoken announcement distinguished from buttons, history Draw now, event/result sharing. Two exact surface/count differences:
- Homepage signed-out CTA in src/main.ts:323–338 with src/i18n.ts:1054,2700 is “Entrar con Google y sortear” / “Sign in with Google and draw”. Source's shorter phrase exists inside login picker but is not the initial homepage CTA. Proposed guide-only replacement: use the full homepage CTA in both languages, never change the app button.
- src/ui/draw.ts:590 and src/i18n.ts:1019,2669 append the actual remaining count. Proposed guide-only replacement: “Siguiente premio (quedan […])” / “Next prize ([…] left)”, where […] is a numeric placeholder as already specified for import.

External factual checks and proposed guide-only changes, NOT APPLIED:
- https://support.google.com/chromecast/answer/3228332?hl=en-GB explicitly says “On your computer, open Chrome”, then “Cast, save and share” → “Cast…”, not a phone Chrome route. Proposed ES: “Chromecast desde una computadora. En Chrome: los tres puntos, «Transmitir, guardar y compartir», «Transmitir…», y elegí tu pantalla. También en el mismo wifi.” Proposed EN: “Chromecast from a computer. In Chrome: the three dots, \"Cast, save and share\", \"Cast…\", and pick your screen. Same wifi here too.” Keep Android/iPhone alternatives; disclose receiver compatibility and no physical projection proof. Phone section's original three-dots Chrome instruction must not be asserted reliable as written.
- https://help.luma.com/p/sending-or-scheduling-event-blasts supports 7days and Manage Event > Blasts, but web inline composer is limited to140characters; Advanced permits longer messages. Add proposed ES: “En la web, tocá «Advanced» para pegar el mensaje completo.” EN: “On the web, click \"Advanced\" to paste the full message.” No change to7days claim or thank-you quotation.

Other official evidence: Luma CSV supports Manage/Guests/Download CSV/email confirmation code. Android official source describes Google Home/compatible receiver, not a universal Smart View guarantee. Apple AirPlay requires compatible AppleTV/TV/Mac on same WiFi. Exact Apple iPhone cable page and auxiliary iPhone USB-C official page returned429, so HDMI hardware compatibility and “the most reliable” comparative claim were NOT fully verified; do not substitute iPad documentation or claim hardware tested. DENSO supports4modulequietzone; MDN supports @media print/@page mechanisms but is not A4 acceptance proof. Canonical https://tinkazo.app/sorteo-para-meetup.html fetched successfully with both preserved sections; no production fragment exists yet. No proof_trust/proof-trust UI in6c583e9 main baseline, so conditional Luma extra sentence not triggered now; recheck refreshed main before closure and never invent that missing optional source sentence. Parent web stored spotcheck response mvy4esz2tre8a1 contains exact Chrome/Luma passages.

Decision requested: authorize only these four concrete ES/EN editorial corrections/addition, retaining all other Guido phrases and unchanged app buttons. Pending actual human reply. No source change or resumed Arreglos work inferred from silence.

L4 — User approval (verbatim):
“Sí, apruebo las cuatro correcciones del Kit en español e inglés: los dos textos reales de botones, Chromecast desde computadora y «Advanced» en Luma. El resto del texto de Guido queda intacto y no se cambian botones de la app.”
User also explicitly resumed Arreglos and supplied its second prompt; independent outcomes now run in separate worktrees with one bounded writer each (parallel units, >100lines/several files each). No branch mixing. Parent owns long/browser gates, commits and PRs. Kit uses flat bilingual cards, two per A4: both languages together, black/white, generous QR and font size; guide prints selected language. Layout choice is within the explicit grant, not a new product requirement. Source edits not yet made when recording this approval.

L5 — Kit worker mvy5adm1-t-ses6 returned partial source-ready T2/T3, not functional acceptance. Parent source/entry/CSS/audit readback; all12intendedpaths staged to normalize assessment. Native ASSESS medium, reviewDuefalse/under_budget, no independent verifier required. Parent job58 exit0 (queue0.000048s,execution85.37s): pnpmtypecheck0; pnpmtest155files,3148passed/4skipped(testnet opt-in, notpasses),duration76.60s; pnpmbuild0; glossary0 (14files clean,2advisory avisar decisions). Existing Vite native__dirname and ineffective_dynamic_import warnings preserved. Evidence .evidence/kit-parent/gates-8xi6qD/source-identity.txt + per-check stdout/stderr/exit. Child pnpmtypecheck materialized111locked localignoredpackages/download0; parent verified package.json and pnpm-lock.yaml unchanged. Sourceguide136units and153focusedtests passed; differential3344oldentriesunchanged+20additions/metadataidentical. Real browser/PDF/QR/cards fit and final main/preview still pending; no commit/PR yet. Parent nativePDF toolchain jobs56/57 verified only smallprototype, not Kit. Parent prepares productionbuild-owned5188browser/PDFcheck under shared e2e lock.

L6 — Parent digital acceptance: job60 WebKit70/0+Firefox70/0(2metadatarecordseach),390/1280ESEN; mode selection and afterprint reset. NativeFirefox/BiDi produced guideES/EN4A4pages each, cards2completebilingualcopieson1A4. Parent visually inspectedall8guidepages+cards; allsourceunits preserved, templatewholepage1/tablewholepage2, nooffpapertext. Originaljob60exit1retained: ENfalsemissingcausedbyPDF.jsfi/lltext-runjoin, QRdownscaling. Job61exit0 rereadIDENTICALPDFs, geometricaltextjoining andnative144dpiQRquadrants: ENzero missing,tablewholepage2,bothprintedQRscanexactcanonicalURL. Noappcode/textchange. PDFguideENsha0e4f7d2ae15cdd056daa6498cf8100090d2b8816f2969ed5f2dd50526f8dfa65; cards4ba71c5c9e4396977136b116c4a32b69a8d4c4102b868b8bb8ea8aaa9a4a1739. Proof docs/capturas/kit-organizador/ withidentity.json. Initial4JSrequests16719B/gzip7367;entry408B/gzip276;74injectedkeys/language, notwhole3344legacyentries. Job62fetchmain0→6c583e98ee0864be13297297f7521097cc494b53; Confianzaabsent, noextraLumasentenceinvented/copied. No physicalphone/projector/printer/one-metretrial or OSnativeprintCanceltested; nativePDFcompletionafterprint and dispatchedcancel-boundaryeventtested. S5physicalreadability and S7authenticpreview remain declaredlimits, notclaimedverified. Four reviewable commits planned: source record338lines; local print/resources240; page/tests377; audit/docs/evidence under400. No source from siblings, deployment or merge.

L7 — Commits de unidad: fuente 66a2d793b2a5bf3cde75f9b2e8c97a0d72fd6e33; recursos locales 2910571e08c4caf02abf5c29f7346388ea1e4653; comportamiento/pruebas fec3c682d39f37bbfe9156f7c77c166215df6de2. Autor y committer exactos exigidos. Código de aplicación idéntico al build/gates/browser/PDF comprobados. Auditor, evidencia y documentación viajan en la siguiente unidad; CI y preview remotos todavía pendientes. Sin merge ni despliegue.

L8 — Job65 exit1 tras crear exactamente tres commits válidos: A66a2d793b2a5bf3cde75f9b2e8c97a0d72fd6e33(340líneas), B2910571e08c4caf02abf5c29f7346388ea1e4653(240), Cfec3c682d39f37bbfe9156f7c77c166215df6de2(377). Cuarta unidad detenida por .gitignore:30 docs/capturas/*, política expresa de no versionar salidas regenerables de auditor. No es fallo de aplicación ni RDD. Se conserva la política: no gitadd-f, no migración de los mismos archivos para eludirla; capturas/PDF/identity locales y resultados/huellas en documentación textual. Se continúa únicamente la cuarta unidad documental, sin repetir los tres commits ni cambiar código ya verificado. PR incluirá resultados concretos y limitaciones, no enlaces rotos a archivos ignorados.


L9 — Entrega remota observada: PR https://github.com/nema1502/tinkazo/pull/5 abierto en borrador, sin merge ni producción; cuatro commits iniciales con autor exacto hasta9b1a3ab. CI41343215427SUCCESS para ese código. Deployment7478088101SUCCESS, pero WebKit real1280x900 redirige a «Login – Vercel» (HTTP200); job74exit2, sin errorJS, NO revisión de aplicación. Celular no se ejecutó tras detectar el bloqueo. Evidencia local .evidence/kit-parent/preview-zeKvaD/results.json. Etiqueta única type:feature aplicada (job75exit0); no hay issue aprobado vinculado y no se inventa aprobación ni referencia de cierre. Se solicita al equipo el issue aprobado para referencia Refs no cerrante y acceso autorizado a las previews. Esta recepción cambia solo documentación; material literal L1 y entradas de aplicación/config/lock/build se conservan. El CI del último HEAD se consulta en https://github.com/nema1502/tinkazo/pull/5/checks para no confundir el CI del código9b1a3ab con un recibo documental posterior. T4 sigue abierto por aceptación externa; no se declaran pruebas físicas ni preview aprobada.
