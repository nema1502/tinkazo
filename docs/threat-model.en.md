# Threat model: summary in English

A summary of [amenazas.md](amenazas.md) for readers who don't read Spanish. The Spanish document is the complete one, with every mitigation and its date. The protocol it refers to is in [protocol.en.md](protocol.en.md).

The product promises that **anyone can check a draw**. This document says what backs that promise, what doesn't yet, and what we decided not to do.

## What is protected

| Asset | Why it matters |
|---|---|
| The draw result | It is the product |
| The participant list | Real people's names; they never need to reach a server |
| The receipt | It lets a third party redo the draw years later |
| The organizer's account | It signs the transactions and pays the fees |

## Who could attack, and what they can't do

| Actor | Can | Cannot |
|---|---|---|
| The organizer | Choose the list, when to seal, what to publish | Choose the seed: it does not exist when the list is sealed |
| A participant | Read and recompute the receipt | Sign anything or touch the contract |
| Anyone watching | Read the chain, finalize a pending draw | Seal on someone else's behalf |
| A drand relay | Serve a round or not | Forge a round: the signature is checked against the public key |
| The drand network | Sign rounds | Cheat without compromising the League of Entropy threshold |
| Whoever hosts the site | Serve a different site | Change what is already on chain |
| The venue's network | Cut or intercept traffic | Forge a signature |

## Covered

- **Sealing for someone else:** `seal` requires `organizer.require_auth()`.
- **A made-up round:** `draw` verifies the BLS12-381 signature against quicknet's fixed public key inside the contract (CAP-0059).
- **Changing a name after sealing:** the SHA-256 of the list is on chain; any change gives a different hash and verification turns red.
- **Drawing twice for a better result:** `draw` stores the result once (`AlreadyDrawn`).
- **Blind reruns** (the `try_call` attack on the network PRNG described in [rs-soroban-sdk#1748](https://github.com/stellar/rs-soroban-sdk/issues/1748)): not applicable. Tinkazo doesn't use the network PRNG; the result comes from a drand round's signature, which doesn't exist at seal time and is unique per round, so every `draw` attempt gives exactly the same result and the contract keeps the first.
- **Picking a round that already exists:** `seal` requires the round to be born at least 30 seconds later, and at most 30 days.
- **A game showing another winner:** games receive the winner already decided, and an auditor checks every game against the protocol.
- **The organizer holding back a result they dislike:** `draw` needs no permission; anyone can finalize, and the verification page offers it.
- **Names leaking:** only the hash goes on chain; the receipt travels in the URL fragment, which browsers don't send to servers; QR codes and avatars are drawn in the browser. During a draw, the only request that leaves the browser is the beacon round.
- **Taking over the contract:** it has no admin, cannot be upgraded and holds no funds. There is no privilege to take.

## Open, and said out loud

**Commitment selection.** An organizer seals five different lists against five rounds and publishes only the receipt that suited them. Each draw is valid on its own. Today every seal is public under the organizer's address, and the verification page lists the other seals from that address and flags the same list hash sealed again, and the same head count with another hash. Since October 4, 2026 it also flags the same list sealed by **another** account, and the draw number is shown big during the wait so it ends up in the room's photos before the deciding number exists. The attack is visible, not closed. Closing it would require the organizer to announce the draw id through a channel they don't control before sealing.

**Padding the list before sealing.** The seal stops changes after the fact, not a bad list from the start: an organizer can add a friend three times with small variations, add filler names, or leave someone out. Today the list can come from a third party (the Luma import proposes only those who checked in: 35 of 67 in the first real export we tried), the import window groups names that match ignoring accents and case, and the full list travels in the receipt. Since October 4, 2026 the list can be shown to the room **before sealing**: full screen on the projector, duplicates flagged, with a QR that opens the same list on everyone's phone with a search box; the receipt has the same search ("you are number 37 of 120"). Still missing: a per-participant proof ("you were entry 37 of 120"), and a protocol v3 that sorts the canonical list and rejects the same hash sealed twice by the same address.

**Free mode.** Without the contract, nobody witnesses that the list existed before the seed. Verification shows yellow, not green.

**Testnet is reset on 16 December 2026.** Anchored testnet receipts stop verifying then. Real draws with outside participants have to be on mainnet. Receipts always carry the round signature, so the math can still be redone and the verdict drops to yellow instead of failing.

**Third-party mainnet RPC.** `mainnet.sorobanrpc.com` is not run by the SDF. The endpoint lives in one place so it can be swapped in one line; a fallback list with retries is pending before mainnet.

**drand's long-term operation.** Randamu, drand's corporate steward, closed in February 2026. The network is run by the League of Entropy, the four relays answer, and the risk is watched, not solved.

## Decided not to do

| Decision | Why |
|---|---|
| Encrypt the list in the receipt | Without the names nobody can recompute, and recomputing is the product |
| Keep anything on a server | A server is something you'd have to trust |
| Make the contract upgradable | An upgradable contract has an admin who can change the rules later |
| Use the ledger hash as seed | A validator can influence it, and it leaves no signature a third party can check years later |
