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
| Round endpoint | API v2: `/v2/chains/{chain_hash}/rounds/{round}` → `{ "round", "signature" }`. API v1: `/{chain_hash}/public/{round}` → `{ "round", "signature", "randomness" }`. The drand.sh relays serve both; `drand.cloudflare.com` serves only v1. Both routes return the same signature, and the seed is computed from the verified signature, not from the `randomness` field |

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

### 7.1 Verification from the transaction history

The contract's state expires (its entries live 7 days on testnet and 120 on mainnet) and keeping it alive costs rent. The transaction that sealed the list needs no rent: it stays in the transaction history for as long as someone keeps that history, and that "as long as" is not forever. Measured on October 25, 2026: the public mainnet Horizon keeps about 413 days (a moving window, and the SDF describes it as close to the end of its life), the Soroban RPC keeps 7 days, and the whole testnet is wiped on December 16, 2026. So the receipt can carry, besides the above, the hash of the seal transaction (`stx`) and of the draw transaction (`dtx`): 64 lowercase hexadecimal characters, both optional. A receipt without them is verified as always, and anything that doesn't have that shape is dropped on read.

When the contract's state doesn't have the draw (the instance is gone or the entry was archived) and the receipt carries `stx`, steps 1 and 2 come from the transaction instead of the state:

1. Fetch the transaction from the history of the receipt's network (Horizon, `GET /transactions/{stx}`) and decode its envelope with that network's passphrase. If a fee-bump wraps it, read the inner transaction. The envelope's hash, the transaction's or the inner one's, must be `stx`.
2. The transaction must have succeeded, have a single operation and be a call to `seal` on the receipt's contract, which must be one of the official contracts of that network (`src/stellar/deployments.json`). A previous contract only counts up to its last official seal: the transaction's ledger cannot exceed its `ultimoLedger` (the `sealed_ledger` of draw `ultimoId`). The draw number is not in the transaction (the contract returns it), so the cap by number cannot be applied here and this one replaces it. A previous contract without `ultimoLedger` is not accepted through history.
3. `organizer`, `list_hash`, `count`, `winners`, `R` and `meta` come from `seal`'s arguments; the transaction's ledger and the time that ledger closed (the `sealed_at` the contract would have stored) come from Horizon's record. The same checks apply as with the state: `list_hash` and `count` against the receipt's canonical list, `R` against the receipt's round, `1 ≤ winners ≤ min(count, 32)` and `round_time(R) ≥ close time + 30`.
4. Continue with steps 3, 4 and 5 above, with `winners` as the number of winners.

If the state does have the draw, the state governs and the transaction is only cross-checked against it: if they disagree about the seal, the result is red. A transaction the receipt cites that failed, or isn't a `seal` on an official contract, is red too. If the state doesn't have the draw and the transaction can't be read (no network, rate limit, an answer that makes no sense, that source no longer keeps operations that old (HTTP 410) or doesn't know the transaction (HTTP 404)), the result is **not confirmed** (`sin-red`): not green, not "not there", not red. With a 404 "it never existed" can't be told from "this source no longer keeps it", so an absence is not claimed either. "Not there" (`falta`) is for what has nobody to ask: a receipt without `stx`, or one for a previous contract without `ultimoLedger`. Red is only for a contradiction: the history that was read doesn't match the receipt or the state, or the transaction isn't an official seal. With the state at hand, a history that couldn't be read changes nothing.

**What it proves and what it doesn't.** It proves that a successful transaction, authorized by the organizer, committed that fingerprint, count, winners and round on an official contract, in a ledger that closed at least 30 seconds before the round's signature existed, and that the numbers add up. The arguments are bound by the transaction's hash. The rest has limits, and this version states them:

- **The draw number is not checked.** The transaction doesn't carry it (the contract returns it): the same seal comes out green with any number in the link. On this path, whoever shows the result identifies the draw by the date the seal's ledger closed and by the short code of its transaction (the first 8 characters of the inner transaction's hash), and the number, if shown, goes apart, as the one that appears in the receipt. The same seal cited by a fee-bump's outer hash or by the inner one is the same seal.
- **The same list sealed other times is not seen.** Two seals of the same list, in different rounds and from different accounts, both come out green on this path. Today that is only detected by looking at the contract's live state (docs/amenazas.md, "El ataque real: selección del compromiso"), which is not read here.
- **It proves nothing about the contract's state**: not that the result is recorded there (it comes out the same, since it derives from the round's signature), and not the list's other seals.
- **A single source.** That the transaction was included, that it succeeded, in which ledger and at what time that ledger closed is taken from Horizon, just as the state is taken from the RPC. If Horizon lied about the time or the ledger, the green from history would be wrong. A second independent source and the transactions' envelopes inside the receipt (so as not to depend on a source keeping the transaction) are planned for later; this version doesn't include them.
- **It lasts as long as the source keeps it.** With the times above: past the window, or if the source disappears, the result goes back to "not confirmed". Never "it doesn't exist", and not forever either.

### 7.2 Check against the history archives

§7.1 trusts a single source, Horizon, for the transaction having been included, in which ledger and when that ledger closed. This check does not: it redoes it with the history archives that organizations other than the SDF publish on their own, and it only says green when at least two return the same thing. It is a command-line tool, `scripts/verificar-archivo.mjs`, given the hash of a transaction (the proof's `stx` or `dtx`) or the whole proof. The verification page does not use it yet.

```bash
node scripts/verificar-archivo.mjs mainnet <transaction hash>
node scripts/verificar-archivo.mjs --enlace <verification link | comprobante.json>
```

Every 64 ledgers the validators publish a checkpoint. The one for ledger `L` ends at `P = L − (L mod 64) + 63` and is three compressed files: `ledger` (the headers of the 64 ledgers), `transactions` (each one's transaction set) and `results` (their results), at `<base>/<category>/xx/yy/zz/<category>-xxyyzzww.xdr.gz`, with `xxyyzzww` being `P` in eight hex digits. For each source the tool checks:

1. **Headers.** Each hash is the SHA-256 of its XDR, the ledgers are consecutive, each header points (`previousLedgerHash`) to the hash of the one before, the close time does not go backwards (since Protocol 30 two consecutive ledgers can close in the same second), and the file ends at `P`.
2. **The transaction.** An envelope in `L`'s transaction set has the wanted hash, SHA-256(network id ‖ envelope type ‖ transaction), the network id being the SHA-256 of the network passphrase. In a fee bump the seal is the inner transaction: the inner or the outer hash is accepted, and the result is looked up by the outer one.
3. **The ledger.** The SHA-256 of the set (the generalized set's, or the previous ledger hash followed by the envelopes) is the `txSetHash` of `L`'s header, and the SHA-256 of the results is its `txSetResultHash`.
4. **Success.** The transaction's result is a success (in a fee bump, the inner one too).
5. **The time.** The close time is that header's `closeTime`. Horizon, if allowed, is only used to learn which ledger to look in (`--ledger` avoids it): if it names the wrong ledger the transaction is not in it and there is no green.

| What happened | Verdict | Exit code |
|---|---|---|
| Two or more distinct organizations confirm and return the same header for `L` (and for the checkpoint) | green | 0 |
| Only one organization confirms | single source | 2 |
| None confirms, or a source whose file arrived and does not add up contradicts those that do, or two return different headers | not verified | 1 |

A source that does not answer (down, 404, cut download) neither adds nor subtracts. Two addresses on the same domain count as one organization. The usual sources are in `scripts/lib/fuentes-historial.json` (mainnet: the SDF, Franklin Templeton, LOBSTR, Blockdaemon and MoneyGram, with PublicNode as a spare; testnet: the SDF only) and `--fuentes` replaces them. Addresses rot (one has already vanished and another retired two nodes): the list is a data file that gets updated, and the proof does not point to any of them.

**What it proves and what it does not.**

- **It proves** that those organizations publish the same history and that in it the transaction was in that ledger, succeeded, and the ledger closed at that time. What is compared across sources is the header hash, which binds everything before it.
- **It does not check the SCP signatures** (the archive's `scp` category), which are what show the network accepted that header. A malicious archive could fabricate 64 coherent headers; what stops it is that the same one would have to be fabricated at every organization consulted. This is social confirmation, not cryptographic, and "independent" means distinct domains, not a guarantee about who operates what.
- It says nothing about the draw: not whether the seal is from an official contract nor whether the fingerprint is the list's. §7.1 checks that, with the proof.
- **Testnet.** As far as is known only the SDF publishes testnet history: with the usual sources the result is at most "single source". And since the whole network is wiped on December 16, 2026, there is nothing to check against afterwards; whoever wants to keep the evidence of a testnet draw has to keep the three files of its checkpoint (about 0.5 MB).
- **Mainnet.** It works as long as at least two of those organizations keep publishing, and none has committed to it. A checkpoint that just closed takes a while to be published (up to 64 ledgers, about 5 to 10 minutes, plus publication delay): before that it answers 404 and the result is "not verified". It downloads about 10 MB per source.
- **Protocol 30.** The ledger header is expected to change (vote on testnet on November 3, 2026 and on mainnet on November 23). The tool reads the records with the Stellar SDK's XDR (17.3.0 or later) and requires that re-encoding them gives the same bytes, so a header the SDK does not read in full fails loudly. It has been tested with headers from before the vote (`ledgerVersion` 29); one from after it is still to be tried.

As long as Stellar's public archives exist, your proof can be checked again with open tools. Nobody guarantees that period, not even us.

## 8. Free mode (no contract)

The same protocol without §3 and §4. The browser seals the list (§1), takes the beacon's most recent round after the seal, verifies the signature (§2) and runs the selection (§5). The receipt says so explicitly: the time order between seal and seed is not witnessed by a third party.

## 9. Differences from v1

The original demo (August 2026) used drand's *default* chain (30 s, chained signatures) and the formula `sha256("randomness|digest|p") mod pool`, drawing without replacement. v2 moves to quicknet, commits to a future round, includes `list_hash` in every selection iteration and defines the signature compression so that `randomness` matches drand's. v1 draws cannot be verified with this document.
