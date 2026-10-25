---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-09-16'
inputDocuments: ['docs/prd.md', 'docs/protocolo.md', 'index.html (demo v1)']
---

# Tinkazo: Arquitectura

Documento de decisiones técnicas para implementar el [PRD](prd.md) sobre Stellar. Es la fuente de verdad para quien implemente: si algo no está aquí, se decide y se agrega aquí antes de codificarlo. El [Protocolo](protocolo.md) es la especificación normativa del sorteo y manda sobre este documento en lo que respecta a la matemática.

## Análisis de contexto

### Requisitos y su peso arquitectónico

**Funcionales (25 FR en el PRD).** Se agrupan en cinco capacidades: carga de lista (FR-1 a 3), sello en Stellar (FR-4 a 8), semilla y sorteo (FR-9 a 13), show (FR-14 a 16), verificación pública (FR-17 a 21), modo libre (FR-22 y 23) e i18n/tema (FR-24 y 25). El núcleo de valor está en FR-10 y FR-11: el contrato verifica la firma del faro y ejecuta una selección determinista que el navegador reproduce byte a byte.

**No funcionales que dominan el diseño.**
- NFR-1 (determinismo verificable) obliga a que todo lo que decide un resultado sea puro y esté especificado. Impone dos implementaciones del mismo algoritmo (Rust y TypeScript) con vectores compartidos.
- NFR-2 (sin servidor para sortear) descarta un backend en el camino del sorteo y una base de datos legible: el sitio es estático y las dependencias del sorteo en ejecución son Stellar RPC, drand y la wallet. D-07 se resolvió sin servidor. La única pieza con servidor es la de la Decisión D-18, el servicio de enlaces cortos: guarda copias cifradas para compartir, no decide nada y tiene el enlace largo de respaldo.
- NFR-3 (costo < 0,1 XLM por sorteo) condiciona la verificación BLS on-chain; se mide en testnet en la historia 1.4.
- NFR-4 (repo público sin secretos) define reglas de configuración y de la CLI de Stellar.
- NFR-6 (privacidad) fija que en la cadena solo viaja el hash de la lista.

### Escala y complejidad

- Dominio: aplicación web estática + un contrato Soroban sin custodia de fondos.
- Complejidad: media. No hay concurrencia ni estado compartido entre usuarios; la dificultad está en criptografía (BLS12-381, RFC 9380), determinismo entre lenguajes y UX de wallet.
- Componentes: contrato (1), frontend (1 app con 2 entradas), protocolo compartido (2 implementaciones), infraestructura (Vercel + GitHub Actions) y, para compartir, el Worker de enlaces cortos en Cloudflare (D-18).

### Restricciones y dependencias

- Testnet y mainnet corren **protocolo 28** (mainnet subió de 27 a 28 entre el 16 y el 19 de septiembre de 2026; verificado vía `getVersionInfo`). El contrato se compila hoy con `soroban-sdk` 27.0.6, compatible con ambas; `soroban-sdk` 28.0.0 ya es estable y se evalúa antes del despliegue a mainnet (historia 5.1).
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
| D-06 | Identidad del organizador (MVP) | **Wallet externa**: Freighter, con su propio adaptador. Se evaluó Stellar Wallets Kit v2 y se descartó por ahora: arrastra WalletConnect y dependencias nativas que rompen la instalación en CI. Más wallets son más clases de `WalletAdapter`. Se elimina Clerk | Clerk: identidad sin capacidad de firmar. Pollar custodial: requiere relayer (D-07). |
| D-07 | "Entrar con Google" sin instalar nada | **Pollar** (`@pollar/core` 0.11) con login social y wallet custodial. **Sin relayer:** `signAndSubmitTx` acepta un XDR de Soroban ya armado (es lo que Pollar usa para DeFindex y Blend), así que Tinkazo construye la invocación, se la entrega firmada y enviada de una vez, y lee el resultado de la red. La wallet se marca `submitsItself` y la capa de anclaje la trata distinto | `signAuthEntry` + relayer: era el plan y resultó innecesario, y además habría sido la única pieza con servidor del proyecto. Passkeys de Pollar (C-address): no firman `signAuthEntry` en esta versión. |
| D-08 | Frontend | **Vite 8 + TypeScript 7, vanilla**, `pnpm` 11, dos entradas HTML (`index.html`, `verificar.html`) | React/Next: no aporta a una app DOM+canvas ya escrita. Mantener sin build: los SDKs de Stellar y BLS no se cargan bien por CDN. |
| D-09 | SDK de Stellar en el navegador | `@stellar/stellar-sdk` **17.1** (`contract.Client`, `rpc.Server`); simulación, firma con el firmante de la wallet y envío propio (`enviarYConfirmar`, D-17). El cliente del contrato baja la interfaz del contrato de la red (dos consultas al RPC): se arma al abrir la sesión, con la página quieta, y quien lo pide mientras se arma espera ese mismo pedido (`getClient`, `precalentarSello`; 21 de octubre de 2026) | Horizon: no sirve para Soroban. Construcción manual de ScVal: innecesaria con `contract.Client`. `signAndSend` del SDK (hasta el 21 de octubre de 2026): sin tope por pedido, y un corte a mitad dejaba un error que nadie entendía. |
| D-10 | BLS en el navegador | `@noble/curves` **2.x** (`bls12_381.shortSignatures`) para verificar la firma de quicknet en modo libre y para descomprimir la firma G1 (48 → 96 bytes) antes de `draw` | Enviar la firma comprimida al contrato: el host de Soroban solo acepta puntos sin comprimir. |
| D-11 | Redes | Configuración por `VITE_STELLAR_NETWORK` (`testnet` por defecto). Direcciones de contrato en `src/stellar/deployments.ts` y en [deployments.md](deployments.md) | Auto-detectar la red desde la wallet: la app debe declarar contra qué contrato habla. |
| D-12 | Hosting y CI | Vercel (proyecto existente, preset Vite, `pnpm`) y GitHub Actions (`cargo test`, build WASM, `pnpm test`, `pnpm build`) | Netlify (opción de v1): el proyecto ya vive en Vercel. |
| D-13 | Comprobante | Enlace con `red`, `contrato`, `id` y la lista canónica comprimida (deflate + base64url) en el fragmento `#`, más descarga JSON | Lista en la cadena: v2, opcional, expone nombres. Servidor de comprobantes que guarde la lista en claro: viola NFR-2 (el enlace corto de D-18 guarda una copia cifrada que no puede leer, y el comprobante sigue siendo el enlace). |
| D-14 | Toolchain de contratos | Rust 1.98 (`stable-x86_64-pc-windows-gnu` en la máquina del autor), `wasm32v1-none`, `soroban-sdk` 27.0.6, `stellar-cli` 28.0 | Subir a `soroban-sdk` 28.0.0 (estable desde septiembre de 2026): se evalúa en la historia 5.1, ahora que ambas redes corren protocolo 28. Sin urgencia: el contrato no usa funciones nuevas del 28. |
| D-15 | Política de renta (TTL) | `seal` y `draw` extienden solo las entradas del propio sorteo (120 días; en la variante de testnet desde el 25 de octubre, 7 días: `TTL_ENTRADA_*`, por el costo del estado de la red). La renta de la instancia y del código se renueva con `extend`, explícita y a cargo del proyecto | Extender la instancia en cada llamada (patrón habitual): el primer organizador tras el umbral pagaba 15 XLM de renta del código sin saberlo. Medido en testnet el 2026-09-16. |
| D-16 | Quién paga la comisión de quien entra con Google o con un correo | **Intentar primero, ayudar después.** Pollar puede pagar la comisión por la app (fee-bump) si `seal` y `draw` están en una regla de contrato de su panel. Antes de simular se espera a que la red conozca la cuenta, que Pollar abre de fondo. Si la comisión no la paga la app, en testnet Tinkazo carga la cuenta con el grifo y reintenta una vez; en mainnet no hay grifo y la persona ve el mensaje de falta de saldo, sin ninguna caja que le pida XLM. Quien entra con Pollar no ve la pantalla de fondos ni un costo que quizá paga otro. `?grifo=0` apaga el grifo en testnet para poder probar con 0 XLM de verdad. Detalle más abajo, en "Fondos y comisiones con Pollar" | Pedir XLM antes de sortear (era un muro para quien solo quiere sortear). "Sponsor all contracts" (paga cualquier llamada a cualquier contrato, no solo las nuestras). Un saldo inicial por alta (cuesta XLM por cada registro, incluido el de quien nunca sortea). |
| D-17 | Reintentos de las transacciones | **Reintentar sin duplicar nunca un sello.** El sorteo se reintenta solo, con espera creciente, ante la red caída u ocupada o la ronda que la cadena todavía no ve: el contrato acepta un solo sorteo por sello y el resultado no depende de quién lo manda. El sello nunca se vuelve a mandar sin saber si el anterior entró: mientras no se sabe se reenvía la misma transacción firmada (la red la aplica una vez como mucho) y, si no se puede saber, se averigua en el contrato con la hora de la red de testigo; sin red, no se manda nada. Detalle más abajo, en "Cuándo se reintenta una transacción" | Reintentar todo a ciegas (dos sellos de la misma lista: el ataque abierto de seguridad.html). No reintentar nada, que era lo de antes: con cada corte de wifi, "la red rechazó la transacción". Dar por vencido un envío con el reloj del navegador. |
| D-18 | Enlaces cortos para compartir un comprobante | **Un Worker de Cloudflare propio** en `c.tinkazo.app`, desplegado el 21 de octubre de 2026, con Durable Objects de SQLite: 62 objetos según el primer carácter del id y uno aparte para los cupos. El navegador cifra el enlace largo (AES-GCM, una clave nueva de 16 bytes por enlace) y la clave viaja solo en el fragmento de `tinkazo.app/c/<id>#<clave>`: el servicio guarda bytes que no puede leer y no decide nada, porque la página abre el mismo comprobante y lo rehace. Se arma al compartir o al mostrar en grande (también al final del show que arrancó desde la espera en grande, que termina en el resultado en grande: desde el 21 de octubre de 2026), nunca en la demo; si no contesta en 5 s se comparte el largo, y el QR del resultado en grande no lo espera más de 2 s: sale con el largo y cambia al corto cuando llega. No vence, y la interfaz no lo borra: Tinkazo lo borra a pedido con el secreto `ADMIN_TOKEN` del Worker, que si no está cargado no existe. Cupos: 256 KB por enlace, 60 altas por hora por dirección IP (en memoria) y 20.000 por día. Es la única pieza con servidor del proyecto y no está en el camino del sorteo (NFR-2). Detalle en [workers/enlaces/README.md](../workers/enlaces/README.md) | Seguir solo con el enlace largo: con doscientos nombres pasa de mil caracteres, su QR no se lee en una foto de WhatsApp y algunos chats lo cortan. Guardarlo sin cifrar: Tinkazo podría leer las listas. Vercel Blob: el plan Hobby no permite uso comercial y trae 2.000 escrituras y 10.000 lecturas por mes. Workers KV: tarda hasta 60 s en verse en otras regiones, y un enlace se abre apenas se comparte. R2: consistente, pero activarlo pide cargar un medio de pago. Un botón para borrarlo desde Mis sorteos (estuvo en la rama del 21 de octubre de 2026 y no llegó a producción): dejaba sin comprobante a todos los que lo tenían, podía parecer que se escondía un resultado y se tocaba sin querer. |
| D-19 | En qué registro cree la verificación | **Solo en los contratos de `src/stellar/deployments.json`** (el vigente y los anteriores de cada red), y solo si la instancia corre el `.wasm` que dice ahí: se lee de la cadena junto con el sello y el resultado, en una consulta `getLedgerEntries`, sin bajar la interfaz que el contrato declara de sí mismo, y cada entrada tiene que ser del contrato y la clave pedidos. Un contrato anterior vale hasta su `ultimoId`. `verificar.html` y `evento.html` usan la misma función (`src/protocol/verificacion.ts`); evento lee la cadena desde el 22 de octubre de 2026. Un ancla ajena o rota es roja; lo que no se pudo leer, amarillo | Creerle al enlace la dirección del contrato (lo de antes: un contrato propio de veinte líneas daba verde). Aceptar cualquier contrato que corra el `.wasm` oficial: es más abierto, pero un despliegue ajeno del mismo código no es un registro de Tinkazo y no hay a quién reclamarle; si hace falta, se agrega a la lista. Que evento no leyera la cadena y su máximo fuera amarillo: más liviano, pero el evento es justamente lo que se comparte con la sala. |

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

Almacenamiento: `instance` para `NextId`; `persistent` para `Raffle(id)` y `Draw(id)` con TTL extendido a 120 días cuando baja de 60 (D-15). Errores numerados y estables (`NotFound=1 … MetaTooLong=9`): son ABI pública, nunca se renumeran. Tamaño del WASM: 11,4 KB optimizado por `stellar contract build` (26,7 KB sin optimizar; límite 128 KB).

Desplegado y probado en testnet el 2026-09-16 con un sorteo real: `seal` 0,099 XLM, `draw` 0,083 XLM (de los cuales 0,003 XLM son cómputo, incluido el `pairing_check`), `extend` 15,15 XLM por la renta del código e instancia. En mainnet la subida del WASM cuesta 15,86 XLM (simulado) y mantener el contrato vivo unos 49 XLM al año. Detalle y proyección en [deployments.md](deployments.md).

Riesgos conocidos: un `signature` malformado (fuera de la curva) aborta la invocación en el host en lugar de devolver `InvalidSignature`; el cliente valida la codificación antes de enviar. La renta del código depende del tamaño del módulo compilado, no del WASM crudo: agregar dependencias pesadas encarece el mantenimiento anual.

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
| `src/protocol/verificacion.ts` | La verificación de un comprobante (protocolo §7), la misma para `verificar.html` y `evento.html`: contrato oficial y su `.wasm`, lista, cantidad, ronda, hora del sello, firma, semilla y ganadores contra el registro. Recibe la cadena y el faro por parámetro (D-19) |
| `src/stellar/oficiales.ts` | Los contratos en los que se cree, por red, leídos de `src/stellar/deployments.json` (D-19) |
| `src/stellar/registro.ts` | Lee de la cadena, en una consulta, la instancia (qué `.wasm` corre), el sello y el resultado de un sorteo (D-19) |
| `src/enlace-corto.ts` | El enlace corto de un comprobante o un evento: lo cifra en el navegador, lo guarda en `c.tinkazo.app` y lo abre; nunca frena compartir (D-18) |
| `c.html` + `src/c.ts` | La página de `tinkazo.app/c/<id>`: trae la copia, la abre con la clave del fragmento y va a `verificar.html` o `evento.html`, que rehacen todo (D-18) |
| `workers/enlaces/` | El Worker de los enlaces cortos, con su prueba de punta a punta (`probar.mjs`) y cómo borrar a pedido (D-18) |
| `src/stellar/config.ts` | Red activa, RPC, passphrase, dirección del contrato |
| `src/stellar/wallet.ts` | Adaptador de wallet: `connect()`, `address`, `network`, `signTransaction(xdr)` sobre `@stellar/freighter-api`, más la cuenta invitada de testnet |
| `src/stellar/session-store.ts` | Recuerda qué tipo de sesión había (cuenta de prueba, Freighter o Google), por red, para no cerrarla al recargar. Solo guarda el tipo, nunca llaves. Se olvida únicamente al pulsar "Salir". Freighter se retoma solo si ya tenía permiso: al cargar nunca se abre un popup |
| `src/stellar/wallet-pollar.ts` | Entrar con Google. Firma y envía de una sola vez contra su propio servidor, por eso se marca con `submitsItself` |
| `src/music.ts` | La música de fondo, andina con beat, generada en el navegador con la semilla de la ronda. Arranca prendida y más baja que los efectos; sigue la tensión de cada línea de la caja del estadio. Desde el 28 de septiembre de 2026 no hay relator con voz: lo sacó el autor porque no le gustaba, y quedaron los subtítulos |
| `src/stellar/contract.ts` | `contract.Client` tipado de `tinkazo-raffle`: `seal`, `draw`, `getRaffle`, `getDraw` |
| `src/stellar/errores.ts` | Qué le pasó a una transacción, en una clave de mensaje (`errorKey`), y el código técnico para "Ver detalle". Sin el SDK (D-17) |
| `src/stellar/envio.ts` | Mandar la misma transacción hasta saber cómo terminó y averiguar si un sello entró, con la red inyectada (D-17) |
| `src/games/overlay.ts` | El andamiaje de los juegos: monta el estadio, siembra el azar con la ronda, dibuja los chips, registra el botón de saltar, pide pantalla completa y desmonta |
| `src/games/*.ts` | Los juegos del motor anterior; los del motor nuevo viven en `src/games/pixi/`: diez en el selector desde el 21 de octubre de 2026 (entró El Trueque; el Sapo y ¿Quién es?, hoy De pie, habían entrado el 2 de octubre), y siete que salieron de él y siguen abriendo con `?demo=`: Cierre de Libro, carrera de cohetes y balsas de totora (30 de septiembre de 2026), luz roja, luz verde (5 de octubre), la tómbola (20 de octubre), y el Aguayo y la Constelación (21 de octubre). Ninguno calcula nada: reciben el ganador ya decidido. Cada uno declara con `setGameLength` cuánto dura sin estirar, porque el selector de duración apunta a una cantidad de segundos y no multiplica |
| `src/games/lore.ts` | Las tarjetas de "¿por qué se llama así?", con su fuente primaria |
| `src/ui/*.ts` | Render de secciones: lista, sello, cuenta regresiva, resultado, errores |
| `verificar.html` + `src/verify.ts` | Página de verificación de solo lectura (FR-17 a 21) |

El adaptador de wallet es una interfaz pequeña para que se pueda agregar una wallet sin tocar el resto: `{ kind, connect, disconnect, getAddress, getNetwork, signTransaction }`. Pollar la extiende con `submitsItself` y `signAndSubmit`, porque firma y envía junto contra su propio servidor y ahí no se puede usar `signAndSend`: la transacción saldría dos veces.

**Fondos y comisiones con Pollar (D-16).** Una cuenta de Pollar nace sin XLM para gastar: con el modo *Immediate* la reserva queda bloqueada en la billetera de la app (CAP-33) y la persona no recibe nada gastable, salvo que el panel tenga un "saldo inicial". Sellar o sortear firma un tope de comisión de unos 0,5 a 0,8 XLM por llamada (registros de Pollar de la app, 19 de octubre de 2026: `seal` de 0,59 a 0,78, `draw` de 0,49 a 0,62; lo que cobra la red es lo que la transacción usa de verdad). Pedirle XLM a quien solo quiere sortear era un muro, así que no se le pide:

1. **Pollar paga.** Envuelve en un *fee-bump* pagado por la billetera de la app cada transacción que califica: de la cuenta del usuario, **una sola operación** `invokeHostFunction`, sobre un contrato y un método que estén en una **regla de contrato** del panel (Wallets, Sponsorship, Stellar) o con "Sponsor all contracts" prendido. `seal` y `draw` son eso. La regla (contrato de `deployments.json`, métodos `seal` y `draw`) la mueve solo quien administra la app de Pollar: no hay API para hacerlo. Sin regla, Pollar envía la transacción sin cambios y paga la cuenta del usuario ("Sponsorship never fails a transaction"); sin XLM, la red la rechaza con `tx_insufficient_balance`.
2. **Antes de simular, que exista la cuenta.** Pollar abre la cuenta en la red de fondo, después de entrar, y tarda de 5 a 62 segundos (mediana de 7; su documentación dice menos de 3). Quien aprieta "Sellar" antes la encuentra sin abrir, y la simulación falla con "Account not found", que no es falta de saldo. `conFondos` espera a que la red conozca la cuenta **antes** de simular el sello y el sorteo (`esperarCuenta` y `conCuentaLista` en `src/ui/reintento.ts`, con la consulta, el reloj y la pausa inyectados): mira apenas empieza y después una vez por segundo, hasta 90 segundos, con la línea "Preparando tu cuenta…" y nunca con la caja de fondos. Si pasan los 90 segundos sale "Tu cuenta todavía no está lista. Probá de nuevo en un minuto.", y si la red no contesta, el aviso de red caída. La existencia se pregunta al RPC con `getLedgerEntries` (el mismo que simula) y no con `getAccount`, porque el SDK contesta "Account not found" ante cualquier fallo, también un corte de red. Si la red mostró la cuenta y la simulación igual dice que no existe, hay un respiro, otra mirada y un solo reintento; si la persona cierra la sesión mientras espera, se deja de esperar. Solo vale para Pollar: con las demás wallets nada cambia.
3. **Si no paga, se ayuda.** `conFondos` (`src/ui/anchor.ts`, con la lógica pura en `src/ui/reintento.ts`) intenta la operación; si la red dice que la cuenta no tiene con qué pagar (`tx_insufficient_balance` y `underfunded`, y nada más: ni `tx_insufficient_fee`, que es una comisión ofrecida demasiado corta, ni `tx_bad_seq`), en testnet la carga con el grifo (que también carga cuentas que ya existen) y reintenta **una** vez, con la línea "Preparando tu cuenta de prueba…". Esa caja (`#fund-box`, pegada al botón de sellar) es también el último recurso en testnet si el grifo no contesta. En mainnet no hay grifo ni caja: quien entra con Pollar ve el mensaje de falta de saldo y nada más, pase lo que pase.
4. **Lo que ve quien entra.** Con una cuenta de Pollar no aparece la pantalla de fondos al conectar ni el aviso en la página, y "Firmando" no muestra la comisión. Con Freighter y con la cuenta de prueba todo sigue como estaba.

**La espera se come el margen de la ronda.** `freeze.ts` elige la ronda con 45 segundos de margen al hacer clic, y el contrato rechaza (`RoundTooSoon`, #5) una que nazca a menos de 30 de la entrada al ledger. Con una cuenta nueva, la espera de arriba (probada de punta a punta contra testnet el 20 de octubre de 2026) se llevaba el margen: la simulación todavía pasaba, porque mira el último ledger, unos segundos atrás, y el sello entraba al ledger y fallaba, con una comisión de por medio. Por eso, al empezar a armar el sello tienen que faltar al menos 40 segundos; si no, se lanza el mismo caso del contrato antes de mandar nada, y `freeze.ts` reintenta con una ronda nueva, ya con la cuenta abierta.

**Probar con 0 XLM de verdad: `?grifo=0`.** En testnet el grifo regala 10.000 XLM, y la interfaz lo ofrece (el paso de fondos, la caja de la página, el panel de la cuenta) y lo pide sola cuando una cuenta de Pollar no puede pagar. Eso tapa la prueba que importa: sellar con una cuenta que de verdad no tiene XLM. Con `?grifo=0` en la dirección y la red en testnet (`src/stellar/grifo.ts`): ningún botón lo ofrece, `fundWithFriendbot` no hace nada ni llama a la red, el reintento automático no lo usa y la caja de último recurso no sale; si falta saldo, se ve el error tal cual. Se ve que está apagado (la insignia de la red dice "sin grifo", el panel de la cuenta suma una insignia y la caja de fondos, una línea), para que nadie lo deje así sin querer. Se lee una sola vez y se recuerda mientras dure la pestaña (volver del ingreso con Google recarga la página sin el parámetro); `?grifo=1` lo vuelve a prender, y una pestaña nueva arranca con el grifo prendido. En mainnet se ignora. La opción "Cuenta de prueba" sigue ofreciéndose y nace vacía.

**Comprobar quién paga la comisión.** No hay que creerle al panel de nadie: la red dice quién pagó. `scripts/verificar-patrocinio.mjs` lee Horizon y, por cada hash de un sello o de un sorteo, dice si existió y fue exitoso, si es un fee-bump, quién pagó (`fee_account`), de quién es la transacción de adentro (`source_account`) y cuánto se cobró, en stroops y en XLM. El veredicto es **patrocinada** (un fee-bump pagado por otra cuenta) o **pagó la propia cuenta**.

```bash
node scripts/verificar-patrocinio.mjs <hash> [<hash> …] [--red testnet|mainnet] \
  [--cuenta G…] [--billetera G…] [--antes <XLM>] [--espero-patrocinada | --espero-propia]
```

- `--cuenta G…` (la cuenta de quien sortea): su saldo, cuántas entradas le patrocinan (`num_sponsored`) y sus operaciones. Si alguna vez recibió fondos (un `payment`, un `create_account` con saldo inicial, un merge hacia ella), avisa que la prueba de 0 XLM queda anulada.
- `--billetera G…` (la billetera que paga): su saldo de hoy. Con `--antes <XLM>` comprueba, al stroop, que lo que bajó son exactamente las comisiones de los hashes, más 0,00003 XLM (300 stroops) si en el medio se abrió una cuenta nueva.
- `--espero-propia` es el control negativo: falla si alguna transacción NO la pagó su propia cuenta (con la regla de patrocinio apagada, por ejemplo).
- Sale con 1 si alguna transacción no es lo esperado o si la prueba se anuló, y con 2 si los argumentos están mal.

La prueba con 0 XLM, en testnet, paso a paso:

1. Anotar el saldo de la billetera que paga: `node scripts/verificar-patrocinio.mjs --billetera G…`.
2. Abrir el sitio con `?grifo=0`, entrar con un correo (un alias nuevo cuenta como otra persona) y copiar la dirección de la cuenta desde el panel. No tiene que haber ninguna caja de fondos ni botón de pedir plata de mentira.
3. Cargar una lista y sellar. Si se aprieta antes de que la cuenta exista, la línea dice "Preparando tu cuenta…". Esperar la ronda y sortear. Anotar los dos hashes (el enlace de "Quedó en Stellar").
4. `node scripts/verificar-patrocinio.mjs <sello> <sorteo> --cuenta G… --billetera G… --antes <saldo anotado>`. Lo que hay que ver: cada hash **PATROCINADA**, la cuenta "nunca recibió fondos y sigue en 0 XLM", y la billetera "coincide al stroop".

La lógica que decide (el veredicto a partir de lo que dice Horizon, y los montos en `BigInt` de stroops, nunca en flotantes) está en `scripts/lib/patrocinio.mjs`, sin red, y se prueba con respuestas reales guardadas en `scripts/lib/muestras-patrocinio/`: un sello y un sorteo patrocinados y un sorteo que pagó su propia cuenta.

Para quien toque esto, lo que se comprobó el 19 de octubre de 2026 y no está en ninguna documentación:

- La documentación de Pollar (docs.pollar.xyz y su `llms-full.txt`, que coinciden entre sí) describe el SDK **0.11.5**; la app corre `@pollar/core` **0.11.3**, que no tiene `refreshWalletState`, `SDK_WALLET_NOT_READY`, `createWallet` ni `cosign_pending`. Ante la duda manda el código de `node_modules/@pollar/core`.
- `signAndSubmitTx` no lanza: devuelve `{ status: "error" }` con el motivo en `resultCode`, `details`, `code` o `message` según el camino que tome su servidor. `mensajeDeRechazo` (`wallet-pollar.ts`) los junta; antes se leía solo `code ?? details` y se perdía la causa.
- `client.seal()` no lanza cuando la simulación falla (por ejemplo, la ronda a menos de 30 s): devuelve la transacción sin armar. El `signAndSend` del SDK lo nota; una wallet que recibe el XDR, como Pollar, no, y la red la rechaza como `txMALFORMED`. `submitElsewhere` lee `simulationData` antes de entregarla.
- `sent.result` del SDK de Stellar (17.1) revienta con `TypeError: Cannot read properties of undefined (reading 'type')` cuando una transacción entró a un ledger y falló: con el protocolo 23 o posterior la respuesta trae `returnValue` como una clave sin valor, y el SDK la lee igual en vez de decir "Transaction failed!". Nadie lo reconocía, así que el sello no se reintentaba con otra ronda cuando esta quedaba a menos de 30 s (medido el 20 de octubre de 2026: 6 de 16 sellos con la cuenta de prueba en el recorrido del auditor de interfaz, también antes de los cambios de fondos). `resultadoDe` (`anchor.ts`) mira el estado antes y lanza `tx-FAILED`, que `selloSinGrabar` ya reintenta.
- La red rechaza por falta de saldo al recibir la transacción, antes de incluirla en un ledger: reintentar no puede dejar dos sellos ni gastar la secuencia de la cuenta.

**Cuándo se reintenta una transacción y cuándo no (D-17).** Nicolás, 21 de octubre de 2026: "es muy común que por el internet salga 'la red rechazó tu transacción'". Casi nunca era la red rechazando algo: era un corte de wifi que nadie reconocía, y el mensaje genérico decía otra cosa. La regla que manda todo lo de abajo: **ningún reintento puede crear un segundo sello**, porque sellar la misma lista varias veces es el ataque que sigue abierto (seguridad.html).

1. **Qué pasó (`src/stellar/errores.ts`, sin el SDK).** El corpus de `errores.test.ts` junta los errores de cada fuente, medidos el 21 de octubre de 2026 en Chrome por DevTools y en la testnet con el SDK, y documentados para Safari, Firefox, Pollar y Freighter. Lo que caía en el genérico: Safari dice "Load failed"; el SDK envuelve el corte en un `AxiosError` (no un `TypeError`); un RPC caído o saturado contesta 5xx o 429; un error de JSON-RPC llega como objeto plano, no como `Error`; un tiempo agotado dice "signal timed out" o "Request timed out after 30000ms"; el rechazo del SDK empieza con "Sending the transaction to the network failed!", y por esa palabra la secuencia corrida salía como red caída; Freighter deja la cancelación en la causa del error; y el SDK dice "Account not found" también ante un corte. `errorKey` lee el mensaje, el nombre, el código, la causa y el estado HTTP, y suma tres claves: `offline` ("Estás sin internet", con `navigator.onLine` en falso), `unconfirmed` (se mandó y no se sabe) y `wallet` (la billetera no aprobó por otra cosa que la persona). Cada mensaje dice qué pasó y qué hacer, en los dos idiomas, y una prueba lo exige.
2. **El sorteo se reintenta solo (`src/ui/sorteo-seguro.ts`).** Es seguro: el contrato acepta un sorteo por sello (`AlreadyDrawn`) y el resultado sale de la ronda y de la lista, no de quién lo manda. Ante la red caída u ocupada, lo que no se pudo confirmar, la ronda que la cadena todavía no ve (`RoundNotReady`, porque su hora va unos segundos atrás) o lo que no se entiende, vuelve a probar a los 2, 4, 8 y 16 segundos, sin pasar de 90 en total, y antes de cada intento mira si ya quedó registrado (`readDraw`). No reintenta lo que no se arregla esperando: la persona canceló, no hay saldo, la cuenta no está lista, el sorteo no existe o el contrato no acepta la prueba de la ronda. Antes eran cuatro intentos cada cinco segundos con cualquier error: con Freighter, cancelar abría la ventana de aprobar tres veces más. Mientras espera, la sala lee lo que pasó (`avisoDelReintento`): "La red no contestó", "La red está ocupada", "La cadena todavía no ve esa ronda" o "Todavía no quedó grabado", con el número del intento.
3. **El sello no se duplica (`src/stellar/envio.ts`, `src/ui/sello-seguro.ts`).** Con Freighter o la cuenta de prueba se firma una vez y se manda esa misma transacción hasta saber cómo terminó (`enviarYConfirmar`): un corte al mandar se arregla reenviando la misma, que la red aplica una sola vez (repetida da `DUPLICATE`, y ya aplicada, `TRY_AGAIN_LATER`, medido), sin otra ventana de la billetera. Con Pollar, que firma y manda desde su servidor, se pregunta por el hash de la transacción que se le entregó: la envuelve en un fee-bump para pagar la comisión, y el RPC la encuentra igual por ese hash (medido con el sello patrocinado `93a2c960…`). Si no se sabe si un sello entró, sale un `SelloIncierto` y, antes de cualquier otra cosa, `resolverSello` lo averigua con la red de testigo y nunca con el reloj del navegador: si el contrato lo tiene (misma cuenta, huella y ronda), es ese; si su transacción falló adentro de un ledger, no entró; si la red ya cerró un ledger a la hora `round_time - 30` o después y el contrato, leído en ese ledger o en uno posterior, no lo tiene, no entró ni puede entrar, porque el contrato ya no lo aceptaría. Recién ahí se sella con otra ronda. Si no se puede averiguar, no se manda nada: se guarda el intento (`tinkazo.sello.pendiente`, con la red y el contrato) y el próximo clic sobre la misma lista empieza por averiguarlo; si entró, se retoma ese sello con su premio y su cantidad de ganadores. Un corte antes de mandar nada (al armar o simular) se reintenta dos veces, solo, y cada vez con la ronda elegida de nuevo desde ese momento: conservarla mientras "alcanzara" competía por décimas con el chequeo de 40 segundos de `sellar` y gastaba un cambio de ronda (medido en la testnet). Lo que se mandó y no se sabe cómo terminó nunca cuenta como un corte antes de mandar, aunque la causa sea un corte. Lo que falló sin dejar nada por la ronda (`RoundTooSoon`, entró y falló, venció, la secuencia) se reintenta con otra ronda, hasta tres intentos en total, como antes.
4. **La espera.** `NOT_FOUND` mientras la transacción sigue viva no es una falla: se espera, y cada tanto se reenvía la misma. "Venció" se dice con la hora de cierre del ledger pasada del `maxTime`. Cada pedido tiene tope de 10 segundos (el SDK no le pone ninguno: un pedido colgado colgaba el sorteo, medido). Sin poder hablar con la red, el sello espera 20 segundos y su averiguación otros 20; el sorteo, 15, porque la sala está mirando y `draw.ts` vuelve a probar.
5. **Cuánto vive cada envío.** El sello vale hasta 15 segundos después de `round_time - 30`: más tarde entraría y fallaría, con la comisión cobrada; así la red lo descarta gratis. Antes valía cinco minutos. El sorteo vale un minuto si la cuenta firma sola y tres con Freighter. Con Freighter, además, la ronda va con 45 segundos más de margen (casi un minuto para leer y aprobar), y si al aprobar la ronda ya no alcanza (menos de 35 segundos), no se manda y se pide otra.
6. **El detalle para la próxima vez (`src/ui/detalle-error.ts`).** Bajo el mensaje queda plegado "Ver detalle", con una línea para copiar: la hora, el paso, la red, el tipo de cuenta, la clave y el código técnico (`codigoTecnico`: del rechazo, el estado y el código; de la simulación, el error del host, sin el registro de eventos, que trae la cuenta, la huella y el premio; las cuentas, tapadas). Los últimos cinco quedan en este navegador (`tinkazo.errores`).

Probado de punta a punta en la testnet con la cuenta de prueba, el 21 de octubre de 2026, cortando la red con DevTools: con la respuesta del envío perdida en el camino (la red sí la recibió), el sello se confirmó con la misma transacción; con la red cortada justo después de mandar, a los 46 segundos dijo que no pudo confirmar, y al volver la red y apretar de nuevo retomó el sello que había entrado, sin mandar otro; con la simulación cortada dos veces, selló al tercer intento; y el sorteo con la respuesta perdida se grabó con la misma transacción. En los cuatro, un solo sello de la lista en el contrato. Repetido el mismo día, ya fusionado con integ/subida-2, con un arnés que corta la red de Stellar desde DevTools (Fetch) y después cuenta los sellos en el contrato, dos corridas de 19 de 19 comprobaciones. La segunda, con los arreglos de esta tanda: sello con la respuesta del envío perdida (se confirmó solo en 7,6 segundos, la misma transacción mandada dos veces); sorteo con la respuesta perdida (grabado solo en 2,6 segundos); sello con la respuesta perdida y la red cortada 75 segundos (a los 44 dijo "Lo mandamos, pero no pudimos confirmar si entró", guardó el intento y, con la red de vuelta, el segundo clic retomó el sello en 1,3 segundos sin mandar nada); sorteo con la red cortada 25 segundos (cuatro avisos de reintento y grabado a los 33); y sello con la red cortada 4 segundos al apretar (reintentó solo y selló en 9,7 segundos; en la primera corrida, antes de elegir la ronda de nuevo tras el corte, pasaba por "la ronda quedó cerca" y tardaba 18,9). En las dos, un solo sello por lista en el contrato y los sorteos grabados.

La lectura del contrato para buscar el sello de un intento (`selloDelIntento`, en `seals.ts`) usa `getLedgerEntries` con claves armadas a mano, como `sealsOnChain`: es la única forma de recorrer por lotes los últimos sorteos sin una simulación por cada uno.

**La capa de juegos.** `overlay.ts` expone un `Stage` con el lienzo, el azar sembrado con `beacon.randomness`, los chips con avatar, los subtítulos del estadio y el desmontaje idempotente. Un juego nuevo pide `mount()` y recibe todo eso; si devuelve `null` es porque corre en modo `?instant=1` y hay que cerrar el sorteo de una.

Dos reglas que valen para todos los juegos:

- **Ninguno decide nada.** El ganador llega por parámetro desde `playGame()` en `src/ui/draw.ts`. Lo único sembrado es cómo se ve.
- **Nunca `Math.random()`.** Todo el azar visual sale del PRNG de `overlay.ts`, así que la misma ronda dibuja siempre la misma animación en cualquier navegador. Eso incluye las frases del narrador: `setPickSeed()` le presta ese azar a `src/i18n.ts` mientras hay un juego corriendo.

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
- Toda transacción sigue: construir → simular → firmar → enviar y confirmar (`enviarYConfirmar`: la misma transacción firmada hasta saber cómo terminó, D-17); la UI muestra estado por paso y el hash en cuanto existe (checklist UX del skill `dapp`).
- La app nunca guarda llaves; la wallet firma. Los archivos `.env*`, `.vercel/` y `.stellar/` están ignorados por git.
- Las direcciones de contrato se cambian solo vía `deployments.ts` + `deployments.md` en el mismo commit.

**Todo colaborador debe:**
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
│   │   ├── wallet.ts             # adaptadores de wallet: Freighter y la cuenta de prueba
│   │   └── contract.ts           # contract.Client tipado
│   ├── games/
│   │   ├── overlay.ts            # andamiaje compartido: estadio, semilla, chips, skip
│   │   ├── lore.ts               # las tarjetas con su fuente
│   │   ├── constellation.ts      # Constelación Stellar
│   │   ├── ledger.ts             # Cierre de Libro
│   │   ├── pasanaku.ts           # Pasanaku
│   │   ├── race.ts               # carrera, con temas (llamas y cohetes)
│   │   ├── themes.ts
│   │   └── wheel.ts              # ruleta
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
│   └── capturas/
├── .github/workflows/ci.yml
├── Cargo.toml                    # workspace
├── package.json · pnpm-lock.yaml · vite.config.ts · tsconfig.json · vercel.json
├── README.md · README.es.md · LICENSE · .gitignore
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
| Wallet (Freighter o cuenta de prueba) | Firmar `seal` y `draw` | Sin wallet: modo libre; red equivocada: bloqueo con aviso |
| stellar.expert | Enlaces de exploración | Solo enlaces |
| Pollar (v1.1) | Login social + `signAndSubmitTx` | Si cae, queda la wallet externa |
| Enlaces cortos (`c.tinkazo.app`, Worker de Cloudflare, D-18) | Guardar y devolver la copia cifrada de un comprobante | Al compartir, se usa el enlace largo sin esperar más de 5 s; en el resultado en grande, el QR sale con el largo a los 2 s. Un enlace corto ya compartido no abre hasta que vuelva; el largo sigue en Mis sorteos |

## Validación

**Coherencia.** Las decisiones encajan: quicknet (D-01) habilita la verificación on-chain (D-02) y el compromiso temporal (D-03); la inmutabilidad (D-04) y el `draw` sin permiso (D-05) refuerzan la promesa del producto; Vite vanilla (D-08) preserva la interfaz v1 y admite los SDKs (D-09, D-10).

**Cobertura.** Cada FR del PRD está mapeado a una épica en [epics.md](epics.md). NFR-1 se garantiza con vectores cruzados; NFR-2 con la ausencia de backend en el camino del sorteo (D-07 quedó sin servidor; el único es el de los enlaces cortos, D-18, que no decide nada y tiene el enlace largo de respaldo); NFR-3 se mide en 1.4; NFR-4 con `.gitignore` y la comprobación previa a mainnet (`pnpm preflight:mainnet`), que revisa que no haya semillas en el repositorio; NFR-6 porque el contrato solo recibe `list_hash`.

**Brechas.**
- *Resuelta (2026-09-16):* el costo real de `pairing_check` es despreciable (0,003 XLM); el plan B de D-02 no hace falta. El costo por sorteo lo domina la renta de almacenamiento (0,18 XLM) y NFR-3 se ajustó a 0,25 XLM.
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

**Estado:** LISTA PARA IMPLEMENTAR CON BRECHAS MENORES. Confianza alta en el contrato (probado en testnet con un sorteo real); media en la integración de wallet hasta cerrar la historia 3.2 en testnet.

**Primera prioridad de implementación:** historia 2.1 (migración a Vite + TypeScript con pnpm y paridad visual), seguida de 2.2 y 2.3 (protocolo v2 y quicknet en el navegador).
