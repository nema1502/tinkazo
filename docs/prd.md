---
title: Tinkazo
status: draft
created: 2026-09-16
updated: 2026-09-16
stakes: lanzamiento (código libre, repo público)
mode: fast path, redactado a partir de la idea original y el demo existente; las inferencias llevan [ASSUMPTION]
---

# PRD: Tinkazo

*Sorteos que no se pueden arreglar.*

## 0. Propósito del documento

Este PRD define qué construye Tinkazo en su versión sobre Stellar. Lo leen quien desarrolla (humano o agente), quien diseña la arquitectura ([architecture.md](architecture.md)) y quien parte el trabajo en historias ([epics.md](epics.md)). El vocabulario del Glosario es obligatorio en todos los documentos derivados. Los requisitos funcionales (FR) tienen numeración global y estable. Las inferencias no confirmadas por el autor llevan la etiqueta `[ASSUMPTION]` y se indexan al final.

Parte de dos insumos: la idea original concebida para el ideathon de Arkiv ([idea-original-arkiv.md](idea-original-arkiv.md)) y el demo estático en producción en [tinkazo.vercel.app](https://tinkazo.vercel.app), que ya resuelve carga de lista, sello local, semilla de drand y dos juegos.

## 1. Visión

Toda comunidad hace sorteos: libros, licencias, entradas, swag. Las herramientas que existen son de pago por algo trivial, o gratis y "confía en mí": nadie puede probar que el organizador no agregó un nombre a último minuto ni que el resultado no estaba elegido de antemano.

Tinkazo separa el show de la verdad. El show es una carrera de llamas o una ruleta en pantalla grande. La verdad es matemática: la lista de participantes se sella con un hash antes de que exista la semilla; la semilla la publica un faro público de aleatoriedad que nadie controla; el ganador es una función determinista de ambos. Con Stellar, el sello y el resultado quedan anclados en una red pública con timestamp, y un contrato verifica por sí mismo la firma del faro. Ya no hay que confiar en Tinkazo: cualquiera puede leer la cadena y recomputar.

La verificación es gratis siempre. Anclar en Stellar cuesta centavos y lo paga el organizador. Los participantes nunca crean cuenta ni wallet.

## 2. Usuario

### 2.1 Personas

- **Organizadora de comunidad ("Vale").** Organiza meetups de tecnología en Santa Cruz. Cierra cada evento con un sorteo de libros o licencias. Usa Luma para inscripciones y un proyector. Tiene una wallet de Stellar o puede instalar Freighter en cinco minutos. Quiere que el sorteo se vea bien y que nadie le discuta el resultado.
- **Participante escéptico ("Rodrigo").** Asistió al evento, no ganó, y quiere saber si el sorteo fue limpio. No tiene wallet ni quiere una. Tiene un celular y puede escanear un QR.
- **Auditor externo ("Ana").** Semanas después, alguien que no estuvo en el evento quiere comprobar el resultado a partir de la lista publicada. Puede ser una sponsor, otra comunidad o una persona técnica.

### 2.2 Trabajos por hacer

- Cargar la lista sin transcribir nombres a mano (pegar o CSV; integraciones con Luma y Eventbrite en v2).
- Cerrar la lista de forma que no se pueda alterar después, y que eso sea demostrable.
- Obtener una semilla aleatoria que ni el organizador ni Tinkazo puedan elegir.
- Mostrar el resultado como espectáculo en pantalla grande.
- Dejar un comprobante que cualquiera pueda verificar sin pedir permiso ni tener cuenta.

### 2.3 No usuarios (v1)

- Loterías con dinero en juego, apuestas o cualquier sorteo con premios en efectivo. Tinkazo es para sorteos comunitarios de bienes y servicios.
- Empresas que necesitan white label o cumplimiento regulatorio. Eso es v2 o posterior.

### 2.4 Recorridos clave

**UJ-1. Vale sella y sortea en vivo, anclado en Stellar.**
Vale, en el cierre de un meetup con 60 asistentes y un proyector, abre Tinkazo en su laptop con Freighter instalado. Pega la lista exportada de Luma, escribe el premio, elige "1 ganador" y pulsa **Sellar en Stellar**. Freighter le pide firmar una transacción; la app le muestra el hash de la lista, la ronda objetivo del faro y el enlace al explorador. Una cuenta regresiva de 45 segundos indica cuándo nace la semilla. Al llegar a cero, pulsa **Sortear**: la app trae la firma del faro, la envía al contrato, el contrato la verifica y registra el ganador. La carrera de llamas arranca en pantalla completa y la llama ganadora cruza la meta. El QR en pantalla lleva a la página de verificación. **Edge case:** si Freighter está en la red equivocada, la app lo dice antes de firmar y no envía nada.

**UJ-2. Rodrigo verifica desde el celular.**
Rodrigo escanea el QR. Sin cuenta ni wallet, ve en su celular: la lista sellada con su nombre, el hash, la ronda del faro con enlace a drand, el ganador y un veredicto "Verificado: el resultado coincide con la cadena y con el faro". Puede tocar "Recomputar aquí" y el navegador rehace el cálculo delante de él. **Edge case:** si la lista no coincide con el hash sellado, el veredicto es rojo y explica qué falló.

**UJ-3. Vale sortea en modo libre, sin wallet.**
En un evento chico sin conexión estable, Vale usa Tinkazo sin conectar wallet. La lista se sella localmente, la semilla viene del faro, el navegador verifica la firma del faro y el juego corre igual. El comprobante aclara que este sorteo no fue anclado en Stellar. Todo sigue siendo recomputable.

**UJ-4. Ana audita un mes después.**
Ana recibe el enlace de comprobante. Abre la página de verificación, que lee el registro del contrato en Stellar, la ronda del faro en drand y la lista publicada en el enlace, y recomputa el ganador. No necesita a Tinkazo en línea para confiar: el documento de protocolo le permite rehacer todo con sus propias herramientas.

## 3. Glosario

- **Sorteo**, Un evento de selección aleatoria sobre una Lista canónica, con uno o más Ganadores. Tiene un `id` numérico en el Contrato.
- **Lista canónica**, La lista de Participantes normalizada según el Protocolo: una línea por nombre, recortada, sin líneas vacías ni duplicados exactos, en el orden de entrada.
- **Sello**, El hash SHA-256 de la Lista canónica (`list_hash`) junto con su cantidad de entradas (`count`). Compromete la lista antes de que exista la Semilla.
- **Faro**, El servicio público de aleatoriedad drand, cadena *quicknet*: publica cada 3 segundos una firma BLS sobre el número de ronda.
- **Ronda objetivo**, La ronda del Faro elegida al sellar, siempre en el futuro respecto al momento del Sello.
- **Semilla**, La aleatoriedad de la Ronda objetivo: `sha256(firma)`, igual al campo `randomness` que publica drand.
- **Selección**, El algoritmo determinista del Protocolo que deriva los índices ganadores a partir de Semilla, `list_hash` y `count`.
- **Registro**, El resultado del Sorteo guardado en el Contrato: ronda, firma, Semilla, índices ganadores y momento.
- **Contrato**, El contrato Soroban de Tinkazo en Stellar. Guarda Sellos y Registros y verifica la firma del Faro.
- **Anclaje**, Un Sorteo cuyo Sello y Registro viven en el Contrato. Lo opuesto es **Modo libre**: el mismo Protocolo, sin Contrato, sellado en el navegador.
- **Organizador**, Quien crea el Sorteo. En Anclaje, la cuenta de Stellar que firma el Sello.
- **Participante**, Cada entrada de la Lista canónica. Nunca necesita cuenta ni wallet.
- **Verificador**, Cualquier persona o programa que recomputa el resultado. No necesita permiso.
- **Comprobante**, El enlace o archivo que contiene lo necesario para verificar: `id` del Sorteo, dirección del Contrato, red y Lista canónica.
- **Protocolo**, La especificación normativa en [protocolo.md](protocolo.md). Versión actual: v2.
- **Show**, La presentación visual del resultado: carrera de llamas (modo estadio) o ruleta. No influye en el resultado.

## 4. Funcionalidades

### 4.1 Carga de participantes

**Descripción:** El Organizador pega nombres o sube un CSV. La app muestra la lista con avatares y la cuenta. Realiza UJ-1 y UJ-3. Se conserva el comportamiento del demo actual.

#### FR-1: Pegar lista
El Organizador puede pegar texto con un Participante por línea y ver la Lista canónica resultante.
- Consecuencias: se recortan espacios, se descartan líneas vacías o de un solo carácter, se descartan duplicados exactos conservando el primero; el contador muestra `count`.

#### FR-2: Subir CSV
El Organizador puede subir un archivo CSV y la primera columna se toma como nombre.
- Consecuencias: mismo resultado que FR-1 tras la normalización; archivos sin nombres válidos dejan el botón de sellar deshabilitado.

#### FR-3: Umbral mínimo
El Sello solo se habilita con `count >= 2` y `1 <= ganadores <= min(count, 32)`.

### 4.2 Sello en Stellar

**Descripción:** Con wallet conectada, el Organizador sella la lista en el Contrato. La transacción registra `list_hash`, `count`, cantidad de ganadores, Ronda objetivo y un texto corto (premio o título). Realiza UJ-1.

#### FR-4: Conectar wallet
El Organizador puede conectar Freighter y ver su dirección abreviada y la red activa.
- Consecuencias: si la red de la wallet no coincide con la configurada en la app, se muestra el aviso y se bloquea el Sello; si Freighter no está instalado, se muestra el enlace de instalación y el Modo libre sigue disponible.

#### FR-5: Sellar
El Organizador puede firmar una transacción que llama a `seal` con la Lista canónica ya hasheada.
- Consecuencias: la app calcula la Ronda objetivo como la primera ronda cuyo tiempo de publicación es al menos 45 segundos posterior al momento actual `[ASSUMPTION: 45 s da margen sobre los 30 s que exige el Contrato]`; el Contrato rechaza rondas que ya existan o que estén a más de 30 días; al confirmarse, la app muestra `id`, `list_hash`, ronda, hash de transacción y enlace a stellar.expert.

#### FR-6: Estado del Sello
Tras sellar, la lista y el premio quedan bloqueados en la interfaz y se muestra una cuenta regresiva hasta la Ronda objetivo.

#### FR-7: Solo el Organizador sella
El Contrato exige la autorización de la cuenta que figura como Organizador del Sorteo.

#### FR-8: Texto del Sorteo
El Organizador puede adjuntar un texto de hasta 160 caracteres (premio o título) que queda en el Contrato.

### 4.3 Semilla pública y sorteo

**Descripción:** Cuando la Ronda objetivo existe, la app obtiene la firma del Faro y la envía al Contrato. El Contrato verifica la firma BLS contra la clave pública de quicknet, deriva la Semilla y ejecuta la Selección. Realiza UJ-1.

#### FR-9: Obtener la ronda
La app puede obtener la firma de la Ronda objetivo desde al menos dos relays de drand, con reintento.
- Consecuencias: si ningún relay responde, se informa y se permite reintentar sin perder el Sello.

#### FR-10: Sortear en el Contrato
Cualquier cuenta puede enviar la firma al Contrato con `draw`; el Contrato verifica la firma on-chain y registra el resultado.
- Consecuencias: una firma inválida se rechaza con error `InvalidSignature`; una llamada anterior al tiempo de la ronda se rechaza con `RoundNotReady`; un Sorteo ya registrado se rechaza con `AlreadyDrawn`; el Registro contiene la Semilla igual a `randomness` de drand y los índices ganadores según el Protocolo.

#### FR-11: Selección determinista
Los índices ganadores se derivan exactamente como indica el Protocolo v2, sin repetidos, y el mismo algoritmo produce el mismo resultado en el Contrato (Rust) y en el navegador (TypeScript).
- Consecuencias: existen vectores de prueba compartidos que ambas implementaciones pasan.

#### FR-12: Sorteo sin permiso
`draw` no exige autorización del Organizador: cualquiera puede finalizar un Sorteo cuya ronda ya existe.
- Consecuencias: el Organizador no puede retener el resultado; la app lo usa también para "reanudar" un Sorteo interrumpido.

#### FR-13: Múltiples ganadores
El Organizador puede pedir de 1 a 32 ganadores; el Registro guarda todos en orden de selección.

### 4.4 Show

**Descripción:** Se conservan los dos juegos del demo: carrera de llamas en modo estadio (con narrador, sonido y cámara) y ruleta para hasta 24 participantes. La animación se siembra con la Semilla para que hasta el recorrido sea reproducible. Realiza UJ-1 y UJ-3.

#### FR-14: Carrera de llamas
El resultado se presenta como carrera en pantalla completa donde la llama del Ganador cruza primero la meta.

#### FR-15: Ruleta
Para `count <= 24`, el resultado puede presentarse como ruleta que se detiene en el Ganador.

#### FR-16: Revelación
Al terminar el Show se muestran las tarjetas de Ganadores, el resumen del Registro, el enlace a la ronda del Faro y el QR del Comprobante.

### 4.5 Verificación pública

**Descripción:** Una página de solo lectura recompone el Sorteo desde la cadena, el Faro y la Lista canónica publicada, y emite un veredicto. Realiza UJ-2 y UJ-4.

#### FR-17: Comprobante
Tras el Sello, la app genera un Comprobante como enlace que incluye red, dirección del Contrato, `id` y la Lista canónica comprimida, y permite descargarlo como JSON.

#### FR-18: Página de verificación
Cualquier Verificador puede abrir el Comprobante sin wallet y ver el Sello y el Registro leídos del Contrato, la ronda del Faro y la Lista canónica.

#### FR-19: Veredicto
La página recomputa `list_hash`, verifica la firma del Faro en el navegador, ejecuta la Selección y compara con el Registro.
- Consecuencias: veredicto verde solo si las cuatro comprobaciones coinciden; ante cualquier discrepancia, veredicto rojo con el paso que falló; si el Sorteo aún no tiene Registro, la página lo indica y ofrece finalizarlo (FR-12).

#### FR-20: Enlaces externos
La página enlaza al Contrato y a las transacciones en stellar.expert y a la ronda en drand.

#### FR-21: Recomputar a mano
La página documenta los pasos del Protocolo con los valores concretos del Sorteo para que un Verificador técnico pueda rehacerlos con otras herramientas.

### 4.6 Modo libre

**Descripción:** Sin wallet, Tinkazo funciona como hoy: Sello en el navegador, Semilla del Faro, Show y Comprobante local. Realiza UJ-3.

#### FR-22: Sorteo sin Anclaje
El Organizador puede sellar y sortear sin conectar wallet, usando la ronda más reciente del Faro tras el Sello.
- Consecuencias: el Comprobante indica "sin anclaje en Stellar"; el navegador verifica la firma BLS de la ronda antes de mostrar el resultado.

#### FR-23: Actualizar a Anclaje
`[ASSUMPTION: útil pero no bloqueante]` Un Sorteo en Modo libre no puede convertirse en Anclaje después del hecho, y la interfaz lo explica.

### 4.7 Bilingüe y accesible

#### FR-24: ES / EN
Toda cadena visible existe en español e inglés; el idioma se elige con el conmutador o con `?lang=`.

#### FR-25: Modo claro y oscuro
La interfaz respeta `prefers-color-scheme` y permite forzar el tema.

#### FR-26: Catálogo de juegos
El organizador elige entre varios juegos para mostrar el resultado. Ninguno calcula nada: reciben el ganador ya fijado por el Protocolo. Cada juego pasa las 20 comprobaciones del auditor antes de entrar, incluidas cuatro que lo miran en un celular, y la segunda de esas comprobaciones ·que el nombre en pantalla sea el que fijó el Protocolo· no se negocia. Cuando hay varios premios, el juego anuncia a todos, no sólo al primero: mostrar un nombre de tres es mentir sobre lo que acaba de pasar.

#### FR-27: El narrador habla
El relato del sorteo se dice en voz alta con la voz del navegador, en el idioma de la página, con el ritmo subiendo según la tensión del momento. Si la máquina no tiene voz instalada, se avisa antes del sorteo y el sorteo funciona igual.

#### FR-28: La tarjeta que enseña
Después de revelar al ganador se muestra una tarjeta que contesta una pregunta sobre lo que el juego acaba de mostrar, con enlace a fuente primaria. Nunca antes del resultado. La tarjeta se elige con la ronda, así que es determinista.

#### FR-29: Columnas de un archivo
Cuando la lista viene de un archivo con varias columnas, el organizador elige cuál tiene los nombres. La lista canónica del Protocolo no cambia: sigue recibiendo un nombre por línea.

#### FR-30: El sorteo se oye y se lee desde el fondo de la sala
El show está hecho para una pantalla grande, con cincuenta personas y nadie interactuando. Todo el sonido sale de osciladores, dentro del rango que reproduce el parlante de un proyector, por encima del murmullo de una sala y en una escala donde cualquier par de notas suena bien junto. Lo que tiene que durar una fase del juego se estira con el selector de duración; lo que le habla a una persona ·la cuenta regresiva y el sostén del cartel del ganador· va en segundos reales, porque lo que tarda alguien en leer un nombre proyectado no cambia porque se elija una duración más larga. **El selector apunta a una cantidad de segundos, no multiplica**: cada juego declara cuánto dura sin estirar, y el mismo botón significa lo mismo en todos. Hay un auditor que lo mide sin oídos.

#### FR-31: La espera se ve
Entre que la lista se sella y que la ronda del faro existe pasan unos segundos, y son el corazón del producto: la lista ya está cerrada y el número que la va a decidir todavía no existe, así que nadie ·tampoco el organizador· puede acomodar el resultado. Eso se muestra: el número de la ronda que falta nacer y los segundos que le quedan.

## Requisitos no funcionales transversales

- **NFR-1 Determinismo verificable.** Todo lo que decide un resultado está en el Protocolo y es recomputable con herramientas públicas; ningún paso depende de un servidor de Tinkazo.
- **NFR-2 Sin servidor.** El sitio es estático (Vercel); no hay backend propio ni base de datos. Las únicas dependencias en tiempo de ejecución son Stellar RPC, relays de drand y la wallet.
- **NFR-3 Costo.** Un Sorteo anclado (Sello + Sorteo) debe costar menos de 0,25 XLM al Organizador. Medido en testnet el 2026-09-16: 0,18 XLM (≈ US$ 0,03), casi todo renta de almacenamiento por 120 días; la verificación BLS en sí cuesta 0,003 XLM. Mantener el Contrato vivo cuesta al proyecto unos 49 XLM al año y nunca se le cobra a un Organizador (ver [deployments.md](deployments.md)).
- **NFR-4 Sin secretos en el repo.** Repositorio público: ninguna llave privada, token ni identidad de la CLI se commitea.
- **NFR-5 Tiempo de sorteo.** Entre "Sellar" y el inicio del Show pasan menos de 90 segundos en condiciones normales.
- **NFR-6 Privacidad.** En la cadena solo va el hash de la lista, nunca los nombres. La lista se publica por decisión del Organizador en el Comprobante.
- **NFR-7 Redes.** El mismo código funciona en testnet y mainnet cambiando configuración; la dirección del Contrato de cada red se documenta en [deployments.md](deployments.md).

## 5. No objetivos

- No custodiamos wallets ni llaves de nadie. No hay "cuenta Tinkazo".
- No hay backend, panel de administración ni base de datos.
- No hay dinero ni tokens en juego: el Contrato no mueve fondos.
- No hay integración con Luma, Eventbrite o Meetup en v1.
- No hay sponsor mode, white label ni cobro en v1.
- No hay login con Google ni Clerk en la versión Stellar: la identidad del Organizador es su cuenta de Stellar `[ASSUMPTION: se elimina Clerk; decisión pendiente del autor, ver Preguntas abiertas]`.

## 6. Alcance del MVP

### 6.1 Dentro
- Contrato `seal` / `draw` con verificación BLS de quicknet on-chain, desplegado en testnet y luego mainnet.
- Sitio migrado a build (Vite + TypeScript) conservando la interfaz actual y el Modo libre.
- Protocolo v2 implementado en Rust y TypeScript con vectores compartidos.
- Conexión con Freighter, Sello, cuenta regresiva y Sorteo desde la interfaz.
- Página de verificación con veredicto y Comprobante con lista embebida.
- Documentación: README, protocolo, despliegues.

### 6.2 Fuera del MVP
- Importación desde Luma / Eventbrite (v2: es el motor de adopción, pero requiere claves de API por Organizador).
- Wallets adicionales vía Stellar Wallets Kit y cuentas con passkeys más relayer sin gas (v2: quita la fricción de Freighter).
- Lista opcional en la cadena para Sorteos chicos (v2: comprobante autocontenido, a cambio de exponer nombres). `[NOTE FOR PM]` Emocionalmente importante para la narrativa "todo en la cadena"; revisar tras medir costos.
- Sponsor mode y branding.
- Avatares generados con IA y otros juegos.

## 7. Métricas de éxito

**Primarias**
- **SM-1** Sorteos anclados en mainnet por comunidades distintas de la del autor en los primeros 90 días tras el lanzamiento: objetivo 10. Valida FR-5, FR-10.
- **SM-2** Verificaciones abiertas desde QR o Comprobante por Sorteo anclado: objetivo mediana ≥ 3. Valida FR-17 a FR-19.

**Secundarias**
- **SM-3** Costo real por Sorteo anclado en mainnet ≤ 0,1 XLM. Valida NFR-3.
- **SM-4** Cero discrepancias entre Contrato y navegador en los vectores del Protocolo. Valida FR-11.

**Contramétricas**
- **SM-C1** Proporción de Sorteos en Modo libre. No minimizar: el Modo libre es el embudo gratuito y la promesa de que la verificación nunca se cobra. Contrapesa SM-1.
- **SM-C2** Tiempo entre Sello y Show. No optimizar por debajo de 30 segundos: el margen es lo que hace imposible elegir la ronda. Contrapesa NFR-5.

## 8. Preguntas abiertas

1. **Clerk.** ¿Eliminar el login de Clerk en la versión Stellar? Recomendación: sí; la wallet es la identidad del Organizador y Clerk es una dependencia externa con instancia de desarrollo. Decide el autor.
2. ~~**Costo de la verificación BLS.**~~ Resuelto el 2026-09-16: `draw` con `pairing_check` cuesta 0,083 XLM en testnet y la parte de cómputo es 0,003 XLM. No hace falta el plan B.
3. **Lista en la cadena.** ¿Ofrecer la opción para Sorteos de hasta 50 nombres? Diferido a v2.
4. **Mutabilidad del Contrato.** Se propone inmutable (sin admin ni `upgrade`): cada versión es un nuevo contrato y los Comprobantes llevan la dirección. Confirmar.
5. **Cuenta de despliegue en mainnet.** ¿Qué cuenta despliega y quién guarda esa llave? Debe quedar en [deployments.md](deployments.md) antes del despliegue.

## 9. Índice de supuestos

- §4.2 FR-5, Margen de 45 s en la app frente a 30 s mínimos del Contrato.
- §4.6 FR-23, No convertir Modo libre a Anclaje después del hecho.
- §Requisitos no funcionales NFR-3, Confirmado con medición: 0,18 XLM por Sorteo en testnet; el umbral pasó de 0,1 a 0,25 XLM porque la renta de 120 días domina el costo.
- §5, Se elimina Clerk en la versión Stellar.
- §4, Se agregan FR-26 a FR-29 (2026-09-20): catálogo de juegos, narrador con voz, tarjeta que enseña y selección de columna. Los cuatro salieron de usar el producto, no de planificarlo.
- §4, Se agrega FR-31 (2026-09-20): la espera se ve. Salió de notar que el mejor momento del producto estaba contado en una etiqueta de un botón deshabilitado.
- §4, Se agrega FR-30 (2026-09-20): el sorteo se oye y se lee desde el fondo de la sala. Salió de una auditoría de experiencia que midió cada oscilador y cada línea del narrador, y encontró golpes de clímax que ningún parlante reproduce, sesenta y seis notas por debajo del murmullo y un juego que colgaba la pestaña.
- §Requisitos no funcionales, La espera entre sellar y sortear baja de 45 a 10 segundos en Modo libre (2026-09-20). Lo que la propiedad necesita es que la ronda esté en el futuro al sellar, y quicknet publica una cada tres segundos. Con Anclaje sigue en 45 porque el Contrato exige 30 de margen y es inmutable.
