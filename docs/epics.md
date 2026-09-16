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
| NFR-3, NFR-7 | 1 y 5 |
| D-07 (Pollar) | 6 |

## Lista de épicas

### Épica 1: Contrato de sorteos verificables
El organizador compromete una lista y cualquiera finaliza el sorteo con la firma del faro, verificada en la cadena. **FRs:** 7, 10, 11, 12, 13. NFR-1, 3, 7.

### Épica 2: Sitio con protocolo v2 y modo libre verificable
El sitio actual pasa a build con pnpm y Vite, adopta quicknet y el protocolo v2, verifica la firma del faro en el navegador y emite comprobantes locales. **FRs:** 1, 2, 3, 9, 11, 14, 15, 16, 22, 23, 24, 25. NFR-2.

### Épica 3: Anclaje en Stellar desde la interfaz
El organizador conecta su wallet, sella y sortea en el contrato desde la pantalla, con cuenta regresiva y show. **FRs:** 4, 5, 6, 7, 8, 9, 10, 12, 13. NFR-5, 6.

### Épica 4: Verificación pública
Cualquier persona abre el comprobante, ve el sello y el registro leídos de la cadena y obtiene un veredicto recomputado en su navegador. **FRs:** 17, 18, 19, 20, 21.

### Épica 5: Lanzamiento a mainnet
Contrato en mainnet con checklist de despliegue, documentación final y distribución en el ecosistema. NFR-3, 7.

### Épica 6: Entrar con Google sin wallet ni XLM (v1.1)
El organizador puede usar Pollar para iniciar sesión con Google y sellar sin instalar una wallet, mediante `signAuthEntry` y un relayer mínimo. Decisión D-07; se ejecuta solo si el autor la aprueba tras la épica 3.

---

## Épica 1: Contrato de sorteos verificables

Un contrato Soroban inmutable que guarda sellos y registros, verifica la firma BLS de quicknet y selecciona ganadores de forma determinista.

### Historia 1.1: Sellar una lista — hecho

Como organizador,
quiero comprometer el hash de mi lista, la cantidad de entradas, los ganadores y una ronda futura,
para que nadie (ni yo) pueda cambiar la lista después de conocer la semilla.

**Criterios de aceptación:**

**Dado** un organizador que autoriza la llamada
**Cuando** llama `seal` con `count ≥ 2`, `1 ≤ num_winners ≤ min(count, 32)`, `meta ≤ 160` y una ronda cuyo `round_time` está entre 30 s y 30 días después del ledger
**Entonces** el contrato guarda el `Raffle` con `status = Sealed`, `sealed_at` y `sealed_ledger`, devuelve un `id` secuencial desde 1 y emite `sealed`
**Y** rechaza con `TooFewEntries`, `BadWinnerCount`, `MetaTooLong`, `RoundTooSoon` o `RoundTooFar` cada violación
**Y** la autorización del organizador es obligatoria.

### Historia 1.2: Registrar el resultado con la firma de quicknet verificada — hecho

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

### Historia 1.3: Consultas, TTL y utilidades — hecho

Como verificador,
quiero leer el sello y el registro por id, renovar su vigencia y calcular rondas,
para poder auditar meses después sin depender de Tinkazo.

**Criterios de aceptación:**

**Dado** un sorteo existente
**Cuando** llamo `get_raffle`, `get_draw`, `next_id`, `extend`, `round_at` o `round_time`
**Entonces** obtengo los datos sin autorización, `extend` renueva el TTL de sorteo y registro y devuelve `NotFound` si el id no existe
**Y** los TTL se extienden a 120 días cuando bajan de 60 en cada escritura.

### Historia 1.4: Desplegar en testnet y medir — hecho

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

### Historia 1.5: Integración continua del contrato — hecho (primera corrida en verde)

Como mantenedor,
quiero que cada push ejecute los tests y compile el WASM,
para que una regresión en la matemática no llegue a `main` sin aviso.

**Criterios de aceptación:**

**Dado** un push o pull request
**Cuando** corre `.github/workflows/ci.yml`
**Entonces** `cargo test --workspace` y `cargo build --release --target wasm32v1-none` pasan y el tamaño del WASM queda en el log.

---

## Épica 2: Sitio con protocolo v2 y modo libre verificable

### Historia 2.1: Migrar el sitio a Vite, TypeScript y pnpm con paridad visual — hecho

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

### Historia 2.3: Quicknet en el navegador y modo libre verificable — hecho

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

### Historia 2.4: Comprobante local

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

### Historia 3.1: Conectar wallet y detectar red

Como organizadora,
quiero conectar mi wallet y ver mi dirección y la red,
para sellar con mi identidad.

**Criterios de aceptación:**

**Dado** Stellar Wallets Kit inicializado con la red de `VITE_STELLAR_NETWORK`
**Cuando** pulso "Conectar wallet"
**Entonces** elijo una wallet del modal, veo mi dirección abreviada y la red
**Y** si la wallet está en otra red, veo el aviso y el botón "Sellar en Stellar" queda deshabilitado
**Y** sin wallet instalada, veo el enlace de instalación y el modo libre sigue disponible.

### Historia 3.2: Sellar en Stellar

Como organizadora,
quiero firmar una transacción que registre el sello en el contrato,
para que la lista quede comprometida con timestamp público.

**Criterios de aceptación:**

**Dado** una lista válida, ganadores elegidos y wallet conectada
**Cuando** pulso "Sellar en Stellar"
**Entonces** la app calcula `list_hash`, `count`, la ronda `round_at(now + 45 s)`, construye `seal` con `contract.Client`, simula, pide firma y envía
**Y** al confirmarse muestra `id`, hash, ronda, hora del ledger, enlace a stellar.expert y bloquea lista y premio
**Y** un rechazo de la wallet, falta de XLM o un error del contrato (por código) se muestran en ES/EN sin dejar la pantalla en estado intermedio.

### Historia 3.3: Sortear en Stellar y revelar desde el registro

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

### Historia 3.5: Cuenta invitada en testnet

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

### Historia 3.4: Errores, costos y estados de transacción

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

### Historia 4.1: Página de verificación

Como verificador,
quiero abrir un comprobante y ver el sello, el registro, la ronda y la lista,
para juzgar por mí mismo.

**Criterios de aceptación:**

**Dado** un enlace `verificar.html#…` con red, contrato, id y lista
**Cuando** lo abro sin wallet
**Entonces** la página lee `get_raffle` y `get_draw` por RPC, obtiene la ronda de drand y muestra los cuatro bloques con sus valores
**Y** funciona también para comprobantes de modo libre (sin contrato).

### Historia 4.2: Veredicto y finalización

Como participante,
quiero un veredicto claro y la posibilidad de finalizar un sorteo pendiente,
para no depender de que el organizador vuelva a la app.

**Criterios de aceptación:**

**Dado** la página cargada
**Cuando** pulso "Recomputar aquí"
**Entonces** el navegador recomputa `list_hash`, verifica la firma BLS, ejecuta la selección y compara con el registro, y muestra verde solo si todo coincide o rojo con el paso que falló
**Y** si el sorteo está sellado pero sin registro y la ronda ya existe, la página ofrece "Finalizar" (llamada `draw` con cualquier wallet).

### Historia 4.3: Recomputar a mano y enlaces

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
**Entonces** despliego con `scripts/deploy.sh mainnet`, registro dirección, hash y commit en `deployments.md`, verifico en stellar.expert y actualizo `deployments.ts`
**Y** el sitio en producción apunta a mainnet por configuración.

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

### Historia 6.1: App de Pollar configurada — hecho (testnet)

Como equipo,
quiero una app de Pollar en testnet con key publicable, dominios y wallet fondeada,
para prototipar el login social.

**Criterios de aceptación:**

**Dado** la cuenta de Pollar del autor
**Cuando** se crea la app "Tinkazo" (vía MCP con el PAT local)
**Entonces** existe la key `pub_testnet_…` en `.env.local` (fuera del repo), los orígenes `https://tinkazo.vercel.app` y `localhost` están permitidos y la wallet de la app está fondeada
**Y** tras la historia 1.4, el contrato y la función `seal` se agregan a Treasury → Auth Policy.

### Historia 6.2: Login con Google en el sitio

Como organizadora sin wallet,
quiero entrar con Google y tener una dirección de Stellar sin instalar nada,
para sellar igual que con wallet.

**Criterios de aceptación:**

**Dado** `@pollar/core` inicializado con la key publicable
**Cuando** pulso "Entrar con Google"
**Entonces** completo el OAuth, veo mi dirección custodial y el adaptador de wallet expone `getAddress` y `signAuthEntry`
**Y** el modo con wallet externa sigue disponible en el mismo menú.

### Historia 6.3: Relayer mínimo para `seal` y `draw`

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

## Fuera de alcance (v2)

Importación desde Luma y Eventbrite · lista opcional en la cadena · sponsor mode · avatares con IA · passkeys (cuando Pollar soporte `signAuthEntry` con C-addresses).
