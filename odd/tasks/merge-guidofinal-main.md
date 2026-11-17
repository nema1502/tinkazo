# Merge origin/main → guido/final

## Specs

- S1 (verbatim): «Que no se pierda nada» — resolución hunk por hunk, semántica, nunca por selección wholesale ours/theirs. Ambas ramas traen features: guido/final trae el modo espectador QR, juegos interactivos v2, juego amigo secreto, diálogo final de compartir; origin/main trae el módulo estilos-atencion, protocolo reparto (src/modos/amigo.ts), claves i18n, casos de pago No-llegó, registro equipos, memo numérico. Donde ambas tocaron la misma área, COMBINAR (unión), no elegir.
- S2 (verbatim): «3. Ya integralo, ahorita para evitar problemas» — completar la integración ya, para evitar problemas después.

## Tasks

- T1 (S1,S2): resolver la fusión en curso de origin/main (e9333b1) en guido/final (1167dc1) en el worktree .worktrees/espectadores: 17 archivos en conflicto, 63 bloques. `npx tsc --noEmit` en 0, suite enfocada verde, commit del merge, suite completa y `npx vite build` verdes.

## Log

- L1 (2026-11-15): pedido verbatim: «Spec: odd/tasks/merge-guidofinal-main.md, T1. A merge of origin/main (e9333b1) into guido/final (1167dc1) is IN PROGRESS in /home/agent/repos/tinkazo/.worktrees/espectadores ... 17 conflicted files, 63 conflict blocks ... Resolve hunk by hunk, semantically, never by wholesale ours/theirs file selection. ... Where both touched the same area, COMBINE (union), not pick.» Contrato de preservación: respaldo en backup/guido-final-pre-merge (1167dc1, estado pre-merge exacto). Sin pushes, sin rebase, sin aborts.
