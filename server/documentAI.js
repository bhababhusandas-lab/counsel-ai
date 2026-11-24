// "Any document" path: compose a document the template library does not cover,
// from a freeform request. This needs a language model to write novel clauses,
// so — unlike the deterministic templates — it is NOT offline.
//
// It is deliberately gated on a DEDICATED, self-hosted endpoint (DOC_LLM_URL),
// never on the chat's Grok connection. If DOC_LLM_URL is unset, this path is
// dormant and reports itself unavailable, so enabling it is an explicit choice
// the operator makes once their own model is running. That keeps the product's
// "no third-party API" position intact until they decide otherwise.
//
// Set, when the GPU model is up, e.g.:
//   DOC_LLM_URL=http://127.0.0.1:8000/v1   DOC_LLM_MODEL=mistral-7b-instruct

import { buildDocx, buildPdf } from './documents/legalDoc.js';

const URL_ = () => (process.env.DOC_LLM_URL || '').trim();
const MODEL = () => (process.env.DOC_LLM_MODEL || 'local-model').trim();

export function customDocAvailable() {
  return !!URL_();
}

const SYSTEM = `You are a legal drafting assistant for Indian law. Given a request,
produce a JSON object for a document with this exact shape:
{"docType": string, "title": string, "meta": [[label, value], ...],
 "sections": [{"heading": string, "clauses": [string, ...]}, ...],
 "citations": [{"label": string, "note": string}, ...]}
Rules: use Indian statutes and correct legal terminology; keep clauses concrete;
never invent a section number you are unsure of; return ONLY the JSON, no prose.`;

// Grounding text (retrieved from the RAG indexes) is passed in so the model
// drafts against real statutory material rather than its own memory.
export async function generateCustomDocument({ request, grounding = '', formats = ['docx', 'pdf'] }) {
  const base = URL_();
  if (!base) {
    const e = new Error('Custom document drafting is not enabled: no self-hosted model is configured (DOC_LLM_URL is unset). Use one of the ready templates, or configure a local model.');
    e.code = 'CUSTOM_DISABLED';
    throw e;
  }

  const body = {
    model: MODEL(),
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: grounding ? `${request}\n\nRelevant Indian legal material to rely on:\n${grounding}` : request },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  };

  const resp = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Local model error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';

  let spec;
  try {
    spec = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    throw new Error('The model did not return a valid document structure. Try rephrasing the request.');
  }
  if (!spec.sections?.length) throw new Error('The model returned an empty document.');
  spec.title = spec.title || spec.docType || 'Document';

  const out = {};
  if (formats.includes('docx')) out.docx = await buildDocx(spec);
  if (formats.includes('pdf'))  out.pdf  = await buildPdf(spec);
  return { spec, files: out };
}
