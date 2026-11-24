// Currency check: flag when a retrieved statute is repealed or superseded, so the
// chat can warn "this is no longer the current law" instead of citing a dead act
// as if it were in force. Backed by a hand-curated, conservative map
// (documents/../data/act-status.json) — anything not confidently repealed is
// treated as current and never flagged, because a wrong "repealed" is as
// damaging as a wrong citation.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let ENTRIES = [];
let AMENDMENTS = [];
try {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'act-status.json'), 'utf8'));
  ENTRIES = j.entries || [];
  AMENDMENTS = j.amendments || [];
  console.log(`[act-status] loaded ${ENTRIES.length} currency rules + ${AMENDMENTS.length} amendment advisories`);
} catch (e) {
  console.warn('[act-status] not loaded:', e.message);
}

// Normalise so "Companies Act, 2013" and "companies act 2013" match the same:
// lowercase, drop commas/periods, collapse whitespace.
const norm = (s) => String(s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// Scan a blob of text (the retrieved RAG context and/or the user's question) for
// any superseded act, returning one alert line per distinct match.
export function currencyAlerts(text) {
  const hay = norm(text);
  const hits = [];
  const seen = new Set();
  for (const e of ENTRIES) {
    if (seen.has(e.note)) continue;
    if ((e.match || []).some((m) => hay.includes(norm(m)))) {
      seen.add(e.note);
      hits.push(e.note);
    }
  }
  return hits;
}

// Amendment advisories: the act is still in force but has significant amendments
// the answer should account for.
export function amendmentAlerts(text) {
  const hay = norm(text);
  const hits = [];
  const seen = new Set();
  for (const a of AMENDMENTS) {
    if (seen.has(a.note)) continue;
    if ((a.match || []).some((m) => hay.includes(norm(m)))) { seen.add(a.note); hits.push(a.note); }
  }
  return hits;
}

// Ready-to-append prompt block, or '' if nothing is stale/amended.
export function currencyBlock(text) {
  const repealed = currencyAlerts(text);
  const amended = amendmentAlerts(text);
  let out = '';
  if (repealed.length) {
    out += `\n\nCURRENCY ALERTS (a law referenced here is no longer current — you MUST tell the user this clearly and cite the replacement instead of the old law):\n- ${repealed.join('\n- ')}`;
  }
  if (amended.length) {
    out += `\n\nAMENDMENT NOTES (the law referenced is still in force but has been amended — mention this and advise checking the latest amended text):\n- ${amended.join('\n- ')}`;
  }
  return out;
}
