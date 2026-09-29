# Tinkazo draw protocol: v2 (English translation)

This is a translation of [protocolo.md](protocolo.md) for readers who don't read Spanish. **The Spanish document is the normative one**: if the two ever differ, the Spanish text wins, and if the code differs from it, the code has a bug.

Any implementation that follows these steps (the Rust contract, the TypeScript site, or a third party's tool) gets exactly the same result. Both implementations in this repository must pass the shared test vectors in [vectors.json](vectors.json).

## 1. Canonical list

Input: text with one participant per line (or the first column of a CSV).

1. Split on line breaks (`\n` or `\r\n`).
2. For each line, take the text before the first comma and trim leading and trailing whitespace.
3. Drop lines shorter than 2 characters.
4. Drop exact duplicates (byte-for-byte, case-sensitive), keeping the first occurrence.
5. Keep the input order. Nothing is sorted.

The **canonical list** is the resulting sequence `e_0, e_1, …, e_{n-1}`, and `count = n`.

**Seal:** `list_hash = SHA-256( UTF-8( e_0 ‖ "\n" ‖ e_1 ‖ "\n" ‖ … ‖ e_{n-1} ) )`. No trailing newline. No Unicode normalization: the bytes are the ones that were pasted.

## 2. Beacon: drand quicknet

| Parameter | Value |
|---|---|
| Chain (`chain_hash`) | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| Scheme | `bls-unchained-g1-rfc9380` (signature in G1, public key in G2) |
| Period | 3 seconds |
| Genesis (`genesis_time`) | `1692803367` (Unix seconds) |
| Public key (G2, compressed, 96 bytes) | `83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a` |
| Relays | `https://api.drand.sh`, `https://api2.drand.sh`, `https://api3.drand.sh`, `https://drand.cloudflare.com` |
| Round endpoint | `/v2/chains/{chain_hash}/rounds/{round}` → `{ "round", "signature" }` |

**Time of a round:** `round_time(r) = genesis_time + (r − 1) · 3`.
**Round at an instant:** `round_at(t) = 1` if `t < genesis_time`; otherwise `⌊(t − genesis_time) / 3⌋ + 1`.

**Signed message:** `msg = SHA-256( BE64(round) )`, where `BE64` is the round number as an 8-byte unsigned big-endian integer.

**Signature check** (BLS12-381, RFC 9380):
- `H = hash_to_G1(msg, DST)` with `DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_"`.
- The signature `sig` (48 bytes compressed, or its 96-byte uncompressed form) is valid if `e(sig, G2) = e(H, PK)`, that is `pairing_check([sig, H], [−G2, PK]) = true`.

**Seed:** `randomness = SHA-256( compressed_sig_48_bytes )`. It matches, byte for byte, the `randomness` field drand publishes in its v1 API.

## 3. Commitment (seal)

The organizer picks a **target round** `R` and records on the contract:

`seal(organizer, list_hash, count, winners, R, meta)`

With `now = env.ledger().timestamp()`, the contract requires:

- `count ≥ 2`
- `1 ≤ winners ≤ min(count, 32)`
- `round_time(R) ≥ now + 30` (the seed does not exist yet when the list is sealed)
- `round_time(R) ≤ now + 30 · 86400` (at most 30 days ahead)
- `len(meta) ≤ 160` characters
- authorization from `organizer`

It stores `sealed_at = now` and the ledger number, and returns the draw `id` (sequential from 1).

## 4. Draw (record)

Anyone can call `draw(id, sig_uncompressed_96)` once `now ≥ round_time(R)`:

1. Check the signature as in §2 against the draw's `R`. If it fails: `InvalidSignature`.
2. Compress the signature to 48 bytes (§6) and compute `randomness = SHA-256(sig_48)`.
3. Run the selection (§5).
4. Store the record `{ id, round, signature_48, randomness, winners[], drawn_at }` and mark the draw as `Drawn`.

A draw is recorded only once (`AlreadyDrawn`).

## 5. Selection

Inputs: `randomness` (32 bytes), `list_hash` (32 bytes), `count = n`, `winners = k`.

```
chosen = []
ctr = 0
while len(chosen) < k:
    h   = SHA-256( randomness ‖ list_hash ‖ BE32(ctr) )
    idx = BE64( h[0..8] ) mod n
    if idx ∉ chosen: chosen.append(idx)
    ctr = ctr + 1
```

`BE32` and `BE64` are 4- and 8-byte unsigned big-endian integers. The `j`-th winner is entry `e_{chosen[j]}` of the canonical list, and the order of `chosen` is the order of the prizes.

The modulo bias with 64 bits of entropy over `n ≤ 2^32` is below `2^-32` and is considered negligible.

## 6. Compressing a G1 point

Given the uncompressed point `x ‖ y` (48 + 48 bytes, big-endian, flag bits set to zero):

```
c = x
c[0] |= 0x80                       # "compressed" flag
if y > (p − 1) / 2:  c[0] |= 0x20  # sign flag: y is the "larger" root
```

where `p` is the base field modulus of BLS12-381 and `(p − 1)/2 = 0x0d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555`. The comparison is numeric over 384-bit integers (equivalent to comparing the 48 big-endian bytes lexicographically).

## 7. Verification by a third party

With the receipt (network, contract address, `id`, canonical list):

1. Recompute `list_hash` (§1) and compare it with the one in the seal read from the contract; compare `count`.
2. Read `R` and `sealed_at` from the seal and check that `round_time(R) ≥ sealed_at + 30`.
3. Fetch round `R`'s signature from a drand relay (§2) and verify it against the quicknet public key. Compare it with the signature in the record.
4. Recompute `randomness` and the selection (§5) and compare with the record.
5. Map the indices to names.

If all five steps match, the result is the only one possible for that sealed list at that moment. Nobody, neither the organizer nor Tinkazo, could have picked it.

## 8. Free mode (no contract)

The same protocol without §3 and §4. The browser seals the list (§1), takes the beacon's most recent round after the seal, verifies the signature (§2) and runs the selection (§5). The receipt says so explicitly: the time order between seal and seed is not witnessed by a third party.

## 9. Differences from v1

The original demo (August 2026) used drand's *default* chain (30 s, chained signatures) and the formula `sha256("randomness|digest|p") mod pool`, drawing without replacement. v2 moves to quicknet, commits to a future round, includes `list_hash` in every selection iteration and defines the signature compression so that `randomness` matches drand's. v1 draws cannot be verified with this document.
