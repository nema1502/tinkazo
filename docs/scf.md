# Postular al Stellar Community Fund

Escrito para Nicolás, con lo que hay que hacer y en qué orden. Todo lo de acá sale del handbook oficial del fondo y de sus reglas, verificado el 20 de septiembre de 2026. Lo que no se pudo verificar está marcado como tal, porque un dato inventado en una postulación se nota.

## El calendario, que es lo primero

| Qué | Cuándo |
|---|---|
| **Formulario de interés** | Siempre abierto. Se revisa sobre la marcha. **Mandarlo ya.** |
| HackMeridian, pista Scale | 25 y 26 de octubre de 2026, Lisboa |
| Stellar Lounge | 27 de octubre |
| Meridian | 28 y 29 de octubre, Convento do Beato |
| Cierre de registro a Meridian | 9 de octubre, o antes si se agota |
| **Cierre de postulaciones SCF #46** | **8 de noviembre de 2026** |
| Revisión del panel | 11 al 18 de noviembre |
| Voto de la comunidad | 23 de noviembre al 3 de diciembre |

El cierre del #46 cae **diez días después de que termine Meridian**. Ese hueco es el plan entero: ir a Lisboa, conseguir un referidor y sortear de verdad delante de gente, y postular después con eso adentro.

**No se postula directo a una ronda.** Primero va el formulario de interés; si el proyecto es elegible, invitan por correo a presentar la postulación completa. Sin ese primer paso no pasa nada, y es gratis.

Entrada única: https://communityfund.stellar.org/dashboard (se crea cuenta con Discord).

## Qué pista y por qué

**Build Award, Open Track, categoría "Applications".**

| Pista | Por qué no |
|---|---|
| RFP Track | Los dos pedidos abiertos son de otra cosa: un verificador de LayerZero y un facilitador de x402 |
| Integration Track | Pide tracción significativa ya existente y comprometer una métrica de valor movido en la cadena. Tinkazo no mueve valor |
| Instawards | Hace falta ser parte de un capítulo de embajadores local, y **Bolivia no figura como capítulo activo**. Vale preguntarle igual a StarMaker LATAM: mil a cinco mil dólares por un sprint de treinta días sería un primer paso de bajo riesgo |
| Public Goods | Solo por invitación. Sería el camino si algún día se extrae la verificación de drand como librería aparte |

El Open Track premia a **uno de cada cuatro**. En la ronda 44 entraron 175 postulaciones y ganaron 46, con un premio promedio cercano a los cien mil dólares. **El 61% de los premiados llegó por referido.**

## Lo que hay que tener listo

Lista literal de lo que pide el handbook para una postulación de Build:

1. Hoja de ruta técnica detallada con plan de hitos
2. Desglose del presupuesto **por tramo y por entregable**
3. Tracción actual, verificable dentro de la postulación
4. Habilidades y experiencia del equipo
5. Caso de uso claro de Stellar, con explicación técnica y **esquema de arquitectura completo**
6. **Tres tramos**, y el último tiene que ser el lanzamiento en mainnet
7. Para cada entregable: **cuánto cuesta y cómo va a comprobar el revisor que está hecho**
8. Plan de liberación del código de los contratos
9. En el tramo 2: **modelo de amenazas y plan de monitoreo en la cadena**
10. Declaración completa del uso de inteligencia artificial en documentos y código
11. Una fuente única con toda la documentación (tipo Gitbook)
12. Un video de presentación del equipo

**Y una regla que cambia todo:** *"Reviewers assess each application based solely on the information provided in the submission. No external materials are considered."* El repositorio, el sitio y estos documentos **no cuentan** si no están dentro de la postulación. Hay que copiar los números adentro.

**Lo que el presupuesto no puede incluir:** auditorías (van por el Audit Bank aparte), marketing, premios o airdrops, honorarios legales, y **trabajo ya hecho**.

Los pagos van en cuatro tramos: 10% al aceptar, 20% con el MVP, 30% en testnet, 40% al lanzar en mainnet. Cada tramo hay que presentarlo dentro de los 90 días del anterior o se pierde el saldo.

## Los tres riesgos que pueden hundir la postulación

### 1. El solapamiento con Stellar-VRF

**Este es el más grave.** En la ronda 44, hace ocho semanas, el mismo panel premió con cincuenta mil dólares a VRF-Soroban, que usa **el mismo faro** (drand quicknet), **la misma curva** (BLS12-381), **la misma verificación dentro del contrato** con las funciones nativas de CAP-0059 y **la misma propiedad de ronda futura**. Está en mainnet y sigue recibiendo commits.

El Open Track dice explícitamente que no es para equipos que replican soluciones existentes, y que si se postula igual hay que explicar en qué se mejora.

**La diferencia hay que escribirla en el primer párrafo**, no en la página cuatro:

| | Stellar-VRF | Tinkazo |
|---|---|---|
| Qué es | Infraestructura: un servicio que otros contratos consumen | Producto de usuario final: sortea y lo muestra ante un público |
| Qué hay que operar | Un **nodo oráculo fuera de la cadena**, con Redis y alta disponibilidad | Nada. El navegador arma la transacción |
| En quién hay que confiar | En que el oráculo esté vivo y bien operado | En nadie. `draw` no pide permiso: cualquiera lo finaliza |
| La prueba | Una prueba emitida por el oráculo | **La firma del propio drand**, verificable contra su clave pública años después |
| El compromiso | A la semilla | **A la lista completa**, sellada con SHA-256 antes de que exista la ronda |
| Costo | 58,6 millones de instrucciones por respuesta | **0,18 XLM el sorteo entero**, medido |

La frase: *son capas distintas. Ellos venden la primitiva; Tinkazo resuelve el caso de uso donde la primitiva importa y hay alguien mirando la pantalla.*

Y hay munición a favor: **NebulaVRF** cobró treinta y cuatro mil dólares en la ronda 34 y su repositorio no recibe commits desde el 14 de febrero de 2026, sin haber llegado nunca a mainnet. El ecosistema ya pagó por un generador de aleatoriedad que se murió en testnet. Hay que explicar por qué este no.

### 2. La cláusula de juego de azar

Las reglas oficiales dejan afuera a los equipos cuyos productos *"involve, facilitate, or promote gambling"*. "Sorteos" suena peligrosamente cerca.

**La defensa hay que escribirla antes de que la pregunten:**

> No hay apuesta, no hay boleto pago, no hay contraprestación del participante, el contrato no custodia fondos y no hay premio monetario dentro del sistema. Es asignación verificable de un bien escaso entre personas que ya están en una lista: entradas, becas, licencias, turnos, el orden de un pasanaku. Es lo que hace un sorteo de aula o una asignación de vivienda, no lo que hace una casa de apuestas.

**Acción concreta:** preguntarlo por escrito a communityfund@stellar.org **antes** de postular, y citar la respuesta dentro de la postulación.

### 3. Cero tracción

El repositorio se creó el 16 de septiembre de 2026. Tiene cuatro días, cero estrellas, cero forks. **No hay un solo sorteo hecho por alguien que no sea el autor.**

El criterio del fondo es explícito: hay que demostrar encaje con el mercado, y la tracción tiene que ser **verificable dentro de la postulación**.

Es el problema número uno y el único que Lisboa puede arreglar en seis semanas. Lo que hace falta: **diez sorteos reales, con diez comunidades distintas**, cada uno con nombre, fecha, cantidad de participantes y enlace al comprobante en la cadena. Diez. No dos.

## Lo que falta, sin anestesia

| Falta | Qué hacer | Cuándo |
|---|---|---|
| Tracción | Diez sorteos con comunidades reales | Lisboa, y antes si se puede |
| Mainnet | Desplegar. Cuesta unos trece dólares y `pnpm preflight:mainnet` ya comprueba todo lo demás | **Antes de postular** |
| Referidor | El 61% de los premiados vino por uno | Lisboa |
| Reputación para el voto | Verificarse en el Discord de Stellar y participar. El voto usa reputación acumulada | Empezar ya |
| Modelo de amenazas | Es requisito del tramo 2. Está escrito en [amenazas.md](amenazas.md) | Hecho |
| Métrica de crecimiento en la cadena | Ver abajo | Antes de postular |
| Documentación unificada | Un Gitbook con todo | Antes de postular |
| Video del equipo | Está en la lista literal de lo que hace buena a una postulación | Antes de postular |
| Declaración de uso de IA | Es requisito explícito. Esconderlo es peor que declararlo | Antes de postular |

**El bloqueo formal de mainnet es uno solo:** la cuenta `GB3OND7F…` no existe en esa red, o sea que nunca se fondeó. Hacen falta unos 70 XLM para desplegar y cubrir el primer año de alquiler con colchón.

## La métrica de crecimiento

El fondo pide decir cómo el proyecto genera crecimiento en la cadena y cómo se mide. Un sorteo de 0,18 XLM no mueve la aguja de nada, y decir lo contrario es mentir.

Lo que sí genera es **primera transacción**: cada sorteo anclado le pone una dirección de Stellar en la mano a un organizador que antes no tenía ninguna, y le muestra el explorador de bloques.

La métrica propuesta, que es honesta y se puede verificar en la cadena:

| Métrica | Cómo se mide |
|---|---|
| **Organizadores únicos que sellan por primera vez, por mes** | Direcciones distintas que invocan `seal` por primera vez |
| Sorteos anclados por mes | Invocaciones de `draw` |
| Participantes cubiertos | Suma del campo `count` de los sellos |
| Comprobantes abiertos | No medible sin servidor, y el producto no tiene: **se dice que no se mide** |

## El presupuesto

**No pedir el máximo.** El handbook es explícito: *"Requesting the maximum award amount is not expected. Proposals that overreach in cost relative to their scope often perform poorly in review and voting."* En la ronda 44, SAFU ganó con treinta mil y VRF-Soroban con cincuenta mil.

**Pedir entre treinta y sesenta mil dólares.** Y ojo con un problema conceptual: el fondo no reembolsa trabajo hecho, y el contrato, el protocolo, el sitio y los seis juegos ya están. Los tres tramos tienen que mirar hacia adelante y no ser relleno.

Esqueleto propuesto:

**Tramo 1, MVP.** Extraer la verificación de drand como librería independiente, publicada como crate de Rust y como paquete de npm, con documentación, para que cualquier contrato Soroban pueda verificar quicknet sin montar un oráculo. Más un SDK para organizadores.

**Tramo 2, testnet.** El modelo de amenazas y el plan de monitoreo en la cadena, que son requisito obligatorio de este tramo. Sorteos con varios ganadores y con pesos. **La herramienta de enumeración pública de sellos por dirección**, que es la defensa contra el ataque de selección de compromiso. Pruebas de carga con listas de diez mil.

**Tramo 3, mainnet.** El despliegue, los comprobantes permanentes, los sorteos reales con comunidades identificadas y la documentación unificada.

Cada entregable con su costo y con la forma en que el revisor comprueba que está hecho.

## Lo que hay que preguntar antes de postular

1. **A communityfund@stellar.org:** ¿un sorteo sin apuesta, sin boleto pago y sin custodia de fondos cae bajo la cláusula de juego de azar? Guardar la respuesta.
2. **A communityfund@stellar.org:** ¿Bolivia está en la lista de jurisdicciones con restricciones adicionales de la cláusula 2A? Esa lista no es pública, y si lo está, el tramo 3 no podría ser mainnet.
3. **A events@meridian.stellar.org:** ¿hay pitch, demo day o mesa de proyectos en Meridian 2026? La agenda completa todavía no está publicada.
4. **A StarMaker LATAM:** ¿pueden referir a alguien de Bolivia para un Instaward, aunque no haya capítulo boliviano activo?

## Las preguntas difíciles y sus respuestas

**"Ya financiamos VRF-Soroban hace dos meses."**
Son capas distintas. Ellos venden la primitiva y hay que confiar en que su oráculo esté vivo; Tinkazo no opera nada y la prueba es la firma del propio faro. Si conviene, también se puede consumir el oráculo de ellos, pero entonces el sorteo depende de que ese oráculo funcione, y hoy no depende de nadie.

**"¿Esto no promueve el juego de azar?"**
La defensa está más arriba. Contestarla sin que la pregunten.

**"¿Qué impide que el organizador selle cinco listas y publique solo la que le conviene?"**
Nada lo impide técnicamente, y es el borde real del diseño. Las defensas son dos y las dos son verificables: todos los sellos son públicos bajo la dirección del organizador y cualquiera puede enumerarlos, y el identificador del sorteo se anuncia antes de que exista la semilla. El tramo 2 incluye la herramienta de enumeración para que la defensa no dependa de que alguien sepa buscarla. **Decir esto sin que lo pregunten es lo que hace ver serio a un proyecto.**

**"¿Por qué Stellar y no otra cadena?"**
Porque desde el protocolo 22, CAP-0059 trae BLS12-381 y hash-to-curve como funciones nativas del host, y la verificación de la firma cuesta 0,003 XLM. Sin esas primitivas el mismo emparejamiento cuesta órdenes de magnitud más o directamente no entra en el presupuesto de gas. No es preferencia: es el único lugar donde el número cierra.

**"¿Por qué no usar el hash del ledger, que es gratis?"**
Porque un validador puede influir en el margen, y porque no queda una firma que un tercero pueda verificar años después contra una clave pública fija. El propio SDK de Soroban documenta que su generador no sirve para trabajo sensible a la seguridad.

**"¿Cuántos usuarios tenés?"**
Hoy, ninguno fuera del autor, y esa respuesta hunde la postulación. Por eso Lisboa.

**"¿De qué vive el proyecto?"**
No hay ingresos hoy. El núcleo queda como bien público con licencia MIT; lo que se podría cobrar es la versión gestionada para organizaciones grandes, la marca blanca y el soporte de eventos. Decir "todavía no sé" es aceptable si se dice **cómo se va a averiguar y cuándo**.

**"El proyecto tiene cuatro días. ¿Qué garantiza que no lo abandonás?"**
El contrato es inmutable y no tiene administrador, así que sigue funcionando sin que nadie lo mantenga. El sitio es estático, así que no hay servidor que pagar. Y si el autor se aburre, el sorteo de alguien sigue siendo verificable, porque no hay nada que apagar.

## Lo que no se pudo verificar

No afirmar nada de esto sin comprobarlo primero.

- Los resultados de la ronda 45. El voto cerró el 13 de septiembre y todavía no hay recap publicado.
- Las fechas de la ronda 47. La cadencia dice seis semanas pero el salto de la 45 a la 46 fue de doce.
- El pozo de premios y los criterios del jurado de HackMeridian. La web dice "coming soon".
- Si hay pitch o demo day en Meridian.
- Si Bolivia está en la lista de jurisdicciones restringidas. La lista no es pública.
- Si StarMaker Bolivia es un capítulo oficial reconocido.
- El monto del Audit Bank.
- El informe trimestral "What to Build on Stellar", que marca las prioridades del ecosistema y es literalmente el brief. **Leerlo cuando salga, antes de escribir la postulación.**

## Fuentes

Handbook: https://stellar.gitbook.io/scf-handbook · Reglas oficiales: https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions · Open Track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track · Rondas y fechas: https://communityfund.stellar.org/awards · Meridian: https://meridian.stellar.org · HackMeridian: https://www.hackmeridian.com · VRF-Soroban: https://github.com/NibrasD/Stellar-VRF
