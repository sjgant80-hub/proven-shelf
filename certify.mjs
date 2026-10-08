// certify.mjs — the registry polices itself. Every shelf listed in certified.json must still be
// provable RIGHT NOW: this fetches the shelf's published receipt and live catalog, re-runs the
// gate (shelf-gate.mjs, the mutation-gated kernel), and refuses the registry if any anchor no
// longer reproduces. A certification here is never a memory of a pass — it is a claim that is
// re-verified on every push and every week on cron, the same discipline kar-hub runs on itself.
//
// Thin IO shim: all decisions come from kernel functions. Zero dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha, lf, errMsg, verifyReceipt } from './shelf-gate.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const registry = JSON.parse(readFileSync(here('./certified.json'), 'utf8'));
const gateSourceSha = await sha(lf(readFileSync(here('./shelf-gate.mjs'), 'utf8')));

const shelves = Array.isArray(registry.shelves) ? registry.shelves : [];
if (shelves.length === 0) {
  console.error('certify: the registry is empty — no certified shelves yet (honest, not green-washed).');
  process.exit(0);
}

let failures = 0;
const flunk = (shelf, why) => { failures++; console.error('  ✗ ' + shelf + ': ' + why); };

for (const s of shelves) {
  let receipt, cat, badge;
  try {
    receipt = await (await fetch(s.receipt)).json();
    cat = await (await fetch(s.catalog)).json();
    badge = await (await fetch(s.badge)).json();
  } catch (e) { flunk(s.shelf, 'could not fetch its published files — ' + errMsg(e)); continue; }

  const r = await verifyReceipt(receipt, cat, gateSourceSha);
  if (r.status !== 'HOLDS') { flunk(s.shelf, 'receipt ' + r.status + (r.expected ? ' — re-run produces ' + r.expected + ', receipt says ' + r.got : '')); continue; }
  if (!r.v.badge) { flunk(s.shelf, 'the receipt holds but the shelf is no longer proven'); continue; }
  if (receipt.hash !== s.anchor) { flunk(s.shelf, 'registry anchor ' + s.anchor + ' does not match the published receipt ' + receipt.hash); continue; }
  if (badge.anchor !== receipt.hash) { flunk(s.shelf, 'displayed badge anchor does not match the receipt'); continue; }
  if (badge.color !== 'brightgreen') { flunk(s.shelf, 'displayed badge is not green for an admissible receipt'); continue; }
  console.error('  ✓ ' + s.shelf + ': HOLDS — ' + r.v.summary.proven + '/' + r.v.summary.products + ' listings proven, anchor ' + receipt.hash.slice(0, 12) + '…');
}

if (failures) { console.error('certify: ' + failures + ' certified shel(f/ves) no longer prove — the registry refuses itself'); process.exit(1); }
console.error('certify: all ' + shelves.length + ' certified shelves still prove');
