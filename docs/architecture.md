---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-09-16'
inputDocuments: ['docs/prd.md', 'docs/protocolo.md', 'docs/idea-original-arkiv.md', 'index.html (demo v1)']
---

# Tinkazo — Arquitectura

Documento de decisiones técnicas para implementar el [PRD](prd.md) sobre Stellar. Es la fuente de verdad para quien implemente (humano o agente): si algo no está aquí, se decide y se agrega aquí antes de codificarlo. El [Protocolo](protocolo.md) es la especificación normativa del sorteo y manda sobre este documento en lo que respecta a la matemática.

## Análisis de contexto

### Requisitos y su peso arquitectónico

**Funcionales (25 FR en el PRD).** Se agrupan en cinco capacidades: carga de lista (FR-1 a 3), sello en Stellar (FR-4 a 8), semilla y sorteo (FR-9 a 13), show (FR-14 a 16), verificación pública (FR-17 a 21), modo libre (FR-22 y 23) e i18n/tema (FR-24 y 25). El núcleo de valor está en FR-10 y FR-11: el contrato verifica la firma del faro y ejecuta una selección determinista que el navegador reproduce byte a byte.

**No funcionales que dominan el diseño.**
- NFR-1 (determinismo verificable) obliga a que todo lo que decide un resultado sea puro y esté especificado. Impone dos implementaciones del mismo algoritmo (Rust y TypeScript) con vectores compartidos.
- NFR-2 (sin servidor) descarta backend y base de datos: el sitio es estático y las únicas dependencias en ejecución son Stellar RPC, drand y la wallet. La única excepción admitida está acotada en la Decisión D-07.
- NFR-3 (costo < 0,1 XLM por sorteo) condiciona la verificación BLS on-chain; se mide en testnet en la historia 1.4.
- NFR-4 (repo público sin secretos) define reglas de configuración y de la CLI de Stellar.
- NFR-6 (privacidad) fija que en la cadena solo viaja el hash de la lista.

### Escala y complejidad

- Dominio: aplicación web estática + un contrato Soroban sin custodia de fondos.
- Complejidad: media. No hay concurrencia ni estado compartido entre usuarios; la dificultad está en criptografía (BLS12-381, RFC 9380), determinismo entre lenguajes y UX de wallet.
- Componentes: contrato (1), frontend (1 app con 2 entradas), protocolo compartido (2 implementaciones), infraestructura (Vercel + GitHub Actions).

### Restricciones y dependencias

- Stellar testnet corre protocolo 28 y mainnet 27 (verificado 2026-09-16 vía `getVersionInfo`). El contrato se compila con `soroban-sdk` 27, que corre en ambas redes.
- drand quicknet es la única fuente de aleatoriedad. Sus parámetros son constantes públicas (ver protocolo §2).
- La máquina de desarrollo es Windows sin MSVC: toolchain Rust `x86_64-pc-windows-gnu` con `wasm32v1-none`.
- El sitio v1 existe y está en producción; la migración debe conservar la interfaz.

### Preocupaciones transversales

Determinismo (Rust ↔ TS), manejo de errores del contrato en la UI, redes (testnet/mainnet), i18n de toda cadena nueva, y la disciplina de secretos.

## Evaluación de plantillas de arranque

**Contrato.** `stellar contract init` genera un workspace Cargo con `contracts/*`, `crate-type = ["lib", "cdylib"]`, perfil `release` optimizado y `test.rs` separado. Se adoptó esa estructura a mano (sin la CLI en el momento de crearla) y coincide con la que la CLI espera para `stellar contract build`.

**Frontend.** `pnpm create vite --template vanilla-ts` es la referencia: Vite 8.3, TypeScript 7.0, sin framework. Se aplica sobre el `index.html` existente en la raíz, que pasa a ser la entrada de Vite; el JavaScript inline migra a módulos en `src/`. No se adopta React ni Next: la interfaz actual es DOM y canvas puros, funciona, y un framework solo agregaría peso a una app de una pantalla.

## Decisiones arquitectónicas

Versiones verificadas el 2026-09-16 en crates.io, npm y las redes.

| ID | Decisión | Elección | Alternativas descartadas |
|---|---|---|---|
| D-01 | Fuente de aleatoriedad | drand **quicknet** (3 s, firma G1 sin encadenar, RFC 9380) | Cadena *default* de drand (usada en v1): firmas encadenadas, no verificables con un mensaje simple. `env.prng()` de Soroban: predecible. Hash de bloque de Stellar: manipulable por validadores en el margen. |
| D-02 | Verificación de la semilla | **On-chain**, `pairing_check` de BLS12-381 en el contrato contra la clave pública de quicknet | Almacenar la firma sin verificar (plan B si NFR-3 falla). Oráculo externo: agrega confianza en un tercero. |
| D-03 | Compromiso temporal | Ronda futura con `round_time ≥ ledger_ts + 30 s`, comprobada por el contrato | Sellar y usar "la ronda más reciente" (v1): no demuestra que la semilla no existía al sellar. |
| D-04 | Mutabilidad del contrato | **Inmutable**: sin admin ni `upgrade`. Cada versión es un despliegue nuevo y el comprobante lleva la dirección | Contrato actualizable con admin: un solo actor podría cambiar la lógica del sorteo. |
| D-05 | Finalización | `draw` **sin autorización** (permissionless) | Solo el organizador: podría retener un resultado que no le gusta. |
| D-06 | Identidad del organizador (MVP) | **Wallet externa** vía Stellar Wallets Kit v2 (Freighter, xBull, Lobstr, Albedo, Hana…). Se elimina Clerk | Clerk: identidad sin capacidad de firmar. Pollar custodial: requiere relayer (D-07). |
| D-07 | "Entrar con Google" sin XLM (v1.1) | **Pollar** (`@pollar/core` 0.11) para login social y wallet custodial + `signAuthEntry` para consentir `seal`, con un **relayer** que envía la transacción y paga el fee. El relayer es la única excepción a NFR-2: una función serverless en Vercel o OpenZeppelin Channels | Passkeys de Pollar (C-address): hoy no firman `signAuthEntry`. Smart Account Kit + relayer propio: más piezas para el mismo resultado. |
| D-08 | Frontend | **Vite 8 + TypeScript 7, vanilla**, `pnpm` 11, dos entradas HTML (`index.html`, `verificar.html`) | React/Next: no aporta a una app DOM+canvas ya escrita. Mantener sin build: los SDKs de Stellar y BLS no se cargan bien por CDN. |
| D-09 | SDK de Stellar en el navegador | `@stellar/stellar-sdk` **17.1** (`contract.Client`, `rpc.Server`); simulación + `signAndSend` con el firmante de la wallet | Horizon: no sirve para Soroban. Construcción manual de ScVal: innecesaria con `contract.Client`. |
| D-10 | BLS en el navegador | `@noble/curves` **2.x** (`bls12_381.shortSignatures`) para verificar la firma de quicknet en modo libre y para descomprimir la firma G1 (48 → 96 bytes) antes de `draw` | Enviar la firma comprimida al contrato: el host de Soroban solo acepta puntos sin comprimir. |
| D-11 | Redes | Configuración por `VITE_STELLAR_NETWORK` (`testnet` por defecto). Direcciones de contrato en `src/stellar/deployments.ts` y en [deployments.md](deployments.md) | Auto-detectar la red desde la wallet: la app debe declarar contra qué contrato habla. |
| D-12 | Hosting y CI | Vercel (proyecto existente, preset Vite, `pnpm`) y GitHub Actions (`cargo test`, build WASM, `pnpm test`, `pnpm build`) | Netlify (opción de v1): el proyecto ya vive en Vercel. |
| D-13 | Comprobante | Enlace con `red`, `contrato`, `id` y la lista canónica comprimida (deflate + base64url) en el fragmento `#`, más descarga JSON | Lista en la cadena: v2, opcional, expone nombres. Servidor de comprobantes: viola NFR-2. |
| D-14 | Toolchain de contratos | Rust 1.98 (`stable-x86_64-pc-windows-gnu` en la máquina del autor), `wasm32v1-none`, `soroban-sdk` 27.0.6, `stellar-cli` 28.0 | SDK 28 rc: solo necesario para funciones nuevas del protocolo 28; mainnet sigue en 27. |

### Detalle de la capa de confianza

```mermaid
sequenceDiagram
  participant O as Organizador (wallet)
  participant W as Sitio (navegador)
  participant C as Contrato Soroban
  participant D as drand quicknet
  participant V as Verificador
  W->>W: lista canónica → list_hash, count
  W->>W: ronda objetivo R = round_at(now + 45 s)
  O->>C: seal(organizer, list_hash, count, k, R, meta)  [auth organizador]
  C-->>W: id, sealed_at (ledger)
  Note over W: cuenta regresiva hasta round_time(R)
  W->>D: GET /v2/chains/quicknet/rounds/R
  D-->>W: signature (48 bytes)
  W->>W: descomprimir G1 (96 bytes)
  W->>C: draw(id, signature96)  [sin auth]
  C->>C: pairing_check(sig, H(sha256(be64 R)), PK)
  C->>C: randomness = sha256(comprimir(sig)); winners = select(...)
  C-->>W: Draw {randomness, winners}
  W->>W: show (carrera / ruleta) sembrado con randomness
  V->>C: get_raffle(id), get_draw(id)
  V->>D: rounds/R
  V->>V: recomputa protocolo §7 → veredicto
```

### Contrato `tinkazo-raffle`

Estado implementado y probado (19 tests, incluida la firma real de la ronda 32254977 de quicknet). Interfaz:

| Función | Auth | Efecto |
|---|---|---|
| `seal(organizer, list_hash, count, num_winners, round, meta) → u64` | `organizer` | Valida ventana de ronda, límites y meta; guarda `Raffle`; emite `sealed` |
| `draw(raffle_id, signature: BytesN<96>) → Draw` | ninguna | Verifica BLS, deriva semilla, selecciona, guarda `Draw`, emite `drawn` |
| `get_raffle(id) → Option<Raffle>` / `get_draw(id) → Option<Draw>` | ninguna | Lectura |
| `next_id() → u64` | ninguna | Próximo id |
| `extend(id)` | ninguna | Renueva TTL de sorteo y registro |
| `round_at(ts) → u64` / `round_time(round) → u64` | ninguna | Utilidades de quicknet |

Almacenamiento: `instance` para `NextId`; `persistent` para `Raffle(id)` y `Draw(id)` con TTL extendido a 120 días cuando baja de 60. Errores numerados y estables (`NotFound=1 … MetaTooLong=9`): son ABI pública, nunca se renumeran. Tamaño del WASM: 26,7 KB (límite 128 KB).

Riesgos conocidos: un `signature` malformado (fuera de la curva) aborta la invocación en el host en lugar de devolver `InvalidSignature`; el cliente valida la codificación antes de enviar. El costo de `pairing_check` se mide en testnet (historia 1.4) y se registra en [deployments.md](deployments.md).

### Frontend

Módulos y responsabilidades:

| Módulo | Responsabilidad |
|---|---|
| `src/main.ts` | Arranque, wiring de eventos DOM, estado de la pantalla principal |
| `src/i18n.ts` | Diccionario `T` ES/EN y `setLang` |
| `src/protocol/canonical.ts` | Lista canónica y `listHash` (protocolo §1) |
| `src/protocol/select.ts` | Selección determinista (protocolo §5) |
| `src/protocol/drand.ts` | Parámetros de quicknet, `roundAt`, `roundTime`, fetch con relays y reintentos, verificación BLS y descompresión G1 (§2, §6) |
| `src/protocol/proof.ts` | Comprobante: codificar/decodificar enlace y JSON (D-13) |
| `src/stellar/config.ts` | Red activa, RPC, passphrase, dirección del contrato |
| `src/stellar/wallet.ts` | Adaptador de wallet: `connect()`, `address`, `network`, `signTransaction(xdr)` sobre Stellar Wallets Kit |
| `src/stellar/contract.ts` | `contract.Client` tipado de `tinkazo-raffle`: `seal`, `draw`, `getRaffle`, `getDraw` |
| `src/games/race.ts`, `src/games/wheel.ts` | Carrera de llamas y ruleta (código v1 migrado) |
| `src/ui/*.ts` | Render de secciones: lista, sello, cuenta regresiva, resultado, errores |
| `verificar.html` + `src/verify.ts` | Página de verificación de solo lectura (FR-17 a 21) |

El adaptador de wallet es una interfaz pequeña para que la historia 6.2 agregue Pollar sin tocar el resto: `{ kind, connect, disconnect, getAddress, getNetwork, signTransaction }`.

## Patrones de implementación y reglas de consistencia

**Nombres.**
- Rust: `snake_case` para funciones y campos; tipos en `PascalCase`; errores en `PascalCase` con código explícito.
- TypeScript: `camelCase`; tipos e interfaces en `PascalCase`; archivos en `kebab-case.ts`; constantes de protocolo en `SCREAMING_SNAKE_CASE`.
- Identificadores de código en inglés; documentación, comentarios de alto nivel, commits e interfaz en español (interfaz también en inglés vía `T`).
- Claves de i18n: `camelCase` descriptivo (`sealOnStellar`, `roundCountdown`). Toda cadena visible nueva se agrega en `es` y `en` en el mismo cambio.

**Estructura.**
- Tests de Rust en `src/test.rs` (unitarios) y snapshots en `test_snapshots/` commiteados.
- Tests de TypeScript con Vitest junto al módulo: `select.test.ts` al lado de `select.ts`. Los vectores cruzados viven en `docs/vectors.json` y los cargan ambos lados.
- Nada de lógica de protocolo en `main.ts` o en la UI: solo en `src/protocol/*`.

**Formatos.**
- Bytes en hex minúsculas sin `0x` en la UI y en los comprobantes; `BigInt` para u64 en TS.
- Tiempos Unix en segundos (como el ledger). Fechas legibles con `Intl.DateTimeFormat` en el idioma activo.
- Errores del contrato se mapean por código numérico a mensajes i18n (`errors.contract.5 → "La ronda está demasiado cerca"`); errores de red y de wallet tienen sus propias claves.

**Comunicación.**
- Eventos del contrato: `sealed(raffle_id, organizer)`, `drawn(raffle_id)`. Nuevos eventos, nuevas variantes; nunca cambiar la forma de los existentes.
- Lectura de estado: siempre `get_raffle` / `get_draw` vía `rpc.queryContract` o `contract.Client`; nunca `getLedgerEntries` con claves a mano.

**Proceso.**
- Toda transacción sigue: construir → simular → firmar → enviar → `pollTransaction`; la UI muestra estado por paso y el hash en cuanto existe (checklist UX del skill `dapp`).
- La app nunca guarda llaves; la wallet firma. Los archivos `.env*`, `.vercel/` y `.stellar/` están ignorados por git.
- Las direcciones de contrato se cambian solo vía `deployments.ts` + `deployments.md` en el mismo commit.

**Todo agente debe:**
- Implementar la matemática exactamente como el [Protocolo](protocolo.md) y pasar `docs/vectors.json`.
- Mantener el modo libre funcionando sin wallet ni red de Stellar.
- No agregar dependencias fuera de las listadas en las decisiones sin actualizar este documento.
- Escribir cadenas visibles en ES y EN.

## Estructura del proyecto y fronteras

```
tinkazo/
├── index.html                    # Entrada Vite: sitio principal (v1 migrado)
├── verificar.html                # Entrada Vite: verificación pública
├── src/
│   ├── main.ts
│   ├── verify.ts
│   ├── i18n.ts
│   ├── styles.css                # CSS extraído de index.html
│   ├── protocol/
│   │   ├── canonical.ts  (+ .test.ts)
│   │   ├── select.ts     (+ .test.ts)
│   │   ├── drand.ts      (+ .test.ts)
│   │   └── proof.ts      (+ .test.ts)
│   ├── stellar/
│   │   ├── config.ts
│   │   ├── deployments.ts        # { testnet: "C…", mainnet: "C…" }
│   │   ├── wallet.ts             # adaptador Stellar Wallets Kit
│   │   └── contract.ts           # contract.Client tipado
│   ├── games/
│   │   ├── race.ts
│   │   └── wheel.ts
│   └── ui/
├── public/                       # favicon, og-image
├── contracts/
│   └── raffle/
│       ├── Cargo.toml
│       ├── src/{lib.rs, drand.rs, select.rs, test.rs}
│       └── test_snapshots/
├── scripts/
│   └── deploy.sh                 # build + deploy + registro en deployments.md
├── docs/
│   ├── prd.md · architecture.md · protocolo.md · epics.md · deployments.md · vectors.json
│   ├── idea-original-arkiv.md
│   └── capturas/
├── .github/workflows/ci.yml
├── .stellar-build/bmm/config.yaml # config de las skills (planning_artifacts: docs)
├── Cargo.toml                    # workspace
├── package.json · pnpm-lock.yaml · vite.config.ts · tsconfig.json · vercel.json
├── CLAUDE.md · README.md · LICENSE · .gitignore
```

**Fronteras.**
- *Protocolo* (`src/protocol`, `contracts/raffle/src/{drand,select}.rs`): puro, sin I/O salvo `fetch` a drand en `drand.ts`. Es lo que un tercero reimplementa.
- *Stellar* (`src/stellar`, `contracts/raffle/src/lib.rs`): la única capa que conoce redes, wallets y el contrato.
- *UI y juegos*: consumen resultados; nunca calculan ganadores.
- *Verificación* (`verify.ts`): solo lectura; no importa `wallet.ts`.

**Mapa de épicas a estructura.**

| Épica | Dónde vive |
|---|---|
| 1 Contrato | `contracts/raffle`, `scripts/deploy.sh`, `docs/deployments.md` |
| 2 Sitio con protocolo v2 | `index.html`, `src/main.ts`, `src/protocol/*`, `src/games/*`, `vite.config.ts`, `vercel.json` |
| 3 Anclaje desde la interfaz | `src/stellar/*`, `src/ui/seal.ts`, `src/ui/draw.ts` |
| 4 Verificación pública | `verificar.html`, `src/verify.ts`, `src/protocol/proof.ts` |
| 5 Lanzamiento | `docs/deployments.md`, `README.md`, `src/stellar/deployments.ts` |
| 6 Entrar con Google (Pollar) | `src/stellar/wallet-pollar.ts`, `api/relay.ts` (o cliente de OpenZeppelin Channels) |

**Integraciones externas.**

| Servicio | Uso | Falla → comportamiento |
|---|---|---|
| Stellar RPC (`soroban-testnet.stellar.org`; mainnet vía proveedor) | Simular, enviar, leer estado | Anclaje deshabilitado con aviso; modo libre sigue |
| drand relays (`api.drand.sh`, `api2`, `api3`, `drand.cloudflare.com`) | Firma de la ronda | Reintento rotando relays; error claro y botón de reintentar |
| Wallet (Stellar Wallets Kit) | Firmar `seal` y `draw` | Sin wallet: modo libre; red equivocada: bloqueo con aviso |
| stellar.expert | Enlaces de exploración | Solo enlaces |
| Pollar (v1.1) | Login social + `signAuthEntry` | Si cae, queda la wallet externa |

## Validación

**Coherencia.** Las decisiones encajan: quicknet (D-01) habilita la verificación on-chain (D-02) y el compromiso temporal (D-03); la inmutabilidad (D-04) y el `draw` sin permiso (D-05) refuerzan la promesa del producto; Vite vanilla (D-08) preserva la interfaz v1 y admite los SDKs (D-09, D-10).

**Cobertura.** Cada FR del PRD está mapeado a una épica en [epics.md](epics.md). NFR-1 se garantiza con vectores cruzados; NFR-2 con la ausencia de backend (excepción acotada y opcional en D-07); NFR-3 se mide en 1.4; NFR-4 con `.gitignore` y las reglas de CLAUDE.md; NFR-6 porque el contrato solo recibe `list_hash`.

**Brechas.**
- *Importante:* el costo real de `pairing_check` en testnet (historia 1.4). Si supera el presupuesto o el objetivo de NFR-3, se activa el plan B de D-02 y se actualiza este documento.
- *Importante:* el relayer de D-07 no está diseñado en detalle; se hace en la historia 6.3, solo si la épica 6 se aprueba.
- *Menor:* paleta de wallets exacta del Wallets Kit en la primera versión (por defecto los 12 módulos sin configuración).

**Checklist.**

- [x] Contexto analizado y complejidad estimada
- [x] Restricciones identificadas (redes, toolchain, sitio v1)
- [x] Decisiones críticas con versiones
- [x] Stack completo especificado
- [x] Patrones de integración definidos
- [x] Rendimiento y costo considerados (NFR-3 pendiente de medición)
- [x] Convenciones de nombres, estructura, formato y proceso
- [x] Árbol de proyecto completo y fronteras
- [x] Mapa de requisitos a estructura

**Estado:** LISTA PARA IMPLEMENTAR CON BRECHAS MENORES. Confianza alta en el contrato (ya probado); media en la integración de wallet hasta cerrar la historia 3.2 en testnet.

**Primera prioridad de implementación:** historia 1.4 (desplegar el contrato en testnet, correr `seal`/`draw` reales por CLI y medir costo), seguida de 2.1 (migración a Vite con paridad visual).
