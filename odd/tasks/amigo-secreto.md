# Amigo secreto

## Specs

- S1 (verbatim): «la animacion de los nombres de las personas jugando al amigo secreto y uno de ellos es el ganador» — un juego nuevo del show: la animación recorre los nombres de las personas jugando al amigo secreto y el show termina revelando la asignación (a quién le toca regalarle a quién), con uno de ellos destacado como ganador del premio.
- S2: la asignación es determinista a partir del beacon (nadie la elige): cada participante regala a exactamente una persona, nadie se regala a sí mismo, y la asignación es una permutación completa (todos dan, todos reciben).
- S3: el resultado es comprobable: la verificación (verificar.html / comprobante) recalcula la misma asignación desde la lista sellada y el mismo beacon, con la misma lógica pura compartida entre show y verificación.
- S4: sigue el contrato de juegos del repo (docs/juegos.md, kit/catalogo.ts) y las reglas de reproducibilidad (nada de azar no sembrado; el frame es función pura del tiempo).
- S5: cadena es+en para todos los textos visibles.

## Tasks

- T1 (S2,S3,S5): módulo puro de asignación `amigo-asignacion.ts`: permutación determinista (ciclo hamiltoniano sobre la lista con la semilla del beacon), sin autoasignación, compartida por show y verificación. Tests: sin autoasignación, permutación completa, determinismo, listas de 2..200.
- T2 (S1,S4,S5): el juego del show `amigo-secreto` en el motor (kit/catalogo.ts + módulo pixi): animación de nombres con la asignación revelándose al final, un ganador destacado (el premio). Estética de la casa.
- T3 (S3,S5): la verificación recalcula y muestra la asignación en el comprobante (mismo módulo puro). Tests de replay.
- T4: captura para el selector + registro en el catálogo (selector: true si el proyecto aprueba) + textos i18n.

## Log

- L1 (2026-11-15): pedido verbatim de Guido: «Quiero hacer el juego del amigo secreto» y «la animacion de los nombres de las personas jugando al amigo secreto y uno de ellos es el ganador». Decisión de revelación pendiente de Guido (pública vs QR individual): se arranca con revelación pública en pantalla.
