---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['docs/prd.md', 'docs/architecture.md', 'docs/protocolo.md']
status: approved-draft
updated: 2026-09-16
---

# Tinkazo - Épicas e historias

## Resumen

Descomposición del [PRD](prd.md) y la [Arquitectura](architecture.md) en historias implementables por una sesión de desarrollo cada una. Cada épica entrega valor por sí sola y habilita las siguientes sin depender de ellas. El estado se marca en el título de cada historia: **hecho**, **en curso** o sin marca (pendiente).

## Inventario de requisitos

### Funcionales

FR-1 Pegar lista · FR-2 Subir CSV · FR-3 Umbral mínimo · FR-4 Conectar wallet · FR-5 Sellar · FR-6 Estado del sello · FR-7 Solo el organizador sella · FR-8 Texto del sorteo · FR-9 Obtener la ronda · FR-10 Sortear en el contrato · FR-11 Selección determinista · FR-12 Sorteo sin permiso · FR-13 Múltiples ganadores · FR-14 Carrera de llamas · FR-15 Ruleta · FR-16 Revelación · FR-17 Comprobante · FR-18 Página de verificación · FR-19 Veredicto · FR-20 Enlaces externos · FR-21 Recomputar a mano · FR-22 Sorteo sin anclaje · FR-23 Actualizar a anclaje (no) · FR-24 ES/EN · FR-25 Tema claro/oscuro.

### No funcionales

NFR-1 Determinismo verificable · NFR-2 Sin servidor · NFR-3 Costo < 0,1 XLM · NFR-4 Sin secretos en el repo · NFR-5 < 90 s de sello a show · NFR-6 Solo el hash en la cadena · NFR-7 Testnet y mainnet por configuración.

### Adicionales (arquitectura)

A-1 Vectores cruzados Rust/TS en `docs/vectors.json` · A-2 Adaptador de wallet intercambiable · A-3 Direcciones de contrato en `deployments.ts` + `deployments.md` · A-4 CI con `cargo test`, build WASM, `pnpm test` y `pnpm build` · A-5 Contrato inmutable · A-6 Toda cadena visible en ES y EN.

### Mapa de cobertura

| FR | Épica |
|---|---|
| FR-1, FR-2, FR-3 | 2 |
| FR-4, FR-5, FR-6, FR-8 | 3 |
| FR-7, FR-10, FR-11, FR-12, FR-13 | 1 (contrato) y 3 (interfaz) |
| FR-9 | 2 (modo libre) y 3 (anclaje) |
| FR-14, FR-15, FR-16 | 2 |
| FR-17, FR-18, FR-19, FR-20, FR-21 | 4 |
| FR-22, FR-23 | 2 |
| FR-24, FR-25 | 2 (y regla A-6 en todas) |
| FR-26 | 7 |
| FR-27 | 9 |
| FR-28 | 8 |
| FR-29 | 2 (la lista canónica no cambia: la columna se elige antes) |
| NFR-3, NFR-7 | 1 y 5 |
| D-07 (Pollar) | 6 |

## Lista de épicas

### Épica 1: Contrato de sorteos verificables
El organizador compromete una lista y cualquiera finaliza el sorteo con la firma del faro, verificada en la cadena. **FRs:** 7, 10, 11, 12, 13. NFR-1, 3, 7.

### Épica 2: Sitio con protocolo v2 y modo libre verificable: hecha
El sitio pasó a Vite con pnpm, adoptó quicknet y el protocolo v2, verifica la firma del faro en el navegador y emite comprobantes. **FRs:** 1, 2, 3, 9, 11, 14, 15, 16, 22, 23, 24, 25. NFR-2.

### Épica 3: Anclaje en Stellar desde la interfaz: hecha
El organizador conecta su wallet, sella y sortea en el contrato desde la pantalla, con cuenta regresiva, costo a la vista antes de firmar y show. **FRs:** 4, 5, 6, 7, 8, 9, 10, 12, 13. NFR-5, 6.

### Épica 4: Verificación pública: hecha
Cualquiera abre el comprobante, ve el sello y el registro leídos de la cadena y obtiene un veredicto recomputado en su navegador, y puede finalizar un sorteo que quedó pendiente. **FRs:** 17, 18, 19, 20, 21.

### Épica 5: Lanzamiento a mainnet
Contrato en mainnet con checklist de despliegue, documentación final y distribución en el ecosistema. NFR-3, 7.

### Épica 7: Catálogo de juegos: seis juegos, todos aprobados
El show es lo único que se personaliza y lo que hace que una comunidad elija Tinkazo sobre una ruleta cualquiera. Cada juego nuevo pasa el auditor de `docs/juegos.md` antes de entrar.

### Épica 8: Que el juego enseñe: hecha
Después del ganador aparece una tarjeta que contesta la pregunta que el juego deja picando, con fuente primaria. Es lo que convierte un sorteo en un minuto de divulgación sobre Stellar, sin frenar nada.

### Épica 9: El narrador habla: hecha
La voz usa la API del navegador, elige una voz en español de verdad instalada y sube el ritmo con la tensión. Sin voz en la máquina, el sorteo funciona igual.

### Épica 6: Entrar con Google sin instalar nada: hecha, el login ya se probó con una cuenta real
El organizador entra con Google y sella sin instalar wallet. Decisión D-07. El relayer resultó innecesario: la cuenta custodial de Pollar firma y envía la invocación por su cuenta.

---

## Épica 1: Contrato de sorteos verificables

Un contrato Soroban inmutable que guarda sellos y registros, verifica la firma BLS de quicknet y selecciona ganadores de forma determinista.

### Historia 1.1: Sellar una lista: hecho

Como organizador,
quiero comprometer el hash de mi lista, la cantidad de entradas, los ganadores y una ronda futura,
para que nadie (ni yo) pueda cambiar la lista después de conocer la semilla.

**Criterios de aceptación:**

**Dado** un organizador que autoriza la llamada
**Cuando** llama `seal` con `count ≥ 2`, `1 ≤ num_winners ≤ min(count, 32)`, `meta ≤ 160` y una ronda cuyo `round_time` está entre 30 s y 30 días después del ledger
**Entonces** el contrato guarda el `Raffle` con `status = Sealed`, `sealed_at` y `sealed_ledger`, devuelve un `id` secuencial desde 1 y emite `sealed`
**Y** rechaza con `TooFewEntries`, `BadWinnerCount`, `MetaTooLong`, `RoundTooSoon` o `RoundTooFar` cada violación
**Y** la autorización del organizador es obligatoria.

### Historia 1.2: Registrar el resultado con la firma de quicknet verificada: hecho

Como participante,
quiero que el contrato solo acepte la firma auténtica de la ronda comprometida y derive de ella los ganadores,
para que el resultado no dependa de confiar en el organizador ni en Tinkazo.

**Criterios de aceptación:**

**Dado** un sorteo sellado y `ledger_ts ≥ round_time(round)`
**Cuando** cualquiera llama `draw(id, firma G1 de 96 bytes)`
**Entonces** el contrato verifica `e(sig, G2) = e(H(sha256(be64 round)), PK_quicknet)` y, si falla, devuelve `InvalidSignature`
**Y** si verifica, comprime la firma, calcula `randomness = sha256(sig48)` igual al de drand, ejecuta la selección del protocolo §5 y guarda el `Draw` con `status = Drawn`, emitiendo `drawn`
**Y** rechaza `RoundNotReady` antes de tiempo, `AlreadyDrawn` en una segunda llamada y `NotFound` para ids inexistentes
**Y** el test usa la ronda real 32254977 y reproduce los índices de `docs/vectors.json`.

### Historia 1.3: Consultas, TTL y utilidades: hecho

Como verificador,
quiero leer el sello y el registro por id, renovar su vigencia y calcular rondas,
para poder auditar meses después sin depender de Tinkazo.

**Criterios de aceptación:**

**Dado** un sorteo existente
**Cuando** llamo `get_raffle`, `get_draw`, `next_id`, `extend`, `round_at` o `round_time`
**Entonces** obtengo los datos sin autorización, `extend` renueva el TTL de sorteo y registro y devuelve `NotFound` si el id no existe
**Y** los TTL se extienden a 120 días cuando bajan de 60 en cada escritura.

### Historia 1.4: Desplegar en testnet y medir: hecho

Resultado (2026-09-16): contrato `CD2SSHBU…RENH` en testnet; sorteo real `id=1` contra la ronda 32255926 con `seal` (0,099 XLM), `draw` (0,083 XLM) y `extend` (15,15 XLM por la renta del código). La primera versión desplegada cobraba la renta del código dentro de `seal`; se corrigió y redesplegó el mismo día. Detalle en [deployments.md](deployments.md).

Como equipo,
quiero el contrato desplegado en testnet con un sorteo real ejecutado por CLI y su costo medido,
para validar NFR-3 y tener una dirección estable para el frontend.

**Criterios de aceptación:**

**Dado** el WASM compilado con `stellar contract build`
**Cuando** ejecuto `scripts/deploy.sh testnet` con una identidad de la CLI que no está en el repo
**Entonces** el script despliega, imprime la dirección `C…` y agrega a `docs/deployments.md` fecha, red, dirección, hash del WASM, commit y cuenta de despliegue
**Y** un `seal` y un `draw` reales contra una ronda futura de quicknet terminan en éxito y quedan documentados con sus hashes de transacción
**Y** `stellar contract invoke --send=no` reporta el costo de `draw`; si el fee de `seal + draw` supera 0,1 XLM equivalente, se abre la brecha del plan B de D-02
**Y** la dirección se agrega a `src/stellar/deployments.ts` (o a un JSON provisional si la épica 2 no empezó).

### Historia 1.5: Integración continua del contrato: hecho (primera corrida en verde)

Como mantenedor,
quiero que cada push ejecute los tests y compile el WASM,
para que una regresión en la matemática no llegue a `main` sin aviso.

**Criterios de aceptación:**

**Dado** un push o pull request
**Cuando** corre `.github/workflows/ci.yml`
**Entonces** `cargo test --workspace` y `cargo build --release --target wasm32v1-none` pasan y el tamaño del WASM queda en el log.

---

## Épica 2: Sitio con protocolo v2 y modo libre verificable

### Historia 2.1: Migrar el sitio a Vite, TypeScript y pnpm con paridad visual: hecho

Resultado (2026-09-16): `index.html` es la entrada de Vite 8; el CSS vive en `src/styles.css` y el JavaScript en módulos TypeScript 7 (`src/i18n.ts`, `src/state.ts`, `src/ui/*`, `src/games/*`, `src/protocol/legacy-v1.ts`). Clerk retirado. Verificado con Chrome headless: idioma por URL, demo de ruleta y de carrera con drand real, tema oscuro. El algoritmo sigue siendo el v1 hasta la historia 2.2.

Como organizadora,
quiero que Tinkazo siga viéndose y funcionando igual mientras el código pasa a módulos,
para no perder lo que ya funciona en producción.

**Criterios de aceptación:**

**Dado** el `index.html` actual
**Cuando** se crea `package.json` (pnpm), `vite.config.ts`, `tsconfig.json`, `vercel.json` y el JS inline se mueve a `src/` (juegos, i18n, UI) en TypeScript
**Entonces** `pnpm dev` sirve el sitio, `pnpm build` genera `dist/` y Vercel despliega desde el repo
**Y** las capturas de referencia (landing, ruleta, estadio, modo oscuro, EN) se reproducen sin diferencias visibles
**Y** Clerk se retira del HTML y del flujo de sellado (D-06) y la decisión queda anotada en el commit.

### Historia 2.2: Protocolo v2 en TypeScript con vectores cruzados

Como verificador,
quiero que el navegador calcule la lista canónica y la selección exactamente como el contrato,
para que ambos lleguen al mismo ganador.

**Criterios de aceptación:**

**Dado** `docs/vectors.json`
**Cuando** corren los tests de `canonical.ts` y `select.ts` con Vitest
**Entonces** `listHash(SAMPLE)` es `32e2099c…21ef` y `select` reproduce todos los casos del archivo
**Y** la normalización sigue el protocolo §1 (recorte, longitud ≥ 2, duplicados exactos fuera, orden de entrada).

### Historia 2.3: Quicknet en el navegador y modo libre verificable: hecho

Resultado (2026-09-16): el sello elige `targetRound(now + 45 s)`, el botón de sortear muestra la cuenta regresiva, `draw` obtiene la firma rotando relays, la verifica con `@noble/curves` y selecciona con el protocolo v2; el resumen y la prueba muestran ronda, firma verificada, `list_hash` e índices. `?lead=N` acorta la espera en demos. Verificado con `scripts/smoke.mjs` (Chrome headless vía DevTools) contra rondas reales. El texto "sin anclaje en Stellar" y el comprobante llegan con la 2.4.

Como organizadora sin wallet,
quiero sortear con una ronda futura de quicknet cuya firma el navegador verifica,
para que el modo libre también sea honesto.

**Criterios de aceptación:**

**Dado** una lista sellada localmente
**Cuando** pulso "Sortear"
**Entonces** la app elige la ronda `round_at(now + 45 s)`, muestra la cuenta regresiva, obtiene la firma rotando relays con reintentos, la verifica con `@noble/curves` contra la clave de quicknet y solo entonces ejecuta la selección y el show
**Y** una firma inválida o un relay caído producen mensajes claros en ES/EN y permiten reintentar sin perder el sello
**Y** el resumen indica "sin anclaje en Stellar".

### Historia 2.4: Comprobante: hecho

Resultado (2026-09-20): `src/protocol/proof.ts` arma el comprobante y lo comprime con deflate a base64url. Va en el fragmento de la URL, que no viaja al servidor: los nombres nunca salen del navegador de quien abre el enlace. Un sorteo de 18 nombres da un enlace de 500 caracteres. El QR y los avisos al ganador apuntan ahí.

Como participante,
quiero un enlace o archivo que contenga todo lo necesario para recomputar,
para verificar en mi celular sin pedirle nada al organizador.

**Criterios de aceptación:**

**Dado** un sorteo terminado (modo libre)
**Cuando** pulso "Compartir comprobante"
**Entonces** obtengo un enlace a `verificar.html#…` con red (`libre`), lista canónica comprimida (deflate + base64url), ronda y firma, y un botón para descargar el JSON equivalente
**Y** el QR de pantalla apunta a ese enlace.

---

## Épica 3: Anclaje en Stellar desde la interfaz

### Historia 3.1: Conectar wallet y detectar red: hecho

Resultado (2026-09-19): el botón "Conectar wallet" de la cabecera abre un selector con Freighter (con enlace de instalación si no está) y la cuenta de prueba. Al conectar se muestra la red, la dirección abreviada enlazada al explorador y el botón de salir; si la wallet está en otra red aparece el aviso y el anclaje queda bloqueado. El SDK de Stellar se carga con `import()` recién al abrir el selector, así que quien solo sortea en modo libre no descarga esos 500 KB.

Como organizadora,
quiero conectar mi wallet y ver mi dirección y la red,
para sellar con mi identidad.

**Criterios de aceptación:**

**Dado** Stellar Wallets Kit inicializado con la red de `VITE_STELLAR_NETWORK`
**Cuando** pulso "Conectar wallet"
**Entonces** elijo una wallet del modal, veo mi dirección abreviada y la red
**Y** si la wallet está en otra red, veo el aviso y el botón "Sellar en Stellar" queda deshabilitado
**Y** sin wallet instalada, veo el enlace de instalación y el modo libre sigue disponible.

### Historia 3.2: Sellar en Stellar: hecho

Resultado (2026-09-19): el botón pasa a "Sellar en Stellar" con wallet conectada, firma la transacción y muestra cada paso con el enlace al explorador. El margen hasta la ronda se fuerza a 45 s al anclar, porque por debajo de 30 el contrato rechaza el sello.

Como organizadora,
quiero firmar una transacción que registre el sello en el contrato,
para que la lista quede comprometida con timestamp público.

**Criterios de aceptación:**

**Dado** una lista válida, ganadores elegidos y wallet conectada
**Cuando** pulso "Sellar en Stellar"
**Entonces** la app calcula `list_hash`, `count`, la ronda `round_at(now + 45 s)`, construye `seal` con `contract.Client`, simula, pide firma y envía
**Y** al confirmarse muestra `id`, hash, ronda, hora del ledger, enlace a stellar.expert y bloquea lista y premio
**Y** un rechazo de la wallet, falta de XLM o un error del contrato (por código) se muestran en ES/EN sin dejar la pantalla en estado intermedio.

### Historia 3.3: Sortear en Stellar y revelar desde el registro: hecho

Resultado (2026-09-19): `draw` va al contrato, el show usa los índices registrados y, si otro finalizó antes, se lee el registro en vez de fallar. Probado de punta a punta en el navegador con la cuenta de prueba: sorteo #4 en testnet.

Como organizadora,
quiero que al llegar la ronda la app finalice el sorteo en el contrato y el show use el resultado registrado,
para que lo que se ve en pantalla sea exactamente lo que dice la cadena.

**Criterios de aceptación:**

**Dado** un sorteo sellado y la cuenta regresiva en cero
**Cuando** pulso "Sortear"
**Entonces** la app obtiene la firma de la ronda, la descomprime a 96 bytes, llama `draw` (sin autorización), espera confirmación y lee el `Draw`
**Y** el show (carrera o ruleta) se siembra con `randomness` del registro y termina en los índices del registro
**Y** si el sorteo ya fue finalizado por otra persona, la app lo detecta (`AlreadyDrawn`) y pasa directo al show
**Y** al recargar la página con un sello pendiente, la app ofrece reanudar el sorteo por `id`.

### Historia 3.5: Cuenta invitada en testnet: hecho

Resultado (2026-09-19): el navegador genera el par de llaves, lo fondea con friendbot y lo guarda solo en ese dispositivo. Solo se ofrece en testnet. Falta exponer el exportar y borrar la llave en la interfaz.

Como organizadora que quiere probar sin instalar nada,
quiero que Tinkazo me cree una cuenta de Stellar en testnet con un clic,
para sellar y sortear anclado sin wallet ni XLM propios.

**Criterios de aceptación:**

**Dado** la red configurada en testnet y ninguna wallet conectada
**Cuando** pulso "Probar sin wallet"
**Entonces** el navegador genera un par de llaves, lo fondea con friendbot, lo guarda solo en este dispositivo y lo expone por el mismo adaptador de wallet que Freighter
**Y** la interfaz deja claro que es una cuenta de prueba de testnet, ofrece exportar o borrar la llave y no aparece cuando la red configurada es mainnet
**Y** `seal` y `draw` funcionan igual que con una wallet externa.

Justificación: mientras el proyecto viva en testnet, esta es la forma más rápida de demostrar el anclaje a cualquier comunidad. Se decidió el 2026-09-16 como alternativa gratuita a Pollar para esta etapa.

### Historia 3.4: Errores y estados de transacción: hecho

Resultado (2026-09-20): los nueve errores del contrato, más los de wallet, fondos y red, se traducen a mensajes que dicen qué hacer. El costo sale de la simulación y se muestra en el paso de firma, antes de que el organizador apruebe nada.

Como organizadora,
quiero mensajes claros y un estado visible en cada paso,
para saber qué pasó y qué hacer.

**Criterios de aceptación:**

**Dado** cualquier transacción
**Cuando** se construye, simula, firma, envía y confirma
**Entonces** la UI muestra el paso actual, evita doble envío y muestra el hash apenas existe
**Y** los errores de contrato (1 a 9), de red (RPC caído, timeout), de wallet (rechazo, red equivocada, sin fondos) y de drand tienen mensajes propios en ES/EN
**Y** el costo estimado de la simulación se muestra antes de firmar.

---

## Épica 4: Verificación pública

### Historia 4.1: Página de verificación: hecho

Resultado (2026-09-20): `verificar.html` lee el comprobante, rehace el sorteo y da un veredicto. Sin wallet y sin servidor.

Como verificador,
quiero abrir un comprobante y ver el sello, el registro, la ronda y la lista,
para juzgar por mí mismo.

**Criterios de aceptación:**

**Dado** un enlace `verificar.html#…` con red, contrato, id y lista
**Cuando** lo abro sin wallet
**Entonces** la página lee `get_raffle` y `get_draw` por RPC, obtiene la ronda de drand y muestra los cuatro bloques con sus valores
**Y** funciona también para comprobantes de modo libre (sin contrato).

### Historia 4.2: Veredicto y finalización: hecho

Resultado (2026-09-20): **tres veredictos, no dos.** Verde solo cuando el contrato atestigua la huella de la lista. Amarillo en modo libre, donde la cuenta cierra pero nadie garantiza que esa fuera la lista original, porque el comprobante trae lista y firma juntas. Rojo cuando algo no cuadra. Probado: lista manipulada sobre un sorteo anclado da rojo con el motivo exacto. Ese amarillo es justo lo que compra anclar.

La finalización también está: si el sorteo quedó sellado sin sortear y la ronda ya existe, la página ofrece cerrarlo. Como `draw` no pide permiso a nadie, lo puede hacer cualquiera que abra el comprobante, y el resultado es el mismo porque lo fija la ronda del faro. Probado de punta a punta: sorteo #5 sellado y abandonado a propósito, cerrado desde la verificación por una cuenta que el navegador armó en el momento.

Como participante,
quiero un veredicto claro y la posibilidad de finalizar un sorteo pendiente,
para no depender de que el organizador vuelva a la app.

**Criterios de aceptación:**

**Dado** la página cargada
**Cuando** pulso "Recomputar aquí"
**Entonces** el navegador recomputa `list_hash`, verifica la firma BLS, ejecuta la selección y compara con el registro, y muestra verde solo si todo coincide o rojo con el paso que falló
**Y** si el sorteo está sellado pero sin registro y la ronda ya existe, la página ofrece "Finalizar" (llamada `draw` con cualquier wallet).

### Historia 4.3: Recomputar a mano y enlaces: hecho

Resultado (2026-09-20): la página imprime los cuatro pasos del protocolo con los valores concretos del sorteo, listos para pegar en una terminal, y enlaza al contrato y a la ronda de drand.

Como auditora técnica,
quiero los pasos del protocolo con los valores concretos de este sorteo,
para rehacerlos con mis herramientas.

**Criterios de aceptación:**

**Dado** la página cargada
**Cuando** abro "Cómo recomputar"
**Entonces** veo los pasos de protocolo §7 con los valores reales (hash, ronda, firma, semilla, índices) y enlaces al contrato y transacciones en stellar.expert y a la ronda en drand.

---

## Épica 5: Lanzamiento a mainnet

### Historia 5.1: Despliegue a mainnet con checklist

Como equipo,
quiero pasar las tres puertas del skill `deploy-stellar-mainnet` y desplegar,
para lanzar sin sorpresas.

**Criterios de aceptación:**

**Dado** el contrato validado en testnet
**Cuando** completo la puerta 1 (tests, auth, TTL, sin `unwrap` en rutas de usuario, decisión de inmutabilidad documentada, custodia de la cuenta de despliegue)
**Entonces** despliego con `scripts/deploy.sh mainnet`, registro dirección, hash y commit en `deployments.md`, verifico en stellar.expert y actualizo `deployments.json`
**Y** el sitio en producción apunta a mainnet por configuración.

Avance (2026-09-20): `pnpm preflight:mainnet --account G…` comprueba de una vez todo lo que se puede comprobar **sin gastar un centavo**: los tests del contrato y del protocolo, el tamaño del WASM, que el `.gitignore` cubra lo sensible, que no se haya colado ninguna semilla en el repositorio, que los cuatro relays de drand respondan, que el RPC de mainnet esté vivo y que la red soporte BLS12-381, y que la cuenta exista y tenga saldo.

Estado hoy: todo en verde menos una cosa. **La cuenta `GB3OND7F…` no existe en mainnet**, o sea que nunca se fondeó. Hacen falta unos 70 XLM para desplegar y cubrir el primer año de alquiler con colchón. Ese es el único bloqueo de la épica 5.

### Historia 5.2: Documentación y README finales

Como comunidad interesada,
quiero entender qué es Tinkazo, cómo usarlo y cómo verificar,
para adoptarlo o auditarlo.

**Criterios de aceptación:**

**Dado** el producto en mainnet
**Cuando** leo el README
**Entonces** encuentro qué es, cómo sortear, cómo verificar, direcciones de contrato, capturas actualizadas y cómo contribuir, con el resumen en inglés.

### Historia 5.3: Distribución en el ecosistema

Como autor,
quiero listar Tinkazo donde la comunidad de Stellar lo encuentre,
para conseguir usuarios y evaluar SCF.

**Criterios de aceptación:**

**Dado** el lanzamiento
**Cuando** ejecuto la puerta 3 del skill
**Entonces** hay PR a `lumenloop/stellar-ecosystem-db`, anuncio con enlace a stellar.expert y, si aplica, el borrador del formulario de interés de SCF con `scf-interest-form-drafter`.

---

## Épica 6: Entrar con Google sin wallet ni XLM (v1.1)

### Historia 6.1: App de Pollar configurada: hecho (testnet)

Como equipo,
quiero una app de Pollar en testnet con key publicable, dominios y wallet fondeada,
para prototipar el login social.

**Criterios de aceptación:**

**Dado** la cuenta de Pollar del autor
**Cuando** se crea la app "Tinkazo" (vía MCP con el PAT local)
**Entonces** existe la key `pub_testnet_…` en `.env.local` (fuera del repo), los orígenes `https://tinkazo.vercel.app` y `localhost` están permitidos y la wallet de la app está fondeada
**Y** tras la historia 1.4, el contrato y la función `seal` se agregan a Treasury → Auth Policy.

### Historia 6.2: Login con Google en el sitio: hecho, sin verificar de punta a punta

Resultado (2026-09-20): el selector de cuenta ofrece "Entrar con Google". `src/stellar/wallet-pollar.ts` implementa el adaptador y la sesión se retoma sola al volver del redirect.

Actualización (2026-09-21): el autor entró con Google en producción con su cuenta real y el login funciona.

**Pendiente de comprobar con una cuenta real:** que la política de transacciones de la app en el panel de Pollar acepte firmar una invocación de contrato. Si la rechaza, el error se muestra tal cual. Y para que aparezca en producción hay que cargar `VITE_POLLAR_PUBLISHABLE_KEY` en las variables de entorno de Vercel: el build local la lee de `.env.local`, que no está en el repo.

Como organizadora sin wallet,
quiero entrar con Google y tener una dirección de Stellar sin instalar nada,
para sellar igual que con wallet.

**Criterios de aceptación:**

**Dado** `@pollar/core` inicializado con la key publicable
**Cuando** pulso "Entrar con Google"
**Entonces** completo el OAuth, veo mi dirección custodial y el adaptador de wallet expone `getAddress` y `signAuthEntry`
**Y** el modo con wallet externa sigue disponible en el mismo menú.

### Historia 6.3: Relayer mínimo: ya no hace falta

Se descartó el 2026-09-20. `signAndSubmitTx` de Pollar acepta un XDR de Soroban ya construido, así que la cuenta custodial del propio organizador firma y envía. No hay relayer, no hay servidor, y NFR-2 queda intacto: el proyecto sigue sin backend.

La historia original, para referencia:

Como organizadora con sesión de Pollar,
quiero que alguien envíe la transacción y pague el fee por mí,
para no necesitar XLM.

**Criterios de aceptación:**

**Dado** una auth entry de `seal` firmada por Pollar para mi dirección
**Cuando** el sitio la envía al relayer (función `api/relay.ts` en Vercel con una cuenta patrocinadora, u OpenZeppelin Channels)
**Entonces** el relayer arma la transacción con esa entrada, simula, firma como fuente, envía y devuelve el hash
**Y** el relayer solo acepta invocaciones al contrato de Tinkazo (`seal`, `draw`), verifica la sesión de Pollar y aplica un límite por dirección y por día
**Y** la excepción a NFR-2 queda documentada en `architecture.md`.

---

## Épica 7: Catálogo de juegos

### Historia 7.1: Motor de carrera tematizable y Carrera Stellar: hecho

Resultado (2026-09-19): escenario, horizonte, pista, corredor y texto de largada salen de `src/games/themes.ts`. La Carrera Stellar es una entrada en ese archivo, no un juego duplicado. Documentada en [juegos/carrera-stellar.md](juegos/carrera-stellar.md).

### Historia 7.2: Auditor de juegos: hecho

Resultado (2026-09-19): `pnpm audit:game <juego>` corre un sorteo real en Chrome y comprueba doce cosas, entre ellas la única que no se negocia: que el ganador en pantalla sea exactamente el que fijó el protocolo. Contrato y checklist en [juegos.md](juegos.md).

### Historia 7.5: La tensión de la carrera: hecho

Resultado (2026-09-20): el ganador ya no arranca su sprint en el segundo 9. Corre en el tercio de atrás hasta el 80% de la carrera y remonta al final, con la velocidad calculada para llegar justo al acabarse el tiempo. La punta se la pelea el pelotón y el narrador la canta. Comprobado en una corrida real: tres líderes distintos antes del final y el ganador aparece recién al cruzar. Los tres juegos siguen aprobando el auditor.

### Historia 7.6: Constelación Stellar, que deja de ser un reskin: hecho

Resultado (2026-09-20): la Carrera Stellar era la carrera de llamas con otra piel, y se notaba en el código, que tenía que aclarar la pista "para que los cohetes no se pierdan". Se reemplazó por [Constelación Stellar](juegos/constelacion-stellar.md): un pago que salta de estrella en estrella como un path payment, donde cada participante tiene su estrella y al terminar queda dibujada una constelación. La carrera de cohetes quedó como juego propio (`rockets`).

### Historia 7.7: Cierre de Libro, para doscientas personas: hecho

Resultado (2026-09-20): no había nada para doscientos. La ruleta muere a los veinticuatro nombres y la carrera solo muestra ocho carriles. [Cierre de Libro](juegos/cierre-de-libro.md) barre tarjetas hasta que queda una sellada, y se ve mejor cuanta más gente hay. Dura lo que tarda Stellar en cerrar un ledger.

### Historia 7.8: La ruleta, de nuevo: hecho

Resultado (2026-09-20): con dos o tres participantes no se veía girar, y no era estilo sino geometría: una rueda de n gajos se ve igual cada 360/n grados. Ahora cada persona se lleva varios gajos intercalados y la rueda siempre tiene cerca de veinticuatro. Además frena integrando una velocidad en vez de interpolar el ángulo, la paleta se traba en los pernos, y los 64 dígitos de la semilla están escritos en el aro. Detalle en [ruleta.md](juegos/ruleta.md).

### Historia 7.9: Pasanaku: hecho

Resultado (2026-09-20): el juego con nombre boliviano. El *Diccionario de americanismos* define `pasanacu` como "juego que consiste en sortear el dinero de las cuotas" de un grupo, así que ya era un sorteo. Un aguayo que se cierra sobre los bultos hasta que queda uno en el nudo, y los hilos entre vecinos son las trustlines. Detalle en [pasanaku.md](juegos/pasanaku.md).

### Historia 7.10: El andamiaje compartido: hecho

Resultado (2026-09-20): `src/games/overlay.ts` concentra el montaje del estadio, el azar sembrado con la ronda, los chips con avatar, el botón de saltar, la pantalla completa, el bloqueo de apagado y el desmontaje. Estaba dentro de la carrera, así que cada juego nuevo lo copiaba. Los seis juegos lo usan.

### Historia 7.11: Lo que encontró el control de calidad: hecho en parte

Una revisión de los seis juegos con 2, 3, 5, 24, 60 y 200 participantes, en tres relaciones de pantalla, los dos temas y los dos idiomas: 66 corridas, cero errores de consola, cero excepciones, y los seis a sesenta cuadros por segundo con doscientos participantes.

Arreglado (2026-09-20):

- **La carrera delataba al ganador antes de largar.** Corrían ocho, y eran los siete primeros de la lista más el ganador. Con una lista alfabética la sala veía seis apellidos con A y uno del medio, y ganaba ese. El sorteo estaba bien; el juego lo cantaba. Ahora los ocho salen del azar sembrado, y el carril del ganador también.
- **Las dos carreras eran los únicos juegos sin tarjeta de ganador.** El nombre salía solo en la caja del narrador.
- **No se decía que corrían ocho de doscientos.** Callarlo hacía pensar que el sorteo había sido entre ocho.
- **El botón con la cuenta regresiva era ilegible:** apagar con opacidad lo dejaba en 1,47 a 1, y es lo que toda la sala mira fijo. Ahora 5,39.
- **La huella de la lista, en teal sobre blanco, daba 2,98 a 1.** Es el dato técnico más importante de esa fila. Se agregaron variantes de texto de los acentos, oscurecidas solo lo necesario.
- **En Cierre de Libro el nombre no escalaba con la densidad de píxeles:** en una pantalla HiDPI salía más chico que el rótulo de al lado.
- **Los chips se pisaban** en Pasanaku, y el de la carrera invadía el carril de arriba.
- **Los dígitos de la semilla salían cabeza abajo** en la mitad inferior del aro de la ruleta. El código decía "sacá la foto y comprobalos" y con la mitad ilegible eso era mentira.
- **En 4:3 la ruleta cortaba el nombre.** Es justo el proyector de sala.

Segunda tanda, también hecha (2026-09-20):

- **Los nombres largos hacían que todos se vieran iguales.** Cortar por el final convierte a "María Fernanda Quispe Mamani" y "María Fernanda Quispe Rojas" en la misma cosa, y en una sala llena de apellidos compartidos eso pasa seguido. Ahora se corta por el medio, que conserva las dos puntas.
- **La carrera terminaba con el ochenta por ciento de la pantalla vacío.** La cámara fijaba la meta al 86% del ancho. Ahora se destraba en el último tramo y la deja cerca del centro.
- **La llama cambiaba cuatro veces de tamaño** según cuánta gente hubiera: con dos ocupaba el 15% de la pantalla y con ocho el 3,9%. Es el mismo animal.
- **El confeti caía encima del nombre del ganador** justo cuando la gente saca la foto. Ahora va detrás.
- **Cierre de Libro duraba lo mismo con dos que con doscientos.** Ahora las pasadas duran más cuanta más gente hay, y queda un respiro antes de sellar para leer a los tres que quedaron.
- **Constelación con dos o tres participantes** era un campo de rombos con un par de estrellas perdidas. Ahora hay menos rombos y los nombres quedan puestos todo el tiempo.
- **El número de ronda iba a diez píxeles fijos.** Es el dato que hace verificable el sorteo y en un proyector no se leía. Ahora escala, como el narrador.

Medido el 22 de septiembre de 2026 (ver abajo): doscientos no es el techo.

Pendiente, para cuando haya un evento real donde probarlo:

Medido el 22 de septiembre de 2026, en Chrome sin ventana a 1600x900, con la
cuenta de prueba y anclando de verdad en testnet:

| Juego | Gente | Congelar | Sorteo | Cuadros | Peor cuadro | Memoria |
|---|---|---|---|---|---|---|
| Constelación | 200 | 3,3 s | 36,5 s | 58,8/s | 67 ms | 8 MB |
| Constelación | 500 | 8,2 s | 35,5 s | 56,9/s | 117 ms | 9 MB |
| Constelación | 1000 | 7,5 s | 38,0 s | 59,7/s | 83 ms | 11 MB |
| Cierre de Libro | 500 | 2,9 s | 33,6 s | 59,8/s | 50 ms | 9 MB |
| Cierre de Libro | 1000 | 5,0 s | 34,5 s | 59,7/s | 50 ms | 12 MB |
| Pasanaku | 500 | 8,2 s | 39,1 s | 55,6/s | 50 ms | 15 MB |

O sea: **doscientos no es el techo**. A mil personas el sorteo sigue a sesenta
cuadros por segundo, el cartel del ganador se lee igual y el sello queda en la
cadena. Lo que sí cambia es la lista en pantalla: con mil nombres ya no se lee
ninguno, y eso es lo que fija el tope útil de cada juego, no el rendimiento.

- ~~Un aviso cuando la renta del contrato se acerque al vencimiento~~: hecho el 22 de septiembre de 2026. `pnpm check:renta` lee cuántos días le quedan a la instancia y al código, y sale con error por debajo de treinta (se le puede pedir otro umbral con `--dias`). Hoy: 113,9 días en testnet.
- ~~Un indexador propio de sellos~~: no hizo falta. `sealsOnChain` recorre el estado del contrato, que no tiene ventana temporal, así que la enumeración dejó de depender de los siete días de eventos del RPC.

### Historia 7.3: Mejoras transversales de presentación

Como organizadora,
quiero que el momento del ganador se sienta como el clímax del evento,
para que la sala reaccione y la gente quiera repetirlo.

**Criterios de aceptación:**

**Dado** un sorteo terminado
**Cuando** se revela al ganador
**Entonces** hay una transición entre el juego y la tarjeta, partículas o destello en el instante exacto, y el nombre entra con una animación propia
**Y** las mejoras aplican a los tres juegos por igual, sin duplicar código
**Y** todos los juegos siguen aprobando el auditor.

### Historia 7.4: Juegos nuevos del catálogo

Como comunidad organizadora,
quiero elegir entre varios juegos según el evento,
para que el sorteo encaje con el tono de mi público.

**Criterios de aceptación:**

**Dado** el diseño de un juego nuevo
**Cuando** se implementa
**Entonces** cumple el contrato de `docs/juegos.md`, tiene su documento en `docs/juegos/`, textos en ES y EN, y aprueba las veinte comprobaciones del auditor de juegos y las del auditor de sonido
**Y** si es una carrera, se agrega como tema y no como módulo nuevo.

Resultado parcial (2026-09-20): seis juegos en el catálogo, todos con 15/15. Constelación Stellar, Cierre de Libro, Pasanaku, Carrera de llamas, Carrera de cohetes y Ruleta.

---

## Épica 8: Que el juego enseñe

### Historia 8.1: La tarjeta de "¿por qué se llama así?": hecho

Resultado (2026-09-20): doce tarjetas, cada una con su fuente primaria comprobada. Aparecen después del ganador y nunca antes, porque durante el sorteo nadie lee. Se sortean con la ronda, así que son deterministas. El auditor comprueba que salgan después del ganador, que citen una fuente y que estén en los dos idiomas.

### Historia 8.2: Más tarjetas y verificación viva de las fuentes

Como organizadora,
quiero que los datos que muestra mi sorteo sigan siendo ciertos dentro de un año,
para no quedar mal delante de gente que sabe del tema.

**Criterios de aceptación:**

**Dado** el catálogo de tarjetas
**Cuando** corre la integración continua
**Entonces** se comprueba que cada enlace de fuente responde
**Y** una fuente caída falla la corrida en vez de pasar desapercibida.

Resultado (2026-09-20): `pnpm check:lore` comprueba las doce fuentes y que las dos mitades del texto estén en los dos diccionarios. Corre en la integración continua. Lo que no puede comprobar es que la fuente diga lo que la tarjeta dice: eso lo comprueba una persona al escribirla, y está anotado en el script.

---

## Épica 9: El narrador habla

### Historia 9.1: Voz con la API del navegador: hecho

Resultado (2026-09-20): `src/narrator.ts` elige una voz en español, prefiriendo boliviana y cayendo por vecinos, y prioriza las locales, que arrancan al instante y no dependen del wifi del evento. Cada línea lleva una tensión de 0 a 1 que sube el ritmo y el tono. El botón de sonido del estadio la apaga junto con los pitidos. Sin voz en la máquina no pasa nada.

De paso se arregló que las frases se sorteaban con `Math.random()`: ahora también salen de la semilla, así que la misma ronda narra siempre igual.

### Historia 9.2: Probarla con voz real en el equipo del evento

Como organizadora,
quiero saber antes del evento si la máquina tiene voz en español,
para no descubrirlo con la sala mirando.

**Criterios de aceptación:**

**Dado** el estadio
**Cuando** la página carga
**Entonces** se puede saber si hay voz y cuál se eligió
**Y** si no hay ninguna, se dice antes del sorteo y no durante.

---

## Épica 10: Que el juego se oiga y se sienta

Nació de una auditoría de experiencia sobre los seis juegos, medida en el navegador contra el sitio construido: cada oscilador que arrancaba y cada cambio de la caja del narrador, cronometrados. Encontró un cuelgue, un golpe que sonaba catorce veces y una pasada que el narrador anunciaba como la última sin eliminar a nadie.

### Historia 10.1: Que Pasanaku no cuelgue el navegador: hecho

Resultado (2026-09-20): el aguayo dibujaba los rombos del pallay con `for (px = ...; px < ...; px += step)`, y en el primer cuadro `step` valía cero. No es que fuera lento: `ease.outBack(0)` no devuelve cero sino 2,2e-16, así que la tela medía 1e-13 píxeles de alto, la resta contra la coordenada de arriba se redondeaba al propio valor y el paso se iba con ella. Un `for` que avanza de a cero no termina nunca: la pestaña se colgaba entera, sin excepción y sin un solo cuadro dibujado.

Arreglado con un piso de medio píxel, que no dibuja nada igual, y de paso `u()` en `overlay.ts` ya no puede devolver cero, que protege a los otros bucles de dibujo que avanzan de a `algo * u()`.

### Historia 10.2: El diseño sonoro de los seis juegos: hecho

Resultado (2026-09-20): el problema no eran los sonidos sueltos sino que no había reglas, y ahora están en [juegos.md](juegos.md).

- `beep` ponía la ganancia en su máximo de un salto, y un salto de amplitud es un clic. Ese clic sonaba delante de cada una de las cincuenta notas del producto: era la mitad de por qué esto sonaba a aparato. Ahora hay doce milésimas de ataque, cierre a cero y un paso bajo a 4,5 kHz que le saca el filo a las ondas cuadradas.
- Dieciséis de los veintiún puntos de sonido fuera de la Constelación estaban fuera de la pentatónica. Ahora todos pasan por `note()`.
- Había sesenta y seis sonidos entre 0,008 y 0,016 de volumen, o sea por debajo del murmullo de una sala: estaban escritos y no existían. Y golpes de clímax a 70 y 90 Hz, que el parlante de un proyector no reproduce.
- La traba de la ruleta se disparaba **catorce veces** encima de la fanfarria, al volumen más alto del juego, porque la condición era `flash === 0` y `flash` vuelve a cero a los 0,12 s. El puntero parpadeaba en blanco las catorce.
- La carrera tenía catorce sonidos en veintiséis segundos, con huecos de casi cinco. Ahora tiene galope, que además marca el paso de las patas, y un zumbido de tribuna que sube un grado cada tercio.
- El tejido del Pasanaku, que es la escena que enseña qué es una trustline, era mudo.

### Historia 10.3: El ritmo, que no puede dividir por igual al sonido y a la imagen: hecho

Resultado (2026-09-20): el selector de duración divide el `dt` del juego, pero `beep` mide en segundos reales. Los dos sistemas convivían sin saberlo, y en modo épico el zumbido de 0,7 s que tapaba un apretón entero del Pasanaku dejaba 2,4 s de tela cerrándose en silencio, en el momento de más tensión.

Ahora hay dos funciones y la elección es explícita: `beepFor` para lo que tiene que durar una fase, `beep` para lo que le habla a una persona. La cuenta regresiva avanza en segundos reales, porque una cuenta que no va a un pitido por segundo se lee como una pantalla colgada, y el cartel del ganador se sostiene tres segundos reales en los cinco módulos de juego: leer un nombre proyectado lleva casi un segundo y la reacción de la sala recién llega a su pico a los dos.

### Historia 10.4: La última pasada del Cierre de Libro, que no eliminaba a nadie: hecho

Resultado (2026-09-20): eran tres pasadas fijas con cortes 0,62 / 0,74 / resto. Con dieciocho participantes la primera mataba once, la segunda cuatro y la tercera **cero**: el narrador anunciaba "¡última pasada!", la barra verde cruzaba la pantalla entera y no pasaba nada. La curva estaba al revés, y mordía justo en el caso común de veinte a cuarenta personas.

Ahora el plan de pasadas depende de cuánta gente hay (una a cuatro), los cortes suben, cada pasada tiene piso y techo para que siempre saque a alguien, y "última pasada" se dice sólo en la última de verdad.

### Historia 10.5: Lo que falta de la auditoría de experiencia

Como organizadora,
quiero que el sorteo se entienda desde el fondo de la sala,
para que la gente mire la pantalla y no el teléfono.

**Criterios de aceptación:**

**Dado** un sorteo proyectado y mirado al 25%
**Cuando** corre cualquiera de los seis juegos
**Entonces** se sabe quién va ganando sin leer texto
**Y** hay un hecho legible nuevo cada 1,5 a 2,5 segundos, nunca más de 4 sin novedad
**Y** el efecto del revelado se ve medio segundo antes de que entre el cartel, no debajo.

Hecho (2026-09-20): el destello de dos o tres cuadros en el instante del revelado, en los cuatro juegos que no lo tenían; el temblor del golpe en la ruleta, el Cierre de Libro y el Pasanaku; apagar a los perdedores de la carrera cuando sale el cartel, que hasta ahora seguían corriendo detrás y uno asomaba por el borde; un cuarto de segundo de silencio antes del golpe en la constelación, el Pasanaku y el Cierre; y **la espera de la ronda puesta en escena**, que era el pendiente más grande.

Esa espera son los segundos entre sellar la lista y que la ronda exista, y es el único momento en que este producto es distinto de cualquier ruleta: la lista ya está cerrada y el número que la va a decidir **todavía no existe**. Vivía como una etiqueta chica en un botón gris. Ahora es un panel con el número de la ronda que falta nacer, los segundos que le quedan latiendo, y la frase que lo explica.

De paso, el temblor dejó de salir de `rng()`. Llamar al azar sembrado dentro del dibujo consume la secuencia a la velocidad de los cuadros, así que la misma ronda no se dibujaba igual a 60 Hz que a 144. No cambiaba quién ganaba, pero contradecía la promesa de animación reproducible. Ahora sale del reloj.

Pendiente: cámara lenta en el último 10% de cada juego. Se dejó afuera a propósito porque cambia el `dt` y eso interactúa con el modelo de duración; conviene mirarlo corriendo antes de meterlo.

### Historia 10.6: Que el show dure lo que el organizador eligió: hecho

Resultado (2026-09-20): `PACES` dejó de ser un multiplicador y pasó a ser un objetivo de duración en segundos (`rápido 20 · normal 30 · épico 42`). Cada juego declara con `setGameLength(nominal, fijo)` cuánto dura sin estirar, y `paceFactor()` sale de ahí, acotado entre ×0,55 y ×2,2. Medido, "normal" son treinta segundos en los seis.

Lo que no alcanzaba era subir el multiplicador, y por eso tres juegos recibieron **contenido**: la ruleta pasó de 7,65 a 17,2 segundos nominales acortando el borrón del crucero de 2,2 a 1,6 y llevando la frenada de 1,3 a 4,4, el arrastre de 0,55 a 2,4 y el amague de 0,25 a 1,2; el Cierre de Libro llegó a seis pasadas con listas grandes, con barridas de dos a tres segundos y sellos cada 0,7; el Pasanaku le dio al tejido de los hilos 2 segundos en vez de 0,8 y al apretón 7,5 en vez de 4,2; y la constelación subió el armado a 3 segundos y la suma de los saltos de 9,3 a 14,5.

Y el selector muestra los segundos: "Normal · 30 s". El número sale de `PACES`, así que no se puede despegar del código.

Lo que sigue estando escrito abajo es el análisis que llevó a esto.

`PACES` era un multiplicador (`rápido 0,8 · normal 1,4 · épico 2,2`) y los seis juegos no duran lo mismo sin estirar. Medido, en segundos reales:

| Juego | Base, en segundos de juego hasta el revelado | Normal | Épico |
|---|---|---|---|
| Carrera / Cohetes | 3 de cuenta (ya en segundos reales) + 15 | 23,5 | 36,0 |
| Constelación | 11,48 | 16,2 | 25,3 |
| Pasanaku | 8,60 | 11,8 | 18,9 |
| Ruleta | 7,65 | 11,5 | 16,8 |
| Cierre de Libro (n=18) | 6,21 | 9,3 | 13,7 |

Más tres segundos reales de sostén del cartel en todos. El pedido es que el mínimo sea alrededor de treinta segundos, y hoy no lo alcanzan cuatro de los seis ni en épico.

**Subir el multiplicador no sirve.** Para que el Cierre de Libro llegue a treinta segundos haría falta ×4,35 y la ruleta ×3,53. La ruleta ya tiene 2,2 segundos de crucero en los que la imagen es un borrón: a ×3,5 son casi ocho segundos de nada. Estirar no es alargar.

Van dos pasos, en este orden. Primero, que el selector sea un **objetivo de duración**: cada juego declara cuánto dura sin estirar y el factor sale de `(objetivo menos lo fijo) / nominal`, acotado a ×2,2. Con objetivos de 20, 30 y 42 segundos, "normal" pasa a dar 30 en la carrera, 28 en la constelación y entre 17 y 22 en los otros tres, y el botón por fin significa lo mismo en los seis.

Segundo, y es lo que de verdad falta: **contenido en los tres que topean**. La ruleta tiene que acortar el crucero y darle ese tiempo a la frenada y al amague, que es donde está la tensión, y a la carga inicial, que hoy son 0,9 segundos con la rueda quieta. El Cierre de Libro necesita más pasadas con listas grandes, donde hoy el tope son cuatro, y un desfile de sellos menos apurado que uno cada 0,33 segundos. El Pasanaku tiene el tejido de los hilos en 0,8 segundos, y es la escena que enseña qué es una trustline.

### Historia 10.7: Que el estadio se vea en un celular: hecho

Resultado (2026-09-20): el auditor corría todo a 1280 por 720, que es un proyector, y el estadio nunca se había mirado en vertical. El organizador prueba el sorteo en su teléfono antes del evento, así que ahí se ve primero. Cinco defectos, todos reales:

- **El cartel del ganador** saca su tamaño del alto de la pantalla, y en vertical eso no dice nada del ancho: a 390 por 844 salía con tipografía de 150 píxeles sobre un lienzo de 780. Un nombre largo se iba de los dos bordes y el lienzo lo recortaba sin avisar. Ahora se achica hasta entrar.
- **La ruleta** dibujaba la placa del nombre en una columna a la izquierda que en vertical no existe: quedaba **encima de la rueda**, tapándola entera. Ahora tiene su propia disposición: rueda arriba, centrada, placa debajo.
- **El Cierre de Libro** repartía las tarjetas con `sqrt(m * 1.7)` columnas, donde 1,7 es la proporción de un proyector. En un celular once tarjetas caían en cinco columnas diminutas, apretadas arriba a la izquierda, con los nombres reemplazados por barritas y media pantalla vacía. Ahora las columnas salen de la forma de la pantalla.
- **El contador de saltos** de la constelación y los números de ronda quedaban debajo de la barra de la interfaz y de la caja del comentario, que son HTML por encima del lienzo y el juego no ve. `chrome()` en `overlay.ts` los mide.
- **Los chips** se anclan a su nodo, y un nodo cerca del borde los empujaba fuera: medio nombre cortado contra el filo. Ahora se acotan al lienzo.

Y de paso, dos que no eran de vertical: la pila de monedas del Pasanaku eran catorce barras rectas del ancho de la caja del pote, que a tamaño de celular se leen como un código de barras naranja flotando en una esquina; y `?pose=` dibujaba **siempre la carrera**, así que las comprobaciones de tema claro, tema oscuro y celular venían mirando la carrera para los seis juegos. Nadie había visto nunca la ruleta ni el pasanaku en tema claro.

El auditor pasa de dieciséis a veinte comprobaciones, cuatro de ellas en 390 por 844.

---

## Épica 12: El sitio cuenta el proyecto

### Historia 12.1: Páginas de lectura: hecho

Como alguien que llega por un enlace y no sabe qué es esto,
quiero entender qué hace Tinkazo, cómo se ve y hasta dónde llega,
sin tener que usarlo primero ni leer el repositorio.

**Criterios de aceptación:**

**Dado** el sitio construido
**Cuando** abro `/juegos.html`, `/historia.html` o `/seguridad.html`
**Entonces** cada una carga sin scroll horizontal en celular, en los dos temas y en los dos idiomas
**Y** la de juegos muestra la captura real del estadio de cada juego
**Y** todas llevan el mismo pie de navegación, con blancos de toque de 44 px.

Resultado (2026-09-22): tres páginas nuevas más la de precios, todas sobre `src/pagina.ts`. Las capturas salen de `?pose=<juego>`, que es la escena fija pensada para eso, convertidas a webp (264 KB las doce, entre tema claro y oscuro). `pnpm check:paginas` las revisa como las mira alguien ·doce vistas y los dos idiomas· y corre en la integración continua. De paso: Open Graph en cada una, `sitemap.xml` y `robots.txt` que deja fuera la página de verificación, porque cada comprobante es de alguien.

---

## Épica 11: Recordatorios y aviso a los ganadores

Salvo el historial desde la cadena (11.1), no hay nada de esto todavía y no hace falta para el evento. Queda escrito para no volver a discutirlo desde cero.

El sitio no tiene servidor ni base de datos: todo vive en el navegador y en la cadena. Hasta la 11.1 el historial de sorteos vivía solo en `localStorage` y se perdía al borrar los datos del sitio. El aviso al ganador sigue siendo un enlace que el organizador manda a mano.

Lo que pediría un servidor de verdad: avisar por correo a quien ganó sin que el organizador tenga que copiar nada, recordar un sorteo programado, y que el historial sobreviva a cambiar de equipo. Las tres cosas tienen el mismo costo: dejar de ser un sitio estático.

Hay un camino intermedio que no lo requiere y conviene medir antes: **reconstruir el historial desde la cadena**. Los sellos están en el contrato, la cuenta que los firmó es la del organizador, y `getLedgerEntries` no tiene ventana temporal. Eso devuelve el historial en cualquier equipo con la misma cuenta, sin servidor y sin base de datos. Lo que no resuelve es el correo.

### Historia 11.2: Rearmar el comprobante de un sorteo traído de la cadena: hecho

Como organizadora que abre su historial en otro equipo,
quiero volver a armar el comprobante de un sorteo que hice en otro lado,
para poder compartirlo aunque este navegador no lo tenga.

**Criterios de aceptación:**

**Dado** un sorteo del historial que vino de la cadena, sin comprobante
**Cuando** pego la lista de ese sorteo
**Entonces** el sitio calcula su huella, la compara con la que está en el contrato y, si coincide, devuelve el enlace del comprobante de siempre
**Y** si la lista no es la que se selló, lo dice y no arma nada
**Y** si la cantidad de nombres no coincide, lo dice con los dos números.

Resultado (2026-09-22): `src/ui/rebuild.ts`, con su diálogo y cinco tests. La huella hace de prueba: no se puede rearmar el comprobante de otro sorteo ni con una lista parecida, y el orden importa porque la lista canónica no se ordena.

### Historia 11.1: El historial desde la cadena: hecho

Como organizadora que entra con la misma cuenta desde otro equipo,
quiero ver los sorteos que ya hice,
para no depender de la memoria de un navegador.

**Criterios de aceptación:**

**Dado** una cuenta que ancló sorteos desde otro equipo
**Cuando** la conecto en un navegador sin nada guardado
**Entonces** "Tus sorteos" muestra esos sorteos, marcados como traídos de la cadena, con fecha, premio, cantidad de personas y el puesto de quien ganó
**Y** un sorteo que este equipo ya conoce no se duplica: gana la fila del equipo, que tiene los nombres
**Y** si la cadena no responde, el historial muestra lo del equipo y no afirma nada más.

Resultado (2026-09-21): `sealsOnChain` en `src/stellar/seals.ts` lee `NextId` de la instancia del contrato y recorre `Raffle(id)` de los más nuevos para atrás, doscientas claves por llamada, con techo en dos mil sorteos. Después pide `Draw(id)` solo de los de esa cuenta que ya se sortearon. `mergeWithChain` en `src/ui/history.ts` junta las dos fuentes por id y huella: el id solo no alcanza, porque si el contrato se redespliega los ids vuelven a arrancar desde 1. El CSV suma la columna `origen`.

Probado contra testnet: desde un navegador vacío, la cuenta `GBZQ…DSQY` trae sus seis sorteos en dos segundos, con los ganadores de los sorteos #39 y #40 tal como están en el contrato. Los tests de red se corren a mano con `TINKAZO_RED=1 pnpm test`.

Límites que quedan dichos en el código: los nombres no están en la cadena, así que de un sorteo traído se sabe el puesto de quien ganó y no su nombre, y no hay comprobante para abrir; y una entrada cuyo alquiler se venció se archiva y deja de aparecer hasta que alguien la restaure.

Lo mismo, el mismo día, en la página de verificación: los otros sellos del organizador ya no salen de los eventos del RPC, que duran siete días, sino de `sealsOnChain`, así que aparecen todos. Y se marcan solos los que repiten la huella de la lista (la forma directa de la selección del compromiso) y los que tienen la misma cantidad de gente con otra huella, que es lo que queda si alguien reordena los nombres. Detalle en [amenazas.md](amenazas.md).

---

## Sobre pagar a los ganadores con USDC

Se evaluó y **no entra en v2**, por una razón que no es técnica.

La promesa del producto es que **los participantes no necesitan nada**: ni wallet, ni cuenta, ni saldo, ni saber qué es Stellar. Alguien pega una lista de nombres y sortea. Pagar el premio en USDC rompe eso: para cobrar, quien gana necesita una cuenta de Stellar, una trustline al USDC de Circle y entender qué acaba de recibir. En un evento con cincuenta personas eso convierte un momento de dos segundos en una fila.

Y hay un segundo costo, más serio: hoy el contrato **no custodia valor**. No tiene admin, no se puede actualizar y no tiene fondos. Eso es lo que hace que la auditoría quepa en una tarde y que la promesa sea creíble. Cualquier cosa que ponga dinero adentro cambia el modelo de amenazas por completo y obliga a un tipo de auditoría que hoy no tenemos.

Si algún día se hace, el camino es no custodiar: Pollar ya expone `setTrustline` y `sendPayment`, así que el organizador podría pagarle al ganador desde su propia cuenta, con el sorteo como comprobante. El contrato no se entera y sigue sin tocar dinero.

---

## Fuera de alcance (v2)

Importación desde Luma y Eventbrite · lista opcional en la cadena · sponsor mode · avatares con IA · passkeys (cuando Pollar soporte `signAuthEntry` con C-addresses).
