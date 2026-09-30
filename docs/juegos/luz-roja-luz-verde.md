# Luz roja, luz verde

El juego de patio de todo el mundo. Con luz verde se corre, con luz roja hay que quedarse quieto, y al que se mueve lo ven y queda afuera. Acá quien mira es el Faro: con luz verde está de espaldas y muestra su lámpara verde; con luz roja se da vuelta, prende el ojo rojo y barre la cancha con su haz. Al que el haz agarra moviéndose, "¡te vi!", y se sienta. Gana quien toca el Faro.

**Identificador:** `luz` · **Probalo:** [tinkazo.vercel.app/?demo=luz](https://tinkazo.vercel.app/?demo=luz) · **Agregado:** 30 de septiembre de 2026

## Por qué un faro

Porque es lo que es drand para Tinkazo. drand se presenta como un "distributed randomness beacon", un faro de aleatoriedad distribuido que da números al azar verificables, impredecibles y sin sesgo, y de una de sus rondas sale cada sorteo. En el juego, el Faro solo mira: el ganador ya estaba decidido antes de que arranque.

## Por qué no el de la serie

El autor pidió algo como el juego del calamar, y el juego de la serie es justamente este. Pero la marca "Squid Game" es de Netflix, que la registró para controlar lo que otros hacen con la serie, y la muñeca y los uniformes son creaciones de la serie. Y la serie es de apostar la vida por plata: Tinkazo no es de apuestas, lo dice en todos lados, y un sorteo vestido de esa serie diría lo contrario. Por eso es el juego de patio, sin muñeca, sin uniformes y sin nada que se apueste, con el Faro de la casa.

## La mecánica

**La largada.** Los corredores arrancan en filas escalonadas detrás de la línea de tiza, de espaldas a la cámara, con la polera de su color y, con hasta sesenta personas, su número de la lista en el dorsal. Algunos llevan chullo. El Faro espera al fondo de la cancha, a los pies de la meta.

**La luz verde.** El Faro canta seis notas que suben, de espaldas, cada vez más rápido. Todos corren hacia él.

**La luz roja.** El Faro se da vuelta y prende el ojo rojo. Cada corredor frena con su inercia, y al que le toca salir en esa luz no le alcanza el freno: arrastra los pies y se tambalea. El haz barre la cancha de un lado al otro, y al que agarra moviéndose, "¡te vi!": se sienta en el pasto con una cruz roja en el dorsal. Los que alcanzaron a frenar quedan como estatuas, a mitad del paso.

**El final.** Hay entre dos y cinco luces rojas, según cuánta gente haya. La última es de la rival sola. Después, el último verde: la ganadora corre hasta tocar el Faro, y su luz se vuelve dorada.

## Lo que la cancha hace a propósito

**La ganadora nunca se mueve con luz roja.** El orden en que salen está sembrado con la ronda y ella va primera en esa lista. El haz no decide nada: agarra a los que el plan ya dijo que no iban a alcanzar a frenar.

| Arco | Qué pasa |
|---|---|
| Susto | El haz se detiene sobre la ganadora, que se tambalea sin dar un paso ("¡el Faro mira a fulana!"), y sigue de largo ("¡por un pelo!") |
| Remontada | Arranca última y en el último verde pasa a todos |
| Duelo | Una luz roja más, con la rival adelante hasta que el haz la agarra en la última |
| Tapada | Corre en el medio del grupo y nadie la nombra |

## Cómo escala

| Participantes | Luces rojas | Qué se ve |
|---|---|---|
| 2 | 2 | Nadie sale en la primera, y en la segunda el haz agarra a la rival |
| 18 | 4 | Primero salen muchos, al final de a uno |
| 200 | 5 | Un grupo grande que se va sentando; los nombres aparecen cuando quedan ocho |

## La cámara

Avanza detrás del grupo, en perspectiva y desde tres metros de alto, como desde una tribuna: la cancha se ve con profundidad, los corredores se achican hacia el Faro y el grupo queda en el medio de la pantalla. Los cerros del horizonte se mueven con la cancha, así que al acercarse no se abre ninguna franja entre los dos. Los que se sentaron se desvanecen antes de que la cámara les pase por encima. Cuando el Faro se da vuelta, la cámara va a su cabeza; en la luz roja sigue al haz por la cancha; en el susto se mete en la ganadora; y en el último verde acompaña a la ganadora hasta el Faro.

## El sonido

- **La luz verde:** dos notas que suben, el canto del Faro y los pasos.
- **La luz roja:** un golpe al darse vuelta y un zumbido grave mientras barre el haz.
- **El que ven:** un zumbido corto y grave, como mucho uno cada 0,12 segundos.
- **El susto:** una alarma corta, y otra nota cuando se salva.

## Cómo está hecho

Vive en [`src/games/pixi/luz.ts`](../../src/games/pixi/luz.ts) y usa el andamiaje del motor nuevo. No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

La posición de cada corredor vive en la cancha (el ancho, y la profundidad hacia el Faro) y se proyecta con una cámara en perspectiva que avanza. La física corre a paso fijo de 1/120 de segundo: cada corredor acelera hacia donde tiene que llegar al final de cada verde y frena con su propia fuerza.

## Cómo auditarlo

```bash
node scripts/audit-fisica.mjs luz
node scripts/audit-rigor.mjs luz
node scripts/audit-sound.mjs luz
node scripts/audit-emocion.mjs luz
node scripts/audit-game.mjs luz
```

El auditor de física comprueba, en cuatro semillas y con 2, 60 y 200 personas:
- que a nadie lo agarran quieto;
- que el haz los agarra cuando pasa por encima;
- que con luz roja nadie más se mueve;
- que agarra a todos los que tocaba y nunca a la ganadora;
- que la misma semilla da lo mismo.
