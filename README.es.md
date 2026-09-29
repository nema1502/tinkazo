<div align="center">

# Tinkazo 🦙

### Sorteos verificables para comunidades, sellados antes de que exista el azar y comprobados en Stellar.

[![Probalo](https://img.shields.io/badge/demo-tinkazo.vercel.app-e93d9c?style=flat-square)](https://tinkazo.vercel.app)
[![Contrato Soroban en testnet](https://img.shields.io/badge/Soroban-en%20testnet-7b61ff?style=flat-square)](https://stellar.expert/explorer/testnet/contract/CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH)
[![CI](https://github.com/nema1502/tinkazo/actions/workflows/ci.yml/badge.svg)](https://github.com/nema1502/tinkazo/actions/workflows/ci.yml)
[![drand quicknet](https://img.shields.io/badge/azar-drand%20quicknet-14b8a6?style=flat-square)](https://drand.love)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-ffc629?style=flat-square)](LICENSE)

**[Probalo](https://tinkazo.vercel.app)** · [Cómo funciona](#cómo-funciona) · [Por qué Stellar](#por-qué-stellar) · [Qué está andando](#qué-está-andando-hoy) · [Los próximos 30 días](#los-próximos-30-días) · [English](README.md)

<img src="docs/capturas/readme/hero.webp" alt="La portada de Tinkazo" width="860">

</div>

---

Toda comunidad regala cosas: entradas, libros, licencias, becas, turnos para hablar, quién expone primero. Y cada vez alguien en la sala piensa que el organizador eligió a un amigo. Lo que se usa hoy es un `ALEATORIO()` en una planilla, una ruleta en una página web o "confíen en mí". Nada de eso se puede revisar después.

**Tinkazo hace que cualquiera pueda revisar el sorteo, desde su celular y para siempre.** Quien organiza pega la lista, la lista se sella en Stellar, y el ganador sale de un número público que todavía no existía cuando se selló. Un contrato de Soroban verifica la firma de ese número dentro de la cadena. El resultado se cuenta en pantalla grande con un juego, y cualquiera rehace el sorteo entero en su navegador desde un enlace.

Los participantes no necesitan nada: ni billetera, ni cuenta, ni aplicación.

## No es de apuestas

Tinkazo decide quién se lleva algo que ya se está regalando. No sirve para apostar ni para vender chances:

- **Participar es gratis, siempre.** No hay boletos ni entrada paga. Los [términos](https://tinkazo.vercel.app/terminos.html) prohíben usar Tinkazo para sorteos que cobren por participar.
- **Nadie puede apostar al resultado.** No hay cuotas ni pozo: nadie pone plata, así que nadie gana la plata de otro.
- **El contrato no guarda fondos.** Guarda la huella de la lista y el resultado, nada más.

Un sorteo gratuito, sin compra obligatoria, queda fuera de las reglas de juegos de azar en casi todo el mundo; la investigación país por país está en [docs/legal.md](docs/legal.md). Algunos identificadores del contrato todavía dicen *raffle* (`tinkazo-raffle`, `raffle_id`), de antes de que el nombre se asentara. Son parte de la interfaz del contrato desplegado, así que quedan como están.

## Cómo funciona

```mermaid
sequenceDiagram
    autonumber
    participant O as Quien organiza (navegador)
    participant C as tinkazo-raffle (Soroban)
    participant D as drand quicknet
    participant A as Cualquiera
    O->>O: lista canónica → huella SHA-256
    O->>C: seal(huella, cantidad, ganadores, ronda R)
    Note over C: R tiene que estar al menos 30 s en el futuro:<br/>la semilla todavía no existe
    D-->>A: se publica la ronda R con su firma BLS12-381
    A->>C: draw(id, firma), sin pedir permiso
    C->>C: verifica la firma en la cadena (CAP-0059)<br/>semilla = SHA-256(firma) → ganadores
    A->>A: abre el comprobante → rehace el sorteo → veredicto
```

1. **Sellar.** La lista se normaliza y se resume con SHA-256. El contrato anota la huella, la cantidad de personas, cuántos ganan y una ronda **futura** de drand, y rechaza una ronda a menos de treinta segundos.
2. **Esperar el número.** [drand](https://drand.love) quicknet, el faro público de aleatoriedad de la League of Entropy (Cloudflare, Protocol Labs, la EPFL y otros), publica una ronda firmada cada tres segundos. Nadie, ni quien organiza ni Tinkazo, puede conocerla ni elegirla antes.
3. **Sortear.** `draw` verifica la firma BLS12-381 de la ronda **dentro del contrato**, deriva la semilla y elige a los ganadores de forma determinista. No le pide permiso a nadie: si quien organiza desaparece en medio del evento, cualquiera lo finaliza y el ganador es el mismo.
4. **El show.** Uno de doce juegos a pantalla completa cuenta el resultado. Cuando arranca la animación, el ganador ya está fijado: el juego solo lo relata.
5. **Revisar.** El comprobante es un enlace. Quien lo abre ve a la página rehacer el sorteo desde cero y recibe un veredicto: verde si el contrato atestigua la lista, amarillo si el sorteo no se ancló, rojo con el motivo si algo no cuadra.

La selección completa es una especificación normativa, el [protocolo v2](docs/protocolo.md), con vectores de prueba que comparten el contrato en Rust y el cliente en TypeScript ([docs/vectors.json](docs/vectors.json)). Cualquiera puede reimplementarlo y llegar a los mismos ganadores.

## Por qué Stellar

- **Verificar azar público en la cadena acá es barato.** Las funciones nativas de BLS12-381 ([CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md)) dejan que el contrato compruebe la firma de drand por su cuenta. La verificación cuesta **0,003 XLM**, y un sorteo entero, sellar más sortear, **0,18 XLM, unos cuatro centavos de dólar**, medido en testnet ([detalle](docs/deployments.md)).
- **Sin oráculo que operar.** La prueba es la firma del propio drand, verificable contra su clave pública dentro de años. No hay nodo que mantener vivo ni operador en quien confiar.
- **Inmutable y sin custodia.** El contrato no tiene administrador ni forma de actualizarse, y no guarda fondos. Una versión nueva es una dirección nueva, anotada en [docs/deployments.md](docs/deployments.md).
- **Entrar funciona en un meetup.** Quien organiza entra con Google mediante una billetera de Pollar, con Freighter, o con una cuenta de prueba que el navegador crea y fondea. Los participantes no tocan Stellar nunca.
- **Lo que sigue es nativo de Stellar:** cualquier comunidad, desde un meetup hasta un curso o una cooperativa, reparte recompensas y becas en USDC como saldos reclamables, y el sorteo se cuenta en pantalla con un juego de la cultura boliviana y latinoamericana. Quien sale elegido entra con Google y cobra cuando quiere, sin saber que abajo hay una blockchain y sin que el organizador le guarde la plata ([diseño](docs/premios.md)). La cadena es lo que deja que un grupo chico llegue a gente a la que antes no podía pagarle; nadie tiene que aprenderla. Cada recompensa la pone quien organiza y los participantes no pagan nada, así que no hay pozo ni nada que apostar.

## Qué está andando hoy

| Pieza | Estado | Evidencia |
|---|---|---|
| Contrato Soroban `tinkazo-raffle` | Desplegado en testnet | [`CD2SSHBU…ARENH`](https://stellar.expert/explorer/testnet/contract/CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH) · 19 tests, uno con una ronda real de quicknet · WASM de 11,4 KB |
| Sitio | En producción | [tinkazo.vercel.app](https://tinkazo.vercel.app) · español e inglés · tema claro y oscuro · sin servidor |
| Importar de Luma | En producción | Se suelta el export de invitados y se elige quién entra: los que hicieron check-in, los aprobados o a mano |
| Página de verificación | En producción | Rehace cualquier sorteo en el navegador desde su comprobante |
| Doce juegos de estadio | En producción | Deterministas: la misma ronda dibuja los mismos cuadros en cualquier máquina |
| Protocolo v2 | Especificado | [docs/protocolo.md](docs/protocolo.md) y vectores que las dos implementaciones tienen que pasar |
| Controles de calidad | En la CI y en el repositorio | 82 tests de TypeScript, los 19 del contrato y cinco auditores propios (abajo) |

Probado con mil participantes: el sorteo sigue a sesenta cuadros por segundo y se ancla igual.

**Quién estaba de verdad en la sala.** En el primer export real de Luma que probamos se habían inscrito 67 personas y hicieron check-in 35. Sortear con el export entero le daba la mitad de las chances a gente que no estaba. La ventana de importar propone a los que hicieron check-in, dice quién queda afuera y por qué (no vino, pendiente, invitado, rechazado) y deja marcar a alguien que vino y nunca le hicieron check-in. El archivo no sale del navegador, y al sorteo entran solo los nombres.

<div align="center">
<img src="docs/capturas/readme/importar.webp" alt="La ventana de importar: un export de Luma con 67 filas, los 35 que hicieron check-in marcados y el detalle de quién queda afuera" width="860">
</div>

<div align="center">
<img src="docs/capturas/readme/juegos.webp" alt="Seis de los doce juegos" width="860">
</div>

## El show

La justicia es matemática; el show es lo que hace que a la sala le importe. Doce juegos, casi todos de la cultura boliviana y latinoamericana, sembrados con la misma ronda de drand, así que la animación de un sorteo se puede reproducir:

| Juego | Qué es |
|---|---|
| Constelación Stellar | Un pago salta de estrella en estrella buscando ruta, como un *path payment*, y deja dibujada una constelación |
| Cierre de Libro | Tarjetas barridas por el cierre de un ledger hasta que queda una sellada |
| Carrera de llamas | Ocho carriles por la cordillera |
| Carrera de cohetes | La misma carrera, en el espacio |
| Aguayo | La tela andina que carga: el bulto de cada uno va encima, la tela se cierra y se amarra, y el que queda se va en el nudo |
| Teleférico | Cabinas con los colores de las líneas de La Paz y El Alto suben por el cable; en cada estación se baja la mitad |
| Tómbola | El bombo de la kermés, una bola numerada por persona de la lista sellada |
| Ruleta | La de siempre, que se ve bien hasta con dos personas |
| Trompo | El juego de patio: los trompos se tiran al ruedo de tiza, chocan y se sacan hasta el mano a mano |
| Balsas de totora | Balsas de totora con proa de puma cruzan el lago Titicaca |
| Piñata | La estrella de siete picos de las posadas: con cada palo caen nombres, y gana el último caramelo que quedaba adentro |
| Carnaval de Oruro | Una comparsa de la Diablada baila cuadra por cuadra hacia el Socavón; en cada arco se quedan algunos |

**Ninguno decide nada.** Un *director de emoción* escribe la historia de cada sorteo con la misma ronda: en la carrera una llama se planta, otra tropieza y dos se escupen; la ruleta se para en otro nombre y después avanza un gajo; en el teleférico se corta la luz en el aire. El final no se adivina, y un auditor comprueba en dieciséis semillas por juego que la historia no delata al ganador.

Un director de cámara filma cada juego como una transmisión: sigue a la punta, se mete en el susto, va en cámara lenta en la foto final y sacude en los choques. Los juegos corren en PixiJS, y en un equipo sin WebGL toma la posta el motor anterior: el sorteo nunca se queda en blanco.

De fondo suena música andina con beat que sigue la tensión, unos subtítulos cortos cuentan cada momento en pantalla, y después del ganador una tarjeta cuenta un pedazo de la historia con su fuente primaria.

## Modelo de confianza

Lo que está garantizado y lo que no está escrito en [docs/amenazas.md](docs/amenazas.md) y en la [página de seguridad](https://tinkazo.vercel.app/seguridad.html).

- **Meter un nombre después de sellar** cambia la huella, y la que vale quedó anotada antes de que existiera la semilla.
- **Elegir el número** no se puede: la ronda se fija antes de publicarse y su firma se verifica en la cadena.
- **Retener un resultado que no gustó** no sirve: `draw` no pide permiso.
- **El único ataque conocido que sigue abierto** es la selección del compromiso: sellar la misma lista contra varias rondas y publicar solo la que convino. Todos los sellos son públicos bajo la dirección de quien organiza, y la página de verificación marca sola las huellas repetidas. Publicar las bases del sorteo antes de que exista la ronda (el sitio las arma) cierra casi todo el hueco.
- **Privacidad.** En la cadena va solo la huella, nunca los nombres. El comprobante viaja en el fragmento de la URL, que el navegador no manda a ningún servidor. Durante un sorteo, la única petición que sale es la ronda de drand.

## Cómo se compara

El azar de drand en Stellar ya lo resolvió más de un proyecto, y vale nombrarlos:

| | Planilla o ruleta web | [Stellar-VRF](https://github.com/NibrasD/Stellar-VRF) | [Drand-Relay](https://github.com/kaankacar/Drand-Relay) | Tinkazo |
|---|---|---|---|---|
| Qué es | Un botón | Un oráculo: un contrato pide y un nodo de afuera entrega la ronda | Un relé que sube las rondas de drand y un contrato que las verifica | Un sorteo para quien organiza y una sala |
| Quién puede revisar | Nadie | Cualquiera que lea la cadena | Cualquiera que lea la cadena | Cualquiera con el enlace, desde el celular |
| Qué hay que operar | Nada | El nodo del oráculo | El que sube las rondas | Nada: el navegador arma la transacción |
| Para quién | Cualquiera, sin prueba | Otros contratos | Otros contratos | Gente que regala cosas |

Los tres verifican la firma BLS de drand quicknet en la cadena con CAP-0059. Stellar-VRF y Drand-Relay son primitivas para otros contratos, y buenas. Tinkazo es el producto para la gente, encima de la misma idea: una lista comprometida antes de que exista la semilla, un `draw` que cualquiera puede disparar y una página de prueba que corre en el celular. Fuera de la cadena, [Wallop](https://wallop.run) hace compromiso y drand para sorteos sin un ledger.

Por eso Tinkazo no publica otro crate verificador más. Su comprobación en la cadena, [`drand.rs`](contracts/raffle/src/drand.rs), son 112 líneas; lo que el ecosistema está pidiendo es una guía que compare los enfoques ([stellar-docs#2874](https://github.com/stellar/stellar-docs/issues/2874)), y eso está en el plan de abajo.

## Qué cuesta

Medido en testnet, no estimado. XLM a US$ 0,196.

| | XLM | US$ |
|---|---|---|
| Sellar un sorteo | 0,099 | 0,019 |
| Sortear, con la verificación BLS | 0,083 | 0,016 |
| **Total por sorteo** | **0,18** | **0,036** |
| Mainnet: desplegar una vez | unos 16 | unos 3 |
| Mainnet: mantener vivo el contrato | unos 49 al año | unos 10 al año |

Casi todo el costo es alquiler de almacenamiento por 120 días. **Verificar es gratis siempre**, y sortear sin anclar también.

## Calidad

Cinco auditores en [`scripts/`](scripts) corren el sitio de verdad en Chrome sin interfaz:

- **El de juegos**, veinte comprobaciones por juego contra drand de verdad. La que importa: el nombre en pantalla es el que fijó el protocolo.
- **El exigente**, que cambia el reloj del navegador para comparar dos corridas cuadro contra cuadro: la misma ronda dibuja lo mismo, ni un `Math.random`, nunca cuatro segundos sin novedad, el cartel del ganador se lee desde el fondo de la sala, con dos personas y con doscientas, en un celular.
- **El de emoción**, dieciséis semillas por juego: los arcos de la historia varían y el puesto de la ganadora a mitad de carrera no la delata.
- **El de sonido**, que engancha cada oscilador y mide afinación, registro, volumen y silencios de los efectos, con la música contada aparte.
- **El de interfaz**, en escritorio y celular, en los dos temas: imágenes rotas, texto cortado, contraste y blancos de toque.

## Los próximos 30 días

Cuatro entregables, cada uno con una comprobación que cualquiera puede hacer desde afuera:

| Entregable | Está hecho cuando |
|---|---|
| Mainnet, con la comisión pagada y el contrato verificado (`pnpm preflight:mainnet` ya comprueba lo demás) | El contrato figura verificado en stellar.expert, y alguien que entró con Google, con 0 XLM, sella y sortea un sorteo que da verde |
| Cinco sorteos reales, al menos tres hechos por otra persona con su propia cuenta | Cinco enlaces de comprobación en verde en mainnet, cinco direcciones de organizador y un comentario corto de cada uno |
| Un kit para organizadores, en español y en inglés | Una guía de una página, las bases generadas y un texto de resultado para Luma con la prueba de cada participante, enlazados desde el sitio |
| Aleatoriedad en Soroban, tres enfoques medidos | Un documento que compara [Drand-Relay](https://github.com/kaankacar/Drand-Relay), [Stellar-VRF](https://github.com/NibrasD/Stellar-VRF) y la verificación a pedido de Tinkazo (costo, en qué hay que confiar, un contrato de ejemplo), ofrecido a [stellar-docs#2874](https://github.com/stellar/stellar-docs/issues/2874) |

Después: recompensas en USDC como saldos reclamables, que pone quien organiza y que se cobran entrando con Google, primero en testnet. Los participantes siguen sin pagar nada, y Tinkazo nunca toca la plata.

## Correr en local

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # protocolo v2 contra los vectores compartidos
pnpm build
```

El contrato necesita Rust con el target `wasm32v1-none`:

```bash
cargo test --workspace
cargo build --release --target wasm32v1-none -p tinkazo-raffle
```

Parámetros de URL útiles: `?lang=en`, `?theme=light|dark`, `?demo=stellar|ledger|pasanaku|teleferico|tombola|race|rockets|wheel|trompo|totora|pinata|oruro`, `?instant=1`, `?pose=1` y `?motor=clasico` (el motor anterior).

## El repositorio

```
index.html · verificar.html     La herramienta, y la página que rehace un sorteo desde su comprobante
src/protocol/                   Lista canónica, selección, drand, comprobante
src/stellar/                    Red, billeteras y cliente del contrato
src/games/                      Los doce juegos y el andamiaje que comparten
contracts/raffle/               El contrato Soroban, en Rust
docs/                           Protocolo, arquitectura, amenazas, despliegues, legal, juegos
scripts/                        Despliegue, prueba de humo y los auditores
```

Documentación: [protocolo](docs/protocolo.md) · [arquitectura](docs/architecture.md) · [amenazas](docs/amenazas.md) · [despliegues y costos](docs/deployments.md) · [juegos](docs/juegos.md) · [legal](docs/legal.md) · [marca](docs/marca.md).

## Quién lo hace

Hecho en Bolivia por [Nicolás Emir Mejía Agreda](https://github.com/nema1502). El nombre es boliviano: un *tinkazo* es un presentimiento, una corazonada.

## Contribuir

Issues y pull requests son bienvenidos. **Si encontrás una forma de arreglar un sorteo, abrí un issue**: es el reporte que más sirve. Para agregar un juego, mirá [docs/juegos.md](docs/juegos.md); tiene que pasar los auditores para entrar.

## Licencia

[MIT](LICENSE) © 2026 Nicolás Emir Mejía Agreda
