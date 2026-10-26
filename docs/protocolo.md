# Protocolo de sorteo Tinkazo: v2

Este documento es normativo. Cualquier implementación (el contrato en Rust, el sitio en TypeScript o una herramienta de un tercero) que siga estos pasos obtiene exactamente el mismo resultado. Si algo aquí y el código difieren, el código tiene un bug.

## 1. Lista canónica

Entrada: texto con un participante por línea (o la primera columna de un CSV).

1. Separar por saltos de línea (`\n` o `\r\n`).
2. Para cada línea, tomar el texto antes de la primera coma y recortar espacios al inicio y al final.
3. Descartar líneas de longitud menor a 2.
4. Descartar duplicados exactos (comparación byte a byte, sensible a mayúsculas), conservando la primera aparición.
5. El orden es el de entrada. No se ordena.

La **lista canónica** es la secuencia resultante `e_0, e_1, …, e_{n-1}`. `count = n`.

**Sello:** `list_hash = SHA-256( UTF-8( e_0 ‖ "\n" ‖ e_1 ‖ "\n" ‖ … ‖ e_{n-1} ) )`. Sin salto de línea final. Sin normalización Unicode: los bytes son los que se pegaron.

## 2. Faro: drand quicknet

| Parámetro | Valor |
|---|---|
| Cadena (`chain_hash`) | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| Esquema | `bls-unchained-g1-rfc9380` (firma en G1, clave pública en G2) |
| Período | 3 segundos |
| Génesis (`genesis_time`) | `1692803367` (Unix, segundos) |
| Clave pública (G2, comprimida, 96 bytes) | `83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a` |
| Relays | `https://api.drand.sh`, `https://api2.drand.sh`, `https://api3.drand.sh`, `https://drand.cloudflare.com` |
| Endpoint de ronda | API v2: `/v2/chains/{chain_hash}/rounds/{round}` → `{ "round", "signature" }`. API v1: `/{chain_hash}/public/{round}` → `{ "round", "signature", "randomness" }`. Los relays de drand.sh sirven las dos; `drand.cloudflare.com`, solo la v1. Las dos rutas dan la misma firma, y la semilla se calcula de la firma verificada, no del campo `randomness` |

**Tiempo de una ronda:** `round_time(r) = genesis_time + (r − 1) · 3`.
**Ronda de un instante:** `round_at(t) = 1` si `t < genesis_time`; si no, `⌊(t − genesis_time) / 3⌋ + 1`.

**Mensaje firmado:** `msg = SHA-256( BE64(round) )`, donde `BE64` es el número de ronda como entero sin signo de 8 bytes big-endian.

**Verificación de la firma** (BLS12-381, RFC 9380):
- `H = hash_to_G1(msg, DST)` con `DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_"`.
- La firma `sig` (48 bytes comprimidos, o su forma sin comprimir de 96 bytes) es válida si `e(sig, G2) = e(H, PK)`, es decir `pairing_check([sig, H], [−G2, PK]) = true`.

**Semilla:** `randomness = SHA-256( sig_comprimida_48_bytes )`. Coincide byte a byte con el campo `randomness` que publica drand en su API v1.

## 3. Compromiso (sello)

El organizador elige una **ronda objetivo** `R` y registra en el contrato:

`seal(organizer, list_hash, count, winners, R, meta)`

El contrato exige, con `now = env.ledger().timestamp()`:

- `count ≥ 2`
- `1 ≤ winners ≤ min(count, 32)`
- `round_time(R) ≥ now + 30` (la semilla todavía no existe cuando se sella)
- `round_time(R) ≤ now + 30 · 86400` (a lo sumo 30 días)
- `len(meta) ≤ 160` caracteres
- autorización de `organizer`

Guarda `sealed_at = now` y el número de ledger. Devuelve el `id` del sorteo (secuencial desde 1).

## 4. Sorteo (registro)

Cualquiera puede llamar `draw(id, sig_uncompressed_96)` una vez que `now ≥ round_time(R)`:

1. Verificar la firma según §2 contra `R` del sorteo. Si falla: `InvalidSignature`.
2. Comprimir la firma a 48 bytes (§6) y calcular `randomness = SHA-256(sig_48)`.
3. Ejecutar la selección (§5).
4. Guardar el registro `{ id, round, signature_48, randomness, winners[], drawn_at }` y marcar el sorteo como `Drawn`.

Un sorteo se registra una sola vez (`AlreadyDrawn`).

## 5. Selección

Entradas: `randomness` (32 bytes), `list_hash` (32 bytes), `count = n`, `winners = k`.

```
elegidos = []
ctr = 0
mientras len(elegidos) < k:
    h   = SHA-256( randomness ‖ list_hash ‖ BE32(ctr) )
    idx = BE64( h[0..8] ) mod n
    si idx ∉ elegidos: elegidos.append(idx)
    ctr = ctr + 1
```

`BE32` y `BE64` son enteros sin signo big-endian de 4 y 8 bytes. El ganador `j`-ésimo es la entrada `e_{elegidos[j]}` de la lista canónica. El orden de `elegidos` es el orden de los premios.

El sesgo del módulo con 64 bits de entropía sobre `n ≤ 2^32` es menor a `2^-32` y se considera despreciable.

## 6. Compresión de un punto G1

Dado el punto sin comprimir `x ‖ y` (48 + 48 bytes, big-endian, bits de bandera en cero):

```
c = x
c[0] |= 0x80                       # bandera "comprimido"
si y > (p − 1) / 2:  c[0] |= 0x20  # bandera de signo: y es la raíz "mayor"
```

con `p` el módulo del cuerpo base de BLS12-381 y `(p − 1)/2 = 0x0d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555`. La comparación es numérica sobre enteros de 384 bits (equivale a la comparación lexicográfica de los 48 bytes big-endian).

## 7. Verificación por un tercero

Con el comprobante (red, dirección del contrato, `id`, lista canónica):

1. Recomputar `list_hash` (§1) y compararlo con el del sello leído del contrato; comparar `count`.
2. Leer `R`, `sealed_at` del sello y comprobar `round_time(R) ≥ sealed_at + 30`.
3. Obtener la firma de la ronda `R` de un relay de drand (§2) y verificarla con la clave pública de quicknet. Comparar con la firma del registro.
4. Recomputar `randomness` y la selección (§5) y comparar con el registro.
5. Mapear los índices a nombres.

Si los cinco pasos coinciden, el resultado es el único posible para esa lista sellada en ese momento. Nadie, ni el organizador ni Tinkazo, pudo elegirlo.

### 7.1 Verificación por el historial de transacciones

El estado del contrato vence: sus entradas viven 7 días en testnet y 120 en mainnet, y mantenerlas cuesta renta. La transacción que selló la lista, en cambio, no necesita renta: sigue en el historial de transacciones mientras alguien lo guarde, y ese «mientras» no es para siempre. Medido el 25 de octubre de 2026: el Horizon público de mainnet guarda unos 413 días (una ventana que avanza, y la SDF lo describe cerca del final de su vida), el RPC de Soroban guarda 7 días, y la testnet entera se borra el 16 de diciembre de 2026. Por eso el comprobante puede traer, además de lo de arriba, el hash de la transacción del sello (`stx`) y el de la transacción del sorteo (`dtx`): 64 caracteres hexadecimales, en minúsculas. Los dos son opcionales; un comprobante sin ellos se verifica como siempre, y lo que no tiene esa forma se descarta al leerlo.

Cuando el estado del contrato no tiene el sorteo (la instancia ya no está o la entrada se archivó) y el comprobante trae `stx`, los pasos 1 y 2 salen de la transacción y no del estado:

1. Pedir la transacción al historial de la red del comprobante (en Horizon, `GET /transactions/{stx}`) y decodificar su sobre (`envelope_xdr`) con la passphrase de esa red. Si un fee-bump la envolvió, se lee la transacción interior. El hash del sobre, sea el de la transacción o el de la interior, tiene que ser `stx`: la respuesta de otra transacción no sirve.
2. La transacción tiene que haber salido bien, tener una sola operación y ser una llamada a `seal` del contrato del comprobante, que tiene que ser uno de los oficiales de esa red (`src/stellar/deployments.json`). Un contrato anterior solo vale hasta su último sello oficial: el ledger de la transacción no puede pasar de su `ultimoLedger`, que es el `sealed_ledger` del sorteo `ultimoId`. El número del sorteo no viaja en la transacción (lo devuelve el contrato), así que el tope por número no se puede aplicar por este camino y este lo reemplaza. Un contrato anterior sin `ultimoLedger` no se acepta por historial.
3. De los argumentos de `seal` salen `organizer`, `list_hash`, `count`, `winners`, `R` y `meta`. Del registro de Horizon salen el ledger de la transacción y la hora en que cerró, que es el `sealed_at` que habría guardado el contrato. Se comprueba lo mismo que con el estado: `list_hash` y `count` contra la lista canónica del comprobante, `R` contra la ronda del comprobante, `1 ≤ winners ≤ min(count, 32)` y `round_time(R) ≥ cierre + 30`.
4. Se siguen los pasos 3, 4 y 5 de arriba, con `winners` como cantidad de ganadores. La firma de la ronda sale del comprobante o de un relay de drand, y se verifica igual.

Si el estado sí tiene el sorteo, manda el estado, y la transacción solo se cruza con él: si no cuentan lo mismo del sello (quién lo hizo, la huella, la cantidad, los ganadores, la ronda, la hora, el ledger o el premio), el resultado es rojo. Una transacción que el comprobante cita y que falló, o que no es un `seal` de un contrato oficial, también da rojo. Si el estado no tiene el sorteo y la transacción no se puede leer —no hay red, hay límite de pedidos, el historial contesta algo que no se entiende, esa fuente ya no guarda operaciones tan antiguas (HTTP 410) o no conoce la transacción (HTTP 404)—, el resultado es **no confirmado** (`sin-red`): ni verde, ni «no está», ni rojo. Con un 404 no se distingue «nunca existió» de «esa fuente ya no la guarda», así que tampoco se afirma una ausencia. «No está» (`falta`) queda para lo que no tiene a quién preguntar: un comprobante sin `stx`, o con el de un contrato anterior sin `ultimoLedger`. Rojo, solo para una contradicción: el historial leído no cuadra con el comprobante o con el estado, o la transacción no es un sello oficial. Con el estado a mano, un historial que no se pudo leer no cambia el resultado.

**Qué prueba y qué no.** Prueba que una transacción exitosa, autorizada por el organizador, comprometió esa huella, esa cantidad, esos ganadores y esa ronda en un contrato oficial, en un ledger que cerró al menos 30 segundos antes de que existiera la firma de la ronda, y que las cuentas dan. Los argumentos quedan atados por el hash de la transacción. Lo demás tiene límites, y esta versión los dice:

- **El número del sorteo no se comprueba.** La transacción no lo trae (lo devuelve el contrato): el mismo sello sale verde con cualquier número en el enlace. Por este camino, quien muestre el resultado identifica el sorteo por la fecha en que cerró el ledger del sello y por el código corto de su transacción (los primeros 8 caracteres del hash de la transacción interior), y el número, si lo muestra, va aparte, como el que figura en el comprobante. Un mismo sello citado por el hash de afuera de un fee-bump o por el de adentro es el mismo sello.
- **La misma lista sellada otras veces no se ve.** Dos sellos de la misma lista, en rondas y cuentas distintas, salen verdes los dos por este camino. Hoy eso solo se detecta mirando el estado vivo del contrato (docs/amenazas.md, «El ataque real: selección del compromiso»), que por acá no se lee.
- **No prueba nada del estado del contrato**: ni que el resultado esté grabado en él (da lo mismo, porque sale de la firma de la ronda), ni los otros sellos de la lista.
- **Una sola fuente.** Que la transacción entró, que salió bien, en qué ledger y a qué hora cerró ese ledger se le cree a Horizon, igual que el estado se le cree al RPC. Si Horizon mintiera en la hora o el ledger, el verde por historial se equivocaría. Una segunda fuente independiente y los sobres de las transacciones dentro del comprobante (para no depender de que una fuente conserve la transacción) están previstos para más adelante; esta versión no los incluye.
- **Dura lo que la fuente guarde.** Con los tiempos de arriba: pasada la ventana, o si la fuente desaparece, el resultado vuelve a ser «no confirmado». Nunca «no existe», y tampoco para siempre.

### 7.2 Comprobación contra los archivos de historial

§7.1 le cree a una sola fuente, Horizon, que la transacción entró, en qué ledger y a qué hora cerró ese ledger. Esta comprobación no se lo cree: lo rehace con los archivos de historial que publican, cada una por su cuenta, organizaciones distintas de la SDF, y para dar verde exige que al menos dos devuelvan lo mismo. La hace una herramienta de línea de comandos, `scripts/verificar-archivo.mjs`, con el hash de una transacción (el `stx` o el `dtx` del comprobante) o con el comprobante entero. La página de verificación todavía no la usa.

```bash
node scripts/verificar-archivo.mjs mainnet <hash de la transacción>
node scripts/verificar-archivo.mjs --enlace <enlace de verificación | comprobante.json>
```

Cada 64 ledgers los validadores publican un punto de control. El del ledger `L` termina en `P = L − (L mod 64) + 63` y son tres archivos comprimidos: `ledger` (las cabeceras de los 64 ledgers), `transactions` (el conjunto de transacciones de cada uno) y `results` (sus resultados), en `<base>/<categoría>/xx/yy/zz/<categoría>-xxyyzzww.xdr.gz`, con `xxyyzzww` igual a `P` en ocho hexadecimales. Para cada fuente se comprueba:

1. **Cabeceras.** El hash de cada una es el SHA-256 de su XDR, los ledgers son seguidos, cada cabecera apunta (`previousLedgerHash`) al hash de la anterior, la hora de cierre no retrocede (desde el Protocolo 30 dos ledgers seguidos pueden cerrar en el mismo segundo) y el archivo termina en `P`.
2. **La transacción.** Un sobre del conjunto de `L` tiene el hash buscado, SHA-256(id de red ‖ tipo de sobre ‖ transacción), con el id de red igual al SHA-256 de la frase de la red. En un fee-bump el sello es la transacción interior: vale el hash de la de adentro o el de afuera, y el resultado se busca por el de afuera.
3. **El ledger.** El SHA-256 del conjunto (el del conjunto generalizado, o el del hash del ledger anterior seguido de los sobres) es el `txSetHash` de la cabecera de `L`, y el SHA-256 de los resultados es su `txSetResultHash`.
4. **El éxito.** El resultado de la transacción es un éxito (en un fee-bump, también el de la interior).
5. **La hora.** La hora de cierre es la `closeTime` de esa cabecera. Horizon solo sirve, si se lo deja, para saber en qué ledger buscar (`--ledger` lo evita): si dice un ledger equivocado, la transacción no aparece en él y no hay verde.

| Qué pasó | Veredicto | Salida |
|---|---|---|
| Dos o más organizaciones distintas confirman y devuelven la misma cabecera de `L` (y la del punto de control) | verde | 0 |
| Una sola organización confirma | una sola fuente | 2 |
| Ninguna confirma, o una fuente cuyo archivo llegó y no cuadra contradice a las que sí, o dos devuelven cabeceras distintas | no verificado | 1 |

Una fuente que no responde (caída, 404, descarga cortada) ni suma ni resta. Dos direcciones del mismo dominio cuentan como una sola organización. Las fuentes de siempre están en `scripts/lib/fuentes-historial.json` (mainnet: la SDF, Franklin Templeton, LOBSTR, Blockdaemon y MoneyGram, con PublicNode de reserva; testnet: solo la SDF) y se reemplazan con `--fuentes`. Las direcciones se pudren (ya se vio una que desapareció y otra que retiró dos nodos): la lista es un archivo de datos que se actualiza, y el comprobante no apunta a ninguna.

**Qué prueba y qué no.**

- **Prueba** que esas organizaciones publican el mismo historial y que en él la transacción estuvo en ese ledger, salió bien y el ledger cerró a esa hora. Entre fuentes se compara el hash de la cabecera, que ata todo lo anterior.
- **No comprueba las firmas SCP** (la categoría `scp` del archivo), que son lo que prueba que la red aceptó esa cabecera. Un archivo malicioso podría fabricar 64 cabeceras coherentes; lo que lo frena es que habría que fabricar la misma en cada organización que se consulta. Es una confirmación social, no criptográfica, y «independientes» quiere decir dominios distintos, no una garantía sobre quién opera qué.
- No dice nada del sorteo: ni que el sello sea de un contrato oficial ni que la huella sea la de la lista. Eso lo comprueba §7.1, con el comprobante.
- **Testnet.** Hasta donde se sabe, solo la SDF publica el historial de testnet: con las fuentes de siempre el resultado es, como mucho, «una sola fuente». Y como la red entera se borra el 16 de diciembre de 2026, después de esa fecha no hay de dónde comprobar; quien quiera conservar la prueba de un sorteo de testnet tiene que guardar los tres archivos de su punto de control (unos 0,5 MB).
- **Mainnet.** Funciona mientras al menos dos de esas organizaciones sigan publicando, y ninguna se comprometió a hacerlo. Un punto de control recién cerrado tarda en publicarse (hasta 64 ledgers, unos 5 a 10 minutos, más la demora de publicación): antes da 404 y el resultado es «no verificado». Baja unos 10 MB por fuente.
- **Protocolo 30.** Se espera que cambie la cabecera del ledger (votación en testnet el 3 de noviembre de 2026 y en mainnet el 23 de noviembre). La herramienta lee los registros con el XDR del SDK de Stellar (17.3.0 o posterior) y exige que al volver a codificarlos den los mismos bytes, así que una cabecera que el SDK no lee entera falla en voz alta. Está probada con cabeceras anteriores a la votación (`ledgerVersion` 29); falta probarla con una posterior.

Mientras los archivos públicos de Stellar existan, tu comprobante se puede volver a comprobar con herramientas abiertas. Nadie nos garantiza ese plazo, ni nosotros.

## 8. Modo libre (sin contrato)

El mismo protocolo, sin §3 ni §4. El navegador sella la lista (§1), toma la ronda más reciente del faro posterior al sello, verifica la firma (§2) y ejecuta la selección (§5). El comprobante lo indica explícitamente: el orden temporal entre sello y semilla no está atestiguado por un tercero.

**Sorteo sin sello.** Es también el modo libre cuando una cuenta que podría sellar sigue sin sello porque la red no lo dejó (la comisión por encima de lo que cubre el patrocinador, el RPC caído, un protocolo que la app todavía no conoce): quien organiza lo decide y confirma, y el comprobante, el resultado, lo que se comparte, Mis sorteos y el evento dicen "Sin sello: no se puede comprobar". La ronda se elige a 90 segundos (no a 45) y es una sola, R. Hasta `round_time(R) − 40` la app sigue intentando sellar **la misma lista con la misma R**; si el sello entra antes de `round_time(R) − 30`, el sorteo es anclado (§3) y el ganador es el mismo, porque lo decide la lista y R y no el momento del sello. Sellar otra ronda no es "anclar" ese sorteo: es otro sorteo. El mecanismo (§1 a §5) no cambia: solo cambia cómo se presentan los estados.

**La marca en el comprobante.** El comprobante de un sorteo sin sello lleva `sinSello: true`: un campo opcional del comprobante (§7) que solo puede ser `true`; falta en todos los demás, y lo que no es `true` se descarta al leerlo. Solo cuenta si el comprobante no dice estar anclado (sin red, contrato ni número): si trae un ancla, manda el ancla, y un sello que entró a tiempo apaga la marca. Viaja en el enlace de verificación y dentro de cada sorteo del enlace de evento, así que el mensaje para compartir, la foto, el mensaje al ganador, la pantalla grande, Mis sorteos, el enlace y la página del evento y la página de verificación dicen «Sin sello: no se puede comprobar» de ese sorteo, y ninguno lo llama «verificable» (un evento con alguno sin sello no dice «todos verificables»). La página de verificación muestra el mismo estado de un sorteo sin anclar (`libre`: la cuenta cierra, sin testigo) y además esa frase. Un comprobante sin la marca se lee como siempre, y una página anterior a la marca la ignora. La marca no prueba nada: quien arme un enlace puede quitarla, y entonces queda un sorteo libre, que la página ya muestra sin anclar y nunca como verificable.

## 9. Diferencias con v1

El demo original (agosto de 2026) usaba la cadena *default* de drand (30 s, firmas encadenadas) y la fórmula `sha256("randomness|digest|p") mod pool` con extracción sin reemplazo. v2 cambia a quicknet, compromete una ronda futura, incluye `list_hash` en cada iteración de la selección y define la compresión de la firma para que `randomness` coincida con drand. Los sorteos v1 no son verificables con este documento.
