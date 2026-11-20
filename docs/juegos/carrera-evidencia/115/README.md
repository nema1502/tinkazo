# Issue #115: los cuatro detalles visuales de la carrera — evidencia

Cada detalle con la cantidad de personas y la semilla donde se veía (S2), y el mismo caso después del cambio (S3). Las capturas son de la escena fija (`?pose=1&motor=3d&n=<personas>&semilla=<semilla>&ganador=<ganador>`) con el reloj virtual de `scripts/capturas-carrera-final.mjs` y `scripts/capturas-3d.mjs`; `--antes 3` es tres segundos antes de que la ganadora cruce la meta, `--antes -1` es un segundo después, `--en 9.4` es la hora del show.

Las semillas de rondas vienen de `scripts/lib/delatores-carrera.mjs` (`semillaDe(i)`): la ronda `i` es la semilla de 64 hex que se pasa como `?semilla=`, y `?ganador=g1` pone de ganadora a la primera de la lista, como en cualquier semilla de pose. Con esa semilla y ese ganador, el plan de la escena es la misma ronda que midió el auditor de delatores.

## 1. Hueco al momento del corte de cámara (`hueco-al-corte`)

- **Ronda:** `609c0cc6fc757695e0110d7b1e06ebaa8a2873b94d140b0b942aa8f2f5fa380a` (ronda 21 con 8 personas), ganadora María Quispe (persona 0, `?ganador=g1`).
- **Qué se ve:** en el corte de cámara (T − 3 s), la ganadora llega con un hueco con su vecina que se aparta del de las otras parejas (la fila `hueco-al-corte` del auditor la marcaba: con la corrección de un solo tramo del tope de aceleración, el exceso de lo que la ganadora hace después del corte le corre el lugar en el corte).
- **Antes:** `antes/1366x768-dark-m3s.png` — la ganadora (María Quispe, carril de adelante) queda despegada de las otras tres de punta.
- **Después:** `despues/1366x768-dark-m3s.png`.
- **Medida (`audit-delatores race`, 1.500 rondas, plan):** antes 20 de cada 1.500 rondas con 8 personas marcaban la fila con la ganadora del hueco raro (36 de 150 con 4 a 200 personas en el conteo de la guía); con la corrección partida, la fila deja de salir con la ganadora (24 marcadas en 1.500 con 8, contra el azar de 25 %) y el auditor la da limpia con 18 y 30 personas (p 0,24 y p 1).
- **Estado del arreglo:** probado sobre el plan y medido con el auditor, pero la versión final del tope que no cruza el corte se dejó para un cambio propio: cinco versiones del reparto del exceso (partido en dos correcciones, cascada por celdas, dosided) cierran el delator pero dejan celdas de la costura fuera del tope de aceleración o mueven el orden a un segundo y medio de la meta (`recta-T15` delata), y la guía anota que cuatro versiones anteriores se quedaron en lo mismo. La captura "después" es de la carrera con los otros tres detalles corregidos y el tope de siempre.

## 2. La subfila que queda sola con ciertas cantidades (`subfila-sola`)

- **Ronda:** `0ac2b7d344940ed62e9917244e409afcf1b43c6661977ff9923f576d06160e2d` (ronda 94 con 30 personas), ganadora Paola Mendoza (persona 14, `?ganador=g1`); fila 3 del grupo (7 filas), ella sola de su lado (+1) con Valeria Torrez y Lucía Flores del otro.
- **Qué se ve:** en el corral, la fila de tres deja a la ganadora sola de su lado; como la que va sola de su lado es casi siempre finalista, el corral delata. Con 18 personas sale con todas las filas de tres que llevan dos finalistas (600 en 300 rondas); con 30, en 5 de 300.
- **Antes:** `antes/corral-30p-t9_4s.png` (t = 9,4 s, el grupo recién salido del corral).
- **Después:** `despues/1366x768-dark-t9.4.png` — la misma ronda: Paola corre con alguien de su lado.
- **Medida (`audit-delatores race`, 1.500 rondas, plan):** antes la ganadora iba sola de su lado 1,30 veces lo que le toca con 18 personas (649 contra 500 esperadas) y 1,89 con 30 (31 contra 16,4). Después: 475 contra 500 con 18 (0,95 veces, chi² 1,88, p 0,17) y 14 contra 14,2 con 30 (p 0,47). El auditor la da limpia en los dos tamaños.
- **Qué cambia:** dentro de cada fila, entre las asignaciones de menor peso se elige ahora la que deja a ninguna finalista sola de su lado (`solasDe` en `carrera-subfilas.ts`, con el peso de las costuras por debajo). El reparto de filas no se toca.

## 3. Nombres que se pisan en la recta (fichas del 3D)

- **Ronda:** `609c0cc6fc757695e0110d7b1e06ebaa8a2873b94d140b0b942aa8f2f5fa380a` (la misma del detalle 1), ganadora María Quispe.
- **Qué se ve:** a T − 3 s el grupo de punta se aprieta y las fichas se enciman (el contador `__solapes3d` de la escena marca 4 fichas pisadas entre sí en esa hora).
- **Antes:** `antes/1366x768-dark-m3s.png` — "Lucía Flores" sobre "Ana Vargas", "Diego Rojas" sobre "Jorge Mamani", "Elena Condori" sobre "Pablo Gutiérrez".
- **Después:** `despues/1366x768-dark-m3s.png` — las ocho fichas enteras, ninguna pisada (la búsqueda de lugar sube renglones y se corre a los lados hasta encontrar sitio, `buscaLugarFicha` en `carrera-fichas.ts`).
- **Medida (escena, `__solapes3d` a T − 3 s en esa ronda):** antes `entreSi: 4, sobreCabeza: 9`; después `entreSi: 0, sobreCabeza: 4` (las que quedan sobre una cabeza son de llamas lejanas del fondo, que ninguna ficha cubre de frente).

## 4. La llama ganadora tapada por el poste de la meta en el cartel final

- **Ronda:** `609c0cc6fc757695e0110d7b1e06ebaa8a2873b94d140b0b942aa8f2f5fa380a` (la misma de los detalles 1 y 3), ganadora María Quispe.
- **Qué se ve:** en el festejo (el cartel en pantalla), el poste de la meta de este lado queda encima de la ganadora.
- **Antes:** `antes/1366x768-dark-m-1s.png` — el poste cruza el cuerpo de María Quispe debajo del cartel.
- **Después:** `despues/1366x768-dark-m-1s.png` — el poste casi no se ve mientras el cartel está en pantalla; vuelve entero cuando se va (`FINISH_POST_CARTEL_*` en `carrera-3d-mapa.ts`, con su prueba en `carrera-final-fichas.test.ts`).
- **Prueba:** `carrera-final-fichas.test.ts`, "el poste de la meta se apaga en el cruce y mientras el cartel de quien ganó está en pantalla".

## Las metas de justicia, antes y después

`medir-final-carrera` (400 rondas por tamaño, 8/18/60/200): 15 metas en rojo antes y 15 después, las mismas (`scripts/lib/final-carrera.mjs`; la corrida de 1.500 rondas de la guía deja 18 en rojo en la carrera nueva, por el tiempo en punta y la primera a 0,5 s, que la dirección ya tiene anotados como compromiso de la marcha pareja). `medir-drama-carrera` (400 rondas, 8/18/60): 9 en rojo antes y 9 después, las mismas. `medir-escala-carrera` (celular, pixi, 8 personas, 4 semillas): 56 px de recta antes y después (la misma corrida da 56 en la base; la meta de 70 px queda a mirar en la guía como está). `audit-delatores race`: sin delatores con 18 personas antes y después; `hueco-al-corte` y `subfila-sola` salen limpia después (antes eran filas a mirar).

Las huellas de la carrera (`carrera-huella.json`) se rehicieron a propósito: la subfila de la ganadora ya no copia el orden de salida, así que cambia la parte "grupo" y la de las posturas que salen de ella; el resto de las partes da la misma huella.
