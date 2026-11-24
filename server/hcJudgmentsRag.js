// HIGH COURT JUDGMENT TEXT RAG — DISK-BASED, HYBRID.
// Full text of judgments from all 25 High Courts (Vaquill "Open India Law",
// CC-BY-4.0). Same hybrid shape as the SC judgment-text index. The DB
// (hc-judgments.db) is built on a GPU host — see the hc-ingest pipeline.
// No-ops gracefully if the DB is not present, so this can be wired now and the
// data added later.
import fs from 'fs';
import { ensureIndexFile } from './s3Index.js';
import { ensureDbFts, rrfMerge } from './hybrid.js';
import { embedQuery as localEmbedQuery } from './localEmbed.js';

const EMBED_DIMS = 384;
let DB = null, vecStmt = null, metaStmt = null, FTS = null;

export async function loadHcJudgmentsIndex() {
  try {
    const p = await ensureIndexFile('hc-judgments.db');
    if (!fs.existsSync(p)) { console.warn('[rag] HC judgments DB not present (stage on a GPU host first)'); DB = null; return; }
    const Database = (await import('better-sqlite3')).default;
    const sqliteVec = await import('sqlite-vec');
    DB = new Database(p, { fileMustExist: true });
    sqliteVec.load(DB);
    DB.pragma('cache_size = -60000');
    DB.pragma('mmap_size = 536870912');
    FTS = ensureDbFts(DB, { table: 'meta', cols: ['title', 'text'] });
    vecStmt = DB.prepare('select rowid, distance from vec where embedding match ? and k = ? order by distance');
    metaStmt = DB.prepare('select court, title, citation, date, url, text from meta where rowid = ?');
    try { vecStmt.all(Buffer.from(new Float32Array(EMBED_DIMS).buffer), 1); }
    catch { console.warn(`[rag] HC judgments DB skipped: not ${EMBED_DIMS}d`); DB = null; return; }
    const { c } = DB.prepare('select count(*) c from meta').get();
    console.log(`[rag] HC judgments DB loaded (disk, hybrid): ${c} chunks`);
  } catch (e) {
    console.warn('[rag] HC judgments DB unavailable:', e.message);
    DB = null;
  }
}

export async function retrieveHcJudgments(query, { k = 2, maxDistance = 0.60 } = {}) {
  if (!DB || !vecStmt || !query || !query.trim()) return '';
  try {
    const qvec = await localEmbedQuery(query);
    let distMap = new Map(), vIds = [];
    if (qvec) {
      const vrows = vecStmt.all(Buffer.from(new Float32Array(qvec).buffer), 15);
      distMap = new Map(vrows.map(r => [r.rowid, r.distance]));
      vIds = vrows.map(r => r.rowid);
    }
    const kIds = FTS ? FTS.search(query, 15) : [];
    const kSet = new Set(kIds);
    const fused = rrfMerge([vIds, kIds], k * 2, 60, [2, 1]);
    const keep = fused.filter(id => (distMap.has(id) && distMap.get(id) <= maxDistance) || kSet.has(id)).slice(0, k);
    if (!keep.length) return '';
    return keep.map(id => {
      const m = metaStmt.get(id);
      return `[${m.court || 'High Court'}${m.date ? `, ${String(m.date).slice(0,10)}` : ''}] ${String(m.title || '').slice(0,140)}\n${m.text}${m.url ? `\nSource: ${m.url}` : ''}`;
    }).join('\n\n');
  } catch (e) {
    console.warn('[rag] HC judgments retrieval failed:', e.message);
    return '';
  }
}
export function hcJudgmentsIndexReady() { return !!DB; }
