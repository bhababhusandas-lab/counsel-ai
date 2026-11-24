// Render a plain document spec to .docx and .pdf, in memory, with no network
// call and no LLM. The spec is deterministic: what goes in is what comes out,
// which is the property a document someone may act on actually needs.
//
// A spec looks like:
//   {
//     docType: 'Terms and Conditions',
//     title:   'Terms and Conditions',
//     meta:    [['Between', 'Acme Pvt Ltd'], ['Effective date', '1 April 2026']],
//     sections:[{ heading: 'Definitions', clauses: ['...', '...'] }, ...],
//     citations:[{ label: 'DPDP Act 2023, s.6', note: 'consent must be...' }],
//   }
//
// Every document carries the same review banner: these drafts are assembled from
// templates and statutory forms, not written by an advocate, and must be reviewed
// before use. That is not decoration — it is the honest statement of what this is.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';

export const REVIEW_BANNER =
  'This document was drafted automatically by Counsel AI from templates and ' +
  'Indian statutory material. It is a starting draft, not legal advice, and has ' +
  'not been reviewed by an advocate. Have a qualified advocate review and adapt ' +
  'it before you rely on it or sign it.';

// ---- Word (.docx) -----------------------------------------------------------
export async function buildDocx(spec) {
  const children = [];

  children.push(new Paragraph({
    text: spec.title || spec.docType,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));

  // Review banner, boxed, right under the title.
  children.push(new Paragraph({
    border: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 6 },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 6 },
      left:   { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 6 },
      right:  { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 6 },
    },
    spacing: { before: 200, after: 300 },
    children: [new TextRun({ text: REVIEW_BANNER, italics: true, size: 18, color: '555555' })],
  }));

  // Metadata pairs (parties, dates, jurisdiction).
  for (const [k, v] of spec.meta || []) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `${k}: `, bold: true, size: 22 }),
        new TextRun({ text: String(v), size: 22 }),
      ],
    }));
  }

  // Numbered sections, each with numbered clauses beneath.
  (spec.sections || []).forEach((sec, si) => {
    children.push(new Paragraph({
      spacing: { before: 260, after: 100 },
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${si + 1}. ${sec.heading}`, bold: true })],
    }));
    (sec.clauses || []).forEach((clause, ci) => {
      children.push(new Paragraph({
        spacing: { after: 90 },
        indent: { left: 360 },
        children: [
          new TextRun({ text: `${si + 1}.${ci + 1}  `, bold: true, size: 21 }),
          new TextRun({ text: clause, size: 21 }),
        ],
      }));
    });
  });

  // Sources — the statutory material the clauses were grounded in.
  if (spec.citations && spec.citations.length) {
    children.push(new Paragraph({
      spacing: { before: 320, after: 100 },
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Statutory basis', bold: true })],
    }));
    for (const c of spec.citations) {
      children.push(new Paragraph({
        spacing: { after: 70 }, indent: { left: 360 },
        children: [
          new TextRun({ text: '• ', size: 21 }),
          new TextRun({ text: c.label, bold: true, size: 21 }),
          ...(c.note ? [new TextRun({ text: ` — ${c.note}`, size: 21, color: '555555' })] : []),
        ],
      }));
    }
  }

  const doc = new Document({
    creator: 'Counsel AI',
    title: spec.title || spec.docType,
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc); // -> Promise<Buffer>
}

// ---- PDF --------------------------------------------------------------------
export function buildPdf(spec) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 } });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text(spec.title || spec.docType, { align: 'center' });
    doc.moveDown(0.6);

    // Boxed review banner.
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555');
    const bx = doc.x, by = doc.y, bw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bh = doc.heightOfString(REVIEW_BANNER, { width: bw - 16 }) + 12;
    doc.rect(bx, by, bw, bh).strokeColor('#999').lineWidth(0.5).stroke();
    doc.text(REVIEW_BANNER, bx + 8, by + 6, { width: bw - 16 });
    doc.fillColor('#000').moveDown(1);

    for (const [k, v] of spec.meta || []) {
      doc.font('Helvetica-Bold').fontSize(11).text(`${k}: `, { continued: true })
         .font('Helvetica').text(String(v));
    }
    doc.moveDown(0.4);

    (spec.sections || []).forEach((sec, si) => {
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor('#000')
         .text(`${si + 1}. ${sec.heading}`);
      doc.moveDown(0.2);
      (sec.clauses || []).forEach((clause, ci) => {
        doc.font('Helvetica-Bold').fontSize(10.5).text(`${si + 1}.${ci + 1}  `, { continued: true })
           .font('Helvetica').text(clause, { align: 'justify' });
        doc.moveDown(0.25);
      });
    });

    if (spec.citations && spec.citations.length) {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).text('Statutory basis');
      doc.moveDown(0.2);
      for (const c of spec.citations) {
        doc.font('Helvetica-Bold').fontSize(10.5).text('•  ', { continued: true }).text(c.label,
          { continued: !!c.note });
        if (c.note) doc.font('Helvetica').fillColor('#555').text(` — ${c.note}`).fillColor('#000');
        doc.moveDown(0.15);
      }
    }

    doc.end();
  });
}

// ---- Freeform text → spec ---------------------------------------------------
// Turn a chat answer (markdown-ish) into a document spec so it can be rendered to
// Word/PDF. This is what powers "generate a document about X" in the chat: the
// model writes the answer, and this wraps that exact text into a file — no
// second model call, no reinterpretation of the content.
// Markers the chat wraps the actual document in, so the file contains only the
// document — not the friendly "here's your T&C…" intro or the sign-off around it.
const DOC_BEGIN = /===\s*BEGIN DOCUMENT\s*===/i;
const DOC_END = /===\s*END DOCUMENT\s*===/i;

export function extractDocumentBody(text) {
  const s = String(text || '');
  const b = s.search(DOC_BEGIN);
  if (b === -1) return s; // no markers → treat the whole answer as the document
  const afterBegin = s.slice(s.indexOf('\n', b) + 1);
  const e = afterBegin.search(DOC_END);
  return (e === -1 ? afterBegin : afterBegin.slice(0, e)).trim();
}

const stripMd = (s) => String(s)
  .replace(/^\s*#{1,6}\s*/, '')
  .replace(/\*\*(.*?)\*\*/g, '$1')
  .replace(/\*(.*?)\*/g, '$1')
  .replace(/`(.*?)`/g, '$1')
  .trim();

// Bold labels that structure a legal instrument but are NOT numbered sections —
// they render as bold inline lines, not big headings.
const LABEL_RE = /^(between|and|whereas:?|now,?\s*therefore.*|in witness whereof.*|witnesses:?|recitals:?|schedule[- ].*|annexure[- ].*|important notes.*)$/i;

// Classify each line of a chat-drafted document into a typed block, so the
// renderer can lay it out like a real instrument: a centred title, a small
// governing-law subtitle, bold section headings, bold structural labels
// (BETWEEN / WHEREAS / IN WITNESS WHEREOF), and justified clauses with a hanging
// indent for "(a)" sub-items.
// A warm chat reply opens with a greeting ("Hey, don't worry about this — here's
// what you can do…") and closes by asking a follow-up question ("Tell me more…").
// That belongs in a chat bubble, not an exported document, so strip it when
// turning an answer into a PDF/Word file. (Drafted instruments carry their own
// title and never start this way, so this is a no-op for them.)
const CHAT_OPENER_PREFIX = /^\s*(hey|hi|hello|sure|okay|ok|alright|no worries|don'?t worry(?: about (?:this|it))?|great question|good question|absolutely|of course)\b[^\n]*?(?:[—:-]\s+|\.\s+)/i;
const CHAT_FILLER_START = /^\s*(here'?s what you can do[^.\n]*[.:]?\s+|here is what you can do[^.\n]*[.:]?\s+|let me break it down[^.\n]*[.:]?\s+|this is (?:actually )?(?:pretty |quite )?common[^.\n]*[.:]?\s+|no need to worry[^.\n]*[.:]?\s+)/i;
const CHAT_CLOSER = /(tell me more|let me know|feel free|i can (?:guide|help)|i'?m here to help|hope this helps|reach out|happy to help|any (?:other )?questions|if you (?:have|need|want|give|share|tell)|share (?:more )?details|give me more details|and i can (?:guide|help))/i;

function deChat(body) {
  let s = String(body || '').replace(/\r/g, '').trim();
  // Peel off a leading greeting and any immediate filler opener, repeatedly.
  let prev;
  do { prev = s; s = s.replace(CHAT_OPENER_PREFIX, '').replace(CHAT_FILLER_START, ''); } while (s !== prev);
  s = s.trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  // Drop trailing conversational sign-off lines ("Tell me more…", "Let me know…").
  const lines = s.split('\n');
  while (lines.length) {
    const last = stripMd(lines[lines.length - 1]).trim();
    if (!last) { lines.pop(); continue; }
    if (last.length < 220 && CHAT_CLOSER.test(last)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
}

export function specFromText(text, title) {
  const body = deChat(extractDocumentBody(text));
  const raw = String(body || '').replace(/\r/g, '').split('\n');
  const lines = [];
  let derivedTitle = '';
  let titleEmitted = false;
  let seenHeading = false;
  let firstContent = true;
  const passedTitle = (title && String(title).trim()) ? String(title).trim() : '';

  for (let i = 0; i < raw.length; i++) {
    const l = raw[i].trim();
    if (!l) continue;
    const clean = stripMd(l);

    // Title: the first content line when it is an H1 or a short all-caps line.
    // ALWAYS emit exactly one {t:'title'} block so the renderer draws the centred
    // masthead + rule — even when the caller also passed a `title`, in which case
    // we prefer it but still consume this line so it is not duplicated as body.
    const looksTitle = /^#\s+\S/.test(l) || (/^[A-Z0-9][A-Z0-9 ,'&()./-]{4,70}$/.test(l) && !/^\d+\./.test(l));
    if (firstContent && !titleEmitted && looksTitle) {
      derivedTitle = (passedTitle || clean).slice(0, 90);
      lines.push({ t: 'title', text: derivedTitle });
      titleEmitted = true;
      firstContent = false;
      continue;
    }
    firstContent = false;
    // Section heading: ## , or "N. CAPS TITLE" that is short and not a sentence.
    if (/^#{2,6}\s+\S/.test(l) ||
        (/^\d+\.\s+[A-Z][A-Z0-9 ,'&()./-]{2,60}$/.test(l) && !/[.:;]$/.test(clean))) {
      lines.push({ t: 'heading', text: clean.replace(/:$/, '') });
      seenHeading = true;
      continue;
    }
    // Structural bold label (BETWEEN, WHEREAS:, IN WITNESS WHEREOF…).
    if (/^\*\*.+\*\*:?$/.test(l) && LABEL_RE.test(clean.replace(/:$/, '') + (clean.endsWith(':') ? ':' : ''))) {
      lines.push({ t: 'label', text: clean });
      continue;
    }
    if (LABEL_RE.test(clean)) { lines.push({ t: 'label', text: clean }); continue; }
    // Subtitle: a short plain line right after the title, before any heading
    // (the governing-law note).
    if (derivedTitle && !seenHeading && lines.length && lines[lines.length - 1].t === 'title' && clean.length < 120) {
      lines.push({ t: 'subtitle', text: clean });
      continue;
    }
    // Sub-item "(a)" / "(i)" / bullet, vs a normal clause.
    const isSub = /^\(?[a-z0-9]{1,4}[).]\s/i.test(l) || /^[-*]\s/.test(l);
    lines.push({ t: isSub ? 'subclause' : 'clause', text: clean.replace(/^[-*]\s+/, '• ') });
  }

  // No title-looking first line — emit one anyway (from the passed title or the
  // first clause) so every document gets the centred masthead.
  if (!titleEmitted) {
    // No heading in the text (a chat answer exported to a file). Use the caller's
    // title if given, else a clean professional heading — NEVER the first line of
    // prose (that produced the truncated "HEY, DON'T WORRY… AN A" title).
    derivedTitle = (passedTitle || 'Legal Guidance Note').slice(0, 80);
    lines.unshift({ t: 'title', text: derivedTitle });
  }

  // sections[] kept for the xlsx/pptx fallback paths.
  const sections = [];
  let cur = { heading: '', clauses: [] };
  for (const b of lines) {
    if (b.t === 'title' || b.t === 'subtitle') continue;
    if (b.t === 'heading') { if (cur.heading || cur.clauses.length) sections.push(cur); cur = { heading: b.text, clauses: [] }; }
    else cur.clauses.push(b.text);
  }
  if (cur.heading || cur.clauses.length) sections.push(cur);

  return { docType: derivedTitle, title: derivedTitle, meta: [], sections, lines, citations: [], prose: true };
}

// ---- Professional prose renderers (for freeform chat-drafted documents) -----
// A legal-document look: serif type, centred title with a rule, bold section
// headings that keep the drafter's own numbering (no double numbering), justified
// body, a signature block for agreements, a small disclaimer footnote, and page
// numbers. Used by the "download this answer" path, distinct from the template
// renderers above.

// Render from the typed `lines` when available (chat-drafted instruments), else
// fall back to sections (template output). One layout engine, both inputs.
function proseBlocks(spec) {
  if (spec.lines && spec.lines.length) return spec.lines;
  const out = [];
  for (const sec of spec.sections || []) {
    if (sec.heading) out.push({ t: 'heading', text: sec.heading });
    for (const c of sec.clauses || []) {
      const sub = /^\(?[a-z0-9]{1,4}[).]\s/i.test(c) || c.startsWith('•');
      out.push({ t: sub ? 'subclause' : 'clause', text: c });
    }
  }
  return out;
}

export function buildProsePdf(spec) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const blocks = proseBlocks(spec);
    let titleDone = false;

    const titleText = (blocks.find(b => b.t === 'title')?.text || spec.title || spec.docType || 'Document').toUpperCase();

    const L = doc.page.margins.left;
    let mastheadClosed = false;
    let signMode = false;
    // Close the masthead (title + governing-law note) with a full-width hairline
    // rule before the body begins — the separator that makes it read as a formal,
    // issued instrument rather than a plain page.
    const closeMasthead = () => {
      if (mastheadClosed) return;
      doc.moveDown(0.5);
      const y = doc.y;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor('#b9b9b9').stroke();
      doc.moveDown(0.8);
      mastheadClosed = true;
    };
    // Does a line read like a signature / witness slot?
    const isSignLine = (t) => /^(landlord|tenant|lessor|lessee|vendor|purchaser|donor|donee|first party|second party|party|executant|deponent|for\b|name\b|signature|witness|place|date)\b/i.test(t) || /_{4,}/.test(t);

    for (const b of blocks) {
      if (b.t === 'title') {
        if (titleDone) continue;
        doc.font('Times-Bold').fontSize(19).fillColor('#0f0f0f').text(titleText, { align: 'center', characterSpacing: 1.2 });
        doc.moveDown(0.3);
        const ry = doc.y;
        doc.moveTo(L + W * 0.30, ry).lineTo(L + W * 0.70, ry).lineWidth(0.9).strokeColor('#8a8a8a').stroke();
        doc.moveDown(0.7);
        titleDone = true;
      } else if (b.t === 'subtitle') {
        doc.font('Times-Italic').fontSize(10).fillColor('#5a5a5a').text(b.text, { align: 'center', width: W });
      } else if (b.t === 'heading') {
        closeMasthead();
        // Detect the execution / signature section so the slots below get room.
        if (/witness whereof|signatur|execution/i.test(b.text)) signMode = true;
        doc.moveDown(0.65).font('Times-Bold').fontSize(11.5).fillColor('#111').text(b.text.toUpperCase(), { width: W, characterSpacing: 0.3 });
        doc.moveDown(0.25);
      } else if (b.t === 'label') {
        closeMasthead();
        if (/witness whereof|signatur/i.test(b.text)) signMode = true;
        doc.moveDown(signMode ? 0.7 : 0.5).font('Times-Bold').fontSize(11).fillColor('#111').text(b.text, { width: W });
        doc.moveDown(0.12);
      } else {
        closeMasthead();
        const sub = b.t === 'subclause';
        // In the execution block, render signature/witness slots with breathing
        // room and a ruled underline instead of a cramped run-on line.
        if (signMode && isSignLine(b.text)) {
          doc.moveDown(0.45);
          const label = b.text.replace(/\s*_{2,}.*$/, '').replace(/[:\s]+$/, '');
          const ly = doc.y;
          doc.moveTo(L, ly).lineTo(L + Math.min(230, W * 0.52), ly).lineWidth(0.6).strokeColor('#666').stroke();
          doc.moveDown(0.12);
          doc.font('Times-Roman').fontSize(10).fillColor('#333').text(label, { width: W });
        } else {
          doc.font('Times-Roman').fontSize(11).fillColor('#1a1a1a')
             .text(b.text, { align: 'justify', indent: sub ? 22 : 0, lineGap: 1.6, paragraphGap: 5.5, width: W });
        }
      }
    }
    if (!titleDone) {
      // no title block seen — put one at the very top would need a rewrite, so
      // titles are always emitted by specFromText; this is a safety no-op.
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Zero the bottom margin while stamping the footer: writing text below the
      // content area otherwise makes pdfkit spill onto a fresh blank page, which
      // cascades into a run of empty pages. The footer sits inside the margin band.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - savedBottom + 24;
      doc.font('Times-Roman').fontSize(8.5).fillColor('#999')
         .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, fy, { width: W, align: 'right', lineBreak: false });
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
  });
}

export async function buildProseDocx(spec) {
  const SERIF = 'Times New Roman';
  const children = [];
  const blocks = proseBlocks(spec);
  const titleText = (blocks.find(b => b.t === 'title')?.text || spec.title || spec.docType || 'Document').toUpperCase();
  let titleDone = false;
  let mastheadClosed = false;
  let signMode = false;
  const isSignLine = (t) => /^(landlord|tenant|lessor|lessee|vendor|purchaser|donor|donee|first party|second party|party|executant|deponent|for\b|name\b|signature|witness|place|date)\b/i.test(t) || /_{4,}/.test(t);
  // Full-width hairline that closes the masthead before the body — matches the PDF.
  const closeMasthead = () => {
    if (mastheadClosed) return;
    children.push(new Paragraph({ spacing: { before: 40, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B9B9B9', space: 1 } }, children: [] }));
    mastheadClosed = true;
  };

  for (const b of blocks) {
    if (b.t === 'title') {
      if (titleDone) continue;
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 90 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '8A8A8A', space: 6 } },
        children: [new TextRun({ text: titleText, bold: true, size: 38, font: SERIF, characterSpacing: 24 })],
      }));
      titleDone = true;
    } else if (b.t === 'subtitle') {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
        children: [new TextRun({ text: b.text, italics: true, size: 20, color: '5A5A5A', font: SERIF })] }));
    } else if (b.t === 'heading') {
      closeMasthead();
      if (/witness whereof|signatur|execution/i.test(b.text)) signMode = true;
      children.push(new Paragraph({ spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: b.text.toUpperCase(), bold: true, size: 23, font: SERIF })] }));
    } else if (b.t === 'label') {
      closeMasthead();
      if (/witness whereof|signatur/i.test(b.text)) signMode = true;
      children.push(new Paragraph({ spacing: { before: 140, after: 60 },
        children: [new TextRun({ text: b.text, bold: true, size: 22, font: SERIF })] }));
    } else {
      closeMasthead();
      const sub = b.t === 'subclause';
      if (signMode && isSignLine(b.text)) {
        const label = b.text.replace(/\s*_{2,}.*$/, '').replace(/[:\s]+$/, '');
        // A blank, bottom-ruled paragraph is the signature line; the role sits below.
        children.push(new Paragraph({ spacing: { before: 220, after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '666666', space: 1 } }, children: [] }));
        children.push(new Paragraph({ spacing: { after: 40 },
          children: [new TextRun({ text: label, size: 20, color: '333333', font: SERIF })] }));
      } else {
        children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED, spacing: { after: 110 },
          indent: sub ? { left: 420 } : undefined,
          children: [new TextRun({ text: b.text, size: 22, font: SERIF })],
        }));
      }
    }
  }

  const doc = new Document({ creator: 'Counsel AI', title: spec.title || spec.docType,
    sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

// ---- Excel (.xlsx) ----------------------------------------------------------
// Only meaningful for a spec that carries a `table` ({ columns:[...], rows:[[...]] }),
// e.g. a fee schedule or a payment/compensation annexure. The review banner and
// any metadata sit above the table.
export async function buildXlsx(spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Counsel AI';
  const ws = wb.addWorksheet((spec.docType || 'Document').slice(0, 30));
  const table = spec.table || { columns: [], rows: [] };
  const colCount = Math.max(1, table.columns.length);

  const titleRow = ws.addRow([spec.title || spec.docType]);
  titleRow.font = { bold: true, size: 15 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, colCount);

  const banner = ws.addRow([REVIEW_BANNER]);
  banner.font = { italic: true, size: 9, color: { argb: 'FF777777' } };
  banner.alignment = { wrapText: true };
  ws.mergeCells(banner.number, 1, banner.number, colCount);
  ws.getRow(banner.number).height = 42;

  for (const [k, v] of spec.meta || []) ws.addRow([`${k}:`, String(v)]);
  ws.addRow([]);

  if (table.columns.length) {
    const head = ws.addRow(table.columns);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF3' } }; });
    for (const r of table.rows || []) ws.addRow(r);
    ws.columns.forEach((col) => {
      let w = 12;
      col.eachCell({ includeEmpty: false }, (c) => { w = Math.min(60, Math.max(w, String(c.value ?? '').length + 2)); });
      col.width = w;
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ---- PowerPoint (.pptx) -----------------------------------------------------
// Only meaningful for a spec that carries `slides` ([{ heading, bullets:[...] }]),
// e.g. a case-brief deck. A title slide leads, carrying the same review banner.
export async function buildPptx(spec) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4', width: 10, height: 5.63 });
  pptx.layout = 'A4';

  const title = pptx.addSlide();
  title.addText(spec.title || spec.docType, { x: 0.5, y: 1.4, w: 9, h: 1, fontSize: 30, bold: true, align: 'center' });
  for (const [k, v] of spec.meta || [])
    title.addText(`${k}: ${v}`, { x: 0.5, y: 2.5 + (spec.meta.indexOf([k, v]) * 0.3), w: 9, h: 0.3, fontSize: 12, align: 'center' });
  title.addText(REVIEW_BANNER, { x: 0.5, y: 4.6, w: 9, h: 0.8, fontSize: 9, italic: true, color: '777777', align: 'center' });

  for (const s of spec.slides || []) {
    const sl = pptx.addSlide();
    sl.addText(s.heading, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true });
    const bullets = (s.bullets || []).map((b) => ({ text: b, options: { bullet: true, fontSize: 14, breakLine: true } }));
    if (bullets.length) sl.addText(bullets, { x: 0.6, y: 1.2, w: 8.8, h: 4 });
  }
  const data = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}
