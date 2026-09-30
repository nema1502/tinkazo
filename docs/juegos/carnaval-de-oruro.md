# Carnaval de Oruro

La entrada. Una comparsa de la Diablada baila por las cuadras, entre las graderías llenas, hacia el Santuario del Socavón. En cada arco de cuadra se quedan algunos bailarines, que salen a la vereda y saludan. Los dos últimos hacen un contrapunto frente al Socavón, y el que llega entra con campanas y cohetillos.

**Identificador:** `oruro` · **Probalo:** [tinkazo.vercel.app/?demo=oruro](https://tinkazo.vercel.app/?demo=oruro) · **Agregado:** 28 de septiembre de 2026

## Por qué el Carnaval de Oruro

Porque es la fiesta más grande de Bolivia y es patrimonio de la humanidad: la UNESCO lo proclamó en 2001. Según la UNESCO bailan más de 28.000 bailarines y 10.000 músicos, en unos cincuenta conjuntos, y la entrada recorre cuatro kilómetros durante veinte horas sin parar. ([fuente](https://ich.unesco.org/en/RL/carnival-of-oruro-00003))

Y la entrada ya tiene la forma de un sorteo por etapas: una comparsa que avanza cuadra por cuadra hasta un final.

## La mecánica

**La comparsa se arma.** Los bailarines arrancan en formación, en filas a lo ancho de la calle, en un orden sembrado. Cada uno es un diablo: máscara con cuernos anillados, ojos saltones con reborde y la culebra que baja por la frente; capa del color de su participante con estrellas bordadas; pechera dorada con su cara y lentejuelas que brillan. Y baila entero: los brazos suben y bajan al ritmo, el derecho con su tridente, y las piernas se levantan de a una con la rodilla alta del paso de la Diablada. Hasta el 29 de septiembre de 2026 el cuerpo era un solo dibujo quieto que saltaba.

**Las cuadras.** La comparsa avanza zapateando. En cada arco se para un momento, suenan los bronces de la banda y algunos se quedan: salen a la vereda de arriba y saludan desde ahí. Los que siguen se reacomodan en filas. Hay entre una y cinco cuadras, según cuánta gente haya.

**El contrapunto.** Después de la última cuadra quedan dos, y frente al Socavón se enfrentan: saltan de a uno, alternados, y se miran. Al final la rival se queda, y la ganadora entra al santuario con las campanas.

## Lo que la comparsa hace a propósito

**La ganadora nunca se queda.** El orden en que se quedan está sembrado con la ronda, y ella va primera en esa lista. La rival que elige el director de emoción va segunda, así que es la del contrapunto.

| Arco | Qué pasa |
|---|---|
| Susto | En la última cuadra a la ganadora casi se le cae la máscara ("¡casi se le cae la máscara a fulano!") |
| Remontada | Arranca en la última fila de la comparsa y en cada cuadra avanza |
| Duelo | El contrapunto frente al Socavón dura un paso más |
| Tapada | Baila en el medio de la comparsa y nadie la nombra |

## Cómo escala

| Participantes | Cuadras | Qué se ve |
|---|---|---|
| 2 | 1 | Una comparsa de dos, directo al contrapunto |
| 3 a 5 | 2 | |
| 6 a 14 | 3 | |
| 15 a 50 | 4 | Una comparsa de varias filas que se va achicando |
| 51 a 200 | 5 | Una multitud de diablos chicos; los nombres aparecen cuando quedan ocho |

## Los tiempos

En segundos de juego, con 18 participantes (cuatro cuadras) y sin estirar.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,2 s | La comparsa arma. "¡Arranca la entrada!", "¡18 diablos en la comparsa!" |
| 2,2 – 14,5 s | Cuatro cuadras. En cada arco: "¡Cuadra 1! Se quedan 6, siguen 12" |
| 14,5 – 17,9 s | La última cuadra y el camino al Socavón. "¡Ya se ve el Socavón!" |
| 17,9 – 21,1 s | El contrapunto. "¡Contrapunto entre fulano y mengano!" |
| 21,1 s | Campanas, cohetillos y el cartel |

## La cámara

Sigue a la comparsa, se acerca a los que se quedan en cada arco y a la máscara que se corre en el susto, se abre al Socavón al llegar y se cierra en el contrapunto.

## El sonido

- **El zapateo:** un golpe cada medio tiempo mientras la comparsa avanza.
- **Cada cuadra:** los bronces de la banda, en acorde.
- **La máscara del susto:** una alarma corta.
- **El contrapunto:** una nota por salto, alternada entre los dos.
- **La llegada:** la campana, y en el cartel las campanas del Socavón.

La música con beat, cuando está prendida, hace de banda de fondo.

## Cómo está hecho

Vive en [`src/games/pixi/oruro.ts`](../../src/games/pixi/oruro.ts) y usa el andamiaje del motor nuevo, [`src/games/pixi/stage.ts`](../../src/games/pixi/stage.ts). No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

Las fachadas coloniales, la gradería con su gente y los arcos se arman una vez al empezar; lo que se mueve en cada cuadro son los bailarines, la hinchada que salta y las guirnaldas de focos.

## Cómo auditarlo

```bash
node scripts/audit-rigor.mjs oruro
node scripts/audit-game.mjs oruro
node scripts/audit-emocion.mjs oruro
node scripts/audit-sound.mjs oruro
```
