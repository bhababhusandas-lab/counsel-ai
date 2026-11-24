// Append newly-embedded Supreme Court chunks to an existing sc-fulltext DB.
// Usage: node merge_sc_extra.mjs <target.db> <block.json...>
//
// Appends rather than rebuilding: the 581,833 chunks already in the database are
// correct, only the tail of 3,759 truncated judgments is missing. New rows carry
// rowids continuing from the current maximum, and each one is written to all
// three structures the retriever depends on — meta, the vec0 vector table, and
// the FTS index — so keyword and vector search stay in agreement.
import fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const [, , dbPath, ...inputs] = process.argv;
if (!dbPath || !inputs.length) { console.error('usage: merge_sc_extra.mjs <db> <files...>'); process.exit(1); }

const db = new Database(dbPath);
sqliteVec.load(db);

let rowid = db.prepare('select coalesce(max(rowid),0) m from meta').get().m;
const before = db.prepare('select count(*) c from meta').get().c;
// meta_fts body must match judgmentTextRag's cols: ['header','text'].
const hasFts = db.prepare("select count(*) c from sqlite_master where name='meta_fts'").get().c > 0;

const vStmt = db.prepare('insert into vec(rowid, embedding) values (?, ?)');
const mStmt = db.prepare('insert into meta(rowid, year, header, file, chunk, text) values (?,?,?,?,?,?)');
const fStmt = hasFts ? db.prepare('insert into meta_fts(rowid, body) values (?, ?)') : null;

let added = 0;
for (const f of inputs.sort()) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (raw.dims !== 384) throw new Error(`dim mismatch in ${f}: ${raw.dims}`);
  const buf = Buffer.from(raw.vectors_b64, 'base64');
  const tx = db.transaction(() => {
    for (let i = 0; i < raw.meta.length; i++) {
      const m = raw.meta[i];
      // vec0 accepts only BigInt rowids.
      const id = BigInt(++rowid);
      vStmt.run(id, buf.subarray(i * 384 * 4, (i + 1) * 384 * 4));
      mStmt.run(id, m.year, m.header, m.file, m.chunk, m.text);
      if (fStmt) fStmt.run(id, `${m.header || ''} ${m.text || ''}`);
      added++;
    }
  });
  tx();
  console.log(`  merged ${f.split('/').pop()} (+${raw.meta.length})`);
}
console.log(`MERGE_DONE ${before} -> ${before + added} chunks (+${added})`);
db.close();
