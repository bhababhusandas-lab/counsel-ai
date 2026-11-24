// Build the regulator-provisions sqlite-vec DB from embedded block files
// ({dims, meta:[{title,section,dept,in_force,status,url,year,text}], vectors_b64}).
// Usage: node scripts/build_regulations_db.mjs <out.db> <block.json...>
import fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const [, , outPath, ...inputs] = process.argv;
if (!outPath || !inputs.length) { console.error('usage: <out.db> <files...>'); process.exit(1); }
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
const db = new Database(outPath);
sqliteVec.load(db);
db.pragma('journal_mode = WAL');
let dims = null, rowid = 0, vStmt, mStmt;
for (const f of inputs.sort()) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (dims === null) {
    dims = raw.dims;
    db.exec(`create virtual table vec using vec0(embedding float[${dims}] distance_metric=cosine)`);
    db.exec('create table meta(rowid integer primary key, title text, section text, dept text, in_force integer, status text, url text, year text, text text)');
    vStmt = db.prepare('insert into vec(rowid, embedding) values (?, ?)');
    mStmt = db.prepare('insert into meta(rowid,title,section,dept,in_force,status,url,year,text) values (?,?,?,?,?,?,?,?,?)');
  } else if (raw.dims !== dims) throw new Error(`dim mismatch in ${f}`);
  const buf = Buffer.from(raw.vectors_b64, 'base64');
  const tx = db.transaction(() => {
    for (let i = 0; i < raw.meta.length; i++) {
      const m = raw.meta[i];
      const id = BigInt(++rowid);
      vStmt.run(id, buf.subarray(i * dims * 4, (i + 1) * dims * 4));
      mStmt.run(id, m.title ?? '', m.section ?? '', m.dept ?? '', m.in_force ? 1 : 0, m.status ?? '', m.url ?? '', String(m.year ?? ''), m.text ?? '');
    }
  });
  tx();
  console.log(`${f.split('/').pop()}: +${raw.meta.length} (total ${rowid})`);
}
db.exec('create index if not exists idx_dept on meta(dept)');
db.close();
console.log(`REG_DB_DONE ${rowid} chunks -> ${outPath}`);
