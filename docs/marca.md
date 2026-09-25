# Marca de Tinkazo

Escrito para quien arme una presentación, un afiche o una diapositiva de Tinkazo y necesite que se vea como Tinkazo. Todos los números de contraste de acá están medidos con la fórmula de WCAG 2.x sobre los colores reales del sitio, no estimados.

## La idea en una línea

> Sorteos que nadie puede arreglar. Ni vos.

En inglés: *Raffles nobody can rig. Not even you.*

El "ni vos" es lo que hace el trabajo. Cualquiera promete un sorteo limpio; lo raro es una herramienta que le quita el poder a quien la usa. Si hay que cortar la frase, se corta la primera mitad, nunca la segunda.

## El nombre

**Tinkazo**, siempre junto y con mayúscula inicial. Nunca "TinkaZo", "TINKAZO" en texto corrido, ni "Tinkazo App".

En el logotipo van las dos sílabas con peso distinto: `Tinka` en tinta y `zo` en magenta. Es la única vez que el nombre se parte.

Viene del español de Bolivia. El *Diccionario de americanismos* registra dos palabras gemelas: **tinkazo**, que es un presentimiento, y **tincazo**, que es el golpecito que se da haciendo resbalar el dedo sobre el pulgar. El producto es las dos cosas, y eso se puede contar en diez segundos ante cualquier público.

## La paleta

Cinco colores de acento, dos de superficie y dos de texto. Nada más. La restricción es parte del estilo.

### Tema claro

| Papel | Nombre | Hex |
|---|---|---|
| Fondo | papel | `#fff6e9` |
| Tarjeta | tarjeta | `#ffffff` |
| Texto | tinta | `#191919` |
| Texto secundario | tinta 2 | `#4b4437` |
| Texto terciario | apagado | `#6b655b` |

| Acento | Hex |
|---|---|
| Magenta | `#e93d9c` |
| Naranja | `#ff7a1a` |
| Turquesa | `#00a896` |
| Amarillo | `#ffc629` |
| Morado | `#6c4ce0` |

### Tema oscuro

| Papel | Hex |
|---|---|
| Fondo | `#171126` |
| Tarjeta | `#221a33` |
| Texto | `#f6efe2` |
| Texto secundario | `#cfc6b4` |
| Texto terciario | `#97909f` |

| Acento | Hex |
|---|---|
| Magenta | `#ff5cb3` |
| Naranja | `#ff8b3d` |
| Turquesa | `#17c3b2` |
| Amarillo | `#ffd24d` |
| Morado | `#9b7bff` |

## La regla del texto sobre color

Esta es la que más se rompe y la que más se nota. **Sobre los cinco acentos va tinta, no blanco.** La única excepción es el morado en tema claro.

Contraste medido, texto sobre color plano:

| Acento | Con tinta `#191919` | Con blanco |
|---|---|---|
| Magenta claro | **4,70** | 3,74 |
| Naranja claro | **6,74** | 2,61 |
| Turquesa claro | **5,90** | 2,98 |
| Amarillo claro | **11,19** | 1,57 |
| Morado claro | 3,14 | **5,60** |
| Magenta oscuro | **6,22** | 2,82 |
| Naranja oscuro | **7,55** | 2,33 |
| Turquesa oscuro | **7,94** | 2,21 |
| Amarillo oscuro | **12,20** | 1,44 |
| Morado oscuro | **5,59** | 3,15 |

El umbral es 4,5 para texto normal y 3 para texto grande. Blanco sobre naranja da 2,61: eso no se lee en un proyector de sala ni con buena voluntad.

**El par más fuerte que existe en la marca es amarillo con tinta encima: 11,19 a 1.** Por eso el cartel del ganador es amarillo. Si hay que destacar una sola cosa en una diapositiva, va ahí.

## El estilo

Neobrutalismo: bordes gruesos de tinta, sombras duras sin desenfoque, colores planos, nada de degradados suaves ni de sombras difuminadas.

| Elemento | Valor |
|---|---|
| Borde grueso | 3 px sólido tinta |
| Borde fino | 2 px sólido tinta |
| Sombra grande | 6 px 6 px 0 tinta |
| Sombra chica | 3 px 3 px 0 tinta |
| Rotación de las calcomanías | entre -2 y +2 grados |

**La sombra nunca lleva desenfoque.** Si una diapositiva tiene una sombra difuminada, no es de Tinkazo.

## Tipografía

Se usa la tipografía del sistema, a propósito: el sitio no carga ninguna fuente y por eso pinta el primer cuadro al instante.

| Uso | Familia | Peso |
|---|---|---|
| Títulos | `system-ui` | 900 |
| Texto | `system-ui` | 500 a 700 |
| Números, huellas, direcciones | `ui-monospace`, Consolas | 700 |

Los títulos van muy apretados (`letter-spacing: -0.02em`) y los rótulos en versalitas, muy separados (`0.08em` a `0.14em`).

**Todo lo que sea un dato verificable va en monoespaciada.** Una huella, un hash, una dirección de contrato, un número de ronda. Es una señal: lo que está en monoespaciada se puede comprobar.

## La llama

La mascota es una llama pixelada, dibujada con rectángulos, sin curvas. Va en magenta con sombra dura de tinta, rotada unos tres grados.

No tiene cara ni ojos. No se le pone sombrero ni poncho. Es una silueta y con eso alcanza.

## Cómo se escribe

El sitio está en español boliviano con voseo, y en inglés neutro. No hay un tercer registro.

**Lo que sí:**

- Voseo: "pegá la lista", "sorteá", "probalo", "si encontrás".
- Frases cortas, de una idea cada una.
- Decir el precio y el costo con el número: "cuesta cuatro centavos", no "es muy barato".
- Admitir los límites. El veredicto amarillo de la página de verificación dice que la cuenta cierra pero que nadie atestigua la lista. Esa honestidad es la marca.

**Lo que no:**

- "Revoluciona", "disrumpe", "la próxima generación de", "impulsado por blockchain".
- Prometer lo que no está hecho. Si algo está en testnet, se dice testnet.
- Explicar la criptografía antes de explicar para qué sirve.
- Signos de exclamación en el texto del producto. En el narrador de los juegos sí, porque ahí es un relator.

## El narrador es otro registro

Dentro de los juegos la voz es de relator de partido: mayúsculas, gritos, "¡NO RESPIRA NADIE!". Eso vive solo ahí. No se filtra a la página ni a una presentación.

## Los ocho juegos

Cada uno tiene su color dominante, útil si una diapositiva los muestra.

| Juego | Color | En una frase |
|---|---|---|
| Constelación Stellar | Morado y amarillo | Un pago que salta de estrella en estrella hasta encontrar ruta |
| Cierre de Libro | Turquesa | Tarjetas barridas por el cierre de un ledger |
| Pasanaku | Los cinco, en franjas | Un aguayo que se cierra hasta que queda uno en el nudo |
| Teleférico | Los de las líneas, sobre un atardecer | Un convoy que sube y en cada estación se baja la mitad |
| Tómbola | Naranja y amarillo, con las bolas de los cinco | El bombo de la kermés: la bola que sale es la ganadora |
| Carrera de llamas | Naranja y magenta | Ocho carriles por la cordillera |
| Carrera de cohetes | Morado | La misma carrera, en el espacio |
| Ruleta | Los cinco, en gajos | La de siempre, pero que se ve girar con dos personas |

## Lo boliviano

Entra por la función, nunca por la decoración. Si el elemento se puede sacar sin que nada deje de funcionar, es decoración y sobra.

En el producto hay exactamente cinco cosas bolivianas y las cinco hacen algo: el nombre, la llama de la mascota, el perno tricolor de la ruleta que marca la vuelta, el aguayo del Pasanaku que es el tablero de juego, y el teleférico, cuyo cable es la barra de progreso y cuyas cabinas llevan los colores de las diez líneas de La Paz y El Alto. Los nombres de la lista de ejemplo (Quispe, Mamani, Choque, Condori, Limachi, Villca) son el detalle más sutil y el que más gusta.

**Lo que no va:** wiphalas, cholitas, el Illimani, Tiwanaku, ni la palabra "Bolivia" escrita en pantalla. El pie de página dice "Hecho en Bolivia por Nicolás" y con eso alcanza.

## Los números que se pueden decir

Todos medidos, no estimados. Si se actualizan, se actualizan acá también.

| Dato | Valor |
|---|---|
| Costo de sellar un sorteo | 0,099 XLM |
| Costo de sortear, con la verificación criptográfica | 0,083 XLM |
| **Total por sorteo** | **0,18 XLM, unos 0,036 dólares** |
| Solo la verificación BLS en la cadena | 0,003 XLM |
| Tamaño del contrato compilado | 11,4 KB |
| Tests del contrato | 19 |
| Tests del protocolo en TypeScript | 38 |
| Comprobaciones por juego del auditor | 15 |
| Juegos | 6 |
| Espera entre sellar y sortear, modo libre | 10 segundos |
| Espera si el sorteo se ancla en Stellar | 45 segundos |
| Dependencias en ejecución | 3 (RPC de Stellar, relays de drand, la wallet del organizador) |
| Servidores propios | 0 |

## Los enlaces

| Qué | Dónde |
|---|---|
| Producto | https://tinkazo.vercel.app |
| Código | https://github.com/nema1502/tinkazo |
| Protocolo, especificación normativa | `docs/protocolo.md` |
| Licencia | MIT |

## Para una presentación

El orden que funciona, probado contra las objeciones que aparecen:

1. **La palabra.** En Bolivia un tinkazo es esa corazonada de que hoy tenés suerte. Abre con algo humano y deja el nombre pegado.
2. **El problema.** Toda comunidad hace sorteos, y en todos hay alguien que piensa que el organizador le dio el premio a su amigo.
3. **El truco, en una frase.** La lista se cierra antes de que exista el número que va a decidir. El orden es todo.
4. **La demostración.** Un sorteo de verdad, en vivo. Dura diez segundos de espera y un juego. Que el público vea la lista congelarse.
5. **La prueba.** Abrir el comprobante desde un celular ajeno y que la página rehaga el sorteo sola.
6. **El costo.** Cuatro centavos. Y verificar siempre es gratis.
7. **La honestidad.** Mostrar el veredicto amarillo: cuando el sorteo no está anclado, la herramienta lo dice en vez de dar un verde fácil. Esta diapositiva convence más que las seis anteriores.

Lo que no conviene mostrar en una presentación: el código del contrato, el diagrama de arquitectura, ni la explicación de BLS12-381. Si alguien pregunta, está en la documentación.
