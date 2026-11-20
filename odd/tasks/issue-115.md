# Issue #115: Corregir cuatro detalles visuales de la carrera sin cambiar su justicia

Feature: Corregir cuatro detalles visuales de la carrera sin cambiar su justicia. Worktree: `/home/agent/repos/tinkazo-i115`, rama `guido/issue115`, base `origin/main` (9a9cbc6). Issue: nema1502/tinkazo#115.

## Specs
- S1: corregir cuatro detalles anotados en `docs/juegos/carrera.md` con sus números: "un hueco al momento del corte de cámara, una subfila que queda sola con ciertas cantidades de participantes, nombres que se pisan en la recta y la llama ganadora tapada por el poste de la meta en el cartel final". "Para cada detalle falta encontrar una cantidad de participantes y una semilla donde se repita."
- S2 (evidencia previa): "Antes de cambiar el código, registrar para cada detalle una cantidad de participantes y una semilla donde se vea, junto con su captura." Guardar registros y capturas en el worktree (p. ej. `docs/juegos/carrera-evidencia/115/`).
- S3 (verificación): "Repetir esos mismos cuatro casos después del cambio y adjuntar capturas que muestren cada corrección." Además: "Revisar el cambio y la guía para comprobar que las metas de justicia de la carrera no fueron modificadas." Scripts: `scripts/medir-final-carrera.mjs`, `scripts/medir-drama-carrera.mjs`, `scripts/medir-escala-carrera.mjs`, `scripts/audit-game.mjs`.
- S4 (no tocar): "No mover las metas de justicia de la carrera para resolver problemas de cámara, distribución, nombres o cartel final." "el orden en que se ven las llamas no puede delatar a la ganadora" (de la selección de ganadora ya determinada).

## Tasks
- T1 (S2) [worker] Registrar participantes+semilla+captura de cada detalle antes de tocar código; commit de evidencia. Commit: c2e5cde.
- T2 (S1) [worker] Corregir los cuatro detalles sin tocar justicia; commit. Commit: 6f5bc17 (3 de 4; hueco-al-corte a mirar, documentado).
- T3 (S3,S4) [verify] Repetir los cuatro casos con capturas; guiones de medida y `audit-game.mjs` de la carrera en verde; diff sin cambios de justicia.

## Log
- L1 (pedido original, verbatim): "revisemos estos issues, y vamos resolviendo en paralelamente 5 a la vez" — tanda aprobada: #117, #110, #112, #108, #115. El texto completo del issue #115 es la especificación fuente en GitHub; los S# arriba citan sus partes normativas verbatim.

### L2 — Relevo y cierre de la sesión anterior (16 de noviembre)

La sesión dueña anterior (01a1e25e) dejó el trabajo sin commitear al detenerse: evidencia S2 completa de los 4 detalles (docs/juegos/carrera-evidencia/115/, semillas 609c0cc6… y 0ac2b7d3…, capturas antes/después), el arreglo de 3 detalles y el 4.º (hueco-al-corte) retirado a conciencia tras 5 intentos de tope que no cruza el corte — ninguna versión cerró sin romper otra meta (celdas de la costura fuera del tope, o recta-T15 delata). Verificación independiente (gentle-ai-verify, mwjpokvf-1-gk6u): S2/S3/S4 CUMPLE, justicia idéntica a línea base (medir-final y medir-drama: mismos rojos que en main, cero nuevos), captura reproducida con 1.066% de diferencia de píxeles (antialiasing), revisión de justicia de las tres funciones sin hallazgos. audit-game carrera no corre en este entorno (sin Chrome completo; el sorteo no termina en 240 s y falla igual en main limpio): se validó por medir-final/drama/delatores y huella. Commits: c2e5cde (evidencia), 6f5bc17 (fix + guía).
