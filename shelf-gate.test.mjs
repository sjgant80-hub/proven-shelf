// shelf-gate.test.mjs — the teeth. Written against witness's operator set: every comparison is
// pinned from both sides, every boolean join has a case where flipping it changes the verdict,
// golden anchors kill the whole hash-coverage class (the-doubt lesson), and a fuzz pass holds the
// kernel to "never throws on garbage". The CLI shim is exercised end-to-end by spawning it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE_VERSION, CREDIT, VERIFY_URL, canon, sha, lf, errMsg, normRules, checkProduct, checkCatalog,
  shelfUrls, specFingerprint, assembleVerdict, mintReceipt, badgeEndpoint, headline, summaryMarkdown,
  verifyReceipt, liveness, parseCli, isHttpsUrl, checkOutcome, verifyOutcome, livenessOutcome,
} from './shelf-gate.mjs';

// ── fixtures ─────────────────────────────────────────────────────
const ANCHOR64 = 'a'.repeat(64);
const goodProduct = () => ({
  id: 'alpha', name: 'Alpha', category: 'trust-rail', pitch: 'does a thing, provably',
  live: 'https://example.test/alpha/', repo: 'https://github.example/alpha', free: true,
  proof: { kind: 'witness-gate', rerun: 'https://ci.example/alpha/rerun', receipt: 'https://example.test/alpha/receipt.json', anchor: ANCHOR64 },
});
const consoleProduct = () => ({
  id: 'beta', name: 'Beta', category: 'tool', pitch: 'interactive proof in the console',
  live: 'https://example.test/beta/', repo: 'https://github.example/beta', free: true,
  proof: { kind: 'live-console' },
});
const goodCatalog = () => ({
  catalog: 'fixture/agent-catalog', version: '1',
  credit: 'Powered by the Konomi architecture, created by Thomas Frumkin.',
  contact: { channel: 'github-issues', url: 'https://github.example/fixture/issues' },
  products: [goodProduct(), consoleProduct()],
});
const STRICT = { requireFree: true, forbidPricing: true, requireCredit: true };
const LAX = {};
const SPEC_IN = { shelf: 'fixture-shelf', catalogUrl: 'https://example.test/catalog.json', rules: STRICT, gateSourceSha: 'testsha' };

// golden anchors — pinned hex. If these move, the instrument changed and GATE_VERSION must move
// with it; that is the point of pinning them.
const GOLDEN_FP = '5aa63dcd8ef10104be0be9a382baf679b0f1f9422d62c35606525375da190889';
const GOLDEN_CATALOG_SHA = '28ba5cb9a9e19fd00347d111a9c6e7ad470ee6dbed8eea8b450d5f3bd1b5c1e8';
const GOLDEN_ANCHOR = 'a42fc025041876c3f7462300a3945365b131149b21d3e25932172a94590d1602';

// ── canon / sha / lf / errMsg ────────────────────────────────────
test('canon: primitives, arrays in order, object keys sorted recursively', () => {
  assert.equal(canon(null), 'null');
  assert.equal(canon(5), '5');
  assert.equal(canon('a'), '"a"');
  assert.equal(canon(true), 'true');
  assert.equal(canon({}), '{}');
  assert.equal(canon({ b: 1, a: [{ d: 2, c: 3 }, null, 'x', true] }), '{"a":[{"c":3,"d":2},null,"x",true],"b":1}');
});
test('sha: known SHA-256 vectors', async () => {
  assert.equal(await sha(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('lf: CRLF and bare CR both become LF', () => {
  assert.equal(lf('a\r\nb\rc\n'), 'a\nb\nc\n');
});
test('errMsg: message when there is one, the value itself when not', () => {
  assert.equal(errMsg(new Error('boom')), 'boom');
  assert.equal(errMsg('plain'), 'plain');
  assert.equal(errMsg(null), 'null');
});

// ── normRules ────────────────────────────────────────────────────
test('normRules: only literal true switches a rule on; garbage is all-off', () => {
  assert.deepEqual(normRules(null), { requireFree: false, forbidPricing: false, requireCredit: false });
  assert.deepEqual(normRules('x'), { requireFree: false, forbidPricing: false, requireCredit: false });
  assert.deepEqual(normRules({ requireFree: true }), { requireFree: true, forbidPricing: false, requireCredit: false });
  assert.deepEqual(normRules({ requireFree: 'yes', forbidPricing: 1, requireCredit: true }), { requireFree: false, forbidPricing: false, requireCredit: true });
  assert.deepEqual(normRules(STRICT), { requireFree: true, forbidPricing: true, requireCredit: true });
});

// ── checkProduct ─────────────────────────────────────────────────
test('checkProduct: a clean strict product has zero problems', () => {
  const r = checkProduct(goodProduct(), STRICT);
  assert.deepEqual(r, { id: 'alpha', ok: true, problems: [] });
});
test('checkProduct: non-objects are refused without throwing', () => {
  for (const bad of [null, 'x', 7, []]) {
    assert.deepEqual(checkProduct(bad, LAX), { id: '(not an object)', ok: false, problems: ['listing is not an object'] });
  }
});
test('checkProduct: each missing required field is named', () => {
  const p = goodProduct(); delete p.name;
  assert.deepEqual(checkProduct(p, STRICT).problems, ['missing name']);
  const q = goodProduct(); q.pitch = '   ';
  assert.deepEqual(checkProduct(q, STRICT).problems, ['missing pitch']);
  const m = goodProduct(); delete m.repo;
  assert.deepEqual(checkProduct(m, STRICT).problems, ['missing repo']);
});
test('checkProduct: id falls back to (no id) only when absent or blank', () => {
  const p = goodProduct(); delete p.id;
  assert.equal(checkProduct(p, LAX).id, '(no id)');
  const q = goodProduct(); q.id = '  ';
  assert.equal(checkProduct(q, LAX).id, '(no id)');
  assert.equal(checkProduct(goodProduct(), LAX).id, 'alpha');
});
test('checkProduct: live and repo must be https', () => {
  const p = goodProduct(); p.live = 'http://insecure.example/x';
  assert.deepEqual(checkProduct(p, STRICT).problems, ['live is not an https URL']);
  const q = goodProduct(); q.repo = 'ftp://example.test/r';
  assert.deepEqual(checkProduct(q, STRICT).problems, ['repo is not an https URL']);
});
test('checkProduct: requireFree demands literal true, and only when the rule is on', () => {
  const p = goodProduct(); p.free = 'yes';
  assert.deepEqual(checkProduct(p, STRICT).problems, ['free must be exactly true']);
  const q = goodProduct(); delete q.free;
  assert.deepEqual(checkProduct(q, LAX).problems, []);
  assert.deepEqual(checkProduct(goodProduct(), STRICT).problems, []);
});
test('checkProduct: a listing without a usable proof is refused', () => {
  for (const proof of [undefined, null, 'attested!', [], {}, { kind: 7 }]) {
    const p = goodProduct(); p.proof = proof;
    assert.deepEqual(checkProduct(p, STRICT).problems, ['no proof — an unproven good does not list'], JSON.stringify(proof));
  }
});
test('checkProduct: proof link shapes — rerun/receipt https, anchor 64-hex', () => {
  const p = goodProduct(); p.proof.rerun = 'http://x.example/r';
  assert.deepEqual(checkProduct(p, STRICT).problems, ['proof.rerun is not an https URL']);
  const q = goodProduct(); q.proof.receipt = 'nope';
  assert.deepEqual(checkProduct(q, STRICT).problems, ['proof.receipt is not an https URL']);
  const a = goodProduct(); a.proof.anchor = 'deadbeef';
  assert.deepEqual(checkProduct(a, STRICT).problems, ['proof.anchor is not a 64-hex digest']);
  const b = goodProduct(); delete b.proof.anchor; delete b.proof.receipt;
  assert.deepEqual(checkProduct(b, STRICT).problems, []);
});
test('checkProduct: no rerun URL means attestation — refused, except live-console', () => {
  const p = goodProduct(); delete p.proof.rerun;
  assert.deepEqual(checkProduct(p, STRICT).problems, ['proof has no rerun URL — without a re-run it is an attestation']);
  assert.deepEqual(checkProduct(consoleProduct(), STRICT).problems, []);
});
test('checkProduct: forbidPricing refuses price-shaped fields anywhere in the listing, only when on', () => {
  const p = goodProduct(); p.price = 9;
  assert.deepEqual(checkProduct(p, STRICT).problems, ['price-shaped field found — this shelf binds itself to no public pricing']);
  const q = goodProduct(); q.meta = { cost: 'high' };
  assert.equal(checkProduct(q, STRICT).ok, false);
  const r = goodProduct(); r.price = 9;
  assert.deepEqual(checkProduct(r, LAX).problems, []);
});

// ── checkCatalog ─────────────────────────────────────────────────
test('checkCatalog: a clean strict catalog is ok with exact counts', () => {
  const c = checkCatalog(goodCatalog(), STRICT);
  assert.equal(c.ok, true);
  assert.deepEqual(c.problems, []);
  assert.deepEqual(c.counts, { products: 2, proven: 2, problems: 0 });
  assert.deepEqual(c.products.map((p) => p.id), ['alpha', 'beta']);
});
test('checkCatalog: non-objects are refused without throwing', () => {
  for (const bad of [null, 'x', 7, []]) {
    assert.deepEqual(checkCatalog(bad, LAX), { ok: false, problems: ['catalog is not an object'], products: [], counts: { products: 0, proven: 0, problems: 1 } });
  }
});
test('checkCatalog: empty or missing products is a catalog problem', () => {
  const c = checkCatalog({ ...goodCatalog(), products: [] }, LAX);
  assert.equal(c.ok, false);
  assert.deepEqual(c.problems, ['products must be a non-empty array']);
  const d = checkCatalog({ contact: { url: 'https://x.example/i' } }, LAX);
  assert.deepEqual(d.problems, ['products must be a non-empty array']);
});
test('checkCatalog: Konomi credit required only under the rule', () => {
  const noCredit = goodCatalog(); delete noCredit.credit;
  assert.deepEqual(checkCatalog(noCredit, STRICT).problems, ['the catalog must carry the Konomi credit']);
  const wrong = goodCatalog(); wrong.credit = 'thanks to nobody';
  assert.deepEqual(checkCatalog(wrong, STRICT).problems, ['the catalog must carry the Konomi credit']);
  assert.deepEqual(checkCatalog(noCredit, LAX).problems, []);
  assert.deepEqual(checkCatalog(goodCatalog(), STRICT).problems, []);
});
test('checkCatalog: contact.url must be a real https URL, unconditionally', () => {
  for (const contact of [undefined, null, 'x', {}, { url: 'ftp://x.example/i' }]) {
    const cat = goodCatalog(); cat.contact = contact;
    assert.deepEqual(checkCatalog(cat, LAX).problems, ['contact.url must be a real https URL — agents need a channel'], JSON.stringify(contact));
  }
});
test('checkCatalog: duplicate ids are refused on the second listing', () => {
  const cat = goodCatalog();
  cat.products.push(goodProduct());
  const c = checkCatalog(cat, STRICT);
  assert.equal(c.ok, false);
  assert.deepEqual(c.products[2].problems, ['duplicate id']);
  assert.equal(c.products[2].ok, false);
  assert.deepEqual(c.counts, { products: 3, proven: 2, problems: 1 });
});
test('checkCatalog: one refused listing denies the whole shelf', () => {
  const cat = goodCatalog();
  delete cat.products[0].proof;
  const c = checkCatalog(cat, STRICT);
  assert.equal(c.ok, false);
  assert.deepEqual(c.counts, { products: 2, proven: 1, problems: 1 });
});

// ── shelfUrls ────────────────────────────────────────────────────
test('shelfUrls: collects live/repo/proof/contact, deduplicated, https only', () => {
  const cat = goodCatalog();
  cat.products[1].repo = cat.products[0].repo; // dedupe case
  cat.products[1].live = 'http://not-https.example/'; // skipped
  assert.deepEqual(shelfUrls(cat), [
    'https://example.test/alpha/',
    'https://github.example/alpha',
    'https://ci.example/alpha/rerun',
    'https://example.test/alpha/receipt.json',
    'https://github.example/fixture/issues',
  ]);
});
test('shelfUrls: garbage in, empty or partial out, never a throw', () => {
  assert.deepEqual(shelfUrls(null), []);
  assert.deepEqual(shelfUrls('x'), []);
  assert.deepEqual(shelfUrls({ products: [null, 'str', { live: 7, proof: 'x' }], contact: null }), []);
});

// ── fingerprint / verdict / golden anchors ───────────────────────
test('specFingerprint: pinned golden for a fixed source sha', async () => {
  assert.equal(await specFingerprint('testsha'), GOLDEN_FP);
  assert.notEqual(await specFingerprint('othersha'), GOLDEN_FP);
});
test('assembleVerdict: golden anchor + catalogSha reproduce byte-for-byte', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  assert.equal(v.badge, true);
  assert.equal(v.catalogSha, GOLDEN_CATALOG_SHA);
  assert.equal(v.specFingerprint, GOLDEN_FP);
  assert.equal(v.hash, GOLDEN_ANCHOR);
  assert.deepEqual(v.spec, { gate: 'proven-shelf', gateVersion: GATE_VERSION, shelf: 'fixture-shelf', catalogUrl: 'https://example.test/catalog.json', rules: normRules(STRICT) });
  assert.equal(v.summary.products, 2);
  assert.equal(v.summary.proven, 2);
  assert.equal(v.summary.problems, 0);
});
test('assembleVerdict: the anchor moves when the catalog, the rules, or the instrument move', async () => {
  const changedCat = goodCatalog(); changedCat.products[0].pitch = 'edited';
  const v1 = await assembleVerdict(changedCat, SPEC_IN);
  assert.notEqual(v1.hash, GOLDEN_ANCHOR);
  const v2 = await assembleVerdict(goodCatalog(), { ...SPEC_IN, rules: LAX });
  assert.notEqual(v2.hash, GOLDEN_ANCHOR);
  const v3 = await assembleVerdict(goodCatalog(), { ...SPEC_IN, gateSourceSha: 'othersha' });
  assert.notEqual(v3.hash, GOLDEN_ANCHOR);
});
test('assembleVerdict: a dirty catalog gets badge false and honest counts', async () => {
  const cat = goodCatalog(); delete cat.products[0].proof;
  const v = await assembleVerdict(cat, SPEC_IN);
  assert.equal(v.badge, false);
  assert.equal(v.summary.proven, 1);
  assert.equal(v.summary.problems, 1);
  assert.deepEqual(v.summary.perProduct[0].problems, ['no proof — an unproven good does not list']);
});
test('assembleVerdict: unnamed shelf and missing catalogUrl degrade honestly', async () => {
  const v = await assembleVerdict(goodCatalog(), { rules: LAX, gateSourceSha: 'x' });
  assert.equal(v.spec.shelf, '(unnamed shelf)');
  assert.equal(v.spec.catalogUrl, null);
});

// ── receipt / badge / headline / markdown ────────────────────────
test('mintReceipt: carries the claim, the spec, the anchor, the credit — admissible iff badge', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const r = mintReceipt(v);
  assert.equal(r.v, GATE_VERSION);
  assert.equal(r.kind, 'proven-shelf-receipt');
  assert.equal(r.shelf, 'fixture-shelf');
  assert.equal(r.hash, v.hash);
  assert.equal(r.catalogSha, v.catalogSha);
  assert.equal(r.specFingerprint, v.specFingerprint);
  assert.deepEqual(r.verdict, { badge: true, products: 2, proven: 2, problems: 0 });
  assert.equal(r.admissible, true);
  assert.equal(r.credit, CREDIT);
  assert.equal(r.verify, VERIFY_URL);
  const bad = await assembleVerdict({ ...goodCatalog(), products: [{}] }, SPEC_IN);
  const rb = mintReceipt(bad);
  assert.equal(rb.admissible, false);
  assert.equal(rb.verdict.badge, false);
});
test('badgeEndpoint: three messages, two colors, and the anchor rides along', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  assert.deepEqual(badgeEndpoint(v), { schemaVersion: 1, label: 'proven shelf', message: '2 goods, every proof re-runnable', color: 'brightgreen', anchor: v.hash });
  const empty = await assembleVerdict({ ...goodCatalog(), products: [] }, SPEC_IN);
  assert.equal(badgeEndpoint(empty).message, 'empty shelf');
  assert.equal(badgeEndpoint(empty).color, 'red');
  const dirtyCat = goodCatalog(); delete dirtyCat.products[0].proof;
  const dirty = await assembleVerdict(dirtyCat, SPEC_IN);
  assert.equal(badgeEndpoint(dirty).message, '1 problem(s)');
  assert.equal(badgeEndpoint(dirty).color, 'red');
});
test('headline: proven and refused shapes', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  assert.equal(headline(v), 'proven shelf: 2/2 listings carry re-runnable proofs — anchor ' + v.hash.slice(0, 12));
  const dirtyCat = goodCatalog(); delete dirtyCat.products[0].proof;
  const d = await assembleVerdict(dirtyCat, SPEC_IN);
  assert.equal(headline(d), 'NOT a proven shelf: 1 problem(s) across 2 listing(s)');
});
test('summaryMarkdown: marks, rows, anchor, catalog problems', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const md = summaryMarkdown(v);
  assert.ok(md.includes('## ✅ proven shelf — fixture-shelf'));
  assert.ok(md.includes('| `alpha` | ✅ proven |'));
  assert.ok(md.includes('**Anchor** `' + v.hash + '`'));
  const cat = goodCatalog(); delete cat.products[0].proof; delete cat.contact;
  const d = await assembleVerdict(cat, SPEC_IN);
  const mdd = summaryMarkdown(d);
  assert.ok(mdd.includes('## ❌ proven shelf'));
  assert.ok(mdd.includes('| `alpha` | ❌ refused | no proof — an unproven good does not list |'));
  assert.ok(mdd.includes('- catalog: contact.url must be a real https URL — agents need a channel'));
});

// ── verifyReceipt: HOLDS / REFUSED / INSTRUMENT_CHANGED ──────────
test('verifyReceipt: a minted receipt HOLDS against the same catalog', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const r = await verifyReceipt(mintReceipt(v), goodCatalog(), 'testsha');
  assert.equal(r.status, 'HOLDS');
  assert.equal(r.v.hash, v.hash);
});
test('verifyReceipt: a tampered hash is REFUSED with both anchors shown', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const receipt = mintReceipt(v);
  receipt.hash = 'f'.repeat(64);
  const r = await verifyReceipt(receipt, goodCatalog(), 'testsha');
  assert.equal(r.status, 'REFUSED');
  assert.equal(r.expected, v.hash);
  assert.equal(r.got, 'f'.repeat(64));
});
test('verifyReceipt: a changed catalog no longer produces the receipt anchor', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const moved = goodCatalog(); moved.products[0].pitch = 'quietly edited after certification';
  const r = await verifyReceipt(mintReceipt(v), moved, 'testsha');
  assert.equal(r.status, 'REFUSED');
});
test('verifyReceipt: a different instrument is INSTRUMENT_CHANGED, not a shelf fault', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const r = await verifyReceipt(mintReceipt(v), goodCatalog(), 'other-gate-source');
  assert.equal(r.status, 'INSTRUMENT_CHANGED');
  assert.equal(r.expectedFingerprint, await specFingerprint('other-gate-source'));
  assert.equal(r.receiptFingerprint, v.specFingerprint);
});
test('verifyReceipt: garbage receipts are refused without throwing', async () => {
  assert.equal((await verifyReceipt(null, goodCatalog(), 'x')).status, 'REFUSED');
  assert.equal((await verifyReceipt('x', goodCatalog(), 'x')).status, 'REFUSED');
  const noFp = await verifyReceipt({}, goodCatalog(), 'x');
  assert.equal(noFp.status, 'INSTRUMENT_CHANGED');
  assert.equal(noFp.receiptFingerprint, null);
});
test('verifyReceipt: a receipt with garbage spec recomputes and is REFUSED, no throw', async () => {
  const v = await assembleVerdict(goodCatalog(), SPEC_IN);
  const receipt = mintReceipt(v);
  receipt.spec = null;
  const r = await verifyReceipt(receipt, goodCatalog(), 'testsha');
  assert.equal(r.status, 'REFUSED');
});

// ── liveness (injected fetch — the arithmetic without a network) ─
function fakeFetch(plan) {
  const calls = [];
  const fn = async (u) => {
    calls.push(u);
    const step = plan[u] && plan[u].length ? plan[u].shift() : { status: 200 };
    if (step.throw) throw new Error('net down');
    return { status: step.status };
  };
  fn.calls = calls;
  return fn;
}
test('liveness: all alive — one call each, none dead', async () => {
  const f = fakeFetch({});
  const r = await liveness(['https://a.example/', 'https://b.example/'], f);
  assert.deepEqual(r, { checked: 2, dead: [] });
  assert.equal(f.calls.length, 2);
});
test('liveness: a dead URL is retried exactly once and reported with its status', async () => {
  const f = fakeFetch({ 'https://dead.example/': [{ status: 404 }, { status: 404 }] });
  const r = await liveness(['https://dead.example/'], f);
  assert.deepEqual(r, { checked: 1, dead: [{ url: 'https://dead.example/', status: 404 }] });
  assert.equal(f.calls.length, 2);
});
test('liveness: a throw then a recovery counts as alive', async () => {
  const f = fakeFetch({ 'https://flaky.example/': [{ throw: true }, { status: 200 }] });
  const r = await liveness(['https://flaky.example/'], f);
  assert.deepEqual(r, { checked: 1, dead: [] });
  assert.equal(f.calls.length, 2);
});
test('liveness: a double throw reports status -1', async () => {
  const f = fakeFetch({ 'https://gone.example/': [{ throw: true }, { throw: true }] });
  const r = await liveness(['https://gone.example/'], f);
  assert.deepEqual(r.dead, [{ url: 'https://gone.example/', status: -1 }]);
});
test('liveness: status boundaries — 200 and 399 live, 199 and 400 die', async () => {
  const f = fakeFetch({
    'https://s199.example/': [{ status: 199 }, { status: 199 }],
    'https://s200.example/': [{ status: 200 }],
    'https://s399.example/': [{ status: 399 }],
    'https://s400.example/': [{ status: 400 }, { status: 400 }],
  });
  const r = await liveness(['https://s199.example/', 'https://s200.example/', 'https://s399.example/', 'https://s400.example/'], f);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.dead.map((d) => d.url), ['https://s199.example/', 'https://s400.example/']);
});

// ── parseCli / isHttpsUrl / outcomes ─────────────────────────────
test('parseCli: defaults', () => {
  assert.deepEqual(parseCli([]), { mode: 'gate', target: '.', config: 'proven-shelf.json', live: false });
});
test('parseCli: modes, target, --live', () => {
  assert.deepEqual(parseCli(['mint', '/x']), { mode: 'mint', target: '/x', config: 'proven-shelf.json', live: false });
  assert.deepEqual(parseCli(['check', '.', '--live']), { mode: 'check', target: '.', config: 'proven-shelf.json', live: true });
  assert.deepEqual(parseCli(['verify', 'https://x.example/r.json']), { mode: 'verify', target: 'https://x.example/r.json', config: 'proven-shelf.json', live: false });
  assert.deepEqual(parseCli(['somewordthatisnotamode']), { mode: 'gate', target: 'somewordthatisnotamode', config: 'proven-shelf.json', live: false });
});
test('parseCli: --config takes the NEXT token and that token is not the target', () => {
  assert.deepEqual(parseCli(['gate', 'repo', '--config', 'custom.json']), { mode: 'gate', target: 'repo', config: 'custom.json', live: false });
  assert.deepEqual(parseCli(['gate', '--config', 'c.json', 'target2']), { mode: 'gate', target: 'target2', config: 'c.json', live: false });
});
test('isHttpsUrl: https only, strings only', () => {
  assert.equal(isHttpsUrl('https://a.example/x'), true);
  assert.equal(isHttpsUrl('http://a.example/x'), false);
  assert.equal(isHttpsUrl(undefined), false);
});
test('checkOutcome: HOLDS passes; REFUSED fails and names both anchors', () => {
  assert.deepEqual(checkOutcome({ status: 'HOLDS' }), { ok: true, line: 'check: committed receipt HOLDS — the published claim reproduces from this catalog' });
  const r = checkOutcome({ status: 'REFUSED', expected: 'aaa', got: 'bbb' });
  assert.equal(r.ok, false);
  assert.equal(r.line, 'check: committed receipt REFUSED — re-run produces aaa, receipt says bbb');
  assert.deepEqual(checkOutcome({ status: 'INSTRUMENT_CHANGED' }), { ok: false, line: 'check: committed receipt INSTRUMENT_CHANGED' });
});
test('verifyOutcome: certified, held-but-unproven, refused', () => {
  assert.deepEqual(verifyOutcome({ status: 'HOLDS', v: { badge: true } }), { ok: true, line: 'HOLDS — the anchor reproduces from the live catalog, and the shelf is proven' });
  assert.deepEqual(verifyOutcome({ status: 'HOLDS', v: { badge: false } }), { ok: false, line: 'HOLDS, but the shelf is not proven — the receipt honestly records problems' });
  assert.deepEqual(verifyOutcome({ status: 'REFUSED', v: { badge: true } }), { ok: false, line: 'REFUSED' });
});
test('livenessOutcome: clean and dead shapes', () => {
  assert.deepEqual(livenessOutcome({ checked: 3, dead: [] }), { ok: true, lines: ['liveness: all 3 shelf links answer'] });
  const o = livenessOutcome({ checked: 2, dead: [{ url: 'https://d.example/', status: 500 }] });
  assert.equal(o.ok, false);
  assert.deepEqual(o.lines, ['  ✗ DEAD (500): https://d.example/', 'liveness: 1 dead link(s) — a dead good does not stay on the shelf']);
});

// ── fuzz: the kernel never throws on JSON-shaped garbage ─────────
test('fuzz: checkProduct/checkCatalog/shelfUrls/normRules hold on garbage', () => {
  const garbage = [
    null, 0, 1.5, -7, '', 'x', true, false, [], [[]], [null], {},
    { products: 'x' }, { products: { a: 1 } }, { products: [null, 7, 'x', [], {}] },
    { products: [{ proof: 'x' }], contact: 'x', credit: 7 },
    { products: [{ id: 7, live: {}, repo: [], proof: { kind: 'k', rerun: 9, anchor: {} } }] },
    { contact: { url: 7 } }, { credit: null, products: [{ id: 'a' }, { id: 'a' }] },
    JSON.parse('{"a":{"b":{"c":[1,2,{"d":null}]}}}'),
  ];
  for (const g of garbage) {
    for (const rules of [LAX, STRICT, g]) {
      const c = checkCatalog(g, rules);
      assert.equal(typeof c.ok, 'boolean');
      checkProduct(g, rules);
      shelfUrls(g);
      normRules(g);
    }
  }
});

// ── E2E: the CLI shim, spawned for real ──────────────────────────
const CLI = fileURLToPath(new URL('./shelf-cli.mjs', import.meta.url));
function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
}
function writeShelf(cat) {
  const dir = mkdtempSync(join(tmpdir(), 'proven-shelf-test-'));
  writeFileSync(join(dir, 'proven-shelf.json'), JSON.stringify({ shelf: 'fixture-shelf', catalog: 'catalog.json', catalogUrl: 'https://example.test/catalog.json', rules: STRICT }));
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify(cat));
  return dir;
}
test('cli e2e: gate passes a clean shelf and refuses a dirty one', () => {
  const good = writeShelf(goodCatalog());
  const g = runCli(['gate', good]);
  assert.equal(g.status, 0, g.stderr);
  assert.ok(g.stderr.includes('proven shelf: 2/2'));
  const cat = goodCatalog(); delete cat.products[0].proof;
  const bad = writeShelf(cat);
  const b = runCli(['gate', bad]);
  assert.equal(b.status, 1);
  assert.ok(b.stderr.includes('NOT a proven shelf'));
});
test('cli e2e: mint writes receipt + badge, check HOLDS, tampering is caught', async () => {
  const dir = writeShelf(goodCatalog());
  const m = runCli(['mint', dir]);
  assert.equal(m.status, 0, m.stderr);
  assert.ok(existsSync(join(dir, 'shelf-receipt.json')));
  const badge = JSON.parse(readFileSync(join(dir, 'shelf-badge.json'), 'utf8'));
  assert.equal(badge.color, 'brightgreen');
  const c = runCli(['check', dir]);
  assert.equal(c.status, 0, c.stderr);
  assert.ok(c.stderr.includes('HOLDS'));
  const receipt = JSON.parse(readFileSync(join(dir, 'shelf-receipt.json'), 'utf8'));
  receipt.hash = 'f'.repeat(64);
  writeFileSync(join(dir, 'shelf-receipt.json'), JSON.stringify(receipt));
  const t = runCli(['check', dir]);
  assert.equal(t.status, 1);
  assert.ok(t.stderr.includes('REFUSED'));
});
test('cli e2e: missing config exits 2; verify refuses a non-https target with exit 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'proven-shelf-empty-'));
  assert.equal(runCli(['gate', empty]).status, 2);
  assert.equal(runCli(['verify', 'not-a-url']).status, 2);
});
