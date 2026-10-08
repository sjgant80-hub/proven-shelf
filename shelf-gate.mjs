// ════════════════════════════════════════════════════════════════
// proven-shelf · shelf-gate — the anti-lemons gate for agent storefronts
//
// A market where agents buy from catalogs is a lemons market: every rail verifies WHO is selling
// (identity, registration, payment mandates) and nobody verifies that the GOODS WORK. This gate is
// the missing half. A shelf passes when EVERY listing carries a proof an agent can RE-RUN — a rerun
// URL, a receipt, a content-addressed anchor — and the shelf's own certification is itself
// re-runnable: the verdict below is hashed over canonical JSON, so anyone who fetches the catalog
// and re-runs this file reproduces the anchor or refutes it. No trusted signer anywhere.
//
// Lineage (konomified, not re-implemented): the schema/liveness discipline is kar-hub's
// tools/check-catalog.mjs generalised; the canonical-JSON anchor, instrument fingerprint and
// receipt shape are the witness-bench / proof-of-play contract. Same rail, turned on catalogs.
//
// Deterministic: no clock, no randomness in anything hashed. Liveness (do the links answer TODAY)
// is time-dependent by nature, so it is enforced by CI on every push and on cron — but it is never
// part of the anchor, exactly as witness keeps timing out of its verdict.
//
// Zero dependencies. The SAME file runs under Node (shelf-cli.mjs is the thin IO shim) and in the
// browser (the verify page imports it) — the live page is kernel-backed: gated logic IS live logic.
//
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const GATE_VERSION = '1';
export const CREDIT = 'Powered by the Konomi architecture, created by Thomas Frumkin.';
export const VERIFY_URL = 'https://sjgant80-hub.github.io/proven-shelf/';

// ── canonical JSON: sorted object keys, arrays in order — the same verdict hashes to the same byte
// string on every machine. (witness-bench's canon, verbatim contract.)
export function canon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  const keys = Object.keys(x).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

// sha-256 over a string via WebCrypto — the one digest both Node and the browser share natively.
export async function sha(s) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// normalise line endings before fingerprinting source — git checks the same blob out as CRLF on a
// Windows working copy and LF on a Linux runner, and the fingerprint must not care. (The estate's
// CRLF trap, designed out here as it was in witness-bench.)
export function lf(s) {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function errMsg(e) { return String(e && e.message || e); }

const HTTPS = /^https:\/\/[a-z0-9.-]+\/[^\s]*$/i;
const HEX64 = /^[0-9a-f]{64}$/;

// ── certification rules. The core bar is unconditional: proofs required, re-runnable, links sane.
// The three flags are shelf policies a catalog may additionally bind itself to; they are part of
// the hashed spec, so a receipt states exactly which bar the shelf cleared.
export function normRules(r) {
  const src = (r && typeof r === 'object') ? r : {};
  return {
    requireFree: src.requireFree === true,
    forbidPricing: src.forbidPricing === true,
    requireCredit: src.requireCredit === true,
  };
}

// ── one listing. Returns { id, ok, problems } and NEVER throws, whatever garbage comes in — a gate
// that crashes on a malformed catalog has not refused it, it has abandoned the shelf.
export function checkProduct(p, rulesIn) {
  const rules = normRules(rulesIn);
  const problems = [];
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    return { id: '(not an object)', ok: false, problems: ['listing is not an object'] };
  }
  for (const k of ['id', 'name', 'category', 'pitch', 'live', 'repo']) {
    if (typeof p[k] !== 'string' || p[k].trim() === '') problems.push('missing ' + k);
  }
  if (typeof p.live === 'string' && !HTTPS.test(p.live)) problems.push('live is not an https URL');
  if (typeof p.repo === 'string' && !HTTPS.test(p.repo)) problems.push('repo is not an https URL');
  if (rules.requireFree === true && p.free !== true) problems.push('free must be exactly true');

  const proof = p.proof;
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof) || typeof proof.kind !== 'string') {
    problems.push('no proof — an unproven good does not list');
  } else {
    if (typeof proof.rerun === 'string' && !HTTPS.test(proof.rerun)) problems.push('proof.rerun is not an https URL');
    if (typeof proof.receipt === 'string' && !HTTPS.test(proof.receipt)) problems.push('proof.receipt is not an https URL');
    if (typeof proof.anchor === 'string' && !HEX64.test(proof.anchor)) problems.push('proof.anchor is not a 64-hex digest');
    if (proof.kind !== 'live-console' && typeof proof.rerun !== 'string') {
      problems.push('proof has no rerun URL — without a re-run it is an attestation');
    }
  }
  if (rules.forbidPricing === true) {
    if (/"(price|pricing|cost|fee|gbp|usd|eur)"/.test(JSON.stringify(p).toLowerCase())) {
      problems.push('price-shaped field found — this shelf binds itself to no public pricing');
    }
  }
  const id = typeof p.id === 'string' && p.id.trim() !== '' ? p.id : '(no id)';
  return { id, ok: problems.length === 0, problems };
}

// ── the whole catalog. Catalog-level problems + per-product records + counts. Never throws.
export function checkCatalog(cat, rulesIn) {
  const rules = normRules(rulesIn);
  const problems = [];
  if (cat === null || typeof cat !== 'object' || Array.isArray(cat)) {
    return { ok: false, problems: ['catalog is not an object'], products: [], counts: { products: 0, proven: 0, problems: 1 } };
  }
  const list = Array.isArray(cat.products) ? cat.products : [];
  if (list.length === 0) problems.push('products must be a non-empty array');

  const creditOk = typeof cat.credit === 'string' && cat.credit.includes('Konomi');
  if (rules.requireCredit === true && creditOk !== true) problems.push('the catalog must carry the Konomi credit');

  const contactOk = cat.contact !== null && typeof cat.contact === 'object' && typeof cat.contact.url === 'string' && HTTPS.test(cat.contact.url);
  if (contactOk !== true) problems.push('contact.url must be a real https URL — agents need a channel');

  const seen = new Set();
  const products = list.map((p) => {
    const rec = checkProduct(p, rules);
    if (seen.has(rec.id)) {
      rec.problems = rec.problems.concat('duplicate id');
      rec.ok = false;
    }
    seen.add(rec.id);
    return rec;
  });

  const proven = products.filter((r) => r.ok === true).length;
  const productProblems = products.reduce((a, r) => a + r.problems.length, 0);
  const ok = problems.length === 0 && proven === products.length && products.length !== 0;
  return { ok, problems, products, counts: { products: products.length, proven, problems: problems.length + productProblems } };
}

// every URL the shelf stands on — for the liveness pass. Deduplicated, garbage-safe.
export function shelfUrls(cat) {
  const urls = new Set();
  const add = (u) => { if (typeof u === 'string' && HTTPS.test(u)) urls.add(u); };
  if (cat !== null && typeof cat === 'object') {
    const list = Array.isArray(cat.products) ? cat.products : [];
    for (const p of list) {
      if (p === null || typeof p !== 'object') continue;
      add(p.live); add(p.repo);
      if (p.proof !== null && typeof p.proof === 'object') { add(p.proof.rerun); add(p.proof.receipt); }
    }
    if (cat.contact !== null && typeof cat.contact === 'object') add(cat.contact.url);
  }
  return Array.from(urls);
}

// ── the instrument's identity: this file's own source (LF-normalised) + the gate version. A receipt
// minted under one gate cannot silently be verified under another — verification reports
// instrument-changed instead of blaming the shelf. (witness-bench's specFingerprint pattern.)
export async function specFingerprint(gateSourceSha) {
  return sha(canon({ instrument: 'proven-shelf', gateVersion: GATE_VERSION, gateSourceSha }));
}

// ── assemble the verdict. PURE over (catalog value, spec inputs): same catalog + same gate = same
// anchor, on every machine, forever. This is the whole claim — re-run it or refuse it.
export async function assembleVerdict(cat, { shelf, catalogUrl, rules, gateSourceSha }) {
  const check = checkCatalog(cat, rules);
  const catalogSha = await sha(canon(cat));
  const fp = await specFingerprint(gateSourceSha);
  const spec = { gate: 'proven-shelf', gateVersion: GATE_VERSION, shelf: typeof shelf === 'string' ? shelf : '(unnamed shelf)', catalogUrl: typeof catalogUrl === 'string' ? catalogUrl : null, rules: normRules(rules) };
  const badge = check.ok === true;
  const summary = {
    products: check.counts.products,
    proven: check.counts.proven,
    problems: check.counts.problems,
    catalogProblems: check.problems,
    perProduct: check.products,
  };
  const hash = await sha(canon({ badge, spec, specFingerprint: fp, catalogSha, summary }));
  return { badge, hash, spec, specFingerprint: fp, catalogSha, summary };
}

// ── the receipt a certified shelf publishes next to its catalog. Everything needed to re-run the
// claim travels inside it; the fields outside the hash (credit, verify) are courtesy, not claim.
export function mintReceipt(v) {
  return {
    v: GATE_VERSION,
    kind: 'proven-shelf-receipt',
    shelf: v.spec.shelf,
    claim: 'every listing on this shelf carries a re-runnable proof, and this certification is itself re-runnable — fetch the catalog, re-run the gate, reproduce the anchor',
    spec: v.spec,
    specFingerprint: v.specFingerprint,
    catalogSha: v.catalogSha,
    verdict: { badge: v.badge === true, products: v.summary.products, proven: v.summary.proven, problems: v.summary.problems },
    hash: v.hash,
    admissible: v.badge === true,
    credit: CREDIT,
    verify: VERIFY_URL,
  };
}

// ── shields.io endpoint object — the badge a certified shelf displays. It carries the anchor, so
// the badge itself points at the re-runnable claim rather than asserting one.
export function badgeEndpoint(v) {
  let message;
  if (v.badge === true) message = v.summary.products + ' goods, every proof re-runnable';
  else if (v.summary.products === 0) message = 'empty shelf';
  else message = v.summary.problems + ' problem(s)';
  return {
    schemaVersion: 1,
    label: 'proven shelf',
    message,
    color: v.badge === true ? 'brightgreen' : 'red',
    anchor: v.hash,
  };
}

export function headline(v) {
  if (v.badge === true) return 'proven shelf: ' + v.summary.proven + '/' + v.summary.products + ' listings carry re-runnable proofs — anchor ' + v.hash.slice(0, 12);
  return 'NOT a proven shelf: ' + v.summary.problems + ' problem(s) across ' + v.summary.products + ' listing(s)';
}

// the step-summary markdown a reviewer reads on the Actions run.
export function summaryMarkdown(v) {
  const mark = v.badge === true ? '✅' : '❌';
  let md = '## ' + mark + ' proven shelf — ' + v.spec.shelf + '\n\n' + headline(v) + '\n\n';
  md += '| listing | verdict | problems |\n|---|:--|:--|\n';
  for (const r of v.summary.perProduct) {
    md += '| `' + r.id + '` | ' + (r.ok === true ? '✅ proven' : '❌ refused') + ' | ' + r.problems.join('; ') + ' |\n';
  }
  for (const c of v.summary.catalogProblems) md += '\n- catalog: ' + c;
  md += '\n**Anchor** `' + v.hash + '`\n\n_Re-runnable: fetch the catalog, re-run shelf-gate, reproduce this anchor — or refuse it. No trusted signer._\n';
  return md;
}

// ── verify a published receipt against a fetched catalog: re-run, then compare anchors. The three
// honest outcomes, exactly proof-of-play's: HOLDS (reproduced), REFUSED (the catalog does not
// produce that anchor), INSTRUMENT_CHANGED (a different gate minted it — re-certify, don't guess).
export async function verifyReceipt(receipt, cat, gateSourceSha) {
  if (receipt === null || typeof receipt !== 'object') return { status: 'REFUSED', reason: 'receipt is not an object' };
  const fp = await specFingerprint(gateSourceSha);
  if (receipt.specFingerprint !== fp) {
    return { status: 'INSTRUMENT_CHANGED', expectedFingerprint: fp, receiptFingerprint: typeof receipt.specFingerprint === 'string' ? receipt.specFingerprint : null };
  }
  const spec = (receipt.spec !== null && typeof receipt.spec === 'object') ? receipt.spec : {};
  const v = await assembleVerdict(cat, { shelf: spec.shelf, catalogUrl: spec.catalogUrl, rules: spec.rules, gateSourceSha });
  if (v.hash === receipt.hash) return { status: 'HOLDS', v };
  return { status: 'REFUSED', expected: v.hash, got: typeof receipt.hash === 'string' ? receipt.hash : null, v };
}

// ── liveness: every shelf link must answer. Two attempts per URL; a dead good does not stay on a
// proven shelf. fetchFn is injectable so the arithmetic is testable without a network.
export async function liveness(urls, fetchFn) {
  const dead = [];
  let checked = 0;
  for (const u of urls) {
    checked = checked + 1;
    let ok = false, status = 0;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const r = await fetchFn(u, { method: 'GET', redirect: 'follow' });
        status = r.status;
        ok = r.status >= 200 && r.status < 400;
      } catch (e) { status = -1; }
    }
    if (!ok) dead.push({ url: u, status });
  }
  return { checked, dead };
}

// ── CLI parsing, pulled out pure so the gate can verify it without spawning anything.
// modes: gate (default) · mint · check · verify <receiptUrl>
export function parseCli(argv) {
  const args = argv.slice();
  const MODES = ['gate', 'mint', 'check', 'verify'];
  const mode = MODES.includes(args[0]) ? args.shift() : 'gate';
  const live = args.includes('--live');
  const cfgIdx = args.indexOf('--config');
  const config = cfgIdx !== -1 ? args[cfgIdx + 1] : 'proven-shelf.json';
  const positional = args.filter((a, i) => !a.startsWith('--') && (cfgIdx === -1 || i !== cfgIdx + 1));
  const target = positional[0] !== undefined ? positional[0] : '.';
  return { mode, target, config, live };
}

// is this URL one the verify CLI will accept? (pure, so the gate can pin it)
export function isHttpsUrl(u) {
  return typeof u === 'string' && HTTPS.test(u);
}

// ── pure outcome shaping for the CLI shim — the shim prints lines and exits, it decides nothing.
export function checkOutcome(r) {
  if (r.status === 'HOLDS') return { ok: true, line: 'check: committed receipt HOLDS — the published claim reproduces from this catalog' };
  let line = 'check: committed receipt ' + r.status;
  if (typeof r.expected === 'string') line = line + ' — re-run produces ' + r.expected + ', receipt says ' + r.got;
  return { ok: false, line };
}

export function verifyOutcome(r) {
  const held = r.status === 'HOLDS';
  const certified = held === true && r.v.badge === true;
  let line;
  if (certified === true) line = 'HOLDS — the anchor reproduces from the live catalog, and the shelf is proven';
  else if (held === true) line = 'HOLDS, but the shelf is not proven — the receipt honestly records problems';
  else line = r.status;
  return { ok: certified, line };
}

export function livenessOutcome(l) {
  const lines = l.dead.map((d) => '  ✗ DEAD (' + d.status + '): ' + d.url);
  if (l.dead.length === 0) return { ok: true, lines: ['liveness: all ' + l.checked + ' shelf links answer'] };
  lines.push('liveness: ' + l.dead.length + ' dead link(s) — a dead good does not stay on the shelf');
  return { ok: false, lines };
}

export default {
  GATE_VERSION, CREDIT, VERIFY_URL, canon, sha, lf, errMsg, normRules, checkProduct, checkCatalog,
  shelfUrls, specFingerprint, assembleVerdict, mintReceipt, badgeEndpoint, headline, summaryMarkdown,
  verifyReceipt, liveness, parseCli, isHttpsUrl, checkOutcome, verifyOutcome, livenessOutcome,
};
