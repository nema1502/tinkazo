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
| Endpoint de ronda | `/v2/chains/{chain_hash}/rounds/{round}` → `{ "round", "signature" }` |

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

## 8. Modo libre (sin contrato)

El mismo protocolo, sin §3 ni §4. El navegador sella la lista (§1), toma la ronda más reciente del faro posterior al sello, verifica la firma (§2) y ejecuta la selección (§5). El comprobante lo indica explícitamente: el orden temporal entre sello y semilla no está atestiguado por un tercero.

## 9. Diferencias con v1

El demo original (agosto de 2026) usaba la cadena *default* de drand (30 s, firmas encadenadas) y la fórmula `sha256("randomness|digest|p") mod pool` con extracción sin reemplazo. v2 cambia a quicknet, compromete una ronda futura, incluye `list_hash` en cada iteración de la selección y define la compresión de la firma para que `randomness` coincida con drand. Los sorteos v1 no son verificables con este documento.
