# Issue #102: Siguiente premio sin otra espera: sellar una vez y revelar de a un lugar

Feature: ver issue. Worktree: `/home/agent/repos/tinkazo-i102`, rama `guido/issue102`, base `origin/main` (e9333b19e0488255f5494b1c125d9538c69b4f02). Issue: nema1502/tinkazo#102.

## Specs
Fuente normativa: el cuerpo del issue, citado verbatim abajo (los S# remiten a sus secciones).

> ## Qué pasa
> 
> Un sorteo con varios ganadores ya es un solo sello y un solo número, y la selección da todos los lugares en orden de premio (`docs/protocolo.md:84`). Pero el botón Siguiente premio (`index.html:547`, `src/main.ts:147`) llama a `newDraw("sinGanadores")` (`src/ui/draw.ts:916-944`): abre la lista sin quienes ganaron (`unfreeze`, `draw.ts:944`) y pide sellar y esperar de nuevo. Lo mismo pasa cuando un ganador no está (`draw.ts:949-953`).
> 
> ## Por qué importa
> 
> Quien hace varios sorteos de varias cosas espera entero cada uno. Con la cuenta de prueba el margen antes del número es de 45 segundos por sello (`ANCHOR_LEAD_SECONDS`, `src/state.ts:239`), más lo que tarda el resto. Sellando una vez con todos los lugares, desde el segundo premio no hay espera.
> 
> ## Dónde está
> 
> - `newDraw` y `sinGanadores` en `src/ui/draw.ts:828-833` y `:916-960`.
> - `showAgain`, que arma Siguiente premio, en `src/ui/draw.ts:846-878`.
> - `reveal` en `src/ui/draw.ts:672`. El comprobante ya lleva la cantidad de ganadores (`src/ui/draw.ts:1160`).
> 
> ## Qué se quiere
> 
> - Con más de un ganador sellado, el juego muestra solo el primer lugar. Siguiente premio muestra el lugar que sigue del mismo resultado, con su show, sin sellar.
> - Se ve en qué lugar va (2 de 5) y, si existe, el premio de ese lugar (issue de un premio por lugar).
> - Antes de sellar y en el resultado, una línea dice la verdad a la sala: todos los lugares quedaron fijos al nacer el número y cualquiera los puede calcular desde ese momento.
> - Cuando se terminan los lugares sellados, Siguiente premio vuelve a lo de hoy: sellar entre quienes quedan.
> - Para después: sellar suplentes junto con los ganadores para reemplazar a quien no está sin volver a sellar.
> - Textos nuevos en español y en inglés.
> 
> ## Cómo se comprueba
> 
> - Una prueba en `src/ui/`: con un resultado de 3 lugares, Siguiente premio no llama a `unfreeze` ni a sellar, y muestra el segundo lugar y después el tercero, en el orden de `winners`.
> - Al terminar los 3, Siguiente premio vuelve a abrir la lista sin los ganadores, como hoy.
> - La verificación de ese sorteo muestra los 3 lugares en el mismo orden que la sala.
> - Capturas del aviso a la sala y del contador de lugares, en los dos idiomas.
> 
> ## Qué no se toca
> 
> `contracts/`, `src/protocol/`, `docs/protocolo.md` y `docs/vectors.json`.
> 
