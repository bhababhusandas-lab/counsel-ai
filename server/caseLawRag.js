// Case-law citation RAG — DISK-BASED, KEYWORD-ONLY (FTS5/BM25).
//
// Covers High Court judgments (all courts/benches/years, from the public AWS
// open-data set) plus Supreme Court judgments. Millions of rows, so this index is
// deliberately keyword-only: embedding every judgment would take days on CPU, and
// case lookups are literal anyway — a party name ("Kesavananda Bharati"), a case
// number ("WP(C)/1684/2019"), a judge, or a court. Semantic legal questions are
// answered by the statute/rules vector indexes; this module exists so the model
// can cite REAL cases with real courts and dates instead of inventing them.
//
// The DB lives on external storage (see RAG_DATA_DIRS); no-ops if absent.
import fs from 'fs';
import { ensureIndexFile } from './s3Index.js';
import { ftsMatchExpr } from './hybrid.js';

let DB = null, searchStmt = null;

// How many matching rows to bm25-rank before taking the top k. Keeps a broad query
// fast (~1s) instead of ranking millions. Tunable via env on a bigger-RAM host.
const CASE_LAW_CANDIDATES = Number(process.env.CASE_LAW_CANDIDATES) || 4000;

export async function loadCaseLawIndex() {
  try {
    const p = await ensureIndexFile('case-law.db');
    if (!fs.existsSync(p)) { console.warn('[rag] case-law DB not present'); DB = null; return; }
    const Database = (await import('better-sqlite3')).default;
    DB = new Database(p, { fileMustExist: true, readonly: true });
    DB.pragma('cache_size = -40000');
    DB.pragma('mmap_size = 268435456');
    // IMPORTANT: bound the work. A broad OR query ("police OR india OR section"…)
    // matches MILLIONS of the 20.6M rows, and `order by bm25` over all of them took
    // ~125s and BLOCKED the whole (single-threaded, synchronous better-sqlite3) event
    // loop — 524s at the tunnel and a frozen backend. So we only ever bm25-rank a
    // capped candidate set (the first CASE_LAW_CANDIDATES matches, which FTS5 returns
    // in rowid order and stops early), then take the top k. Scoring a few thousand
    // rows is ~1s instead of minutes, and nothing blocks for long.
    searchStmt = DB.prepare(`
      select m.court, m.title, m.judge, m.date, m.disposal, m.source, m.snippet
      from (
        select rowid, bm25(meta_fts) AS score
        from meta_fts where meta_fts match ? limit ?
      ) f
      join meta m on m.rowid = f.rowid
      order by f.score limit ?`);
    const { c } = DB.prepare('select count(*) c from meta').get();
    console.log(`[rag] case-law DB loaded (disk, keyword): ${c} judgments`);
  } catch (e) {
    console.warn('[rag] case-law DB unavailable:', e.message);
    DB = null;
  }
}

// Returns formatted case citations, or ''. Never throws.
export async function retrieveCaseLaw(query, { k = 4 } = {}) {
  if (!DB || !searchStmt || !query || !query.trim()) return '';
  try {
    const expr = ftsMatchExpr(query);
    if (!expr) return '';
    const rows = searchStmt.all(expr, CASE_LAW_CANDIDATES, k);
    if (!rows.length) return '';
    return rows.map(r => {
      const bits = [r.court, r.date ? `decided ${r.date}` : '', r.judge ? `before ${r.judge}` : '']
        .filter(Boolean).join(', ');
      const disposal = r.disposal ? ` [${r.disposal}]` : '';
      return `${r.title}\n  ${bits}${disposal}${r.snippet ? `\n  ${r.snippet}` : ''}`;
    }).join('\n\n');
  } catch (e) {
    console.warn('[rag] case-law retrieval failed:', e.message);
    return '';
  }
}

export function caseLawIndexReady() { return !!DB; }
