// Orchestrates document generation: pick a template, validate the user's fields,
// build a deterministic spec, optionally attach live statutory citations pulled
// from the RAG indexes, and render to .docx / .pdf.
//
// No LLM and no network are involved in the document itself. Retrieval is used
// only to surface *real* rule/notification text that supports the template's
// clauses, so a generated policy can point at the provision it rests on rather
// than an invented section number.

import { TEMPLATES, listTemplates } from './documents/templates.js';
import { buildDocx, buildPdf, buildXlsx, buildPptx } from './documents/legalDoc.js';

export { listTemplates };

const RENDERERS = { docx: buildDocx, pdf: buildPdf, xlsx: buildXlsx, pptx: buildPptx };

// Optional grounding: given a template and its fields, ask the subordinate-
// legislation index for text that matches the document's subject, and fold a
// couple of concrete hits into the citations list. Failure here is non-fatal —
// the template's own statutory basis still stands.
async function liveCitations(templateId, fields, retrieveSubordinate) {
  if (typeof retrieveSubordinate !== 'function') return [];
  const query = templateId === 'privacy-policy'
    ? `data protection consent ${fields.purpose || ''}`
    : `${fields.service || ''} terms conditions consumer`;
  try {
    const text = await retrieveSubordinate(query);
    if (!text) return [];
    // retrieveSubordinate returns "[Title — type, jurisdiction, year]\n body"
    // blocks; take the bracketed heads as concrete supporting references.
    const heads = [...text.matchAll(/\[([^\]]+)\]/g)].slice(0, 2).map(m => m[1].trim());
    return heads.map(h => ({ label: h, note: 'retrieved as supporting material' }));
  } catch {
    return [];
  }
}

export async function generateDocument({ templateId, fields = {}, formats, retrieveSubordinate }) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) {
    const ids = Object.keys(TEMPLATES).join(', ');
    throw new Error(`Unknown document type "${templateId}". Available: ${ids}`);
  }

  const allowed = tpl.formats || ['docx', 'pdf'];
  // Honour what the caller asked for, but never a format this template can't
  // produce (e.g. a contract has no table to put in a spreadsheet).
  const want = (Array.isArray(formats) && formats.length ? formats : allowed).filter((x) => allowed.includes(x));
  if (!want.length) throw new Error(`${tpl.docType} supports: ${allowed.join(', ')}`);

  // build() throws a clear "Missing required field: X" if a required blank is empty.
  const built = tpl.build(fields);
  const extra = await liveCitations(templateId, fields, retrieveSubordinate);
  const spec = {
    docType: tpl.docType,
    title: tpl.docType,
    meta: built.meta,
    sections: built.sections,
    table: built.table,   // used by xlsx
    slides: built.slides, // used by pptx
    citations: [...(built.citations || []), ...extra],
  };

  const out = {};
  for (const fmt of want) {
    const render = RENDERERS[fmt];
    if (render) out[fmt] = await render(spec);
  }
  return { spec, files: out, formats: want };
}
