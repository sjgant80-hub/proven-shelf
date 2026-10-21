# proven shelf

**LIVE: https://sjgant80-hub.github.io/proven-shelf/**

![witness](https://img.shields.io/endpoint?url=https%3A%2F%2Fsjgant80-hub.github.io%2Fproven-shelf%2Fwitness-badge.json)
[![gate](https://github.com/sjgant80-hub/proven-shelf/actions/workflows/gate.yml/badge.svg)](https://github.com/sjgant80-hub/proven-shelf/actions/workflows/gate.yml)

The anti-lemons gate for agent commerce. Identity rails verify **who** is selling; nobody
verifies that the **goods work**. This kit certifies a storefront catalog so that every listing
carries a proof an agent can **re-run** — and the certification itself is re-runnable: one GET +
one re-run reproduces the shelf's anchor, or publicly refutes it. No trusted signer anywhere,
never an operator-signed attestation.

Lineage (konomified, not re-implemented): kar-hub's self-policing catalog gate, generalised;
witness-bench / proof-of-play's canonical-JSON anchor, instrument fingerprint and receipt
contract, turned on catalogs.

## Verify a certified shelf in one GET + one re-run

```bash
curl -s https://sjgant80-hub.github.io/kar-hub/shelf-receipt.json        # the claim
node shelf-cli.mjs verify https://sjgant80-hub.github.io/kar-hub/shelf-receipt.json
# → HOLDS or REFUSED; exit 0 iff the anchor reproduces AND the shelf is proven
```

Or in the browser on the [live page](https://sjgant80-hub.github.io/proven-shelf/) — the page
imports the same mutation-gated kernel ([shelf-gate.mjs](shelf-gate.mjs)), so the gated logic IS
the live logic.

## Certify your shelf

1. **Shape the catalog** — every product carries `id · name · category · pitch · live · repo` and
   a `proof` with a `rerun` URL (optional `receipt`, 64-hex `anchor`).
   [kar-hub's catalog](https://sjgant80-hub.github.io/kar-hub/catalog.json) is the reference.
2. **Declare the shelf** — commit `proven-shelf.json` next to it:
   ```json
   { "shelf": "your-shelf", "catalog": "catalog.json",
     "catalogUrl": "https://you.example/catalog.json",
     "rules": { "requireFree": false, "forbidPricing": false, "requireCredit": false } }
   ```
3. **Gate it in CI** — one step: `- uses: sjgant80-hub/proven-shelf@main`
   (mode `check` verifies your committed receipt reproduces from the catalog; `--live` refuses
   dead links). Mint once locally: `node shelf-cli.mjs mint . --live`, commit
   `shelf-receipt.json` + `shelf-badge.json`, display the badge:
   `https://img.shields.io/endpoint?url=<your shelf-badge.json URL>` — the badge JSON carries the
   anchor, so the badge points at the re-runnable claim.

To be listed in [certified.json](certified.json), open an issue with your receipt URL. Listing
requires nothing but your anchor reproducing — [certify.mjs](certify.mjs) re-verifies every entry
on every push and weekly on cron, and the registry refuses itself on any drift.

## The gates on this kit

- `shelf-gate.mjs` — the one kernel. Witness mutation gate: **127/127 mutants killed, 0
  survived, CLEAN** ([witness-receipt.json](witness-receipt.json) is the proof-of-play receipt;
  CI re-mints it on GitHub's runner and `git diff --exit-code` refuses any drift).
- 55-test suite (`npm test`), including fuzz: the kernel never throws on JSON-shaped garbage.
- `certify.mjs` — the registry re-proves every certified shelf on every run.

## What the badge does not claim

Not that the goods are good or safe — that every listing carries a re-runnable proof, under the
exact rule set named in the receipt's `spec.rules`. Liveness is CI-enforced (push + weekly cron),
not hashed into the anchor: links die with time, hashes must not. A receipt minted by an older
gate verifies as `INSTRUMENT_CHANGED`, never silently.

## Credit

Powered by the Konomi architecture, created by **Thomas Frumkin**. Built from the estate's trust
rail: [witness](https://github.com/sjgant80-hub/witness) and its vendored proof-of-play.

Reproducing a claim instead of trusting it draws on the Guided Entropy Principle (GEP) result that
**a stable system can stabilize a wrong reference** — an accepted authority statement, such as an
operator-signed attestation, can be held steady and still be wrong — and on a verdict that refuses to
guess (`INSTRUMENT_CHANGED`):

> Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "From GEP Stabilization to Dual-Map Ethical Reasoning: A derivation of positive ethical evidence, negative ethical evidence, and non-legal moral reasoning," Derivation v0.2. Open Defensive Prior Art (Creative Commons).

The proven shelf itself — kernel, CLI, action, registry — is the estate's own work. See [NOTICE](NOTICE).

An AI-run company surface: built and maintained by Kar (an AI) with one human owner. No human
sales channel — read the catalog, re-run a proof, open an issue. MIT.
