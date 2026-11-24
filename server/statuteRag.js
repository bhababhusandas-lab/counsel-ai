// Statute RAG — retrieval over a bundled index of CURRENT Indian bare-act sections.
// The index (server/data/statute-rag-index.json) holds section text + 512-dim
// OpenAI embeddings. On a user query we embed the query, find the closest sections
// by cosine similarity, and return them so the LLM can ground its answer in the
// actual statute text (with correct section numbers) instead of memory alone.
//
// Phase 1 = statutes only (bundled, no external DB). Judgment RAG (millions of
// docs) needs a real vector DB and is intentionally NOT loaded here.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildMemoryFts, rrfMerge, STATES, detectStates } from './hybrid.js';
import { embedQuery as localEmbedQuery } from './localEmbed.js';
import { candidatePaths } from './s3Index.js';

const EMBED_DIMS = 384; // multilingual-e5-small; indexes at other dims are skipped

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let INDEX = null; // { dims, count, meta:[], vectors:Float32Array }
let FTS = null;   // keyword index (BM25) for hybrid retrieval
let EXACT = new Map(); // "ACT|138" -> [meta index, ...] for exact-citation lookup

// Optional stronger vectors for the SAME sections: BAAI/bge-m3 (1024d), stored as
// raw float32 in statute-bge-m3.f32 in the same row order as INDEX.meta. A query
// must be embedded with the same model, which runs in its own sidecar
// (bge_embed_service.py, :8398). Everything here is fail-safe: if the file is
// missing, STATUTE_BGE=off, or the sidecar does not answer, retrieval silently
// uses the e5 vectors exactly as before.
let BGE = null; // { dims, vectors:Float32Array }
const BGE_URL = process.env.BGE_SERVICE_URL || 'http://127.0.0.1:8398';
// Generous on purpose. The sidecar answers in ~0.13s, but the other retrievers run
// synchronous SQLite queries that can block Node's event loop for several seconds
// right after this request is sent; with a short timeout the abort timer fired
// before the (already arrived) reply could be read, and statute search dropped
// back to e5 for no real reason. A dead sidecar still fails instantly (connection
// refused), so a long timeout only matters if it genuinely hangs.
const BGE_TIMEOUT_MS = Number(process.env.BGE_TIMEOUT_MS) || 20000;
let _bgeState = null;   // null = untested, true = working, false = failing
let _bgeRetryAt = 0;    // when failing, try again after this time

async function bgeEmbedQuery(text) {
  if (!BGE) return null;
  if (_bgeState === false && Date.now() < _bgeRetryAt) return null;
  try {
    const res = await fetch(`${BGE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 2000) }),
      signal: AbortSignal.timeout(BGE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j.vector) || j.vector.length !== BGE.dims) throw new Error('bad payload');
    if (_bgeState !== true) { _bgeState = true; console.log(`[rag] statute search using BGE-M3 vectors (${BGE.dims}d) via ${BGE_URL}`); }
    return j.vector;
  } catch (e) {
    if (_bgeState !== false) console.warn(`[rag] BGE-M3 sidecar unavailable (${e.message}); statute search falling back to e5 vectors`);
    _bgeState = false; _bgeRetryAt = Date.now() + 15000; // re-check after 15s
    return null;
  }
}

// Exact-citation lookup. Hybrid search is fuzzy: "BNSS 13" surfaced BNSS 138/137/133
// and never Section 13 itself, so the model answered from memory and got it wrong.
// When the user names a code + section number ("BNS 138", "Section 13 of the BNSS",
// "Article 21"), fetch THAT section directly and put it first.
const ACT_ALIASES = [
  ['b\\.?n\\.?s\\.?s\\b|nagarik suraksha(?: sanhita)?', 'BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 (BNSS)'],
  ['b\\.?n\\.?s\\b(?!\\.?s)|nyaya sanhita', 'BHARATIYA NYAYA SANHITA, 2023 (BNS)'],
  ['b\\.?s\\.?a\\b|sakshya(?: adhiniyam)?', 'BHARATIYA SAKSHYA ADHINIYAM, 2023 (BSA)'],
  ['i\\.?p\\.?c\\b|(?:indian )?penal code', 'THE INDIAN PENAL CODE'],
  ['cr\\.?\\s?p\\.?c\\b|code of criminal procedure|criminal procedure code', 'THE CODE OF CRIMINAL PROCEDURE, 1973'],
  ['n\\.?i\\.? act|negotiable instruments? act', 'THE NEGOTIABLE INSTRUMENTS ACT, 1881'],
  ['i\\.?t\\.? act|information technology act', 'THE INFORMATION TECHNOLOGY ACT, 2000'],
  ['(?:indian )?contract act', 'THE INDIAN CONTRACT ACT, 1872'],
  ['companies act', 'THE COMPANIES ACT, 2013'],
  ['cgst(?: act)?|central goods and services tax act', 'THE CENTRAL GOODS AND SERVICES TAX ACT, 2017'],
  ['income[- ]tax act', 'THE INCOME-TAX ACT, 1961'],
  ['hindu marriage act|\\bhma\\b', 'THE HINDU MARRIAGE ACT, 1955'],
  ['motor vehicles? act|\\bmv act', 'THE MOTOR VEHICLES ACT, 1988'],
  ['pocso(?: act)?', 'THE PROTECTION OF CHILDREN FROM SEXUAL OFFENCES ACT, 2012'],
  ['domestic violence act|\\bdv act|pwdva', 'THE PROTECTION OF WOMEN FROM DOMESTIC VIOLENCE ACT, 2005'],
  ['ndps(?: act)?', 'THE NARCOTIC DRUGS AND PSYCHOTROPIC SUBSTANCES, ACT, 1985'],
  ['transfer of property act|\\btpa\\b|\\btp act', 'THE TRANSFER OF PROPERTY ACT, 1882'],
  ['limitation act', 'THE LIMITATION ACT, 1963'],
  ['specific relief act', 'THE SPECIFIC RELIEF ACT, 1963'],
  ['arbitration(?: and conciliation)? act', 'THE ARBITRATION AND CONCILIATION ACT, 1996'],
  ['consumer protection act', 'THE CONSUMER PROTECTION ACT, 2019'],
  ['dpdp(?: act)?|digital personal data protection act', 'THE DIGITAL PERSONAL DATA PROTECTION ACT, 2023'],
];
const SEC_WORD = '(?:sections?|sec\\.?|s\\.|u/s|under section|§)';
const SEC_NUM = '(\\d{1,3}[A-Za-z]{0,2})\\b';
const ALIAS_RES = ACT_ALIASES.map(([src, act]) => ({
  act,
  // "BNS 138", "IPC section 302", "BNSS, s. 35"
  after: new RegExp(`(?:^|[^a-z])(?:${src})[\\s,:-]*(?:${SEC_WORD}\\s*)?${SEC_NUM}`, 'gi'),
  // "Section 13 of the BNSS", "section 138 NI Act", "u/s 482 BNSS"
  before: new RegExp(`${SEC_WORD}\\s*${SEC_NUM}(?:\\s*\\([^)]{1,6}\\))*\\s*(?:of|in|under)?\\s*(?:the\\s+)?(?:${src})`, 'gi'),
}));

function exactKey(act, num) { return `${act}|${String(num).toUpperCase()}`; }

// Returns meta indexes for every "<code> <section>" the query names, in order.
function exactCitationIds(query) {
  if (!EXACT.size) return [];
  const q = String(query || '');
  const hits = []; // [position, id]
  const add = (pos, act, num) => {
    for (const d of (EXACT.get(exactKey(act, num)) || []).slice(0, 2)) hits.push([pos, d]);
  };
  for (const { act, after, before } of ALIAS_RES) {
    for (const re of [after, before]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(q))) add(m.index, act, m[1]);
    }
  }
  const artRe = /\barticles?\s*(\d{1,3}[A-Za-z]{0,2})\b/gi;
  let a;
  while ((a = artRe.exec(q))) add(a.index, 'THE CONSTITUTION OF INDIA', a[1]);
  hits.sort((x, y) => x[0] - y[0]);
  return [...new Set(hits.map(h => h[1]))].slice(0, 6);
}

export function loadStatuteIndex() {
  try {
    // Search RAG_DATA_DIRS (external disk) first, then the bundled data dir.
    const p = candidatePaths('statute-rag-index.json').find(c => fs.existsSync(c))
      || path.join(__dirname, 'data', 'statute-rag-index.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw.dims !== EMBED_DIMS) {
      console.warn(`[rag] statute index skipped: ${raw.dims}d != ${EMBED_DIMS}d (awaiting re-embed)`);
      INDEX = null; FTS = null; return;
    }
    const buf = Buffer.from(raw.vectors_b64, 'base64');
    const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    INDEX = { dims: raw.dims, count: raw.count, meta: raw.meta, vectors };
    FTS = buildMemoryFts(raw.meta, m => `${m.act} ${m.section} ${m.heading} ${m.text}`);
    EXACT = new Map();
    const wanted = new Set(ACT_ALIASES.map(a => a[1]).concat('THE CONSTITUTION OF INDIA'));
    raw.meta.forEach((m, d) => {
      if (!wanted.has(m.act) || !m.section) return;
      const num = String(m.section).replace(/^(section|article)\s*/i, '').trim();
      if (!/^\d{1,3}[A-Za-z]{0,2}$/.test(num)) return;
      const key = exactKey(m.act, num);
      if (!EXACT.has(key)) EXACT.set(key, []);
      EXACT.get(key).push(d);
    });
    console.log(`[rag] statute index loaded: ${raw.count} sections (${raw.dims}d) + keyword index`);
    BGE = null;
    if ((process.env.STATUTE_BGE || 'on').toLowerCase() !== 'off') {
      try {
        const bp = path.join(path.dirname(p), 'statute-bge-m3.f32');
        const info = JSON.parse(fs.readFileSync(path.join(path.dirname(p), 'statute-bge-m3.json'), 'utf8'));
        const bbuf = fs.readFileSync(bp);
        if (info.count !== raw.count || bbuf.byteLength !== info.count * info.dims * 4) {
          console.warn(`[rag] BGE-M3 statute vectors ignored: size does not match the index (${info.count} vs ${raw.count})`);
        } else {
          BGE = { dims: info.dims, vectors: new Float32Array(bbuf.buffer, bbuf.byteOffset, bbuf.byteLength / 4) };
          console.log(`[rag] BGE-M3 statute vectors loaded: ${info.count} sections (${info.dims}d)`);
        }
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn('[rag] BGE-M3 statute vectors unavailable:', e.message);
      }
    }
  } catch (e) {
    console.warn('[rag] statute index unavailable:', e.message);
    INDEX = null;
  }
}

async function embedQuery(text) { return localEmbedQuery(text); }

// Vector scores for the top-n sections: returns [{ d, score }] sorted best-first,
// plus a Map d->score for the ones returned.
function cosineTopIds(qvec, n, set = INDEX) {
  const { dims, vectors } = set;
  const count = INDEX.count;
  let qn = 0;
  for (let i = 0; i < dims; i++) qn += qvec[i] * qvec[i];
  qn = Math.sqrt(qn) || 1;
  const scores = new Array(count);
  for (let d = 0; d < count; d++) {
    const off = d * dims;
    let dot = 0, vn = 0;
    for (let i = 0; i < dims; i++) { const v = vectors[off + i]; dot += qvec[i] * v; vn += v * v; }
    scores[d] = [dot / ((Math.sqrt(vn) || 1) * qn), d];
  }
  scores.sort((a, b) => b[0] - a[0]);
  return scores.slice(0, n).map(([s, d]) => ({ d, score: s }));
}

// Hybrid retrieval: fuse vector (semantic) and keyword (BM25) results via RRF, so
// section numbers, act names and exact legal terms match literally while meaning
// still matters. A kept hit must be at least weakly semantic (cosine >= floor) OR
// a keyword hit, so off-topic queries still return ''. Never throws.
export async function retrieveStatuteContext(query, { k = 6, floor = 0.24, cite = '' } = {}) {
  if (!INDEX || !query || !query.trim()) return '';
  try {
    // Prefer the BGE-M3 vectors; fall back to e5 if that sidecar is unavailable.
    const bvec = await bgeEmbedQuery(query);
    const qvec = bvec ? null : await embedQuery(query);
    const vec = bvec ? cosineTopIds(bvec, 15, BGE)
      : qvec ? cosineTopIds(qvec, 15) : []; // neither -> keyword-only
    const vIds = vec.map(v => v.d);
    const scoreMap = new Map(vec.map(v => [v.d, v.score]));
    const kIds = FTS ? FTS.search(query, 15) : [];
    const kSet = new Set(kIds);
    let fused = rrfMerge([vIds, kIds], k * 2, 60, [2, 1]); // vector outranks keyword
    // Building bye-laws / development-control regulations are broad municipal text
    // that hijacks non-building queries ("shops", "working hours"). Gate them out
    // unless the question is actually about construction/building.
    const meta0 = INDEX.meta;
    const isBuildingQ = /build|setback|\bfsi\b|floor area|\bfar\b|construction|plinth|parking|storey|storey|\bheight\b|balcony|basement|coverage|bye-?law|far\b/i.test(query);
    if (!isBuildingQ) {
      fused = fused.filter(d => !/BUILDING BYE-LAWS|DEVELOPMENT CONTROL|\bDCPR\b|BUILDING RULES|MODEL BUILDING/i.test(meta0[d].act));
    }
    // State routing: if the query names a state, drop acts named after a DIFFERENT
    // state (e.g. "Delhi Land Holdings Act" for a Tamil Nadu question).
    const qStates = detectStates(query);
    if (qStates.length) {
      fused = fused.filter(d => {
        const act = meta0[d].act.toLowerCase();
        return !STATES.some(s => { const sl = s.toLowerCase(); return act.includes(sl) && !qStates.includes(sl); });
      });
    }
    // Sections the user cited by number go first, ahead of any fuzzy match.
    // `cite` carries extra citations resolved elsewhere (e.g. IPC 420 -> "BNS 318").
    const exact = exactCitationIds(cite ? `${query}\n${cite}` : query);
    const fuzzy = fused.filter(d => (scoreMap.get(d) ?? 0) >= floor || kSet.has(d));
    const meta = INDEX.meta;
    // When the user cited a section by number, drop fuzzy hits that carry the SAME
    // number in a different act ("BNS 13" next to a question about "BNSS 13") — the
    // model confuses the look-alike and describes the wrong one.
    const exactSet = new Set(exact);
    const citedSet = new Set(cite ? exactCitationIds(query) : exact);
    const secNum = d => String(meta[d].section || '').replace(/^(section|article)\s*/i, '').trim().toUpperCase();
    const exactNums = new Set(exact.map(secNum));
    let fuzzyClean = fuzzy.filter(d => exactSet.has(d) || !exactNums.has(secNum(d)));
    // When the question is pinned to specific sections, show other provisions of
    // the SAME Act before provisions of unrelated Acts: neighbours in the same
    // code are usually the companion rules, while a literal phrase match in a
    // special Act ("arrest without warrant" in a passport or ferries Act) is noise
    // that the model blends into the answer. Nothing is dropped — only reordered.
    if (exact.length) {
      const pinnedActs = new Set(exact.map(d => meta[d].act));
      fuzzyClean = [...fuzzyClean.filter(d => pinnedActs.has(meta[d].act)), ...fuzzyClean.filter(d => !pinnedActs.has(meta[d].act))];
    }
    const keep = [...new Set([...exact, ...fuzzyClean])].slice(0, Math.max(k, exact.length));
    if (!keep.length) return '';
    return keep
      .map(d => {
        const m = meta[d];
        const cite = m.section ? `${m.act} — ${m.section}` : m.act;
        const head = m.heading ? ` ${m.heading}` : '';
        // Only a section the user literally cited gets the strong tag. Sections
        // pinned via the topic map are relevant, but the user did not ask for them
        // by number, so they must not be presented as "the provision asked about".
        const tag = citedSet.has(d)
          ? '\n(THIS IS THE EXACT PROVISION THE USER ASKED ABOUT — answer from this text, not from any other section below.)'
          : '';
        return `[${cite}]${head}${tag}\n${m.text}`;
      })
      .join('\n\n');
  } catch (e) {
    console.warn('[rag] retrieval failed:', e.message);
    return '';
  }
}

export function statuteIndexReady() { return !!INDEX; }
