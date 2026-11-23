# Las capturas del proyector y del celular de campaña (residual T3 de #179)

Qué es cada imagen de esta carpeta, generadas con `scripts/captura-campana.mjs` el 23 de noviembre de 2026 (el día puede variar en la lista y en el QR: los horarios de la campaña de prueba salen del reloj de la corrida).

## El proyector del stand de campaña

La pantalla completa del stand (#173) contra una campaña de verdad del Worker de salas montado en Node (el guion de captura lo detalla): el logo de la empresa, el premio, la hora de cierre, cuántas personas van, el QR con el pase, la lista descifrada y el bloque «Para revisar». Seis personas en la lista y dos en «Para revisar» (un nombre repetido y uno que mira el filtro), tal como las anotó un celular.

| Archivo | Qué es |
|---|---|
| `proyector-1366x768-dark.png` | El proyector a 1366x768 (una laptop) en el tema oscuro. |
| `proyector-1366x768-light.png` | El proyector a 1366x768 en el tema claro. |
| `proyector-1920x1080-dark.png` | El proyector a 1920x1080 en el tema oscuro. |
| `proyector-1920x1080-light.png` | El proyector a 1920x1080 en el tema claro. |

Las cuatro capturan la misma pantalla: el estilo del proyector (`src/ui/stand-campana.css`) tiene el fondo claro fijo por diseño (se ve a la luz del recinto), así que el tema forzado no le cambia nada. El dark y el light de un mismo tamaño son la misma imagen: quedan las cuatro porque la tarea las pide, y si el estilo deja de ser de fondo fijo la próxima corrida se nota acá.

## El celular de una campaña

Los estados documentados de `participar.html?demo=campana&estado=…` (las dependencias locales de `src/campana/demostracion.ts`: la campaña de ejemplo, sin red, sin Google y sin recuerdos), a 360x844 con la densidad de píxeles de un celular (factor 2). La etiqueta «Demo» de la cabecera está escondida en la captura: la pone la página al reconocer `?demo=campana` y no es parte del estado.

| Archivo | Qué es |
|---|---|
| `celular-entrada-dark.png` / `-light.png` | La entrada: lo que pide la empresa (seguir en cada red), con el nombre recordado de este navegador («Hola, Ana P.») y «Acepto y me anoto». |
| `celular-adentro-dark.png` / `-light.png` | Ya está adentro: el visto bueno, cuántas personas van y a qué hora cierra y se sortea. |
| `celular-lista-dark.png` / `-light.png` | La sala ya está lista pero la inscripción todavía no abre: lo que ve el celular que escaneó antes de la abertura. |
| `celular-cerrada-dark.png` / `-light.png` | La inscripción cerró: lo que ve el celular que llega tarde. |
| `celular-ganaste-dark.png` / `-light.png` | Ganó: el festejo con papel picado, el premio y «Recibir mi premio». |

El ganador de la demostración conserva el nombre recordado («Ana P.»): la confirmación de ganadora muestra su nombre y el camino para recibir el premio.
