# UX de Tinkazo

Cómo se piensa y cómo se comprueba que quien usa Tinkazo sepa, en cada momento, qué sigue. Es una regla de producto y tiene su auditor: lo que acá se dice se mide con `scripts/audit-flujo.mjs`.

## Por qué existe

Una prueba con alguien que usaba la herramienta por primera vez (19 de octubre de 2026) dijo que la interfaz se veía muy bien, y que la experiencia no: "me cuesta encontrar el botón del siguiente [...] no sé cuál es el siguiente". Se midió y tenía razón. Con la lista sellada, el botón de sortear quedaba debajo de los doce juegos, a una pantalla y media de la caja de la espera; y después del ganador, "otro premio" quedaba debajo de la verificación, el QR y la historia, a más de una pantalla. Hasta ese día solo se probaba en 1440x900 y 390x844, y en una laptop común (1362x632 al 100 %) el botón de sellar ni siquiera se veía.

## Los principios

1. **En cada paso hay una sola acción principal.** Los pasos son cuatro: 1 Lista, 2 Sellar, 3 Sortear, 4 Compartir. La acción principal es el botón con el color de la casa (magenta); todo lo demás es secundario y no lleva ese color. Si después del ganador queda con quién sortear, la principal es "Siguiente premio" (con cuántas personas quedan); si no, "Compartir el comprobante". "Siguiente premio" vuelve al paso 2 con la lista sin los que ya ganaron.
2. **Se ve sin hacer scroll.** La acción principal tiene que estar a la vista, con la pantalla donde la deja la propia página, en estas cinco pantallas y a 200 % de zoom:

   | Etiqueta | Ancho x alto | Qué es |
   |---|---|---|
   | laptop-100 | 1362x632 | laptop a 100 % de zoom |
   | escritorio | 1280x720 | escritorio |
   | tablet-h | 1024x560 | tablet acostada o laptop chica |
   | celular-h | 844x390 | celular acostado |
   | celular | 390x844 | celular parado |
   | zoom-200 | 681x316 | la laptop de arriba a 200 % de zoom |

   Se logra ordenando la página: arriba lo que se espera y el botón que sigue, y recién después lo opcional (el selector de juegos, los ajustes, las bases, los datos del sello). Los doce juegos no se esconden: quedan debajo del botón, con el juego elegido siempre a la vista junto a él y un "Cambiar de juego" que lleva al selector.
3. **Si no entra, la barra de "lo que sigue".** Es la red de seguridad: una barra fija abajo, con un único botón principal y la línea del paso ("Paso 3 de 4 · Esperando la ronda · 0:25"). Aparece solo cuando el botón de verdad no se ve entero, así que nunca hay dos botones iguales a la vista; su botón hace `.click()` sobre el de verdad, así que la lógica no se repite; no tapa el pie de la página (la herramienta deja aire abajo, esté o no la barra) ni el botón de verdad; y se va con el estadio, con la espera en grande y con cualquier ventana abierta. Vive en `src/ui/siguiente.ts`.
4. **Un botón apagado dice por qué.** Mientras corre la cuenta, el botón de sortear dice cuánto falta ("Se habilita en 0:25") y se ve apagado pero presente. Al llegar a cero se enciende con un pulso suave, y con `prefers-reduced-motion` el pulso se apaga y queda el aro quieto.
5. **Siempre se sabe dónde se está.** Arriba de la herramienta hay un indicador de pasos, discreto: el actual resaltado y los hechos con ✓. En el celular entra en una sola línea. Los cambios de paso se anuncian con calma a los lectores de pantalla (región `role="status"`, `aria-live="polite"`), solo cuando cambia de qué se trata el paso y nunca con cada segundo de la cuenta.
6. **Ninguna ventana se corta.** Una ventana entra entera en la pantalla o se recorre por dentro; nada queda fuera de alcance, tampoco a 200 % de zoom. Lo revisa `scripts/audit-ui.mjs`.
7. **Nada de tecnicismos en lo que ve quien sortea.** Nada de drand, bytes, firmas, hashes ni "XLM": lo técnico va plegado o en las páginas de seguridad y de verificar (ver [marca.md](marca.md)).

## Cómo está armado

- `index.html`: el orden de la lista sellada (`#sec-frozen`) es la espera compacta, el botón (`#btn-draw`) con el juego elegido, el selector, los ajustes, las bases y los datos del sello. El bloque de lo que sigue después del ganador (`#again-row`, con `#btn-again-sin`, `#btn-proof` y `#btn-again-nueva`) va justo debajo de las tarjetas del ganador, antes de "Mostrar en grande" y de la verificación.
- `src/ui/siguiente.ts`: calcula el paso (`app.frozen`, `app.drawn`, cuántos nombres hay), pinta el indicador y la barra, y vigila el botón de verdad con un `IntersectionObserver`. `freeze.ts` y `draw.ts` le avisan cuando algo cambia (`actualizarPaso`); la cuenta regresiva se la pasa `main.ts`. La regla de qué paso toca (y de qué se trata) vive aparte, sin DOM, en `src/ui/pasos.ts`, con sus pruebas; y `src/ui/index-textos.test.ts` cuida que `index.html` conserve sus ids y que cada `data-i` exista en los dos idiomas.
- La barra no descuenta su propio lugar al mirar el botón: si el botón entra entero en la pantalla se ve, esté donde esté, y la barra se esconde. Así nunca queda el botón de verdad a medio tapar detrás de ella. Arriba sí descuenta la cabecera fija (en pantallas de más de 1100 px).
- Con `?demo=` no hay barra ni indicador: la demo se hace sola. Con la puerta cerrada (sin cuenta conectada) tampoco: la puerta ya dice qué falta.
- `env(safe-area-inset-bottom)`: la barra lo usa (`max(10px, env(...))`) para un celular con barra de gestos. Ojo: esos valores solo son distintos de cero con `viewport-fit=cover`, y el sitio no lo usa a propósito (obligaría a rellenar los costados en todas las páginas, por los notch). Hoy vale cero y la barra queda sobre la del navegador.
- **No se rompen ids.** Los auditores y el sitio usan `#btn-draw`, `#btn-freeze`, `#btn-again-sin`, `#g-*`, `#st-skip`, `#winner-box`, `#sec-frozen`, `#sec-draw` y otros. Buscalos antes de renombrar: `grep -rn "getElementById\|\$(\"" scripts/*.mjs`.

## La lista de comprobación

Es lo que mira `audit-flujo.mjs` en cada paso (lista cargada, sellada y esperando, ronda lista, resultado, siguiente premio) y en cada pantalla:

- [ ] Hay una acción principal a la vista, sin scroll: el botón de verdad o el de la barra, nunca los dos ni ninguno.
- [ ] Nunca hay dos botones principales a la vista.
- [ ] La barra no tapa el botón de verdad, ni lo importante del paso (la espera, el primer ganador), ni el pie de la página. Una barra fija siempre tapa algo de lo que está más abajo hasta que se baja; por eso la herramienta deja aire abajo y se mira el pie.
- [ ] Lo que está a la vista se puede tocar: nada encima, en el punto del clic.
- [ ] No hay scroll horizontal.
- [ ] En el celular, los blancos de toque miden 44 px o más.
- [ ] El indicador de pasos marca el paso en que se está y los anteriores con ✓.
- [ ] El texto se lee: contraste de 4,5 a 1 (3 a 1 el texto grande), en los dos temas.
- [ ] Mientras corre la cuenta, el botón dice cuánto falta; al llegar a cero se enciende, con pulso y sin él si se pide menos movimiento.
- [ ] Con el botón fuera de la pantalla, la barra lo ofrece encendido y su clic sortea.
- [ ] La barra se va con el estadio, con la espera en grande y con una ventana abierta, y vuelve al cerrarlas.
- [ ] Después del ganador, lo que sigue va pegado al ganador, antes de "Mostrar en grande" y de la verificación. La acción principal es "Siguiente premio" si queda con quién sortear, o "Compartir el comprobante" si no; lo demás es secundario.
- [ ] Una captura de cada paso, para mirarla con los ojos.

## El auditor

```bash
pnpm build && pnpm preview &        # sirve dist/ en :4173
CDP_PORT=9684 node scripts/audit-flujo.mjs --base http://localhost:4173
```

Recorre el flujo de verdad con la cuenta de prueba de testnet (la única que no necesita a nadie y se carga sola con fondos), una vez por pantalla y por tema, y deja una captura por paso en `--out` (por defecto `docs/capturas/flujo`, que no se versiona). Cada recorrido arranca un Chrome nuevo: es alguien que llega por primera vez, con la bienvenida a la vista.

| Opción | Qué hace |
|---|---|
| `--base` | El sitio a mirar (por defecto `http://localhost:4173`). |
| `--out` | Dónde dejar las capturas. |
| `--vistas` | Cuáles de las pantallas, separadas por coma (`laptop-100,escritorio,tablet-h,celular-h,celular,zoom-200`). |
| `--temas` | `dark`, `light` o los dos (`dark,light`). Por defecto solo `dark`: la geometría es la misma y el flujo es largo. |
| `--sin-resto` | En qué pantallas mirar también el caso en que no queda nadie sin premio, donde la principal es "Compartir el comprobante" (por defecto `laptop-100,celular-h`; `none` para saltearlo). |
| `--lang` | `es` o `en`. |
| `--sello-max` | Segundos que espera al sellado en testnet (por defecto 240). |
| `--reintentos` | Cuántas veces repite una pantalla si el sellado falla o tarda (por defecto 2, con un respiro de 15 s entre una y otra; lo medido en un intento descartado no cuenta). |

Cada recorrido dura unos dos o tres minutos, casi todo esperando la ronda; las seis pantallas en un tema, un cuarto de hora. Como todos los auditores: `CDP_PORT=<puerto>` para tener su propio Chrome (nunca cierres uno que no abriste), la salida marca con ✓ y ✗, y sale con código 1 si algo falla.

Un ✗ en "una acción principal a la vista" dice dónde quedó el botón de verdad y si hay barra: es el síntoma que originó todo esto, y es el primero que hay que mirar.

## Qué se midió el 19 de octubre de 2026

Posición del botón de la acción principal en cada paso, contada en alto de pantalla. Antes de esta tarea y después, con la cuenta de prueba en testnet y la pantalla donde deja la página al usuario (`scripts/audit-flujo.mjs`).

(Se completa con la medida final.)
