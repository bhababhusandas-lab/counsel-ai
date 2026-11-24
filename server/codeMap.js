// Criminal-code renumbering guard. The IPC, CrPC and Indian Evidence Act were
// replaced in 2023 by the BNS, BNSS and BSA, and EVERY section was renumbered —
// the old number almost never carries over (e.g. IPC 34 "common intention" is now
// BNS 3(5), while BNS 34 is "right of private defence"). Left to itself the model
// assumes the old number survived and cites the wrong section. This scans the
// question + retrieved context for any code/section it recognises and appends the
// verified mapping so the model cites the correct NEW (or NEW->old) number.
//
// Every "new" heading in data/criminal-code-map.json was checked against the live
// statute index. Only the mappings a given question touches are injected, so the
// note stays short.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let MAP = [];
let byOld = new Map();   // "ipc:302" -> entry
let byNew = new Map();   // "bns:103" -> entry
let NAMES = [];          // { alias, entry }

// Code aliases as they appear in free text.
const OLD_CODES = [
  { code: 'ipc', rx: '(?:ipc|i\\.?\\s?p\\.?\\s?c\\.?|indian penal code|penal code)' },
  { code: 'crpc', rx: '(?:crpc|cr\\.?\\s?p\\.?\\s?c\\.?|code of criminal procedure)' },
  { code: 'evidence', rx: '(?:indian evidence act|evidence act)' },
];
const NEW_CODES = [
  { code: 'bnss', rx: '(?:bnss|nagarik suraksha sanhita|nagarik suraksha)' },
  { code: 'bsa', rx: '(?:bsa|sakshya adhiniyam|bharatiya sakshya)' },
  { code: 'bns', rx: '(?:bns(?!s)|bharatiya nyaya sanhita|nyaya sanhita)' },
];

// Parse "IPC 302" / "CrPC 41" / "Evidence Act 65B" / "BNS 3(5)" -> {code, num}.
function parseRef(ref) {
  const s = String(ref).toLowerCase();
  let code = null;
  if (/evidence/.test(s)) code = 'evidence';
  else if (/bnss/.test(s)) code = 'bnss';
  else if (/bsa/.test(s)) code = 'bsa';
  else if (/bns/.test(s)) code = 'bns';
  else if (/crpc/.test(s)) code = 'crpc';
  else if (/ipc/.test(s)) code = 'ipc';
  const m = s.match(/(\d{1,3}[a-z]?)/); // first section number token
  return code && m ? { code, num: m[1] } : null;
}

try {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'criminal-code-map.json'), 'utf8'));
  MAP = j.map || [];
  for (const e of MAP) {
    const o = parseRef(e.old), n = parseRef(e.new);
    if (o) byOld.set(`${o.code}:${o.num}`, e);
    // Only index the reverse when the new section is a whole section (no sub-clause
    // like "3(5)"), so "BNS 3" is never mislabelled as common intention.
    if (n && !/\(/.test(e.new)) byNew.set(`${n.code}:${n.num}`, e);
    // Match aliases as WHOLE words/phrases. Plain substring matching made "fir"
    // fire on "first", "confirm" and "firm", pinning the FIR section onto divorce
    // and company questions.
    for (const a of (e.names || [])) {
      const alias = a.toLowerCase();
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      NAMES.push({ alias, rx: new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i'), entry: e });
    }
  }
  console.log(`[code-map] loaded ${MAP.length} IPC/CrPC/Evidence -> BNS/BNSS/BSA mappings`);
} catch (err) {
  console.warn('[code-map] not loaded:', err.message);
}

// Find section numbers cited next to a code token, in either order
// ("ipc 302", "section 302 ipc", "302 of the ipc").
function refsForCode(hay, rx) {
  const nums = new Set();
  const after = new RegExp(rx + '\\s*(?:section|sec\\.?|s\\.?|§|art\\.?|no\\.?|under)?[\\s:.,-]*([0-9]{1,3}[a-z]?)', 'gi');
  const before = new RegExp('([0-9]{1,3}[a-z]?)\\s*(?:of\\s+the\\s+|,?\\s*(?:of\\s+)?)?' + rx, 'gi');
  let m;
  while ((m = after.exec(hay))) nums.add(m[1].toLowerCase());
  while ((m = before.exec(hay))) nums.add(m[1].toLowerCase());
  return nums;
}

// Returns a short prompt block (or '') listing the correct renumbered sections for
// whatever the text touches. Never throws.
export function codeMapNote(text, nameText = text) {
  if (!MAP.length) return '';
  try {
    const hay = String(text || '').toLowerCase();
    if (!hay.trim()) return '';
    const lines = [];
    const seen = new Set();
    const push = (key, line) => { if (!seen.has(key)) { seen.add(key); lines.push(line); } };

    // 1. Old-code section cited -> point to the new section.
    for (const { code, rx } of OLD_CODES) {
      for (const num of refsForCode(hay, rx)) {
        const e = byOld.get(`${code}:${num}`);
        if (e) push('o' + code + num, `${e.old} is now ${e.new} — ${e.topic}. Cite ${e.new}.`);
      }
    }
    // 2. New-code section cited -> confirm what it actually is (stops misdescription).
    for (const { code, rx } of NEW_CODES) {
      for (const num of refsForCode(hay, rx)) {
        const e = byNew.get(`${code}:${num}`);
        if (e) push('n' + code + num, `${e.new} = ${e.topic} (was ${e.old}). The old ${e.old} number did NOT carry over to the new code.`);
      }
    }
    // 3. Offence named -> give the new section (only if we haven't already emitted it).
    //    Names are matched against the USER'S words only (nameText), never the
    //    retrieved context: thousands of characters of retrieved law always
    //    contain words like "theft" or "420" somewhere, which stapled criminal
    //    mappings onto unrelated civil answers.
    const nameHay = String(nameText || '');
    for (const { rx, entry } of NAMES) {
      if (lines.length >= 6) break;
      if (rx.test(nameHay)) push('e' + entry.new, `${entry.topic}: ${entry.new} (old ${entry.old}).`);
    }

    if (!lines.length) return '';
    return `\n\nCRIMINAL CODE RENUMBERING (2023) — the IPC, CrPC and Indian Evidence Act were replaced by the BNS, BNSS and BSA and every section was renumbered; the OLD number does not carry over. Use these verified mappings and cite the correct new section (you may add the old one in brackets):\n- ${lines.slice(0, 6).join('\n- ')}`;
  } catch (e) {
    console.warn('[code-map] note failed:', e.message);
    return '';
  }
}

// New-code sections ("BNS 318", "BNSS 35") that a user's question points at, either
// by citing the old section ("IPC 420") or by naming the offence/procedure ("arrest
// without warrant"). The statute retriever fetches these sections' actual text so
// the answer is grounded in the current law rather than the model's memory.
export function codeMapNewRefs(text) {
  if (!MAP.length) return [];
  try {
    const hay = String(text || '').toLowerCase();
    const out = new Set();
    // `related` lists companion sections a complete answer needs (e.g. arrest ->
    // grounds of arrest, 24-hour limit, production before a Magistrate).
    const add = (e) => { out.add(e.new); for (const r of (e.related || [])) out.add(r); };
    for (const { code, rx } of OLD_CODES) {
      for (const num of refsForCode(hay, rx)) {
        const e = byOld.get(`${code}:${num}`);
        if (e) add(e);
      }
    }
    for (const { rx, entry } of NAMES) if (rx.test(hay)) add(entry);
    return [...out].slice(0, 6);
  } catch { return []; }
}
