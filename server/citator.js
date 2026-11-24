// citator.js — Curated landmark "case status" guard.
//
// WHAT THIS IS
// A deterministic, model-independent safety net. Every entry below is a
// HAND-VERIFIED Supreme Court overruling: an older case whose ratio is no
// longer good law because a later, larger or subsequent bench overruled it.
// When the AI's answer names one of these overruled cases, we attach a factual
// warning so the user is never told a dead case is still binding.
//
// WHY CURATED (not auto-extracted)
// The judgment corpus is OCR'd, chunked running text with no clean citation
// field, so machine-guessing "A overruled B" is unreliable. Everything here is
// checked against the actual judgments. If it is on this list, it is correct.
// It is a SEED of the most-asked landmark overrulings, built to grow — add
// entries to LANDMARK_OVERRULINGS and the guard picks them up automatically.
//
// SCOPE / LIMITS
// - Supreme Court overrulings only for now (High Court layer waits on the host).
// - Covers the cases on this list; a rare overruling not listed is not flagged.
//   The guard makes answers SAFER, not omniscient.

export const LANDMARK_OVERRULINGS = [
  {
    overruled: 'ADM Jabalpur v. Shivkant Shukla',
    aliases: ['adm jabalpur', 'a.d.m. jabalpur', 'additional district magistrate, jabalpur', 'shivkant shukla', 'shivakant shukla'],
    overruledBy: 'K.S. Puttaswamy v. Union of India',
    year: 2017,
    note: 'The majority view — that even the right to life under Article 21 could be suspended during a proclaimed Emergency — was expressly overruled. The right to life and personal liberty is now held to be inalienable.',
  },
  {
    overruled: 'Suresh Kumar Koushal v. Naz Foundation',
    aliases: ['suresh kumar koushal', 'suresh koushal', 'koushal v. naz', 'koushal vs naz'],
    overruledBy: 'Navtej Singh Johar v. Union of India',
    year: 2018,
    note: 'The ruling that re-criminalised consensual same-sex relations under Section 377 IPC was overruled. Consensual same-sex conduct between adults is no longer an offence.',
  },
  {
    overruled: 'Golak Nath v. State of Punjab',
    aliases: ['golak nath', 'golaknath', 'i.c. golak nath', 'golak nath v. state of punjab'],
    overruledBy: 'Kesavananda Bharati v. State of Kerala',
    year: 1973,
    note: 'The holding that Parliament could NOT amend Fundamental Rights was overruled. The settled position is now the basic-structure doctrine: Parliament may amend any part of the Constitution but cannot destroy its basic structure.',
  },
  {
    overruled: 'A.K. Gopalan v. State of Madras',
    aliases: ['a.k. gopalan', 'ak gopalan', 'gopalan v. state of madras', 'gopalan vs state of madras'],
    overruledBy: 'Maneka Gandhi v. Union of India',
    year: 1978,
    note: 'The narrow "isolated rights" reading — that Articles 19, 21 and 22 operate in separate silos and that "procedure established by law" need not be fair — no longer holds. Article 21 procedure must now be just, fair and reasonable, and the rights are read together.',
  },
  {
    overruled: 'P. Rathinam v. Union of India',
    aliases: ['p. rathinam', 'p rathinam', 'rathinam v. union of india'],
    overruledBy: 'Gian Kaur v. State of Punjab',
    year: 1996,
    note: 'The ruling that Section 309 IPC (attempt to suicide) was unconstitutional — reading a "right to die" into Article 21 — was overruled. Article 21 does not include a right to die.',
  },
  {
    overruled: 'Rajendra Prasad v. State of Uttar Pradesh',
    aliases: ['rajendra prasad v. state of uttar pradesh', 'rajendra prasad v. state of u.p', 'rajendra prasad vs state of u'],
    overruledBy: 'Bachan Singh v. State of Punjab',
    year: 1980,
    note: 'Its approach to the death penalty was superseded. The governing test is now the "rarest of rare" doctrine laid down in Bachan Singh.',
  },
  {
    overruled: 'Sowmithri Vishnu v. Union of India',
    aliases: ['sowmithri vishnu', 'saumitri vishnu', 'sowmithri vishnu v. union of india'],
    overruledBy: 'Joseph Shine v. Union of India',
    year: 2018,
    note: 'Decisions upholding the adultery offence under Section 497 IPC were overruled when Section 497 was struck down as unconstitutional. Adultery is no longer a criminal offence.',
  },
  {
    overruled: 'Yusuf Abdul Aziz v. State of Bombay',
    aliases: ['yusuf abdul aziz', 'yusuf abdul aziz v. state of bombay'],
    overruledBy: 'Joseph Shine v. Union of India',
    year: 2018,
    note: 'Its basis — the adultery offence under Section 497 IPC — was struck down as unconstitutional. Adultery is no longer a criminal offence.',
  },
  {
    overruled: 'Unni Krishnan v. State of Andhra Pradesh',
    aliases: ['unni krishnan', 'unnikrishnan', 'unni krishnan v. state of andhra pradesh', 'unni krishnan j.p'],
    overruledBy: 'T.M.A. Pai Foundation v. State of Karnataka',
    year: 2002,
    note: 'The scheme it laid down regulating private (including professional) education was overruled. Private unaided institutions have greater autonomy in administration and admissions under the later ruling.',
  },
  {
    overruled: 'V. Revathi v. Union of India',
    aliases: ['v. revathi', 'v revathi', 'revathi v. union of india'],
    overruledBy: 'Joseph Shine v. Union of India',
    year: 2018,
    note: 'Its basis — the adultery offence under Section 497 IPC — was struck down as unconstitutional. Adultery is no longer a criminal offence.',
  },
  {
    overruled: 'Prakash v. Phulavati',
    aliases: ['prakash v. phulavati', 'prakash vs phulavati', 'phulavati'],
    overruledBy: 'Vineeta Sharma v. Rakesh Sharma',
    year: 2020,
    note: 'Its ruling — that a daughter became a coparcener only if her father was alive on 9 September 2005 — was overruled. A daughter is a coparcener by birth in her own right, with the same rights as a son, whether or not the father was living on that date.',
  },
  {
    overruled: 'Sabhajit Tehsildar v. Union of India',
    aliases: ['sabhajit tehsildar', 'sabhajit tehsildar v. union of india'],
    overruledBy: 'Pradeep Kumar Biswas v. Indian Institute of Chemical Biology',
    year: 2002,
    note: 'Its test for what counts as "State"/"other authorities" under Article 12 was overruled. The governing test is now deep and pervasive financial, functional and administrative control by the government.',
  },
  {
    overruled: 'India Cement Ltd v. State of Tamil Nadu',
    aliases: ['india cement ltd v. state of tamil nadu', 'india cement v. state of tamil nadu', 'india cement vs state of tamil nadu'],
    overruledBy: 'Mineral Area Development Authority v. Steel Authority of India',
    year: 2024,
    note: 'Its holding that royalty on minerals is in the nature of a tax, and that States lacked power to levy such charges, was overruled by a nine-judge bench. Royalty is not a tax, and States have legislative competence to tax mineral rights and mineral-bearing land.',
  },
  {
    overruled: 'NN Global Mercantile Solutions v. Indo Unique Flame',
    aliases: ['nn global', 'n.n. global', 'nn global mercantile', 'indo unique flame'],
    overruledBy: 'In Re: Interplay Between Arbitration Agreements and the Stamp Act',
    year: 2023,
    note: 'Its holding that an unstamped or insufficiently stamped arbitration agreement is void and unenforceable was overruled by a seven-judge bench. Such an agreement is not void — the defect is curable and goes only to admissibility, not validity.',
  },
  {
    overruled: 'State of Rajasthan v. Union of India',
    aliases: ['state of rajasthan v. union of india', 'state of rajasthan vs union of india'],
    overruledBy: 'S.R. Bommai v. Union of India',
    year: 1994,
    note: 'To the extent it treated the exercise of power under Article 356 (President\'s Rule) as largely beyond judicial scrutiny, it was overruled. A proclamation under Article 356 is subject to judicial review, and the floor of the House is the proper test of majority.',
  },
  {
    overruled: 'State of Bombay v. United Motors (India) Ltd',
    aliases: ['state of bombay v. united motors', 'united motors (india)', 'united motors v. state of bombay'],
    overruledBy: 'Bengal Immunity Co. Ltd v. State of Bihar',
    year: 1955,
    note: 'Its interpretation of Article 286 — on when a State may tax inter-State sales under the Explanation to that Article — was overruled. The ban on taxing inter-State sales was read more strictly against the taxing State.',
  },
  {
    overruled: 'P.V. Narasimha Rao v. State (CBI/SPE)',
    aliases: ['p.v. narasimha rao v. state', 'pv narasimha rao v. state', 'narasimha rao v. state (cbi)', 'jmm bribery case'],
    overruledBy: 'Sita Soren v. Union of India',
    year: 2024,
    note: 'Its ruling — that a legislator who accepted a bribe to vote or speak in the House enjoyed immunity from prosecution under Article 105(2)/194(2) — was overruled by a seven-judge bench. Legislators do NOT have immunity for bribery; such conduct can be prosecuted.',
  },
  {
    overruled: 'E.V. Chinnaiah v. State of Andhra Pradesh',
    aliases: ['e.v. chinnaiah', 'ev chinnaiah', 'chinnaiah v. state of andhra pradesh'],
    overruledBy: 'State of Punjab v. Davinder Singh',
    year: 2024,
    note: 'Its holding — that Scheduled Castes form a single homogeneous class that cannot be sub-classified — was overruled by a seven-judge bench. States may sub-classify within SCs/STs to give more benefit to the more backward among them, subject to safeguards.',
  },
  {
    overruled: 'S. Azeez Basha v. Union of India',
    aliases: ['azeez basha', 'aziz basha', 's. azeez basha'],
    overruledBy: 'Aligarh Muslim University v. Naresh Agarwal',
    year: 2024,
    note: 'Its view — that an institution created by a statute cannot claim minority status under Article 30 — was overruled by a seven-judge bench, which laid down fresh tests for determining minority character (leaving AMU\'s actual status to a regular bench).',
  },
  {
    overruled: 'Synthetics and Chemicals Ltd v. State of Uttar Pradesh',
    aliases: ['synthetics and chemicals', 'synthetics & chemicals'],
    overruledBy: 'State of U.P. v. Lalta Prasad Vaish',
    year: 2024,
    note: 'Its holding on the scope of States\' power over "intoxicating liquor" — excluding industrial alcohol from State legislative competence under Entry 8, List II — was overruled by a nine-judge bench. The State\'s power extends to industrial/denatured alcohol as well.',
  },
  {
    overruled: 'Sanjeev Coke Manufacturing Co. v. Bharat Coking Coal Ltd',
    aliases: ['sanjeev coke', 'sanjeev coke manufacturing'],
    overruledBy: 'Property Owners Association v. State of Maharashtra',
    year: 2024,
    note: 'The broad view — that ALL privately owned resources are "material resources of the community" under Article 39(b) — was overruled by a nine-judge bench. Not every private resource qualifies; whether one does is contextual (nature, scarcity, impact on the public).',
  },
  {
    overruled: 'Bhatia International v. Bulk Trading S.A.',
    aliases: ['bhatia international', 'bhatia international v. bulk trading'],
    overruledBy: 'Bharat Aluminium Co. v. Kaiser Aluminium (BALCO)',
    year: 2012,
    note: 'Its holding — that Part I of the Arbitration and Conciliation Act 1996 applies even to arbitrations seated outside India — was overruled. Part I does not apply to foreign-seated arbitrations (prospectively, for agreements from 6 September 2012).',
  },
  {
    overruled: 'Venture Global Engineering v. Satyam Computer Services',
    aliases: ['venture global engineering', 'venture global v. satyam'],
    overruledBy: 'Bharat Aluminium Co. v. Kaiser Aluminium (BALCO)',
    year: 2012,
    note: 'It applied the now-overruled Bhatia International rule that Part I of the Arbitration Act reaches foreign-seated arbitrations. Under BALCO, Part I does not apply to arbitrations seated outside India.',
  },
  {
    overruled: 'Automobile Transport (Rajasthan) Ltd v. State of Rajasthan',
    aliases: ['automobile transport (rajasthan)', 'automobile transport v. state of rajasthan', 'automobile transport ltd'],
    overruledBy: 'Jindal Stainless Ltd v. State of Haryana',
    year: 2016,
    note: 'The "compensatory tax" doctrine it developed — as an exception to the freedom of trade under Article 301 — was overruled by a nine-judge bench. A compensatory tax is no longer a recognised exception; taxes are tested against Articles 301 to 304 directly.',
  },
  {
    overruled: 'S.P. Sampath Kumar v. Union of India',
    aliases: ['s.p. sampath kumar', 'sp sampath kumar', 'sampath kumar v. union of india'],
    overruledBy: 'L. Chandra Kumar v. Union of India',
    year: 1997,
    note: 'Its approval of tribunals as substitutes for the High Courts — ousting Article 226/227 review — was overruled by a seven-judge bench. Judicial review by the High Courts and Supreme Court is part of the basic structure and cannot be excluded; tribunal decisions remain subject to it.',
  },
  {
    overruled: 'Northern India Caterers (India) Ltd v. State of Punjab',
    aliases: ['northern india caterers (india) ltd v. state of punjab', 'northern india caterers v. state of punjab'],
    overruledBy: 'Maganlal Chhaganlal v. Municipal Corporation of Greater Bombay',
    year: 1974,
    note: 'Its reasoning under Article 14 — that giving the authorities a choice between a harsher summary procedure and an ordinary suit is by itself discriminatory — was overruled by a larger bench. Providing an additional summary procedure is not, without more, a violation of Article 14.',
  },
  {
    overruled: 'M.P. Sharma v. Satish Chandra',
    aliases: ['m.p. sharma', 'mp sharma', 'm.p. sharma v. satish chandra'],
    overruledBy: 'K.S. Puttaswamy v. Union of India',
    year: 2017,
    note: 'Its holding — that the Constitution contains no fundamental right to privacy — was expressly overruled by a nine-judge bench. Privacy is a fundamental right protected under Article 21 and Part III.',
  },
  {
    overruled: 'Kharak Singh v. State of Uttar Pradesh',
    aliases: ['kharak singh', 'kharak singh v. state of uttar pradesh', 'kharak singh v. state of u.p'],
    overruledBy: 'K.S. Puttaswamy v. Union of India',
    year: 2017,
    note: 'To the extent the majority held there is no fundamental right to privacy under the Constitution, it was expressly overruled by a nine-judge bench. Privacy is now a fundamental right under Article 21 and Part III.',
  },
  {
    overruled: 'Konkan Railway Corporation Ltd v. Rani Construction Pvt Ltd',
    aliases: ['rani construction', 'konkan railway corporation v. rani construction', 'konkan railway corporation ltd v. rani construction'],
    overruledBy: 'S.B.P. & Co. v. Patel Engineering Ltd',
    year: 2005,
    note: 'Its holding — that the Chief Justice\'s power to appoint an arbitrator under Section 11 of the Arbitration and Conciliation Act 1996 is merely administrative — was overruled by a seven-judge bench. That power is judicial, and the Chief Justice or his designate may decide preliminary and jurisdictional issues.',
  },
  {
    overruled: 'Cloth Traders (P) Ltd v. Additional Commissioner of Income Tax',
    aliases: ['cloth traders', 'cloth traders (p) ltd', 'cloth traders v. additional cit'],
    overruledBy: 'Distributors (Baroda) Pvt Ltd v. Union of India',
    year: 1985,
    note: 'Its ruling — that the Section 80M deduction for inter-corporate dividends is computed on the gross dividend received — was overruled by a five-judge bench. The deduction is allowed only on the net dividend income, after deducting the expenditure attributable to earning it.',
  },
  {
    overruled: 'M. Nagaraj v. Union of India',
    aliases: ['m. nagaraj', 'nagaraj v. union of india'],
    overruledBy: 'Jarnail Singh v. Lachhmi Narain Gupta',
    year: 2018,
    note: 'Its requirement — that a State must collect quantifiable data showing the backwardness of SCs/STs before granting reservation in promotion — was overruled by a five-judge bench as contrary to Indra Sawhney. Such backwardness data is not required (the creamy-layer exclusion laid down in Nagaraj was, however, upheld).',
  },
  {
    overruled: 'Ravji alias Ram Chandra v. State of Rajasthan',
    aliases: ['ravji', 'ravji alias ram chandra', 'ravji v. state of rajasthan'],
    overruledBy: 'Santosh Kumar Satishbhushan Bariyar v. State of Maharashtra',
    year: 2009,
    note: 'Its approach — that only the circumstances of the crime, and not those of the criminal, are relevant when awarding a death sentence — was held to be per incuriam and no longer good law, being contrary to Bachan Singh. Both the crime and the criminal must be weighed.',
  },
  {
    overruled: 'Islamic Academy of Education v. State of Karnataka',
    aliases: ['islamic academy of education', 'islamic academy v. state of karnataka'],
    overruledBy: 'P.A. Inamdar v. State of Maharashtra',
    year: 2005,
    note: 'To the extent it allowed the State to fix a quota for seat-sharing between the management and the State in unaided (minority and non-minority) institutions, it was overruled by a seven-judge bench as running counter to T.M.A. Pai. The State cannot impose reservation or appropriate seats in unaided institutions.',
  },
  {
    overruled: 'Management of Safdarjung Hospital v. Kuldip Singh Sethi',
    aliases: ['management of safdarjung hospital', 'safdarjung hospital v. kuldip', 'safdarjung hospital case'],
    overruledBy: 'Bangalore Water Supply & Sewerage Board v. A. Rajappa',
    year: 1978,
    note: 'Its narrow reading of "industry" under the Industrial Disputes Act — excluding hospitals and similar bodies — was overruled by a seven-judge bench. Under the triple test, hospitals, educational/research institutions, clubs and government departments with an employer-employee relationship can be an "industry".',
  },
  {
    overruled: 'Project Director, NHAI v. M. Hakeem',
    aliases: ['m. hakeem', 'nhai v. m. hakeem', 'project director, nhai v. m. hakeem'],
    overruledBy: 'Gayatri Balasamy v. ISG Novasoft Technologies Ltd',
    year: 2025,
    note: 'Its holding — that a court has no power to modify an arbitral award under Section 34 of the Arbitration and Conciliation Act 1996 and can only set it aside — was overruled by a five-judge bench (4:1). Courts have a limited power to modify an award in narrow circumstances.',
  },
];

// Build a fast lookup: lowercased alias -> entry. Longer aliases first so the
// most specific match wins and we do not double-count within one case.
const ALIAS_INDEX = LANDMARK_OVERRULINGS.flatMap(e =>
  e.aliases.map(a => ({ alias: a.toLowerCase(), entry: e }))
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Scan answer text for any overruled case named in it.
 * @param {string} text
 * @returns {Array} matched entries (deduped, one per case)
 */
export function detectOverruledCases(text) {
  if (!text || typeof text !== 'string') return [];
  const hay = text.toLowerCase();
  const seen = new Set();
  const hits = [];
  for (const { alias, entry } of ALIAS_INDEX) {
    if (seen.has(entry.overruled)) continue;
    if (hay.includes(alias)) {
      seen.add(entry.overruled);
      hits.push(entry);
    }
  }
  return hits;
}

/**
 * Produce a plain-text guard note to append to an answer, or '' if the answer
 * cites no overruled case. Plain text (no markdown) to match the app style.
 * @param {string} text
 * @returns {string}
 */
export function citatorGuardNote(text) {
  const hits = detectOverruledCases(text);
  if (!hits.length) return '';
  const lines = hits.map(e =>
    `• ${e.overruled} is NO LONGER GOOD LAW. It was overruled by ${e.overruledBy} (${e.year}). ${e.note}`
  );
  return `\n\n———\nIMPORTANT — CASE STATUS CHECK\n${lines.join('\n')}\nAlways confirm a case's current status before relying on it.`;
}

// --- self-test: run `node citator.js` ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const samples = [
    'As held in ADM Jabalpur v. Shivkant Shukla, rights can be suspended during Emergency.',
    'Section 377 was addressed in Suresh Kumar Koushal and later cases.',
    'Under Maneka Gandhi, Article 21 procedure must be fair — a clean, current citation.',
    'The right to privacy was affirmed in K.S. Puttaswamy (this is the overruling case, must NOT warn).',
    'Golak Nath and Kesavananda Bharati both concern amendment of fundamental rights.',
    'A daughter\'s coparcenary right was settled in Prakash v. Phulavati.',
    'Vineeta Sharma v. Rakesh Sharma clarified daughters are coparceners by birth (overruling case, must NOT warn).',
    'On royalty, see India Cement Ltd v. State of Tamil Nadu.',
    'Legislator immunity was discussed in P.V. Narasimha Rao v. State (CBI).',
    'Sub-classification of SCs was rejected in E.V. Chinnaiah v. State of Andhra Pradesh.',
    'Part I applied to foreign arbitrations under Bhatia International.',
    'The BALCO judgment settled the seat question (overruling case, must NOT warn).',
    'The claim that there is no right to privacy in Kharak Singh v. State of Uttar Pradesh no longer holds.',
    'The Section 11 power was said to be administrative in Konkan Railway Corporation v. Rani Construction.',
    'Death sentencing looked only at the crime in Ravji v. State of Rajasthan.',
    'Courts cannot modify awards under Project Director, NHAI v. M. Hakeem.',
  ];
  let pass = 0, fail = 0;
  const expect = [1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1]; // how many overruled-case hits each sample should trigger
  samples.forEach((s, i) => {
    const hits = detectOverruledCases(s);
    const ok = hits.length === expect[i];
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${hits.length}/${expect[i]}] ${s.slice(0, 60)}...`);
    if (hits.length) console.log('   ->', hits.map(h => `${h.overruled} => ${h.overruledBy}`).join(' | '));
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('\n--- sample guard note ---');
  console.log(citatorGuardNote(samples[0]));
  process.exit(fail ? 1 : 0);
}
