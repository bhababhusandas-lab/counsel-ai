// Supreme Court FULL JUDGMENT TEXT RAG — DISK-BASED, HYBRID.
//
// judgmentRag.js indexes SC judgment *metadata* (title, citation, the legal issue)
// so the model can cite a real case. This module indexes the actual TEXT of those
// judgments — every year 1950-present, chunked — so the model can say what the
// Court reasoned and held, not merely that a case exists.
//
// Vector + keyword (FTS5) fused with RRF, same as the state full-text index.
// The DB lives on external storage (RAG_DATA_DIRS); no-ops if absent.
import fs from 'fs';
import { ensureIndexFile } from './s3Index.js';
import { ensureDbFts, rrfMerge } from './hybrid.js';
import { embedQuery as localEmbedQuery } from './localEmbed.js';

const EMBED_DIMS = 384;

let DB = null, vecStmt = null, metaStmt = null, FTS = null;

export async function loadJudgmentTextIndex() {
  try {
    const p = await ensureIndexFile('sc-fulltext.db');
    if (!fs.existsSync(p)) { console.warn('[rag] SC full-text DB not present'); DB = null; return; }
    const Database = (await import('better-sqlite3')).default;
    const sqliteVec = await import('sqlite-vec');
    // Read-write so the FTS keyword index can be built into the local copy.
    DB = new Database(p, { fileMustExist: true });
    sqliteVec.load(DB);
    DB.pragma('cache_size = -40000');
    DB.pragma('mmap_size = 268435456');
    FTS = ensureDbFts(DB, { table: 'meta', cols: ['header', 'text'] });
    vecStmt = DB.prepare('select rowid, distance from vec where embedding match ? and k = ? order by distance');
    metaStmt = DB.prepare('select year, header, file, chunk, text from meta where rowid = ?');
    try { vecStmt.all(Buffer.from(new Float32Array(EMBED_DIMS).buffer), 1); }
    catch { console.warn(`[rag] SC full-text DB skipped: not ${EMBED_DIMS}d`); DB = null; return; }
    const { c } = DB.prepare('select count(*) c from meta').get();
    console.log(`[rag] SC full-text DB loaded (disk, hybrid): ${c} chunks`);
  } catch (e) {
    console.warn('[rag] SC full-text DB unavailable:', e.message);
    DB = null;
  }
}

// Returns passages from real SC judgments, or ''. Never throws.
export async function retrieveJudgmentText(query, { k = 3, maxDistance = 0.60 } = {}) {
  if (!DB || !vecStmt || !query || !query.trim()) return '';
  try {
    const qvec = await localEmbedQuery(query);
    let distMap = new Map(), vIds = [];
    if (qvec) { // null qvec -> keyword-only
      const vrows = vecStmt.all(Buffer.from(new Float32Array(qvec).buffer), 15);
      distMap = new Map(vrows.map(r => [r.rowid, r.distance]));
      vIds = vrows.map(r => r.rowid);
    }
    const kIds = FTS ? FTS.search(query, 15) : [];
    const kSet = new Set(kIds);
    const fused = rrfMerge([vIds, kIds], k * 2, 60, [2, 1]);
    const keep = fused
      .filter(id => (distMap.has(id) && distMap.get(id) <= maxDistance) || kSet.has(id))
      .slice(0, k);
    if (!keep.length) return '';
    return keep.map(id => {
      const h = metaStmt.get(id);
      // The header is the first line of the judgment (parties + citation line).
      return `[Supreme Court of India, ${h.year}] ${String(h.header || '').slice(0, 160)}\n${h.text}`;
    }).join('\n\n');
  } catch (e) {
    console.warn('[rag] SC full-text retrieval failed:', e.message);
    return '';
  }
}

export function judgmentTextIndexReady() { return !!DB; }

// Assemble the FULL text of the single best-matching Supreme Court judgment for a
// query (a case name / citation). FTS finds the judgment; then, because a
// judgment's chunks sit in consecutive rows with `chunk` counting 0..N-1, we walk
// the rowids to stitch the whole judgment back together — fast primary-key reads,
// no table scan, no DB writes. Returns { file, year, header, chunks, text } or null.
export function getFullJudgment(query, { maxChunks = 6000 } = {}) {
  if (!DB || !FTS || !metaStmt || !query || !query.trim()) return null;
  try {
    const ids = FTS.search(query, 200);
    if (!ids || !ids.length) return null;
    // Every chunk of a judgment carries the same `header` — the case title line
    // (parties + date). A query names a case, so the RIGHT judgment is the one
    // whose TITLE matches the query terms — not the many later cases that merely
    // cite it in their body. So rank candidate files by how many distinctive query
    // terms appear in the header, with FTS rank as the tiebreak.
    // Drop only request/filler words — KEEP disambiguating title words like
    // "union", "india", "state" so a fuller case name ("... v Union of India")
    // ranks the right judgment above others that merely share a surname.
    const COMMON = new Set(['the', 'and', 'for', 'with', 'versus', 'case', 'judgment', 'judgement', 'full', 'complete', 'entire', 'whole', 'actual', 'original', 'text', 'ruling', 'order', 'copy', 'file', 'give', 'show', 'get', 'read', 'download', 'provide', 'want', 'need', 'please', 'court', 'supreme']);
    const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !COMMON.has(w));
    const cand = new Map(); // file -> { seed rowid, header, ftsRank, hits }
    ids.forEach((id, i) => {
      const r = metaStmt.get(id);
      if (!r || !r.file) return;
      if (!cand.has(r.file)) cand.set(r.file, { seed: id, header: String(r.header || '').toLowerCase(), rank: i, hits: 0 });
      cand.get(r.file).hits++;
    });
    // Pick by: most distinctive title-terms matched, then most matching chunks
    // (the substantive judgment, not a short order that shares the name), then
    // best FTS rank.
    let bestFile = null, bestScore = -1, bestHits = -1, bestRank = Infinity;
    for (const [file, c] of cand) {
      let hs = 0; for (const t of terms) if (c.header.includes(t)) hs++;
      if (hs > bestScore
          || (hs === bestScore && c.hits > bestHits)
          || (hs === bestScore && c.hits === bestHits && c.rank < bestRank)) {
        bestScore = hs; bestHits = c.hits; bestRank = c.rank; bestFile = file;
      }
    }
    if (bestFile == null) return null;

    // Walk back to the first chunk of this judgment.
    let start = cand.get(bestFile).seed, guard = maxChunks;
    while (start > 1 && guard-- > 0) {
      const prev = metaStmt.get(start - 1);
      if (!prev || prev.file !== bestFile) break;
      start--;
    }
    // Collect forward until the file changes.
    const rows = []; let rid = start; guard = maxChunks;
    while (guard-- > 0) {
      const row = metaStmt.get(rid);
      if (!row || row.file !== bestFile) break;
      rows.push(row); rid++;
    }
    if (!rows.length) return null;
    const text = rows.map(r => r.text || '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return null;
    return { file: bestFile, year: rows[0].year, header: String(rows[0].header || '').slice(0, 200), chunks: rows.length, text };
  } catch (e) {
    console.warn('[rag] getFullJudgment failed:', e.message);
    return null;
  }
}
