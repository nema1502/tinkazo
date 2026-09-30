# Balsas de totora

La carrera, en el lago Titicaca. Balsas de totora con la proa de puma, un remero por carril con poncho y chullo, la Cordillera Real al fondo y la meta en la otra orilla.

**Identificador:** `totora` · **Probalo:** [tinkazo.vercel.app/?demo=totora](https://tinkazo.vercel.app/?demo=totora) · **Agregado:** 28 de septiembre de 2026

## Por qué balsas de totora

Porque son del Titicaca y no hay nada más andino que eso. El *Diccionario de americanismos* describe la totora como una planta de tallo erecto de hasta tres metros que se usa para techos, paredes y embarcaciones, y la registra en Bolivia. ([fuente](https://www.asale.org/damer/totora)) En el lago se atan haces de totora y sale una balsa.

Y porque un juego nuevo que es carrera se agrega como tema del motor de carrera y no como un juego aparte, como pide la historia 7.4: la misma carrera que ya pasa todas las auditorías, con otra piel.

## Qué cambia respecto de la carrera de llamas

Lo mismo que cambia en la de cohetes: el dibujo y la voz, no la carrera.

- **El corredor** es una balsa: dos haces de totora curvados hacia arriba, las amarras, la cabeza de puma en la proa y el remero con la cara del participante. El remo va y viene con el paso.
- **La pista** es agua, con crestas de ola y una cuerda de boyas; **la tribuna** es la orilla con totorales y gente mirando.
- **El polvo** es espuma, y **los cascos** son el chapoteo del remo. Cada palada salpica: donde entra el remo saltan unas gotas y se abre un anillo en el agua.
- **Los momentos de la historia** se cuentan en agua: la llama que se planta es la balsa que se queda quieta ("¡a fulano se le fue el viento!"), el tropiezo es una ola que la ladea, el pique es remar con todo, y la escupida es una salpicada.

## Lo que la carrera hace a propósito

Lo mismo que la de llamas: el plan de la carrera sale de la ronda, la ganadora corre donde el director de emoción la pone, y la cámara mira lo que el plan ya decidió. El azar se consume en el mismo orden que la carrera de llamas del motor anterior, así que en un equipo sin WebGL, que cae a esa carrera, la historia del sorteo es la misma.

## Cómo escala

Como las otras dos carreras: ocho carriles en pantalla. Con más de ocho, corren ocho y el cartel de arriba dice entre cuántos fue el sorteo.

## Cómo está hecho

Es el tema `lago` de [`src/games/llamas/pixi-race.ts`](../../src/games/llamas/pixi-race.ts), junto a `andes` (llamas) y `stellar` (cohetes). Los textos de la historia usan la voz `B` en [`src/i18n.ts`](../../src/i18n.ts), al lado de la `L` de las llamas y la `R` de los cohetes.

## Cómo auditarlo

```bash
node scripts/audit-rigor.mjs totora
node scripts/audit-game.mjs totora
node scripts/audit-emocion.mjs totora
node scripts/audit-sound.mjs totora
```
