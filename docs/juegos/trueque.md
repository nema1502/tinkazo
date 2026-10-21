# El Trueque

Una feria de puestos. Cada persona tiene el suyo: acepta un producto y da otro a cambio. Un encargo (un atado de aguayo, un q'epi) sale de un origen con un producto y va de puesto en puesto hasta llegar a quien lo espera. Cada puesto cambia una sola vez, y el camino no pasa de seis cambios. Gana quien recibe el encargo, y la ruta del final muestra el nombre de cada uno que lo hizo posible.

**Identificador:** `trueque` · **Probalo:** `?demo=trueque` · **Agregado:** 20 de octubre de 2026; entró al selector el 21 de octubre, en el lugar del Aguayo y la Constelación.

## Por qué existe

Es la fusión de Aguayo y Constelación Stellar (auditoría de los juegos, sección 7.6). El aguayo tenía la mejor idea cultural del catálogo, pero sus hilos de "confianza" se deshacían en vez de sostener. La constelación tenía la idea más Stellar, un pago que busca camino, pero dibujada con estrellas anónimas y veinte saltos, y un pago de Stellar tiene como máximo cinco activos intermedios. El Trueque se queda con las dos ideas, contadas bien.

Entró al selector el 21 de octubre de 2026, y los dos que reemplaza salieron de él: siguen abriendo con `?demo=pasanaku` y `?demo=stellar`. Con la lista sellada, el selector lo recomienda de 12 a 200 personas, y lo pone entre los ideales de 20 a 120 (auditoría, sección 6).

## Cómo se juega

1. **La feria** (5 segundos de juego). Los puestos aparecen de a uno en una cuadrícula, con el color de lo que acepta arriba y el cuadrito de lo que da abajo. La leyenda de arriba dice qué color es cada producto. Se pasa lista: cada nombre aparece encima de su puesto.
2. **El encargo.** Sale del origen con un producto (papa, chuño, quinua, maíz, arroz, yuca, plátano o café).
3. **Cada pase.** "¿Quién acepta…?": se prenden todos los puestos que aceptan lo que lleva el encargo. El encargo se acerca a uno de ellos. Si ese puesto lo cambia, el atado cambia de contenido ("¡Cambio! Ahora es…") y el puesto se apaga. Si no hay camino desde ahí, es un **callejón sin salida** y el encargo vuelve.
4. **La entrega.** Quedan dos puestos que aceptan lo que lleva el atado: el de quien espera y, a veces, otro. El atado se acerca primero al otro ("No, es para el otro"), y después llega a quien espera. El cartel del ganador se abre.
5. **La ruta.** Se prende el camino de cambios en dorado, con los nombres de todos los que cambiaron, y la frase "Nadie llega solo: pasó por… y llegó a…".

Con varios premios, cada premio es un encargo. Salen juntos, cada uno con su camino, y cada uno llega a quien espera. Ningún puesto cambia dos veces, y quien espera nunca cambia.

## Lo que la sala no ve, pero es verdad

**Quién cambia lo decide el plan, no la escena.** `src/games/pixi/trueque-plan.ts` arma la feria con el azar sembrado de la ronda: quién cambia, qué producto entra y sale, y en qué pase. La escena lee el plan y lo dibuja. La misma ronda arma la misma feria.

**Los callejones son reales.** Un puesto solo se muestra como callejón si, desde lo que da, no se llega a quien espera dentro del límite de seis cambios, usando solo los puestos que todavía no cambiaron. Si el juego dice "callejón", no hay camino. Lo comprueban las pruebas de `trueque-plan.test.ts`.

**Quien espera no se delata antes.** Su puesto no se prende hasta la entrega. Si se prendiera antes, la sala aprendería el final.

**El camino no pasa de seis cambios.** Es el límite de Stellar (cinco activos intermedios): `MAX_CAMBIOS = 6` en el plan. Con 2 personas hay un cambio; con 12 o más, cuatro; con 60 o más, cinco.

## Cuántos

| Personas | Cambios por encargo | Qué se ve |
|---|---|---|
| 2 | 1 | El mano a mano: uno cambia y llega |
| 8 | 3 | Una feria chica: tres cambios y la entrega |
| 12 a 59 | 4 | La ruta se ve completa en la pantalla |
| 60 a 200 | 5 | Muchos toldos encendidos; a veces, la ruta cruza la feria entera |

Los nombres se leen antes del ganador en las tres cantidades que pide el auditor de identificación (8, 18 y 50). Con más de 64, el pasar lista no entra y no se promete que se lean.

El tiempo del juego: la escena se estira hasta llenar la duración del selector, como a los demás juegos (`setGameLength`). Normal son 38 segundos en total, con el cartel de tres segundos reales al final; medido con 18 personas, 38,5 segundos (auditor exigente). El ganador aparece a unos 32 segundos, con 8, 18 o 50 personas (auditor de identificación): la cantidad cambia cuántos cambios hay, no cuánto dura.

## La escena

Vive en [`src/games/pixi/trueque.ts`](../../src/games/pixi/trueque.ts) y usa el andamiaje del motor nuevo. No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

- **Colores.** Ocho colores propios, uno por producto, fuera de la paleta de la casa, porque la feria necesita ocho. El contraste de cada uno contra el fondo se revisa a ojo en las capturas de los dos temas; no está medido con la tabla de [marca.md](../marca.md).
- **Cámara.** La feria entera al armarse. En cada intento sigue al encargo con un acercamiento de 1,25 veces. En la entrega se acerca a quien espera (1,45 veces). Al final encuadra todas las rutas, con el cartel por encima.
- **Sin desenfoque** (`cam.noBlur()`), para que los nombres se lean nítidos en los acercamientos.
- **Nombres**: `S.tags`, el mismo acomodo de los demás juegos, para que no se pisen.
- **Sonido**: solo notas de `note()` (la escala de los juegos), con tics al nacer los puestos, un barrido cuando el encargo viaja, un sonido al cambiar, otro al rechazar y la fanfarria de la entrega. Un fondo sostenido en 196 y 262 Hz, en notas encadenadas (si se salta, las que no llegaron a sonar no suenan). Los efectos de la feria suben unos 6 dB sobre los de otros juegos (`EMPUJE` en `trueque.ts`): con la música andina de fondo, el parlante de un proyector perdía 3,6 LU en 150 Hz (el límite del auditor de mezcla es 3,5); con el empuje, 3,0 a 3,2.
- **Movimiento de la feria.** Mientras no pasa nada en los puestos, la escena se sigue moviendo: una franja de aguayo con los colores de los productos corre despacio por arriba de la feria, las rayas de cada toldo corren de lado a lado, una nube cruza el fondo (sombra de día, luz de noche) y el atado respira en su origen. Hace falta por el auditor exigente: su huella toma una muestra de 32 por 18 cada seis cuadros, en puntos fijos cada cuarenta píxeles, y cuantiza a 16 niveles. Un movimiento que no cruza esos puntos (una franja entre dos filas muestreadas, un velo tenue) no existe para la huella, aunque en la pantalla se vea. Por eso la franja queda entre los 170 y los 192 píxeles de un lienzo de 720, cubriendo la fila muestreada de los 180.

## Stellar adentro, sin una palabra técnica en la sala

En el juego no aparece ninguna palabra técnica. Lo que cada cosa es, por dentro:

- **Trustline:** cada puesto acepta un solo producto. Solo recibe lo que aceptó. Aceptar un activo en Stellar es un acto explícito que cuesta medio XLM de reserva (lo dice [docs/juegos/pasanaku.md](pasanaku.md)).
- **Path payment:** el encargo sale como una cosa y llega como otra, cambiando por el camino, con como máximo cinco activos intermedios.
- **Liquidez:** un callejón sin salida es falta de liquidez: no hay quien cambie lo que lleva.
- **Red:** puestos que parecían lejos están a tres cambios.

En la página de juegos, para quien quiera, la tarjeta del juego lo dice: "Así viaja un pago en Stellar".

## La cultura adentro

La tarjeta de historia sale de la nota de Opinión del 21 de noviembre de 2021, "Pongo K'asa y Confital: el trueque mantiene vigencia en la región Andina":

- las ferias de Pongo K'asa (los sábados, kilómetro 94) y Confital (los martes, kilómetro 121) en la carretera Cochabamba–Oruro;
- el chhalaku, que la nota llama "práctica ancestral" y identifica con el trueque;
- papa y chuño entre los productos.

Lo que la nota **no dice**, y por eso la tarjeta no lo afirma: que se trueque maíz y oca (la auditoría los nombraba, pero la nota no los menciona), que el trueque se organice por pisos ecológicos, y que medie la reciprocidad. La nota dice que en la parte artesanal de la feria hay venta, así que tampoco afirmamos que nunca medie dinero.

Los productos del juego son los de la feria boliviana en general: el altiplano (papa, chuño, quinua), los valles (maíz), los llanos (arroz, yuca) y los yungas (plátano, café). Esa agrupación es nuestra, no de la fuente.

## Lo que no va

- **La huella tejida del aguayo de la lista** (auditoría, sección 8.5): el dibujo de la huella de la lista como un aguayo único. No se hizo en este juego. Es una pieza aparte, de la página de la lista.
- **El golpe del ganador** (auditor de mezcla): la última corrida pasó (+5,2 LU), pero el medidor no es estable en la máquina de la prueba: con builds parecidos, el mismo juego dio entre -59 y +6 LU, y dos juegos de control dieron valores imposibles (chovena 96 LU, sapo -57 LU). Hasta que el auditor ubique el cartel en el audio de forma confiable, ese número no prueba nada.
- **El nombre del encargo en celular:** cuando un nombre queda justo encima del atado, tapa la etiqueta del producto (se ve en la captura de 390 px, tema claro). El atado en su origen también queda recortado en el borde izquierdo del celular.

## Cómo auditarlo

```bash
node scripts/audit-game.mjs trueque
node scripts/audit-identidad.mjs trueque
node scripts/audit-emocion.mjs trueque
node scripts/audit-rigor.mjs trueque
node scripts/audit-sound.mjs trueque
node scripts/audit-mezcla.mjs trueque
```

`audit-game` comprueba el selector (7) y el nombre en el selector (14): mientras el juego estuvo fuera del selector, esas dos fallaban a propósito y daba 18 de 20. Desde que entró (21 de octubre de 2026), 20 de 20.

Las pruebas del plan: `pnpm test` (`src/games/pixi/trueque-plan.test.ts`).
