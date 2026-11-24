// Detect when a chat message is really a "make me a document" request, and map
// it to one of the known templates. This lets the chat route a request like
// "generate a T&C for Praapthi.ai" straight to the offline template generator —
// no language model, no API — instead of sending it to the chat model, which
// cannot produce files.
//
// Detection is deliberately conservative: it fires only when a drafting verb and
// a recognised document type BOTH appear, so ordinary questions ("explain the
// terms of section 5") are left alone and answered by the normal chat.

export type DocIntent = { templateId: string; values: Record<string, string>; label: string };

const VERB = /\b(generate|create|draft|make|prepare|write|need|give me|build|produce)\b/i;

// Order matters: more specific phrases first (e.g. "reply to notice" before "notice").
const TYPE_PATTERNS: { id: string; label: string; re: RegExp }[] = [
  { id: 'privacy-policy', label: 'Privacy Policy', re: /\b(privacy policy|privacy notice|data protection policy|dpdp policy)\b/i },
  // Tolerant of "terms and condition(s)", "terms & conditions", "terms ans/n
  // condition", "t&c", "terms of service/use" — people rarely type it exactly.
  { id: 'terms-and-conditions', label: 'Terms and Conditions', re: /\b(terms?\s*(?:&|and|ans|n)?\s*conditions?|t\s*&\s*c|terms of (?:service|use))\b/i },
  { id: 'refund-policy', label: 'Refund Policy', re: /\b(refund policy|cancellation policy|return policy)\b/i },
  { id: 'disclaimer', label: 'Disclaimer', re: /\bdisclaimer\b/i },
  { id: 'cheque-bounce-notice', label: 'Cheque Bounce Notice', re: /\b(cheque bounce|cheque dishonou?r|138 notice|section 138)\b/i },
  { id: 'reply-notice', label: 'Reply to Legal Notice', re: /\b(reply (to|for) (a )?(legal )?notice|notice reply)\b/i },
  { id: 'cease-and-desist', label: 'Cease and Desist', re: /\b(cease and desist|cease & desist)\b/i },
  { id: 'legal-notice', label: 'Legal Notice', re: /\b(legal notice|demand notice)\b/i },
  { id: 'consumer-complaint', label: 'Consumer Complaint', re: /\b(consumer complaint|consumer case)\b/i },
  { id: 'nda', label: 'Non-Disclosure Agreement', re: /\b(nda|non.?disclosure|confidentiality agreement)\b/i },
  { id: 'rental-lease', label: 'Rent Agreement', re: /\b(rent agreement|rental agreement|lease agreement|lease deed|rent deed)\b/i },
  { id: 'employment-agreement', label: 'Employment Agreement', re: /\b(employment (agreement|contract)|offer letter|appointment letter)\b/i },
  { id: 'service-agreement', label: 'Service Agreement', re: /\b(service agreement|services agreement|consulting agreement)\b/i },
  { id: 'partnership-deed', label: 'Partnership Deed', re: /\b(partnership deed|partnership agreement)\b/i },
  { id: 'mou', label: 'Memorandum of Understanding', re: /\b(mou|memorandum of understanding)\b/i },
  { id: 'power-of-attorney', label: 'Power of Attorney', re: /\b(power of attorney|poa)\b/i },
  { id: 'affidavit', label: 'Affidavit', re: /\baffidavit\b/i },
  { id: 'will', label: 'Will', re: /\b(will|testament|last will)\b/i },
  { id: 'indemnity-bond', label: 'Indemnity Bond', re: /\b(indemnity bond|indemnity)\b/i },
  { id: 'declaration', label: 'Declaration', re: /\b(self.?declaration|declaration)\b/i },
  { id: 'board-resolution', label: 'Board Resolution', re: /\b(board resolution|company resolution)\b/i },
  { id: 'fee-schedule', label: 'Fee Schedule', re: /\b(fee schedule|payment schedule|fee table)\b/i },
  { id: 'case-brief-deck', label: 'Case Brief', re: /\b(case brief|case summary deck|brief deck)\b/i },
];

// Pull a business / entity name out of "... for <Name>" or "... of <Name>".
function guessEntity(msg: string): string {
  const m = msg.match(/\b(?:for|of)\s+(?:my\s+(?:company|business|startup|firm|website|app)\s+(?:called\s+)?)?([A-Z0-9][\w.&' -]{1,60}?)(?:\s*(?:website|app|business|company|firm|startup))?\s*$/);
  if (m) return m[1].trim().replace(/[.,]$/, '');
  const m2 = msg.match(/\bfor\s+([A-Za-z0-9][\w.&'-]{1,40})\b/);
  return m2 ? m2[1].trim() : '';
}

// A message that plainly asks to produce a file even without naming a type —
// "generate the pdf", "make it a word doc", "export as pdf". Requires an explicit
// make-a-file verb AND an explicit file word, so questions like "what documents
// do I need" (which merely contain "need" and "documents") do NOT trigger.
const MAKE_VERB = /\b(generate|create|make|prepare|produce|export|download|save|give me|draft)\b/i;
const FILE_WORD = /\b(pdf|word doc|word document|\.docx|\.pdf|docx)\b/i;
// Generic legal-document nouns: "draft an agreement", "make a notice" — clearly a
// document request even without a named type or a file word. Paired with a make
// verb, so plain questions ("what is an agreement") do not trigger.
const LEGAL_NOUN = /\b(agreement|contract|notice|policy|affidavit|deed|declaration|bond|resolution|testament|legal document|document)\b/i;

export function detectDocIntent(message: string): DocIntent | null {
  if (!message) return null;
  if (VERB.test(message)) {
    for (const t of TYPE_PATTERNS) {
      if (t.re.test(message)) {
        const values: Record<string, string> = {};
        const entity = guessEntity(message);
        if (entity) { values.entity = entity; values.partyA = entity; values.company = entity; }
        return { templateId: t.id, values, label: t.label };
      }
    }
  }
  // No specific type, but clearly a "make me a document/file" request → picker.
  if (MAKE_VERB.test(message) && (FILE_WORD.test(message) || LEGAL_NOUN.test(message))) {
    return { templateId: '', values: {}, label: 'a document' };
  }
  return null;
}
