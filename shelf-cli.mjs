#!/usr/bin/env node
// shelf-cli.mjs — the thin IO shim over shelf-gate.mjs (the mutation-gated kernel). This file only
// reads, writes, prints and exits; every decision it acts on comes from a kernel function the gate
// has verified. (Same division as witness: ci.mjs is the shim, witness-bench.mjs is the law.)
//
//   node shelf-cli.mjs gate  <shelfDir> [--config proven-shelf.json] [--live]
//   node shelf-cli.mjs mint  <shelfDir> [...]        write shelf-receipt.json + shelf-badge.json
//   node shelf-cli.mjs check <shelfDir> [...]        committed receipt must reproduce from the catalog
//   node shelf-cli.mjs verify <receiptUrl>           one GET + one re-run against a live shelf
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sha, lf, errMsg, parseCli, isHttpsUrl, assembleVerdict, mintReceipt, badgeEndpoint, headline,
  summaryMarkdown, verifyReceipt, liveness, shelfUrls, checkOutcome, verifyOutcome, livenessOutcome,
} from './shelf-gate.mjs';

const { mode, target, config, live } = parseCli(process.argv.slice(2));
const here = fileURLToPath(new URL('./shelf-gate.mjs', import.meta.url));
const gateSourceSha = await sha(lf(readFileSync(here, 'utf8')));
const out = (s) => console.error(s);

function finish(ok, v) {
  if (v && process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(v) + '\n'); } catch { /* best-effort */ }
  }
  process.exit(ok ? 0 : 1);
}

if (mode === 'verify') {
  if (!isHttpsUrl(target)) { out('verify needs a https receipt URL'); process.exit(2); }
  let receipt, cat;
  try {
    receipt = await (await fetch(target)).json();
    if (!isHttpsUrl(receipt.spec?.catalogUrl)) { out('receipt carries no https spec.catalogUrl — nothing to re-run against'); process.exit(2); }
    cat = await (await fetch(receipt.spec.catalogUrl)).json();
  } catch (e) { out('verify: could not fetch — ' + errMsg(e)); process.exit(2); }
  const r = await verifyReceipt(receipt, cat, gateSourceSha);
  console.log(JSON.stringify(r, null, 2));
  const o = verifyOutcome(r);
  out(o.line);
  finish(o.ok, r.v);
}

const root = resolve(target);
let cfg;
try { cfg = JSON.parse(readFileSync(isAbsolute(config) ? config : join(root, config), 'utf8')); }
catch (e) { out('no usable ' + config + ' in ' + root + ' — a shelf adopts the gate by declaring { "shelf", "catalog", "catalogUrl", "rules" }: ' + errMsg(e)); process.exit(2); }
let cat;
try { cat = JSON.parse(readFileSync(join(root, cfg.catalog ?? 'catalog.json'), 'utf8')); }
catch (e) { out('could not read the catalog: ' + errMsg(e)); process.exit(2); }

const v = await assembleVerdict(cat, { shelf: cfg.shelf, catalogUrl: cfg.catalogUrl, rules: cfg.rules, gateSourceSha });
out(headline(v));
for (const r of v.summary.perProduct) if (!r.ok) out('  ✗ ' + r.id + ': ' + r.problems.join('; '));
for (const c of v.summary.catalogProblems) out('  ✗ catalog: ' + c);

let ok = v.badge;

if (mode === 'mint') {
  writeFileSync(join(root, 'shelf-receipt.json'), JSON.stringify(mintReceipt(v), null, 2) + '\n');
  writeFileSync(join(root, 'shelf-badge.json'), JSON.stringify(badgeEndpoint(v), null, 2) + '\n');
  out('wrote shelf-receipt.json · shelf-badge.json (anchor ' + v.hash.slice(0, 12) + '…)');
}

if (mode === 'check') {
  let committed;
  try { committed = JSON.parse(readFileSync(join(root, 'shelf-receipt.json'), 'utf8')); }
  catch { out('check: no committed shelf-receipt.json — mint one first'); process.exit(2); }
  const o = checkOutcome(await verifyReceipt(committed, cat, gateSourceSha));
  out(o.line);
  if (!o.ok) ok = false;
}

if (live) {
  const o = livenessOutcome(await liveness(shelfUrls(cat), fetch));
  for (const l of o.lines) out(l);
  if (!o.ok) ok = false;
}

finish(ok, v);
