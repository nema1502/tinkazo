# Juegos interactivos (Kahoot-like)

## Specs

- S1 (verbatim): «Crear otra en Tinkazo de "Juegos Interactivos" donde podamos vivir en nuestro dispositivos si ganamos» — una sección/modo de Tinkazo donde la gente vive el sorteo desde su dispositivo.
- S2 (verbatim): «esto funcuonaria que leyendo un Qr los redirija a la view del juego y salgan los participnates y puedan poner sus nombres, tipo Kahoo salga en la pantalla y la blockchain ahi recien se haria» — leyendo un QR se entra a la vista del juego; ahí salen los participantes y cada uno pone su nombre (tipo Kahoot); luego se hace el sorteo en la blockchain recién ahí.
- S3: el flujo: el organizador abre la sala → QR para unirse → los celulares entran, ven participantes en vivo, ponen sus nombres → se sella la lista con esos nombres → sorteo con drand → cada celular ve si ganó.
- S4: reutiliza el modo sala que ya existe (`workers/sala`, WebSocket pantalla↔celulares, hoy solo recibe nombres para el modo stand) extendiéndolo al flujo completo.
- S5: privacidad: los nombres viajan por el canal cifrado como hoy; el comprobante sale igual (nombres nunca publicados); cadena es+en en todo.

## Tasks

- T1 (S4): extender `workers/sala` para el flujo interactivo: lista de participantes en vivo → cierre de lista → semilla compartida para el espectador (hoy faroDeStand no comparte semilla: agregar que el stand emita la ronda/frozen).
- T2 (S2,S3): vista del participante: unirse por QR, poner su nombre, ver participantes, ver el resultado personal («te tocó» / «no ganó») tras el sorteo.
- T3 (S1,S2): sección «Juegos interactivos» en la web (entrada desde el selector/portada) con el flujo organizador: abrir sala → QR → en vivo.
- T4 (S5): i18n es/en + pruebas del flujo (sala, participante, cierre de lista).

## Log

- L1 (2026-11-15): pedido verbatim de Guido (las dos citas de S1 y S2). Depende conceptualmente del modo espectador (PR #67) y del modo sala existente. Arranca después del juego amigo-secreto para no pisar i18n/catalogo.
