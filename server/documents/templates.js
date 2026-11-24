// Document template registry. Each template declares the fields it needs, the
// formats it naturally supports, and a build() that turns the user's answers
// into a spec. Clause text is fixed, reviewed wording — the user's answers only
// fill the blanks. Nothing here is model-generated, so a given set of answers
// always produces the same document. (Freeform "any document" requests are
// handled separately by documentAI.js, which needs a self-hosted model.)
//
// Indian-law oriented; each template names the statutes it rests on in
// `citations`. Formats default to Word + PDF; a tabular template adds 'xlsx'
// and a presentation template uses 'pptx'.

const req = (f, key, label) => {
  const v = (f[key] ?? '').toString().trim();
  if (!v) throw new Error(`Missing required field: ${label || key}`);
  return v;
};
const opt = (f, key, dflt = '') => (f[key] ?? '').toString().trim() || dflt;

// Shared field shorthands
const F = {
  entity: { key: 'entity', label: 'Business / entity name', required: true },
  person: { key: 'person', label: 'Your full name', required: true },
  place:  { key: 'place', label: 'City / place', required: true },
  date:   { key: 'date', label: 'Date', required: false, hint: 'e.g. 1 April 2026' },
  jx:     { key: 'jurisdiction', label: 'Governing state (courts)', required: true, hint: 'e.g. Telangana, at Hyderabad' },
};

export const TEMPLATES = {

  // ============================ CONTRACTS ============================
  'nda': {
    label: 'Non-Disclosure Agreement', docType: 'Non-Disclosure Agreement',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'partyA', label: 'Disclosing party', required: true },
      { key: 'partyB', label: 'Receiving party', required: true },
      { key: 'purpose', label: 'Purpose of sharing information', required: true },
      { key: 'years', label: 'Confidentiality period (years)', required: false, hint: 'e.g. 3' },
      F.jx,
    ],
    build(f) {
      const a = req(f, 'partyA', 'Disclosing party'), b = req(f, 'partyB', 'Receiving party');
      const purpose = req(f, 'purpose', 'Purpose'), jx = req(f, 'jurisdiction', 'Governing state');
      const yrs = opt(f, 'years', 'three');
      return {
        meta: [['Disclosing Party', a], ['Receiving Party', b]],
        sections: [
          { heading: 'Purpose', clauses: [`The parties wish to exchange confidential information for the following purpose: ${purpose}.`] },
          { heading: 'Confidential information', clauses: [
            `"Confidential Information" means any non-public information disclosed by ${a} to ${b}, in any form, whether or not marked confidential.`,
            `It does not include information that is already public, was lawfully known before disclosure, or is independently developed without use of the Confidential Information.`] },
          { heading: 'Obligations of the receiving party', clauses: [
            `${b} shall use the Confidential Information solely for the Purpose, shall not disclose it to any third party without prior written consent, and shall protect it with at least the same care it uses for its own confidential information.`] },
          { heading: 'Term', clauses: [`The obligations of confidentiality shall survive for ${yrs} years from the date of disclosure.`] },
          { heading: 'Return of information', clauses: [`On request, ${b} shall return or destroy all Confidential Information and copies.`] },
          { heading: 'No transfer of rights', clauses: [`Nothing in this Agreement grants ${b} any licence or intellectual-property right in the Confidential Information.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This Agreement is governed by the laws of India, and the courts at ${jx} shall have exclusive jurisdiction.`] },
        ],
        citations: [
          { label: 'Indian Contract Act, 1872, s.10', note: 'a valid, enforceable agreement' },
          { label: 'Indian Contract Act, 1872, s.27', note: 'confidentiality is enforceable, but a clause restraining lawful trade is void' },
        ],
      };
    },
  },

  'rental-lease': {
    label: 'Rent / Lease Agreement', docType: 'Rent Agreement',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'landlord', label: 'Landlord name', required: true },
      { key: 'tenant', label: 'Tenant name', required: true },
      { key: 'property', label: 'Property address', required: true },
      { key: 'rent', label: 'Monthly rent (₹)', required: true },
      { key: 'deposit', label: 'Security deposit (₹)', required: false },
      { key: 'term', label: 'Term (months)', required: false, hint: 'e.g. 11' },
      F.jx,
    ],
    build(f) {
      const ll = req(f, 'landlord', 'Landlord'), tn = req(f, 'tenant', 'Tenant');
      const prop = req(f, 'property', 'Property'), rent = req(f, 'rent', 'Monthly rent');
      const dep = opt(f, 'deposit', 'as mutually agreed'), term = opt(f, 'term', '11'), jx = req(f, 'jurisdiction', 'Governing state');
      return {
        meta: [['Landlord', ll], ['Tenant', tn], ['Property', prop]],
        sections: [
          { heading: 'Demise and term', clauses: [
            `The Landlord lets and the Tenant takes the premises at ${prop} for a term of ${term} months, commencing on the date of this Agreement.`,
            `A lease from month to month, or for a term not exceeding one year, may be made by an unregistered agreement under section 107 of the Transfer of Property Act, 1882; a lease exceeding eleven months is commonly registered.`] },
          { heading: 'Rent', clauses: [`The Tenant shall pay monthly rent of ₹${rent}, in advance, on or before the fifth day of each month.`] },
          { heading: 'Security deposit', clauses: [`The Tenant has paid a refundable security deposit of ₹${dep}, to be returned at the end of the tenancy after deducting lawful dues and the cost of repairing damage beyond normal wear and tear.`] },
          { heading: 'Use of premises', clauses: [`The premises shall be used for residential purposes only and shall not be sublet without the Landlord's written consent.`] },
          { heading: 'Maintenance and utilities', clauses: [`The Tenant shall pay for electricity, water and other utilities consumed, and shall keep the premises in good condition. Structural repairs are the Landlord's responsibility.`] },
          { heading: 'Termination', clauses: [`Either party may terminate this Agreement by giving one month's written notice.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This Agreement is governed by the Transfer of Property Act, 1882 and the applicable State rent law, and the courts at ${jx} shall have jurisdiction.`] },
        ],
        citations: [
          { label: 'Transfer of Property Act, 1882, ss.105–117', note: 'rights and duties of lessor and lessee' },
          { label: 'Registration Act, 1908, s.17', note: 'a lease over one year must be registered' },
          { label: 'Applicable State Rent Control Act', note: 'may override certain terms; varies by State' },
        ],
      };
    },
  },

  'employment-agreement': {
    label: 'Employment Agreement', docType: 'Employment Agreement',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'employer', label: 'Employer name', required: true },
      { key: 'employee', label: 'Employee name', required: true },
      { key: 'role', label: 'Job title / role', required: true },
      { key: 'salary', label: 'Annual salary (₹)', required: true },
      { key: 'location', label: 'Place of work', required: false },
      F.jx,
    ],
    build(f) {
      const er = req(f, 'employer', 'Employer'), ee = req(f, 'employee', 'Employee');
      const role = req(f, 'role', 'Role'), sal = req(f, 'salary', 'Salary');
      const loc = opt(f, 'location', 'the employer’s premises'), jx = req(f, 'jurisdiction', 'Governing state');
      return {
        meta: [['Employer', er], ['Employee', ee], ['Role', role]],
        sections: [
          { heading: 'Appointment', clauses: [`${er} appoints ${ee} to the position of ${role}, and ${ee} accepts the appointment on the terms set out below.`] },
          { heading: 'Remuneration', clauses: [`The Employee shall be paid a gross annual salary of ₹${sal}, subject to statutory deductions, payable monthly, in compliance with the Code on Wages, 2019.`] },
          { heading: 'Place and hours of work', clauses: [`The place of work is ${loc}. Working hours and leave shall be as per the applicable Shops and Establishments Act and company policy.`] },
          { heading: 'Duties', clauses: [`The Employee shall perform the duties of the role diligently and comply with the lawful policies of the Employer.`] },
          { heading: 'Confidentiality', clauses: [`The Employee shall keep the Employer's confidential information secret during and after employment.`] },
          { heading: 'Safe workplace', clauses: [`The Employer shall maintain a workplace free of harassment, in compliance with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.`] },
          { heading: 'Termination', clauses: [`Either party may terminate this Agreement by giving one month's written notice or salary in lieu, subject to applicable law.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This Agreement is governed by the laws of India, and the courts at ${jx} shall have jurisdiction.`] },
        ],
        citations: [
          { label: 'Indian Contract Act, 1872', note: 'the contract of employment' },
          { label: 'Code on Wages, 2019', note: 'timely payment of wages' },
          { label: 'POSH Act, 2013', note: 'safe workplace obligation' },
          { label: 'Applicable Shops and Establishments Act', note: 'hours, leave; varies by State' },
        ],
      };
    },
  },

  'service-agreement': {
    label: 'Service Agreement', docType: 'Service Agreement',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'provider', label: 'Service provider', required: true },
      { key: 'client', label: 'Client', required: true },
      { key: 'services', label: 'Services to be provided', required: true },
      { key: 'fee', label: 'Fee (₹)', required: true },
      F.jx,
    ],
    build(f) {
      const p = req(f, 'provider', 'Provider'), c = req(f, 'client', 'Client');
      const s = req(f, 'services', 'Services'), fee = req(f, 'fee', 'Fee'), jx = req(f, 'jurisdiction', 'Governing state');
      return {
        meta: [['Service Provider', p], ['Client', c]],
        sections: [
          { heading: 'Scope of services', clauses: [`${p} shall provide the following services to ${c}: ${s}.`] },
          { heading: 'Fees and payment', clauses: [`The Client shall pay ₹${fee} for the services, inclusive of applicable GST unless stated otherwise, within the agreed timelines.`] },
          { heading: 'Standard of service', clauses: [`The Provider shall render the services with reasonable skill and care. A deficiency in service is actionable under the Consumer Protection Act, 2019.`] },
          { heading: 'Term and termination', clauses: [`This Agreement continues until the services are completed, and may be terminated by either party on written notice for material breach not cured within fifteen days.`] },
          { heading: 'Intellectual property', clauses: [`Work product created for the Client vests in the Client on full payment, unless otherwise agreed in writing.`] },
          { heading: 'Limitation of liability', clauses: [`Neither party is liable for indirect or consequential loss. Liability that cannot be excluded under Indian law is unaffected.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This Agreement is governed by the laws of India, and the courts at ${jx} shall have jurisdiction.`] },
        ],
        citations: [
          { label: 'Indian Contract Act, 1872', note: 'the service contract' },
          { label: 'Consumer Protection Act, 2019', note: 'deficiency in service' },
        ],
      };
    },
  },

  'mou': {
    label: 'Memorandum of Understanding', docType: 'Memorandum of Understanding',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'partyA', label: 'First party', required: true },
      { key: 'partyB', label: 'Second party', required: true },
      { key: 'objective', label: 'Objective of the MoU', required: true },
      { key: 'binding', label: 'Binding? (yes / no)', required: false, hint: 'no = statement of intent' },
      F.jx,
    ],
    build(f) {
      const a = req(f, 'partyA', 'First party'), b = req(f, 'partyB', 'Second party');
      const obj = req(f, 'objective', 'Objective'), jx = req(f, 'jurisdiction', 'Governing state');
      const binding = /^y/i.test(opt(f, 'binding', 'no'));
      return {
        meta: [['First Party', a], ['Second Party', b]],
        sections: [
          { heading: 'Objective', clauses: [`${a} and ${b} record their understanding to work together for the following objective: ${obj}.`] },
          { heading: 'Roles', clauses: [`Each party shall contribute in good faith towards the objective, with specific responsibilities to be agreed in a definitive agreement.`] },
          { heading: 'Nature of this MoU', clauses: [
            binding
              ? `This MoU is intended to be legally binding on the parties.`
              : `This MoU records intent only and is not legally binding, save for the clauses on confidentiality and governing law.`] },
          { heading: 'Confidentiality', clauses: [`Each party shall keep confidential the information shared under this MoU.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This MoU is governed by the laws of India, and the courts at ${jx} shall have jurisdiction.`] },
        ],
        citations: [{ label: 'Indian Contract Act, 1872, s.10', note: 'when a writing becomes an enforceable contract' }],
      };
    },
  },

  'partnership-deed': {
    label: 'Partnership Deed', docType: 'Partnership Deed',
    category: 'Contracts & agreements', formats: ['docx', 'pdf'],
    fields: [
      { key: 'firm', label: 'Firm name', required: true },
      { key: 'partners', label: 'Partners (comma-separated)', required: true },
      { key: 'business', label: 'Nature of business', required: true },
      { key: 'capital', label: 'Total capital (₹)', required: false },
      F.jx,
    ],
    build(f) {
      const firm = req(f, 'firm', 'Firm name'), partners = req(f, 'partners', 'Partners');
      const biz = req(f, 'business', 'Nature of business'), jx = req(f, 'jurisdiction', 'Governing state');
      const cap = opt(f, 'capital', 'as contributed and recorded in the books');
      return {
        meta: [['Firm', firm], ['Partners', partners]],
        sections: [
          { heading: 'Constitution', clauses: [`The partners named above have agreed to carry on business in partnership under the name ${firm}.`] },
          { heading: 'Business', clauses: [`The business of the firm is: ${biz}. It may be extended by mutual consent.`] },
          { heading: 'Capital', clauses: [`The capital of the firm is ₹${cap}. Profits and losses shall be shared equally unless otherwise agreed in writing.`] },
          { heading: 'Management', clauses: [`Every partner has a right to take part in the conduct of the business, as provided by the Indian Partnership Act, 1932.`] },
          { heading: 'Accounts and banking', clauses: [`Proper books of account shall be kept, and the firm's bank account shall be operated as the partners agree.`] },
          { heading: 'Retirement and dissolution', clauses: [`A partner may retire on giving notice; the firm may be dissolved as provided by the Indian Partnership Act, 1932.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`This Deed is governed by the Indian Partnership Act, 1932, and the courts at ${jx} shall have jurisdiction.`] },
        ],
        citations: [
          { label: 'Indian Partnership Act, 1932', note: 'rights, duties and dissolution of the firm' },
          { label: 'Indian Partnership Act, 1932, s.58–59', note: 'registration of the firm (optional but advisable)' },
        ],
      };
    },
  },

  // ============================ NOTICES ============================
  'legal-notice': {
    label: 'Legal Notice (demand)', docType: 'Legal Notice',
    category: 'Notices & complaints', formats: ['docx', 'pdf'],
    fields: [
      { key: 'sender', label: 'Sender (your) name', required: true },
      { key: 'recipient', label: 'Recipient name & address', required: true },
      { key: 'grievance', label: 'What the dispute is about', required: true },
      { key: 'demand', label: 'What you demand', required: true },
      { key: 'days', label: 'Days to comply', required: false, hint: 'e.g. 15' },
    ],
    build(f) {
      const s = req(f, 'sender', 'Sender'), r = req(f, 'recipient', 'Recipient');
      const g = req(f, 'grievance', 'Grievance'), d = req(f, 'demand', 'Demand'), days = opt(f, 'days', '15');
      return {
        meta: [['From', s], ['To', r]],
        sections: [
          { heading: 'Facts', clauses: [`My client / I state the following facts giving rise to this notice: ${g}.`] },
          { heading: 'Grievance', clauses: [`By reason of the above, you are liable for the wrong done, and I am constrained to issue this notice.`] },
          { heading: 'Demand', clauses: [`You are hereby called upon to ${d} within ${days} days of receipt of this notice.`] },
          { heading: 'Consequence of non-compliance', clauses: [`If you fail to comply within the said period, I shall be constrained to initiate appropriate civil and/or criminal proceedings against you at your risk as to cost and consequences.`] },
        ],
        citations: [{ label: 'Code of Civil Procedure, 1908, s.80', note: 'notice before suit (mandatory where the defendant is the Government or a public officer)' }],
      };
    },
  },

  'cease-and-desist': {
    label: 'Cease and Desist Notice', docType: 'Cease and Desist Notice',
    category: 'Notices & complaints', formats: ['docx', 'pdf'],
    fields: [
      { key: 'sender', label: 'Sender (rights holder)', required: true },
      { key: 'recipient', label: 'Recipient name & address', required: true },
      { key: 'right', label: 'Right being infringed', required: true, hint: 'e.g. trademark, copyright, reputation' },
      { key: 'conduct', label: 'The infringing conduct', required: true },
      { key: 'days', label: 'Days to comply', required: false, hint: 'e.g. 7' },
    ],
    build(f) {
      const s = req(f, 'sender', 'Sender'), r = req(f, 'recipient', 'Recipient');
      const right = req(f, 'right', 'Right'), c = req(f, 'conduct', 'Conduct'), days = opt(f, 'days', '7');
      return {
        meta: [['From', s], ['To', r]],
        sections: [
          { heading: 'Rights of the sender', clauses: [`${s} is the lawful owner of the following right: ${right}.`] },
          { heading: 'The infringing conduct', clauses: [`It has come to notice that you are engaged in the following conduct that infringes the said right: ${c}.`] },
          { heading: 'Demand to cease', clauses: [`You are called upon to immediately cease and desist from the said conduct, and to confirm in writing within ${days} days that you have done so.`] },
          { heading: 'Consequence', clauses: [`Failing compliance, ${s} reserves the right to seek an injunction, damages and all other remedies available in law and equity.`] },
        ],
        citations: [
          { label: 'Trade Marks Act, 1999 / Copyright Act, 1957', note: 'depending on the right asserted' },
          { label: 'Specific Relief Act, 1963', note: 'injunction as a remedy' },
        ],
      };
    },
  },

  'reply-notice': {
    label: 'Reply to Legal Notice', docType: 'Reply to Legal Notice',
    category: 'Notices & complaints', formats: ['docx', 'pdf'],
    fields: [
      { key: 'sender', label: 'You (replying party)', required: true },
      { key: 'recipient', label: 'Original notice sender', required: true },
      { key: 'noticeDate', label: 'Date of the notice you received', required: false },
      { key: 'response', label: 'Your response to the allegations', required: true },
    ],
    build(f) {
      const s = req(f, 'sender', 'Replying party'), r = req(f, 'recipient', 'Original sender');
      const nd = opt(f, 'noticeDate', 'the notice under reply'), resp = req(f, 'response', 'Response');
      return {
        meta: [['From', s], ['To', r]],
        sections: [
          { heading: 'Reference', clauses: [`This is in reply to your legal notice dated ${nd}, the contents of which are denied save as expressly admitted below.`] },
          { heading: 'Response on facts', clauses: [`The correct facts are as follows: ${resp}.`] },
          { heading: 'Denial of liability', clauses: [`My client / I deny any liability as alleged, and put you to strict proof of your claims.`] },
          { heading: 'Reservation of rights', clauses: [`All rights and contentions are expressly reserved, including the right to recover the cost of this reply.`] },
        ],
        citations: [{ label: 'Indian Evidence Act, 1872 / Bharatiya Sakshya Adhiniyam, 2023', note: 'burden of proof rests on the party asserting a fact' }],
      };
    },
  },

  'consumer-complaint': {
    label: 'Consumer Complaint', docType: 'Consumer Complaint',
    category: 'Notices & complaints', formats: ['docx', 'pdf'],
    fields: [
      { key: 'complainant', label: 'Complainant (your) name', required: true },
      { key: 'opposite', label: 'Opposite party (seller / service provider)', required: true },
      { key: 'goods', label: 'Goods or service purchased', required: true },
      { key: 'defect', label: 'Defect or deficiency', required: true },
      { key: 'relief', label: 'Relief sought', required: true, hint: 'e.g. refund, replacement, compensation' },
    ],
    build(f) {
      const c = req(f, 'complainant', 'Complainant'), o = req(f, 'opposite', 'Opposite party');
      const g = req(f, 'goods', 'Goods/service'), d = req(f, 'defect', 'Defect'), rel = req(f, 'relief', 'Relief');
      return {
        meta: [['Complainant', c], ['Opposite Party', o]],
        sections: [
          { heading: 'Parties', clauses: [`The Complainant is a consumer within the meaning of section 2(7) of the Consumer Protection Act, 2019. The Opposite Party is ${o}.`] },
          { heading: 'Facts', clauses: [`The Complainant purchased / availed: ${g}.`] },
          { heading: 'Deficiency / defect', clauses: [`The following defect in goods or deficiency in service arose: ${d}. This amounts to a deficiency under section 2(11) of the Act.`] },
          { heading: 'Cause of action and jurisdiction', clauses: [`The cause of action arose where the Complainant resides or where the Opposite Party carries on business, and this Commission has jurisdiction under section 34 of the Act.`] },
          { heading: 'Relief sought', clauses: [`The Complainant prays for: ${rel}, together with compensation and costs as the Commission deems fit.`] },
        ],
        citations: [
          { label: 'Consumer Protection Act, 2019, s.2(7)', note: 'who is a consumer' },
          { label: 'Consumer Protection Act, 2019, s.2(11) & s.2(10)', note: 'deficiency and defect' },
          { label: 'Consumer Protection Act, 2019, ss.34–35', note: 'jurisdiction of the District Commission' },
        ],
      };
    },
  },

  'cheque-bounce-notice': {
    label: 'Cheque Bounce Notice (s.138 NI Act)', docType: 'Cheque Bounce Notice',
    category: 'Notices & complaints', formats: ['docx', 'pdf'],
    fields: [
      { key: 'payee', label: 'Payee (you)', required: true },
      { key: 'drawer', label: 'Drawer (who issued the cheque)', required: true },
      { key: 'amount', label: 'Cheque amount (₹)', required: true },
      { key: 'chequeNo', label: 'Cheque number & bank', required: true },
      { key: 'returnDate', label: 'Date the cheque was returned', required: false },
    ],
    build(f) {
      const p = req(f, 'payee', 'Payee'), dr = req(f, 'drawer', 'Drawer');
      const amt = req(f, 'amount', 'Amount'), chq = req(f, 'chequeNo', 'Cheque number'), rd = opt(f, 'returnDate', 'the date of dishonour');
      return {
        meta: [['From (Payee)', p], ['To (Drawer)', dr]],
        sections: [
          { heading: 'The cheque', clauses: [`You issued cheque ${chq} for ₹${amt} in discharge of a legally enforceable debt or liability owed to me.`] },
          { heading: 'Dishonour', clauses: [`On presentation, the cheque was returned unpaid on ${rd}, for insufficiency of funds or a like reason, as recorded in the bank's return memo.`] },
          { heading: 'Statutory demand', clauses: [`Under the proviso to section 138 of the Negotiable Instruments Act, 1881, you are called upon to pay ₹${amt} within fifteen days of receipt of this notice.`] },
          { heading: 'Consequence', clauses: [`If you fail to pay within fifteen days, I shall be constrained to file a criminal complaint under section 138 of the Act, which is punishable with imprisonment up to two years or fine up to twice the cheque amount, or both.`] },
        ],
        citations: [
          { label: 'Negotiable Instruments Act, 1881, s.138', note: 'dishonour of cheque; 15-day statutory demand is mandatory' },
          { label: 'Negotiable Instruments Act, 1881, s.142', note: 'complaint to be filed within one month of the cause of action' },
        ],
      };
    },
  },

  // ============================ PERSONAL ============================
  'affidavit': {
    label: 'Affidavit', docType: 'Affidavit',
    category: 'Personal legal documents', formats: ['docx', 'pdf'],
    fields: [
      { key: 'deponent', label: 'Deponent (your) name', required: true },
      { key: 'parentage', label: 'S/o, D/o, W/o', required: true },
      { key: 'address', label: 'Address', required: true },
      { key: 'statements', label: 'What you are affirming', required: true },
      F.place,
    ],
    build(f) {
      const dep = req(f, 'deponent', 'Deponent'), par = req(f, 'parentage', 'Parentage');
      const addr = req(f, 'address', 'Address'), st = req(f, 'statements', 'Statements'), place = req(f, 'place', 'Place');
      return {
        meta: [['Deponent', `${dep}, ${par}`], ['Address', addr], ['Place', place]],
        sections: [
          { heading: 'Identity', clauses: [`I, ${dep}, ${par}, resident of ${addr}, do solemnly affirm and state as under.`] },
          { heading: 'Statements on oath', clauses: [`${st}`] },
          { heading: 'Verification', clauses: [`I verify that the contents of the above paragraphs are true and correct to the best of my knowledge and belief, and that nothing material has been concealed. Verified at ${place}.`] },
        ],
        citations: [
          { label: 'Oaths Act, 1969', note: 'affirmation before an authorised officer' },
          { label: 'Order XIX, Code of Civil Procedure, 1908', note: 'affidavits in civil proceedings' },
        ],
      };
    },
  },

  'power-of-attorney': {
    label: 'Power of Attorney', docType: 'Power of Attorney',
    category: 'Personal legal documents', formats: ['docx', 'pdf'],
    fields: [
      { key: 'principal', label: 'Principal (grantor)', required: true },
      { key: 'agent', label: 'Attorney / agent (grantee)', required: true },
      { key: 'powers', label: 'Powers granted', required: true },
      { key: 'special', label: 'Special or general? ', required: false, hint: 'special = specific act; general = broad' },
      F.place,
    ],
    build(f) {
      const p = req(f, 'principal', 'Principal'), a = req(f, 'agent', 'Agent');
      const pw = req(f, 'powers', 'Powers'), place = req(f, 'place', 'Place');
      const special = /^s/i.test(opt(f, 'special', 'special'));
      return {
        meta: [['Principal', p], ['Attorney', a], ['Place', place]],
        sections: [
          { heading: 'Appointment', clauses: [`I, ${p}, appoint ${a} as my lawful attorney to act on my behalf as set out below.`] },
          { heading: special ? 'Special powers' : 'General powers', clauses: [`My attorney is authorised to: ${pw}.`, special ? `This is a Special Power of Attorney limited to the act(s) stated above.` : `This is a General Power of Attorney; my attorney may do all lawful acts necessary for the above purposes.`] },
          { heading: 'Ratification', clauses: [`I ratify and confirm all lawful acts done by my attorney under this authority.`] },
          { heading: 'Revocation', clauses: [`This power remains in force until revoked by me in writing.`] },
        ],
        citations: [
          { label: 'Powers of Attorney Act, 1882', note: 'execution and effect of a power of attorney' },
          { label: 'Registration Act, 1908 / Indian Stamp Act, 1899', note: 'a POA dealing with immovable property is stamped and often registered' },
        ],
      };
    },
  },

  'will': {
    label: 'Will (Testament)', docType: 'Last Will and Testament',
    category: 'Personal legal documents', formats: ['docx', 'pdf'],
    fields: [
      { key: 'testator', label: 'Testator (your) name', required: true },
      { key: 'address', label: 'Address', required: true },
      { key: 'executor', label: 'Executor name', required: true },
      { key: 'bequests', label: 'Who gets what', required: true },
      F.place,
    ],
    build(f) {
      const t = req(f, 'testator', 'Testator'), addr = req(f, 'address', 'Address');
      const ex = req(f, 'executor', 'Executor'), beq = req(f, 'bequests', 'Bequests'), place = req(f, 'place', 'Place');
      return {
        meta: [['Testator', t], ['Address', addr], ['Executor', ex]],
        sections: [
          { heading: 'Declaration', clauses: [`I, ${t}, resident of ${addr}, being of sound mind and making this Will freely, declare this to be my last Will, and revoke all earlier Wills and codicils.`] },
          { heading: 'Executor', clauses: [`I appoint ${ex} as the executor of this Will to give effect to its provisions.`] },
          { heading: 'Bequests', clauses: [`I bequeath my estate as follows: ${beq}.`] },
          { heading: 'Residue', clauses: [`Anything not specifically bequeathed shall go to my legal heirs as the executor decides in accordance with law.`] },
          { heading: 'Attestation', clauses: [`This Will is signed by me in the presence of two witnesses, who have attested it in my presence and in the presence of each other, as required by section 63 of the Indian Succession Act, 1925. Signed at ${place}.`] },
        ],
        citations: [
          { label: 'Indian Succession Act, 1925, s.63', note: 'a Will must be signed by the testator and attested by two witnesses' },
          { label: 'Indian Succession Act, 1925, s.59', note: 'who may make a Will (sound mind, not a minor)' },
        ],
      };
    },
  },

  'declaration': {
    label: 'Declaration', docType: 'Declaration',
    category: 'Personal legal documents', formats: ['docx', 'pdf'],
    fields: [
      { key: 'declarant', label: 'Declarant (your) name', required: true },
      { key: 'address', label: 'Address', required: true },
      { key: 'statement', label: 'What you declare', required: true },
      F.place,
    ],
    build(f) {
      const d = req(f, 'declarant', 'Declarant'), addr = req(f, 'address', 'Address');
      const st = req(f, 'statement', 'Statement'), place = req(f, 'place', 'Place');
      return {
        meta: [['Declarant', d], ['Address', addr], ['Place', place]],
        sections: [
          { heading: 'Declaration', clauses: [`I, ${d}, resident of ${addr}, do hereby declare as follows: ${st}.`] },
          { heading: 'Truth of declaration', clauses: [`I declare that the above is true to the best of my knowledge and belief.`] },
        ],
        citations: [{ label: 'General', note: 'a self-declaration; may require notarisation depending on the purpose' }],
      };
    },
  },

  'indemnity-bond': {
    label: 'Indemnity Bond', docType: 'Indemnity Bond',
    category: 'Personal legal documents', formats: ['docx', 'pdf'],
    fields: [
      { key: 'indemnifier', label: 'Indemnifier (you)', required: true },
      { key: 'indemnified', label: 'Person / body indemnified', required: true },
      { key: 'matter', label: 'Matter being indemnified', required: true },
      F.place,
    ],
    build(f) {
      const i = req(f, 'indemnifier', 'Indemnifier'), o = req(f, 'indemnified', 'Indemnified');
      const m = req(f, 'matter', 'Matter'), place = req(f, 'place', 'Place');
      return {
        meta: [['Indemnifier', i], ['Indemnified', o], ['Place', place]],
        sections: [
          { heading: 'Background', clauses: [`This bond concerns the following matter: ${m}.`] },
          { heading: 'Indemnity', clauses: [`I, ${i}, undertake to indemnify and keep ${o} indemnified against any loss, claim or liability arising out of the said matter.`] },
          { heading: 'Extent', clauses: [`This indemnity is a contract of indemnity within the meaning of section 124 of the Indian Contract Act, 1872, and covers actual loss suffered.`] },
        ],
        citations: [{ label: 'Indian Contract Act, 1872, s.124–125', note: 'contract of indemnity and rights of the indemnity-holder' }],
      };
    },
  },

  // ======================= BUSINESS & COMPLIANCE =======================
  'terms-and-conditions': {
    label: 'Terms and Conditions', docType: 'Terms and Conditions',
    category: 'Business & compliance', formats: ['docx', 'pdf'],
    fields: [
      { key: 'entity', label: 'Business / entity name', required: true },
      { key: 'service', label: 'What the service or product is', required: true },
      { key: 'website', label: 'Website or app', required: false },
      F.jx,
      { key: 'contact', label: 'Contact email', required: false },
    ],
    build(f) {
      const entity = req(f, 'entity', 'Business / entity name'), service = req(f, 'service', 'What the service is');
      const jx = req(f, 'jurisdiction', 'Governing state'), site = opt(f, 'website'), contact = opt(f, 'contact');
      return {
        meta: [['Between', `${entity} ("the Company")`], ['And', 'the user of the service ("the User")'], ...(site ? [['Service', site]] : [])],
        sections: [
          { heading: 'Definitions', clauses: [`"Company" means ${entity}. "Service" means ${service}${site ? `, offered through ${site}` : ''}. "User" means any person who accesses or uses the Service.`, `"Content" means all text, data, files and material made available through the Service.`] },
          { heading: 'Acceptance of terms', clauses: [`By accessing or using the Service, the User agrees to be bound by these Terms. If the User does not agree, the User must not use the Service.`, `These Terms constitute an agreement under the Indian Contract Act, 1872. The User confirms they are competent to contract under section 11 of that Act.`] },
          { heading: 'Use of the service', clauses: [`The Company grants the User a limited, non-exclusive, non-transferable right to use the Service for lawful purposes only.`, `The User shall not use the Service in any way that breaches applicable Indian law, including the Information Technology Act, 2000, or infringes the rights of others.`] },
          { heading: 'Intellectual property', clauses: [`All intellectual property in the Service and its Content belongs to the Company or its licensors and is protected under the Copyright Act, 1957 and the Trade Marks Act, 1999.`] },
          { heading: 'Payment and refunds', clauses: [`Where the Service is paid, charges are as displayed at purchase and inclusive of applicable taxes unless stated otherwise. Refunds are governed by the Company's refund policy and the Consumer Protection Act, 2019.`] },
          { heading: 'Limitation of liability', clauses: [`The Service is provided "as is". To the extent permitted by law, the Company excludes implied warranties and is not liable for indirect or consequential loss. Liability that cannot be limited under Indian law is unaffected.`] },
          { heading: 'Termination', clauses: [`The Company may suspend or terminate access for breach of these Terms. The User may stop using the Service at any time.`] },
          { heading: 'Governing law and jurisdiction', clauses: [`These Terms are governed by the laws of India, and the courts at ${jx} shall have exclusive jurisdiction, subject to arbitration where agreed.`] },
          { heading: 'Contact', clauses: [contact ? `Questions about these Terms may be sent to ${contact}.` : `Questions may be sent to the Company at its published contact address.`] },
        ],
        citations: [
          { label: 'Indian Contract Act, 1872, s.10 & s.11', note: 'what makes an agreement enforceable' },
          { label: 'Consumer Protection Act, 2019', note: 'unfair terms are void; deficiency in service' },
          { label: 'Information Technology Act, 2000', note: 'lawful use of an online service' },
        ],
      };
    },
  },

  'privacy-policy': {
    label: 'Privacy Policy', docType: 'Privacy Policy',
    category: 'Business & compliance', formats: ['docx', 'pdf'],
    fields: [
      { key: 'entity', label: 'Business / entity name', required: true },
      { key: 'website', label: 'Website or app', required: false },
      { key: 'dataTypes', label: 'Personal data collected', required: true, hint: 'e.g. name, email, phone, payment details' },
      { key: 'purpose', label: 'Why the data is collected', required: true },
      { key: 'contact', label: 'Contact email for data requests', required: true },
    ],
    build(f) {
      const entity = req(f, 'entity', 'Business / entity name'), data = req(f, 'dataTypes', 'Personal data collected');
      const purpose = req(f, 'purpose', 'Why the data is collected'), contact = req(f, 'contact', 'Contact email'), site = opt(f, 'website');
      return {
        meta: [['Data Fiduciary', entity], ...(site ? [['Service', site]] : []), ['Contact for data rights', contact]],
        sections: [
          { heading: 'Who we are', clauses: [`${entity} ("we", "us") is the Data Fiduciary responsible for your personal data under the Digital Personal Data Protection Act, 2023 ("DPDP Act").`, `This policy explains what personal data we collect, why, and the rights you have as a Data Principal.`] },
          { heading: 'What we collect', clauses: [`We collect the following personal data: ${data}.`, `We collect only data necessary for the purpose stated below, in line with data minimisation.`] },
          { heading: 'Why we collect it and our legal basis', clauses: [`We process your personal data for: ${purpose}.`, `Our lawful basis is your consent under section 6 of the DPDP Act, or a legitimate use permitted under section 7 where applicable. You may withdraw consent at any time.`] },
          { heading: 'Your rights as a Data Principal', clauses: [`Under sections 11 to 14 of the DPDP Act you may access a summary of your data, correct or complete it, erase it where no longer needed, and nominate another person to exercise your rights.`, `You have the right to grievance redressal before approaching the Data Protection Board of India.`] },
          { heading: 'Consent and withdrawal', clauses: [`Where we rely on consent, you may withdraw it as easily as you gave it, by writing to ${contact}. Withdrawal does not affect lawful processing already carried out.`] },
          { heading: 'Data retention', clauses: [`We keep personal data only as long as the purpose requires or as required by law, then erase it, per section 8(7) of the DPDP Act.`] },
          { heading: 'Security', clauses: [`We take reasonable security safeguards per section 8(5) of the DPDP Act, and will notify the Data Protection Board and affected persons of a breach as required by the Act and the Digital Personal Data Protection Rules, 2025.`] },
          { heading: 'Children’s data', clauses: [`For a child (under 18), we obtain verifiable consent of a parent or guardian and do not carry out tracking or targeted advertising directed at children, per section 9 of the DPDP Act.`] },
          { heading: 'Grievance officer and contact', clauses: [`To exercise your rights or raise a concern, contact our grievance officer at ${contact}.`] },
        ],
        citations: [
          { label: 'DPDP Act, 2023, s.6', note: 'consent as the basis for processing' },
          { label: 'DPDP Act, 2023, s.8(5)–(7)', note: 'security safeguards and retention limits' },
          { label: 'DPDP Act, 2023, ss.11–14', note: 'rights of the Data Principal' },
          { label: 'DPDP Act, 2023, s.9', note: 'processing of children’s data' },
          { label: 'Digital Personal Data Protection Rules, 2025', note: 'breach notification and operational detail' },
        ],
      };
    },
  },

  'refund-policy': {
    label: 'Refund & Cancellation Policy', docType: 'Refund and Cancellation Policy',
    category: 'Business & compliance', formats: ['docx', 'pdf'],
    fields: [
      { key: 'entity', label: 'Business / entity name', required: true },
      { key: 'window', label: 'Refund window (days)', required: true, hint: 'e.g. 7' },
      { key: 'conditions', label: 'Conditions for a refund', required: true },
      { key: 'contact', label: 'Contact email', required: false },
    ],
    build(f) {
      const e = req(f, 'entity', 'Business'), w = req(f, 'window', 'Refund window');
      const cond = req(f, 'conditions', 'Conditions'), contact = opt(f, 'contact');
      return {
        meta: [['Business', e]],
        sections: [
          { heading: 'Scope', clauses: [`This policy applies to purchases from ${e} and forms part of our terms.`] },
          { heading: 'Refund window', clauses: [`A refund may be requested within ${w} days of purchase, subject to the conditions below.`] },
          { heading: 'Conditions', clauses: [`A refund is available where: ${cond}.`] },
          { heading: 'Process and timelines', clauses: [`Approved refunds are processed to the original payment method within a reasonable period. We do not levy unfair charges, consistent with the Consumer Protection Act, 2019.`] },
          { heading: 'Contact', clauses: [contact ? `Refund requests may be sent to ${contact}.` : `Refund requests may be sent to our published contact address.`] },
        ],
        citations: [{ label: 'Consumer Protection Act, 2019', note: 'unfair trade practice; consumer’s right to redress' }],
      };
    },
  },

  'disclaimer': {
    label: 'Website Disclaimer', docType: 'Disclaimer',
    category: 'Business & compliance', formats: ['docx', 'pdf'],
    fields: [
      { key: 'entity', label: 'Business / entity name', required: true },
      { key: 'nature', label: 'Nature of content', required: true, hint: 'e.g. informational, educational' },
      { key: 'website', label: 'Website or app', required: false },
    ],
    build(f) {
      const e = req(f, 'entity', 'Business'), n = req(f, 'nature', 'Nature of content'), site = opt(f, 'website');
      return {
        meta: [['Business', e], ...(site ? [['Service', site]] : [])],
        sections: [
          { heading: 'General', clauses: [`The content provided by ${e}${site ? ` on ${site}` : ''} is ${n} in nature and is provided in good faith.`] },
          { heading: 'No professional advice', clauses: [`The content is not professional, legal, financial or medical advice. You should seek advice from a qualified professional before acting on it.`] },
          { heading: 'No warranty', clauses: [`We make no warranty as to accuracy or completeness, and are not liable for any loss arising from reliance on the content, to the extent permitted by law.`] },
          { heading: 'External links', clauses: [`We are not responsible for the content of external websites linked from our service.`] },
        ],
        citations: [{ label: 'Indian Contract Act, 1872 / Consumer Protection Act, 2019', note: 'a disclaimer cannot exclude liability that the law does not allow to be excluded' }],
      };
    },
  },

  'board-resolution': {
    label: 'Board Resolution', docType: 'Board Resolution',
    category: 'Business & compliance', formats: ['docx', 'pdf'],
    fields: [
      { key: 'company', label: 'Company name', required: true },
      { key: 'meetingDate', label: 'Date of board meeting', required: false },
      { key: 'resolution', label: 'What is being resolved', required: true },
      { key: 'authorised', label: 'Person authorised to act', required: false },
    ],
    build(f) {
      const c = req(f, 'company', 'Company'), r = req(f, 'resolution', 'Resolution');
      const md = opt(f, 'meetingDate', 'the date of the meeting'), auth = opt(f, 'authorised', 'a director of the Company');
      return {
        meta: [['Company', c], ['Meeting date', md]],
        sections: [
          { heading: 'Extract', clauses: [`Certified extract of the resolution passed at the meeting of the Board of Directors of ${c} held on ${md}.`] },
          { heading: 'Resolution', clauses: [`"RESOLVED THAT ${r}."`] },
          { heading: 'Authority to act', clauses: [`"RESOLVED FURTHER THAT ${auth} be and is hereby authorised to do all acts, deeds and things necessary to give effect to the above resolution, including signing documents on behalf of the Company."`] },
          { heading: 'Certification', clauses: [`Certified to be a true copy, for and on behalf of the Board of Directors of ${c}.`] },
        ],
        citations: [
          { label: 'Companies Act, 2013, s.179', note: 'powers of the Board exercised by resolution' },
          { label: 'Companies Act, 2013, s.118', note: 'minutes as evidence of proceedings' },
        ],
      };
    },
  },

  // ==================== FORMAT-SPECIFIC TEMPLATES ====================
  'fee-schedule': {
    label: 'Fee / Payment Schedule (Excel)', docType: 'Fee Schedule',
    category: 'Tables & schedules', formats: ['xlsx', 'pdf'],
    fields: [
      { key: 'entity', label: 'Business / matter name', required: true },
      { key: 'items', label: 'Line items', required: true, hint: 'Description : Amount, one per line' },
      { key: 'currency', label: 'Currency', required: false, hint: 'default ₹' },
    ],
    build(f) {
      const e = req(f, 'entity', 'Business / matter'), raw = req(f, 'items', 'Line items');
      const cur = opt(f, 'currency', '₹');
      const rows = raw.split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [desc, amt] = l.split(/[:=]/);
        return [desc ? desc.trim() : l, amt ? `${cur}${amt.trim()}` : ''];
      });
      const total = raw.split(/\n|;/).reduce((s, l) => {
        const m = l.split(/[:=]/)[1]; const n = m ? parseFloat(m.replace(/[^0-9.]/g, '')) : 0;
        return s + (isNaN(n) ? 0 : n);
      }, 0);
      if (total) rows.push(['Total', `${cur}${total}`]);
      return {
        meta: [['For', e]],
        table: { columns: ['Description', 'Amount'], rows },
        // a readable fallback for the PDF version
        sections: [{ heading: 'Fee schedule', clauses: rows.map((r) => `${r[0]}: ${r[1]}`) }],
        citations: [],
      };
    },
  },

  'case-brief-deck': {
    label: 'Case Brief Deck (PowerPoint)', docType: 'Case Brief',
    category: 'Presentations', formats: ['pptx', 'pdf'],
    fields: [
      { key: 'caseName', label: 'Case name', required: true },
      { key: 'citation', label: 'Citation', required: false },
      { key: 'facts', label: 'Facts', required: true },
      { key: 'issues', label: 'Issues', required: true },
      { key: 'held', label: 'Held / decision', required: true },
    ],
    build(f) {
      const cn = req(f, 'caseName', 'Case name'), facts = req(f, 'facts', 'Facts');
      const issues = req(f, 'issues', 'Issues'), held = req(f, 'held', 'Held'), cit = opt(f, 'citation', '');
      const toList = (s) => s.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
      return {
        meta: [['Case', cn], ...(cit ? [['Citation', cit]] : [])],
        slides: [
          { heading: 'Facts', bullets: toList(facts) },
          { heading: 'Issues', bullets: toList(issues) },
          { heading: 'Held', bullets: toList(held) },
        ],
        // PDF fallback
        sections: [
          { heading: 'Facts', clauses: toList(facts) },
          { heading: 'Issues', clauses: toList(issues) },
          { heading: 'Held', clauses: toList(held) },
        ],
        citations: [],
      };
    },
  },
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({
    id, label: t.label, category: t.category || 'Other',
    formats: t.formats || ['docx', 'pdf'], fields: t.fields,
  }));
}
