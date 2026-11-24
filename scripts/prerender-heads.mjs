// Gives each app page its own title and link preview in the served HTML, so
// crawlers and link previews that do not run JavaScript still see them.
// Runs after `vite build`; each page is dist/index.html with its head filled in.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PAGES = {
  '/documents': ['Legal Document Templates | Counsel AI', 'Create legal documents for India from templates, including rental agreements, employment contracts, NDAs and power of attorney.'],
  '/lawyers': ['Find a Lawyer in India | Counsel AI', 'Browse a directory of lawyers in India by state, city and practice area.'],
  '/community': ['Legal Community | Counsel AI', 'Ask questions and discuss legal matters with the Counsel AI community.'],
  '/discussion': ['AI Courtroom | Counsel AI', 'Upload legal case files and simulate a court hearing with an AI judge and AI lawyers.'],
  '/tax-services': ['Tax Services India | Counsel AI', 'Income tax help for India: ITR filing, tax planning, refunds, notices and CA assistance.'],
  '/tax-services/file-return': ['File Income Tax Return | Counsel AI', 'File your income tax return in India online.'],
  '/tax-services/upload-form16': ['Upload Form 16 | Counsel AI', 'Upload your Form 16 to start your income tax return.'],
  '/tax-services/ca-filing': ['CA-Assisted Tax Filing | Counsel AI', 'File your income tax return with help from a chartered accountant.'],
  '/tax-services/tax-planning': ['Tax Planning | Counsel AI', 'Plan your income tax and understand your options in India.'],
  '/tax-services/refund-status': ['Income Tax Refund Status | Counsel AI', 'Check the status of your income tax refund.'],
  '/tax-services/tds-solution': ['TDS Solutions | Counsel AI', 'Help with TDS questions and problems in India.'],
  '/tax-services/nri-taxes': ['NRI Taxes | Counsel AI', 'Income tax help for non-resident Indians.'],
  '/tax-services/tax-advisory': ['Tax Advisory | Counsel AI', 'Tax advice for individuals in India.'],
  '/tax-services/capital-gains': ['Capital Gains Tax | Counsel AI', 'Help with capital gains tax in India.'],
  '/tax-services/tax-notices': ['Income Tax Notices | Counsel AI', 'Help understanding and responding to income tax notices.'],
  '/tax-services/connect-expert': ['Talk to a Tax Expert | Counsel AI', 'Connect with a tax expert for help with your income tax.'],
};

const shell = readFileSync('dist/index.html', 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const setAttr = (html, pattern, value) => {
  if (!pattern.test(html)) throw new Error(`prerender-heads: no match for ${pattern}`);
  return html.replace(pattern, `$1${esc(value)}$2`);
};

for (const [path, [title, description]] of Object.entries(PAGES)) {
  const url = `https://counselai.com${path}`;
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setAttr(html, /(<meta name="description" content=")[^"]*(")/, description);
  html = setAttr(html, /(<link rel="canonical" href=")[^"]*(")/, url);
  html = setAttr(html, /(<meta property="og:url" content=")[^"]*(")/, url);
  html = setAttr(html, /(<meta property="og:title" content=")[^"]*(")/, title);
  html = setAttr(html, /(<meta property="og:description" content=")[^"]*(")/, description);
  html = setAttr(html, /(<meta name="twitter:url" content=")[^"]*(")/, url);
  html = setAttr(html, /(<meta name="twitter:title" content=")[^"]*(")/, title);
  html = setAttr(html, /(<meta name="twitter:description" content=")[^"]*(")/, description);
  const file = `dist${path}.html`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
console.log(`prerender-heads: wrote ${Object.keys(PAGES).length} pages`);
