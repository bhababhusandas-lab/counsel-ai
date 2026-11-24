// REGULATOR PROVISIONS RAG — DISK-BASED, HYBRID.
//
// Provisions from the financial and sectoral regulators — SEBI, RBI, IRDAI, TRAI,
// MCA, DGFT, CBIC, MoEFCC, CPCB, DFS, state-GST, Law Commission — from the open
// Vaquill "Open India Law" dataset (CC-BY-4.0). Each provision carries its
// in-force status and a source_url back to the official document, so the model
// can say whether a provision is current and point at where it came from.
//
// Vector + keyword (FTS5) fused with RRF, same shape as the other hybrid indexes.
import fs from 'fs';
import { ensureIndexFile } from './s3Index.js';
import { ensureDbFts, rrfMerge } from './hybrid.js';
import { embedQuery as localEmbedQuery } from './localEmbed.js';

const EMBED_DIMS = 384;
let DB = null, vecStmt = null, metaStmt = null, FTS = null;

export async function loadRegulationsIndex() {
  try {
    const p = await ensureIndexFile('regulations.db');
    if (!fs.existsSync(p)) { console.warn('[rag] regulations DB not present'); DB = null; return; }
    const Database = (await import('better-sqlite3')).default;
    const sqliteVec = await import('sqlite-vec');
    DB = new Database(p, { fileMustExist: true });
    sqliteVec.load(DB);
    DB.pragma('cache_size = -40000');
    DB.pragma('mmap_size = 268435456');
    FTS = ensureDbFts(DB, { table: 'meta', cols: ['title', 'section', 'text'] });
    vecStmt = DB.prepare('select rowid, distance from vec where embedding match ? and k = ? order by distance');
    metaStmt = DB.prepare('select title, section, dept, in_force, status, url, year, text from meta where rowid = ?');
    try { vecStmt.all(Buffer.from(new Float32Array(EMBED_DIMS).buffer), 1); }
    catch { console.warn(`[rag] regulations DB skipped: not ${EMBED_DIMS}d`); DB = null; return; }
    const { c } = DB.prepare('select count(*) c from meta').get();
    console.log(`[rag] regulations DB loaded (disk, hybrid): ${c} provisions`);
  } catch (e) {
    console.warn('[rag] regulations DB unavailable:', e.message);
    DB = null;
  }
}

// Returns regulator provisions relevant to the query, or ''. Never throws.
export async function retrieveRegulations(query, { k = 2, maxDistance = 0.60 } = {}) {
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
    const keep = fused
      .filter(id => (distMap.has(id) && distMap.get(id) <= maxDistance) || kSet.has(id))
      .slice(0, k);
    if (!keep.length) return '';
    return keep.map(id => {
      const m = metaStmt.get(id);
      const dept = (m.dept || '').toUpperCase();
      const force = m.in_force ? 'in force' : `NOT in force${m.status ? ` (${m.status})` : ''}`;
      const src = m.url ? `\nSource: ${m.url}` : '';
      return `[${dept}${m.year ? `, ${m.year}` : ''} — ${force}] ${String(m.title || '').slice(0, 140)}${m.section ? ` §${m.section}` : ''}\n${m.text}${src}`;
    }).join('\n\n');
  } catch (e) {
    console.warn('[rag] regulations retrieval failed:', e.message);
    return '';
  }
}

export function regulationsIndexReady() { return !!DB; }
