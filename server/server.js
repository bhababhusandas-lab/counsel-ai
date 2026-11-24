import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OpenAI, toFile } from 'openai';
import nodemailer from 'nodemailer';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// ── AWS SDK ──────────────────────────────────────────────────────────────────
import {
  CognitoIdentityProviderClient,
  AdminConfirmSignUpCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, PutCommand, GetCommand,
  QueryCommand, UpdateCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { loadStatuteIndex, retrieveStatuteContext } from './statuteRag.js';
import { loadJudgmentIndex, retrieveJudgmentContext } from './judgmentRag.js';
import { citatorGuardNote } from './citator.js';
import { loadStateLawIndex, retrieveStateLawContext } from './stateLawRag.js';
import { loadStateFullTextIndex, retrieveStateFullText } from './stateFullTextRag.js';
import { loadSubordinateIndex, retrieveSubordinate } from './subordinateRag.js';
import { loadCaseLawIndex, retrieveCaseLaw } from './caseLawRag.js';
import { loadJudgmentTextIndex, retrieveJudgmentText, getFullJudgment } from './judgmentTextRag.js';
import { loadRegulationsIndex, retrieveRegulations } from './regulationsRag.js';
import { warmEmbedder } from './localEmbed.js';
import { generateDocument, listTemplates } from './documentGen.js';
import { generateCustomDocument, customDocAvailable } from './documentAI.js';
import { currencyBlock } from './actStatus.js';
import { codeMapNote, codeMapNewRefs } from './codeMap.js';
import geoip from 'geoip-lite';

const dnsResolve = dns.promises;

// ── Location-aware drafting ─────────────────────────────────────────────────
// Detect the user's Indian state from their IP, fully offline (geoip-lite bundles
// the MaxMind data — no API, no token, no cost). Used to draft state-appropriate
// documents (governing law, jurisdiction, stamp duty, rent-control act) instead of
// the model guessing a random state. Best-effort and approximate; the user can
// always override by naming a state.
const IN_STATES = {
  AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam',
  BR: 'Bihar', CH: 'Chandigarh', CT: 'Chhattisgarh', CG: 'Chhattisgarh', DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DD: 'Dadra and Nagar Haveli and Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana',
  HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala',
  LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya',
  MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', OD: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan',
  SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TS: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh',
  UT: 'Uttarakhand', UK: 'Uttarakhand', WB: 'West Bengal',
};
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = cf || xff || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
  return String(raw).replace(/^::ffff:/, '').trim();
}
// Returns the user's Indian state name, or null if it can't be determined
// (private/local IP, non-India, or unmapped region).
function stateFromReq(req) {
  try {
    const ip = clientIp(req);
    if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(ip)) return null;
    const geo = geoip.lookup(ip);
    if (!geo || geo.country !== 'IN') return null;
    return IN_STATES[(geo.region || '').toUpperCase()] || null;
  } catch { return null; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Global crash guards — prevent the process from dying on unhandled errors.
// Without these, a single bad API response kills the server until manual restart.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});

const app = express();
const port = process.env.PORT || 8080;

// Configure CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
// Handle pre-flight OPTIONS for all routes
app.options('*', cors());

// Increase limit for audio files
app.use(express.json({ limit: '50mb' }));

// LLM provider — OpenAI-compatible. Defaults to Grok (xAI), but is fully swappable
// to any OpenAI-compatible endpoint (a self-hosted vLLM/Ollama/TGI server running
// Llama/Qwen, etc.) by setting LLM_BASE_URL + LLM_API_KEY + LLM_MODEL. This is the
// single switch to drop the Grok API for a self-hosted model — no other code change.
const grok = new OpenAI({
  apiKey: process.env.LLM_API_KEY || process.env.GROK_API_KEY || process.env.XAI_API_KEY || 'not-needed',
  baseURL: process.env.LLM_BASE_URL || 'https://api.x.ai/v1',
});
console.log(`[llm] provider endpoint: ${process.env.LLM_BASE_URL || 'https://api.x.ai/v1 (Grok)'}`);

// xAI doesn't expose STT yet, so Whisper (OpenAI) handles speech-to-text only.
// All TTS goes through Google. Chat & courtroom remain 100% on Grok.
const whisperClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const GROK_MODEL = process.env.LLM_MODEL || process.env.GROK_MODEL || 'grok-4-fast-non-reasoning';
const GROK_STT_MODEL = process.env.GROK_STT_MODEL || 'whisper-1';

// Hinglish is EXPLICITLY excluded — it must use the Hindi TTS voice, not the English one.
const isEnglish = (lang) => !lang || (lang !== 'hinglish' && /^en(-|$)/i.test(lang));

// English routes through Google's British English Neural2 voice (en-GB-Neural2-C).
// Neural2 is Google's second-highest quality tier — natural, warm, professional female British accent.
// Chirp3-HD is not yet available for en-GB, so Neural2-C is the top available tier.
const ENGLISH_GOOGLE_VOICE = { languageCode: 'en-GB', name: 'en-GB-Neural2-C', ssmlGender: 'FEMALE' };

// Google Cloud Text-to-Speech — covers every major Indian language with native voices.
// OpenAI TTS speaks Indian scripts but with a heavy English accent; Google has dedicated
// language-specific voices that sound natural.
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

// Map of supported BCP-47 codes → highest-quality Google voice currently available.
// Quality tiers (best → worst): Chirp3-HD > Studio > Neural2 > Wavenet > Standard.
// Chirp3-HD voices ("Aoede" — warm female) are Google's MOST FLUENT generation and
// are now available in en-IN, hi-IN, bn-IN, ta-IN, te-IN, kn-IN, ml-IN, gu-IN, mr-IN.
// Wavenet is the fallback for less-supported languages (Punjabi, Urdu) and Standard
// for Odia (Google hasn't shipped higher tiers there yet).
const GOOGLE_VOICE_MAP = {
  'en-IN': { languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Indian English, Chirp3-HD (most fluent)
  'hi-IN': { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Hindi Chirp3-HD
  'hinglish': { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Hinglish → Hindi voice (authentic Indian accent)
  'bn-IN': { languageCode: 'bn-IN', name: 'bn-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Bengali Chirp3-HD
  'ta-IN': { languageCode: 'ta-IN', name: 'ta-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Tamil Chirp3-HD
  'te-IN': { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Telugu Chirp3-HD
  'kn-IN': { languageCode: 'kn-IN', name: 'kn-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Kannada Chirp3-HD
  'ml-IN': { languageCode: 'ml-IN', name: 'ml-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Malayalam Chirp3-HD
  'gu-IN': { languageCode: 'gu-IN', name: 'gu-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Gujarati Chirp3-HD
  'mr-IN': { languageCode: 'mr-IN', name: 'mr-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Marathi Chirp3-HD
  'pa-IN': { languageCode: 'pa-IN', name: 'pa-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Punjabi Chirp3-HD
  'ur-IN': { languageCode: 'ur-IN', name: 'ur-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Urdu Chirp3-HD
  // Google TTS has NO Odia or Assamese voice. Bengali is the closest relative and
  // renders both scripts intelligibly (verified: returns valid audio), so we route
  // them to the Bengali Chirp3-HD voice instead of erroring (or-IN-Standard-A does
  // not exist → 500) or mispronouncing with the English fallback voice.
  'or-IN': { languageCode: 'bn-IN', name: 'bn-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Odia → Bengali voice (no native Odia voice)
  'as-IN': { languageCode: 'bn-IN', name: 'bn-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' }, // Assamese → Bengali voice (near-identical script)
};

// Detect whether a voice supports SSML. Chirp3-HD voices DO NOT support SSML —
// they only accept plain text. Studio/Neural2/Wavenet/Standard all support SSML.
const isChirp3Voice = (voice) => /Chirp3/i.test(voice?.name || '');

// Per-language tuning. Chirp3-HD voices are already very natural at rate 1.0 and don't
// need pitch adjustment. Wavenet is a touch breezier so we slow it slightly + warm it.
const VOICE_TUNING = {
  'en-GB': { speakingRate: 1.0,  pitch: 0.0 },  // Neural2-C — British English, natural pace
  'en-US': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD — natural pace, no pitch shift needed
  'en-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'hi-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'bn-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'ta-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'te-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'kn-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'ml-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'gu-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'mr-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'pa-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'ur-IN': { speakingRate: 1.0,  pitch: 0.0 },  // Chirp3-HD
  'or-IN': { speakingRate: 0.93, pitch: 1.0 },  // Standard
};
const DEFAULT_TUNING = { speakingRate: 1.0, pitch: 0.0 };

// ── Courtroom character voices ────────────────────────────────────────────────
// Judge: 60+ yr old Indian male — deep, measured, authoritative.
//   en-IN-Wavenet-B is the deepest male Indian-English voice Google provides.
//   Wavenet supports SSML so we can push pitch down and slow the rate for gravitas.
// Opponent: 25 yr old Indian female lawyer — fluent, confident, natural pace.
//   Chirp3-HD Aoede is Google's highest-quality Indian-English female voice.
const COURTROOM_VOICE_CONFIG = {
  judge: {
    voice:  { languageCode: 'en-IN', name: 'en-IN-Wavenet-B', ssmlGender: 'MALE' },
    tuning: { speakingRate: 0.80, pitch: -5.0 }, // slow + very deep = elderly senior judge
  },
  opponent: {
    voice:  { languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' },
    tuning: { speakingRate: 1.10, pitch: 0.0 }, // slightly faster = sharp young lawyer (Chirp3 ignores pitch)
  },
};

// Role discipline for the AI Judge. Without this the model often makes the judge
// address ITSELF as "Your Honour" — that phrase belongs to lawyers/parties speaking
// TO the judge, never to the judge speaking. Injected into every judge prompt.
const JUDGE_SPEECH_RULES = `JUDGE SPEECH RULES (strict):
- You ARE the judge. NEVER refer to yourself as "Your Honour", "Your Lordship", or "My Lord" — those are how lawyers address you, not how you speak.
- Speak with the authority of the bench. Use phrases such as: "Counsel, proceed.", "The court will consider the evidence.", "Objection sustained.", "Objection overruled.", "Please continue your argument.", "This court finds...", "The bench notes...".
- Address the lawyers as "Counsel", "the Prosecution", or "the Defense" — never as "Your Honour".`;

const synthWithGoogle = async (input, language, voiceOverride, tuningOverride) => {
  const voice = voiceOverride || GOOGLE_VOICE_MAP[language] || GOOGLE_VOICE_MAP['en-IN'];
  const tuning = tuningOverride || VOICE_TUNING[voice.languageCode] || DEFAULT_TUNING;
  const chirp3 = isChirp3Voice(voice);

  // Chirp3-HD voices DO NOT accept SSML — they only accept { text }. If caller passed
  // an SSML payload but we're using a Chirp3 voice, downgrade to plain text by stripping tags.
  let inputPayload;
  if (typeof input === 'string') {
    inputPayload = { text: input };
  } else if (input?.ssml && chirp3) {
    // Strip SSML tags → plain text fallback for Chirp3
    const plain = input.ssml.replace(/<[^>]+>/g, '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    inputPayload = { text: plain };
  } else {
    inputPayload = input;
  }

  // Chirp3-HD ignores pitch + effectsProfileId + custom sampleRate; sending them returns 400.
  // For Chirp3 we send only audioEncoding + speakingRate. For other tiers we keep the EQ + boost.
  const audioConfig = chirp3
    ? {
        audioEncoding: 'MP3',
        speakingRate: tuning.speakingRate,
      }
    : {
        audioEncoding: 'MP3',
        speakingRate: tuning.speakingRate,
        pitch: tuning.pitch,
        sampleRateHertz: 24000,                       // 24kHz MP3 — Google's max for Neural2/Wavenet
        volumeGainDb: 1.5,                            // mild loudness boost so it sits well over background
        effectsProfileId: ['headphone-class-device'], // tuned EQ — clearer on phones, laptops, earbuds
      };

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: inputPayload, voice, audioConfig }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google TTS ${resp.status}: ${errText}`);
  }
  const json = await resp.json();
  return json.audioContent; // already base64 MP3
};

// Shared helper: strip any markdown the model might emit so output is always clean prose.
const stripMarkdown = (txt) => {
  if (!txt) return '';
  return txt
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ──────────────────────────────────────────────────────────────────────────────
// Number → English-words conversion.
// When a Telugu / Hindi / Tamil / etc. response contains digits like "154",
// the native-language TTS reads them with native digit names (e.g. Telugu reads
// "నూట యాభై నాలుగు"). Indian users overwhelmingly prefer English number reading
// in mixed legal contexts ("section one hundred fifty four"). So for ANY non-English
// TTS output we replace digit sequences with their English word form *before* synth.
const ONES_WORDS = ['', 'one','two','three','four','five','six','seven','eight','nine',
                    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS_WORDS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

const numUnder1000ToWords = (n) => {
  if (n === 0) return '';
  if (n < 20) return ONES_WORDS[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o ? `${TENS_WORDS[t]} ${ONES_WORDS[o]}` : TENS_WORDS[t];
  }
  const h = Math.floor(n / 100), rest = n % 100;
  return rest ? `${ONES_WORDS[h]} hundred ${numUnder1000ToWords(rest)}` : `${ONES_WORDS[h]} hundred`;
};

// Convert an integer string to English words. Uses western scale (thousand/million/billion).
// "154" → "one hundred fifty four"; "2024" → "two thousand twenty four"; "50000" → "fifty thousand"
const integerToEnglishWords = (numStr) => {
  const cleaned = numStr.replace(/,/g, '');
  if (!/^\d+$/.test(cleaned)) return numStr;
  let n = parseInt(cleaned, 10);
  if (!Number.isFinite(n)) return numStr;
  if (n === 0) return 'zero';
  // For absurdly large numbers, just spell each digit.
  if (n > 999999999999) {
    return cleaned.split('').map(d => ONES_WORDS[parseInt(d, 10)] || 'zero').join(' ');
  }
  const parts = [];
  const billions = Math.floor(n / 1000000000); n %= 1000000000;
  const millions = Math.floor(n / 1000000);    n %= 1000000;
  const thousands = Math.floor(n / 1000);      n %= 1000;
  if (billions) parts.push(numUnder1000ToWords(billions) + ' billion');
  if (millions) parts.push(numUnder1000ToWords(millions) + ' million');
  if (thousands) parts.push(numUnder1000ToWords(thousands) + ' thousand');
  if (n) parts.push(numUnder1000ToWords(n));
  return parts.join(' ').trim();
};

// Replace every digit sequence in text with its English word equivalent.
// Handles decimals ("12.5" → "twelve point five"), Indian-style commas ("1,00,000"),
// and digit-letter boundaries ("498A" → "four hundred ninety eight A").
//
// Regex: digits with embedded commas (each comma MUST be followed by digits) + optional decimal.
// This way "2024," matches only "2024" and the trailing comma stays in the text.
const digitsToEnglishWords = (txt) => {
  if (!txt) return txt;
  const out = txt.replace(/(\d+(?:,\d+)*)(?:\.(\d+))?/g, (match, intPart, decPart) => {
    const intWords = integerToEnglishWords(intPart) || match;
    let words;
    if (decPart) {
      const decWords = decPart.split('').map(d => ONES_WORDS[parseInt(d, 10)] || 'zero').join(' ');
      words = `${intWords} point ${decWords}`;
    } else {
      words = intWords;
    }
    // Pad with spaces so digit-glued letters/punctuation separate cleanly ("498A" → " four hundred ... A").
    return ` ${words} `;
  });
  // Collapse runs of whitespace introduced by the padding, and strip space before punctuation.
  return out.replace(/[ \t]+/g, ' ').replace(/ ([,.;:!?।])/g, '$1').trim();
};
// ──────────────────────────────────────────────────────────────────────────────

// Strip emojis + symbol pictographs so TTS doesn't verbalize them (e.g. avoid "smile face").
// Covers: faces, symbols, transport, flags, dingbats, misc symbols, supplemental.
const stripEmojis = (txt) => {
  if (!txt) return '';
  return txt
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u{FE0F}\u{200D}]/gu, '') // variation selector + zero-width joiner
    .replace(/\s{2,}/g, ' ') // collapse double-spaces left behind
    .trim();
};

// Words that look like acronyms but ARE pronounced as words. Don't spell these out.
const PRONOUNCED_AS_WORD = new Set([
  'NATO', 'NASA', 'AIDS', 'OPEC', 'OK', 'AICTE', 'NEET', 'CAT', 'GATE', 'JEE', 'UPSC',
  'IIT', 'IIM', 'AIIMS', 'IGNOU', 'NCERT', 'CBSE', 'ICSE',
]);

// Convert ALL-CAPS acronyms to spaced letters so TTS spells them out.
// "FIR" -> "F I R", "GST" -> "G S T". For OpenAI TTS (no SSML).
const spellAcronyms = (txt) => {
  if (!txt) return '';
  return txt.replace(/\b([A-Z]{2,5})\b/g, (match) => {
    if (PRONOUNCED_AS_WORD.has(match)) return match;
    return match.split('').join(' ');
  });
};

// Build SSML wrapping acronyms in <say-as interpret-as="characters"> for Google TTS.
// Google handles this far more naturally than splitting with spaces.
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const buildSSML = (txt) => {
  const escaped = escapeXml(txt);
  const wrapped = escaped.replace(/\b([A-Z]{2,5})\b/g, (match) => {
    if (PRONOUNCED_AS_WORD.has(match)) return match;
    return `<say-as interpret-as="characters">${match}</say-as>`;
  });
  return `<speak>${wrapped}</speak>`;
};

// Final TTS prep: strip markdown + emojis, then either build SSML (Google) or spell acronyms (OpenAI).
const prepForTTS = (txt, useSSML) => {
  const cleaned = stripEmojis(stripMarkdown(txt));
  return useSSML ? buildSSML(cleaned) : spellAcronyms(cleaned);
};

// Whisper bias prompt — multi-script primer so Whisper recognises legal terms
// across English + 9 Indian scripts and doesn't bias detection toward English.
// Whisper uses this as vocabulary hints, not as a language lock.
const WHISPER_LEGAL_PROMPT = [
  "Indian legal assistant. Multilingual: English, Hindi, Tamil, Telugu, Bengali, Kannada, Malayalam, Gujarati, Marathi, Punjabi, Urdu, Odia.",
  "Acronyms: FIR, IPC, BNS, CrPC, CPC, RTI, PIL, NRI, OCI, HUF, GST, PAN, TDS, ITR, IFSC, NEFT, RTGS, Aadhaar.",
  "Terms: advocate, plaintiff, defendant, magistrate, bail, anticipatory bail, summons, chargesheet, petition, affidavit, judgement, Supreme Court, High Court, Sessions Court, Lok Adalat, ombudsman.",
  "हिंदी: एफआईआर, धारा, अदालत, वकील, ज़मानत, याचिका, फैसला, गिरफ्तारी, समन, सुप्रीम कोर्ट.",
  "தமிழ்: காவல்துறை, புகார், நீதிமன்றம், வழக்கறிஞர், ஜாமீன்.",
  "తెలుగు: పోలీసు, న్యాయవాది, కోర్టు, బెయిల్.",
  "বাংলা: পুলিশ, আদালত, আইনজীবী, জামিন.",
  "ಕನ್ನಡ: ಪೊಲೀಸ್, ನ್ಯಾಯಾಲಯ, ವಕೀಲ, ಜಾಮೀನು.",
  "മലയാളം: പോലീസ്, കോടതി, വക്കീൽ, ജാമ്യം.",
  "ગુજરાતી: પોલીસ, અદાલત, વકીલ, જામીન.",
  "मराठी: पोलीस, न्यायालय, वकील, जामीन.",
  "ਪੰਜਾਬੀ: ਪੁਲਿਸ, ਅਦਾਲਤ, ਵਕੀਲ, ਜ਼ਮਾਨਤ.",
].join(' ');

// Map ISO-639-1 (what Whisper returns: 'hi', 'ta') → BCP-47 (what our voice map keys on: 'hi-IN', 'ta-IN').
const ISO_TO_BCP47 = {
  en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN',
  kn: 'kn-IN', ml: 'ml-IN', gu: 'gu-IN', mr: 'mr-IN', pa: 'pa-IN',
  ur: 'ur-IN', or: 'or-IN',
};
const normalizeDetectedLang = (whisperLang) => {
  if (!whisperLang) return 'en-IN';
  const iso = String(whisperLang).toLowerCase().slice(0, 2);
  return ISO_TO_BCP47[iso] || 'en-IN';
};

// Map BCP-47 / detected codes to the ISO-639-1 codes Whisper accepts (for OPTIONAL hint only —
// we now prefer letting Whisper auto-detect so the customer can speak any language).
const toWhisperLang = (lang) => {
  if (!lang) return undefined;
  const m = String(lang).toLowerCase().match(/^([a-z]{2})/);
  return m ? m[1] : undefined;
};

// Split text into sentence-aligned chunks where each chunk's SSML form fits Google's ~5000 byte limit.
// Returns array of strings, each safe to wrap in <speak>...</speak>.
const SSML_CHUNK_BUDGET = 4500;
const chunkForTTS = (text) => {
  const cleaned = stripEmojis(stripMarkdown(text));
  if (!cleaned) return [];
  // Estimate SSML overhead per acronym wrapping; target ~3500 chars of plain text per chunk.
  const TARGET = 3200;
  // Split on sentence boundaries: . ! ? । (Devanagari purna viram), keeping the delimiter.
  const sentences = cleaned.split(/(?<=[.!?।]|[\u0964\u0965])\s+/);
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if (!s) continue;
    // If a single sentence is itself too long, hard-split on commas / spaces.
    if (s.length > TARGET) {
      if (buf) { chunks.push(buf); buf = ''; }
      let remaining = s;
      while (remaining.length > TARGET) {
        let cut = remaining.lastIndexOf(',', TARGET);
        if (cut < TARGET * 0.5) cut = remaining.lastIndexOf(' ', TARGET);
        if (cut < 1) cut = TARGET;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) buf = remaining;
      continue;
    }
    if ((buf + ' ' + s).length > TARGET) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = buf ? buf + ' ' + s : s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
};

// Synthesize FULL text by chunking + Google TTS per chunk + concatenating MP3 buffers.
// MP3 frames concatenate cleanly, so the result plays as one continuous audio stream.
//
// Branches on voice tier:
//   - Chirp3-HD voices: send PLAIN TEXT with acronyms spelled out via spaces (no SSML support).
//   - Studio/Neural2/Wavenet/Standard: send SSML with <say-as interpret-as="characters"> wrapping
//     for natural acronym pronunciation.
//
// Number handling: native Chirp3-HD voices read digits correctly IN THEIR OWN
// language (Telugu reads "138" as Telugu, Tamil as Tamil, etc.). The previous
// approach converted digits to English WORDS ("one hundred thirty eight"), which
// forced the native voice to speak English mid-sentence — that was the source of
// the "mispronounced words" in Telugu/Tamil/Odia/Assamese. We now leave digits
// as-is so every voice pronounces numbers naturally in its own language.
const synthFullWithGoogle = async (text, language, voiceOverride, tuningOverride) => {
  const textForTTS = text;
  const chunks = chunkForTTS(textForTTS);
  if (chunks.length === 0) throw new Error('Empty text after cleanup');
  const voice = voiceOverride || GOOGLE_VOICE_MAP[language] || GOOGLE_VOICE_MAP['en-IN'];
  const chirp3 = isChirp3Voice(voice);
  const buffers = [];
  for (const chunk of chunks) {
    let payload;
    if (chirp3) {
      // Chirp3 path: plain text with spaced-out acronyms (e.g. "F I R" instead of <say-as>)
      payload = spellAcronyms(chunk);
    } else {
      // SSML path
      payload = { ssml: buildSSML(chunk).slice(0, SSML_CHUNK_BUDGET) };
    }
    const b64 = await synthWithGoogle(payload, language, voiceOverride, tuningOverride);
    buffers.push(Buffer.from(b64, 'base64'));
  }
  return Buffer.concat(buffers).toString('base64');
};


// Helper for language instructions
const getLanguageInstructions = (lang) => {
  const langMap = {
    // ── English variants ────────────────────────────────────────────────────
    'en-IN': 'Reply ONLY in English. Do NOT use Hindi, Hinglish, or any other language. Use simple, clear English.',
    'en-GB': 'Reply ONLY in English. Do NOT use Hindi, Hinglish, or any other language. Use simple, clear English.',
    'en-US': 'Reply ONLY in English. Do NOT use Hindi, Hinglish, or any other language. Use simple, clear English.',
    // ── Indian languages ────────────────────────────────────────────────────
    'hi-IN':    'Reply ONLY in Hindi (Devanagari script). Do NOT mix English sentences — legal terms (FIR, IPC, GST) may stay in English.',
    'hinglish': 'Reply in Hinglish — mix Hindi and English naturally, the way urban Indians speak.',
    'ta-IN':    'Reply ONLY in Tamil (தமிழ்). Do NOT use any other language.',
    'te-IN':    'Reply ONLY in Telugu (తెలుగు). Do NOT use any other language.',
    'bn-IN':    'Reply ONLY in Bengali (বাংলা). Do NOT use any other language.',
    'mr-IN':    'Reply ONLY in Marathi (मराठी). Do NOT use any other language.',
    'gu-IN':    'Reply ONLY in Gujarati (ગુજરાતી). Do NOT use any other language.',
    'kn-IN':    'Reply ONLY in Kannada (ಕನ್ನಡ). Do NOT use any other language.',
    'ml-IN':    'Reply ONLY in Malayalam (മലയാളം). Do NOT use any other language.',
    'pa-IN':    'Reply ONLY in Punjabi (ਪੰਜਾਬੀ). Do NOT use any other language.',
    'or-IN':    'Reply ONLY in Odia (ଓଡ଼ିଆ). Do NOT use any other language.',
    'as-IN':    'Reply ONLY in Assamese (অসমীয়া). Do NOT use any other language.',
    'ur-IN':    'Reply ONLY in Urdu (اردو). Do NOT use any other language.',
    // ── International ───────────────────────────────────────────────────────
    'es-ES': 'Reply ONLY in Spanish (Español).',
    'fr-FR': 'Reply ONLY in French (Français).',
    'de-DE': 'Reply ONLY in German (Deutsch).',
    'it-IT': 'Reply ONLY in Italian (Italiano).',
    'pt-PT': 'Reply ONLY in Portuguese (Português).',
    'ru-RU': 'Reply ONLY in Russian (Русский).',
    'ja-JP': 'Reply ONLY in Japanese (日本語).',
    'ko-KR': 'Reply ONLY in Korean (한국어).',
    'zh-CN': 'Reply ONLY in Chinese (Simplified) (简体中文).',
    'ar-SA': 'Reply ONLY in Arabic (العربية).',
  };
  const base = langMap[lang] || 'Reply ONLY in English. Do NOT use Hindi or Hinglish.';
  // Hinglish is intentionally mixed — every other language gets a strict
  // no-drift / finish-completely clause. This stops Punjabi drifting into Hindi,
  // Hindi drifting into Hinglish, and answers ending before the last sentence.
  // Anti-refusal is CRITICAL and applies to EVERY language (including Hinglish):
  // the model must never reject the user or demand they rewrite their question.
  const antiRefusal = `

NEVER REFUSE: You can READ and UNDERSTAND the user's question no matter what language or script they typed it in (Assamese, Odia, Bengali, Tamil, etc.). ALWAYS answer their actual question. Do NOT say "I can only respond in X", do NOT ask them to rewrite their question in another language, and do NOT reject the message. Just understand it and reply helpfully.`;

  // Confusable-language PURITY guards. Several Indian languages are close cousins
  // (Bengali/Assamese share a script; Hindi/Marathi share Devanagari; Punjabi and
  // Telugu often absorb Hindi words). The model tends to bleed one into the other,
  // so we name the specific language to avoid for each.
  const CONFUSABLE_PURITY = {
    'bn-IN': ' PURITY: Use standard Bengali (বাংলা) ONLY. Do NOT use Assamese words or the Assamese-only letters ৰ/ৱ — use Bengali র/ব.',
    'as-IN': ' PURITY: Use Assamese (অসমীয়া) ONLY, with Assamese word-forms and ৰ/ৱ. Do NOT slip into standard Bengali.',
    'hi-IN': ' PURITY: Use standard Hindi ONLY. Do NOT use Marathi or Urdu words.',
    'mr-IN': ' PURITY: Use Marathi ONLY (आहे, आणि, मला...). Do NOT use Hindi words (है, और, मुझे...).',
    'te-IN': ' PURITY: Use Telugu ONLY. Do NOT mix in Hindi or English words.',
    'pa-IN': ' PURITY: Use Punjabi ONLY. Do NOT mix in Hindi words.',
    'or-IN': ' PURITY: Use Odia ONLY. Do NOT mix in Hindi or Bengali words.',
    'gu-IN': ' PURITY: Use Gujarati ONLY. Do NOT mix in Hindi words.',
  };
  const purity = CONFUSABLE_PURITY[lang] || '';

  if (lang === 'hinglish') return base + antiRefusal;
  return `${base}

LANGUAGE LOCK: Write your ENTIRE answer in this one language — first word to last. Do NOT switch to Hindi, English, or any other language partway through, not even for a single phrase. Finish every sentence and complete your full thought before stopping; never end mid-sentence.${purity}${antiRefusal}`;
};

// Shared reminder that India's criminal laws changed on 1 July 2024. Injected into
// the courtroom (Discussion room) prompts so the AI judge/lawyers argue on current law.
const CURRENT_LAW_NOTE = `IMPORTANT — CURRENT LAW: As of 1 July 2024, India's criminal laws are the Bharatiya Nyaya Sanhita 2023 (BNS, replaced IPC), Bharatiya Nagarik Suraksha Sanhita 2023 (BNSS, replaced CrPC), and Bharatiya Sakshya Adhiniyam 2023 (BSA, replaced the Evidence Act). Use these current laws as primary and, where helpful, note the old IPC/CrPC equivalent in brackets. Laws that were not replaced (e.g. Negotiable Instruments Act, Consumer Protection Act) stay unchanged.`;

// 1. Chat Endpoint — alias to /functions/v1/legal-chat
app.post('/api/chat', (req, res) => {
  req.url = '/functions/v1/legal-chat';
  app.handle(req, res);
});

// 2. Speech-to-Text Endpoint (Whisper-1)
// Primed with Indian legal vocabulary so it transcribes acronyms like "FIR" / "IPC" correctly.
// If the client passes a language hint we use it; otherwise Whisper auto-detects.
app.post('/api/voice', async (req, res) => {
  try {
    if (!whisperClient) {
      return res.status(501).json({ error: 'Speech-to-text requires OPENAI_API_KEY to be configured on the server.' });
    }
    const { audio, mimeType, language } = req.body;

    if (!audio) {
      return res.status(400).json({ error: "No audio data" });
    }

    const buffer = Buffer.from(audio, 'base64');

    let extension = 'webm';
    if (mimeType?.includes('mp4') || mimeType?.includes('m4a')) extension = 'm4a';
    if (mimeType?.includes('wav')) extension = 'wav';
    if (mimeType?.includes('mp3') || mimeType?.includes('mpeg')) extension = 'mp3';

    const file = await toFile(buffer, `audio.${extension}`, { type: mimeType || 'audio/webm' });

    // No language hint → Whisper auto-detects from audio. Customer can speak ANY of the
    // 10+ supported languages and Whisper will pick the right one. The legal prompt is
    // multi-script so it primes vocabulary across all of them without biasing detection.
    const transcription = await whisperClient.audio.transcriptions.create({
      file,
      model: GROK_STT_MODEL,
      response_format: "verbose_json",
      prompt: WHISPER_LEGAL_PROMPT,
    });

    res.json({
      text: transcription.text,
      detectedLanguage: normalizeDetectedLang(transcription.language),
      detectedLanguageRaw: transcription.language,
      ok: true
    });

  } catch (error) {
    console.error('Voice error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Text-to-Speech Endpoint — Google TTS only.
// SSML wraps ALL-CAPS acronyms (FIR -> "F I R") and emojis are stripped before synthesis.
// FULL answer is synthesized via sentence-aware chunking + MP3 concatenation,
// so long responses are never truncated mid-sentence.
app.post('/api/speak', async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });
    if (!GOOGLE_TTS_API_KEY) return res.status(501).json({ error: 'GOOGLE_TTS_API_KEY not configured.' });

    const english = isEnglish(language);
    const voiceOverride = english ? ENGLISH_GOOGLE_VOICE : undefined;
    const audioContent = await synthFullWithGoogle(text, english ? 'en-US' : language, voiceOverride);
    res.json({ audioContent, provider: 'google' });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Workflow Endpoint (Chained: Audio -> STT -> Chat -> TTS)
app.post('/api/workflow', async (req, res) => {
  try {
    if (!whisperClient) return res.status(501).json({ error: 'Speech-to-text requires OPENAI_API_KEY.' });
    const { audio, mimeType } = req.body;

    if (!audio) return res.status(400).json({ error: "No audio data" });

    // Step 1: STT (with legal vocabulary primer)
    const buffer = Buffer.from(audio, 'base64');
    const extension = mimeType?.includes('mp4') ? 'm4a' : 'webm';
    const file = await toFile(buffer, `audio.${extension}`, { type: mimeType || 'audio/webm' });

    const transcription = await whisperClient.audio.transcriptions.create({
      file,
      model: GROK_STT_MODEL,
      prompt: WHISPER_LEGAL_PROMPT,
    });
    
    const userText = transcription.text;
    
    // Step 2: Chat via Grok
    const chatCompletion = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: 'You are Counsel AI, an Indian legal assistant. Reply in clear plain language, no markdown.' },
        { role: 'user', content: userText }
      ],
      max_tokens: 600,
      temperature: 0.4,
    });
    const aiText = chatCompletion.choices[0]?.message?.content || "Okay.";

    // Step 3: Full-answer TTS via Google (sentence-aware chunking → no truncation)
    if (!GOOGLE_TTS_API_KEY) return res.status(501).json({ error: 'GOOGLE_TTS_API_KEY not configured.' });
    const detectedLang = normalizeDetectedLang(transcription.language);
    const english = isEnglish(detectedLang);
    const voiceOverride = english ? ENGLISH_GOOGLE_VOICE : undefined;
    const audioContent = await synthFullWithGoogle(aiText, english ? 'en-US' : detectedLang, voiceOverride);

    res.json({
      userText,
      aiText,
      audioResponse: audioContent // already base64 MP3
    });

  } catch (error) {
    console.error('Workflow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Courtroom AI Endpoint
app.post('/functions/v1/courtroom-ai', async (req, res) => {
  try {
    const { action, documentContent, caseAnalysis, phase, previousArguments, userRole, userMessage, language } = req.body;

    const getLanguageInstruction = (lang) => {
      const langMap = {
        'hi-IN': 'Respond entirely in Hindi (Devanagari script). Use formal legal Hindi terminology.',
        'bn-IN': 'Respond entirely in Bengali (বাংলা script). Use formal legal Bengali terminology.',
        'ta-IN': 'Respond entirely in Tamil (தமிழ் script). Use formal legal Tamil terminology.',
        'te-IN': 'Respond entirely in Telugu (తెలుగు script). Use formal legal Telugu terminology.',
        'mr-IN': 'Respond entirely in Marathi (मराठी script). Use formal legal Marathi terminology.',
        'gu-IN': 'Respond entirely in Gujarati (ગુજરાતી script). Use formal legal Gujarati terminology.',
        'kn-IN': 'Respond entirely in Kannada (ಕನ್ನಡ script). Use formal legal Kannada terminology.',
        'ml-IN': 'Respond entirely in Malayalam (മലയാളം script). Use formal legal Malayalam terminology.',
        'pa-IN': 'Respond entirely in Punjabi (ਪੰਜਾਬੀ script). Use formal legal Punjabi terminology.',
        'or-IN': 'Respond entirely in Odia (ଓଡ଼ିଆ script). Use formal legal Odia terminology.',
        'as-IN': 'Respond entirely in Assamese (অসমীয়া script). Use formal legal Assamese terminology.',
        'ur-IN': 'Respond entirely in Urdu (اردو script). Use formal legal Urdu terminology.',
        'hi-EN': 'Respond in Hinglish (Hindi words written in English/Roman script mixed with English).',
      };
      const base = langMap[lang] || 'Respond in English. Use clear legal English terminology.';
      if (lang === 'hi-EN' || !langMap[lang]) return base;
      return `${base} LANGUAGE LOCK: Keep the ENTIRE statement in this one language from first word to last — never switch to Hindi or English partway, and finish every sentence completely.`;
    };

    const callAI = async (messages, maxTokens = 1500) => {
      const completion = await grok.chat.completions.create({
        model: GROK_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      });
      return completion.choices[0]?.message?.content || '';
    };

    const langInstruction = getLanguageInstruction(language || 'en-IN');

    if (action === 'analyze') {
      const rawDoc = (documentContent || '').trim();
      // Reject empty or trivially short input — otherwise the LLM hallucinates a
      // fake case and the placeholder fallback ('Case Analysis') hides the bug.
      if (rawDoc.replace(/\s+/g, '').length < 40) {
        return res.status(400).json({
          error: 'document_too_short',
          message: 'The uploaded document has no extractable text (it may be a scanned image PDF) or is too short to analyze. Please paste case details manually or upload a text-based document.',
        });
      }
      const docContent = rawDoc.slice(0, 60000);
      const content = await callAI([
        {
          role: 'system',
          content: `You are an expert Indian legal case analyzer. Analyze the provided legal documents and extract structured information. You must respond in valid JSON format only, no markdown. ${langInstruction} ${CURRENT_LAW_NOTE} — but keep JSON keys in English, only values should be in the selected language.`
        },
        {
          role: 'user',
          content: `Analyze these legal documents and return a JSON object with these exact keys:
{
  "caseType": "string - type of case",
  "caseTitle": "string - brief title for the case",
  "parties": { "complainant": "string", "accused": "string" },
  "keyIssues": ["array of key legal issues"],
  "evidenceSummary": ["array of key evidence points"],
  "claims": ["array of claims by complainant"],
  "counterClaims": ["array of potential counterclaims"],
  "applicableLaws": ["array of relevant laws/sections"],
  "caseSummary": "string - 3-4 sentence summary of the case"
}

Documents:
${docContent}`
        }
      ], 2000);

      let parsed;
      try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = { caseSummary: content, caseType: 'General', caseTitle: 'Case Analysis', parties: { complainant: 'Party A', accused: 'Party B' }, keyIssues: [], evidenceSummary: [], claims: [], counterClaims: [], applicableLaws: [] };
      }
      return res.json({ analysis: parsed });
    }

    if (action === 'simulate_phase') {
      const analysis = JSON.stringify(caseAnalysis);
      const prevArgs = (previousArguments || []).map(a => `[${a.speaker}]: ${a.content}`).join('\n') || 'None yet.';
      const opponentRole = userRole === 'complainant' ? 'Defense Lawyer' : 'Prosecution Lawyer';

      const phasePrompts = {
        // ── Session start ────────────────────────────────────────────────────
        case_introduction: { speaker: 'Judge', prompt: 'You are an AI Judge in an Indian courtroom. Introduce the case formally. State the case type, parties involved, and the charges/claims. Be authoritative but neutral. 4-6 sentences.' },

        // ── Opening statements ───────────────────────────────────────────────
        opening_prosecution: { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI) in an Indian courtroom. The user is representing the other side as their own lawyer. Deliver your opening statement. Present key claims or defense strategy, outline evidence. Be persuasive but factual. 5-7 sentences.` },
        opening_defense: { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI) in an Indian courtroom. Deliver your opening statement. Challenge the other side's claims or outline your defense strategy. Be assertive and logical. 5-7 sentences.` },

        // ── Phase transitions (Judge announces moving to next phase) ─────────
        opening_transition:     { speaker: 'Judge', prompt: 'You are the AI Judge. The opening statements phase has concluded. Formally announce the transition into the examination phase. Summarize what was established in the openings in 1-2 sentences, then declare the examination phase open. 3-4 sentences total.' },
        examination_transition: { speaker: 'Judge', prompt: 'You are the AI Judge. The examination phase has concluded. Formally announce the transition into the closing arguments phase. Briefly note the key evidence discussed. 3-4 sentences.' },
        closing_transition:     { speaker: 'Judge', prompt: 'You are the AI Judge. The court is now entering the closing arguments phase. Formally announce this and remind both sides they have one final opportunity to address the court. 2-3 sentences.' },
        verdict_transition:     { speaker: 'Judge', prompt: 'You are the AI Judge. All arguments have been heard. Formally announce the court is rising for deliberation and that the verdict will be pronounced shortly. 2-3 sentences.' },

        // ── Evidence & arguments ─────────────────────────────────────────────
        evidence_presentation: { speaker: 'Judge', prompt: 'You are the AI Judge. Review and present key evidence from both sides. Summarize what each piece suggests, note gaps or inconsistencies. 6-8 sentences.' },
        prosecution_argument:  { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI). Present main legal arguments. Cite relevant Indian laws. Connect evidence to your claims. Be thorough and persuasive. 6-8 sentences.` },
        defense_argument:      { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI). Present counter-arguments. Challenge the other side's reasoning. Cite defense-favorable laws. Be thorough and persuasive. 6-8 sentences.` },

        // ── Judge interaction ────────────────────────────────────────────────
        judge_questions:       { speaker: 'Judge', prompt: 'You are the AI Judge. Ask 3-4 critical questions addressed to BOTH sides. Format as numbered questions specifying who they are directed to.' },
        judge_reaction:        { speaker: 'Judge', prompt: `You are the AI Judge. A party in the case has just presented an argument. Based on the most recent argument in the proceedings, acknowledge it, note its legal merit briefly, and direct the ${opponentRole} to respond. Be formal, fair, and neutral. 2-4 sentences.` },
        opponent_answer_judge: { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI). Answer the questions directed to your side thoroughly, citing law and evidence. 4-6 sentences.` },

        // ── Closing ──────────────────────────────────────────────────────────
        closing_prosecution: { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI). Deliver closing statement. Summarize strongest points and explain why your side should prevail. 5-7 sentences.` },
        closing_defense:     { speaker: opponentRole, prompt: `You are the ${opponentRole} (AI). Deliver closing statement. Summarize why your side should prevail. Be convincing. 5-7 sentences.` },

        // ── Private advisor hint (shown only to the user, not the court) ─────
        private_advisor_hint: { speaker: 'Advisor', prompt: `You are a private legal advisor giving a confidential strategic tip to the user. Based on what has been argued so far in the proceedings, give 1-2 specific, actionable suggestions to strengthen the user's position. Be concise, practical, and encouraging. Do NOT address the judge or opponent — speak directly to the user as their private counsel. 3-5 sentences.` },
      };

      const config = phasePrompts[phase] || { speaker: 'Judge', prompt: 'You are the AI Judge. Provide a brief neutral update on the state of the court proceedings. 2-3 sentences.' };

      const roleRules = config.speaker === 'Judge' ? `\n\n${JUDGE_SPEECH_RULES}` : '';

      const content = await callAI([
        {
          role: 'system',
          content: `${config.prompt}${roleRules}\n\n${langInstruction}\n\nCase Analysis: ${analysis}\n\nPrevious proceedings:\n${prevArgs}\n\nIMPORTANT: Do NOT use any markdown formatting. Write in plain conversational court language. Stay strictly within Indian legal framework. ${CURRENT_LAW_NOTE}`
        },
        {
          role: 'user',
          content: `Proceed with the ${(phase || '').replace(/_/g, ' ')} phase of this courtroom hearing.`
        }
      ], 1200);

      return res.json({ speaker: config.speaker, phase, content: stripMarkdown(content) });
    }

    if (action === 'user_argument') {
      const analysis = JSON.stringify(caseAnalysis);
      const prevArgs = (previousArguments || []).map(a => `[${a.speaker}]: ${a.content}`).join('\n') || '';
      const opponentRole = userRole === 'complainant' ? 'Defense Lawyer' : 'Prosecution Lawyer';

      // Accept both key names: 'userArgument' (from client) and 'userMessage' (legacy)
      const userMsg = req.body.userArgument || userMessage || '';

      // The judge first decides HOW to respond, so the court never gets stuck
      // looping on non-arguments:
      //   • a genuine legal submission  -> acknowledge + the opponent rebuts;
      //   • abuse / contempt (e.g. cursing the judge) -> a firm warning, NO rebuttal;
      //   • REPEAT contempt, or a party resting / with nothing further -> close the
      //     arguments and move the court to judgment (verdictReady).
      const judgeRaw = await callAI([
        {
          role: 'system',
          content: `You are the AI Judge in an Indian courtroom. The ${userRole === 'complainant' ? 'complainant' : 'accused'} (acting as their own lawyer) has just said: "${userMsg}".

Decide how the court responds, following these rules strictly:
- GENUINE ARGUMENT: if it is a real legal submission about this case, acknowledge it, briefly note its legal merit, and direct the ${opponentRole} to respond. -> opponentShouldRespond true, verdictReady false.
- IRRELEVANT / OFF-TOPIC: if it is unrelated to the case, evasive, gibberish, small talk, or says nothing of legal substance (but is not abusive), do NOT treat it as an argument and do NOT invite a rebuttal. In one or two sentences, politely direct the party to address the matter before the court and make a proper legal submission on this case. -> opponentShouldRespond false, verdictReady false.
- CONTEMPT / ABUSE: if it is abusive, insulting, threatening, or shows contempt for the court (for example cursing or insulting the judge), do NOT treat it as an argument and do NOT invite a rebuttal. Firmly warn that such language is contempt of court and instruct the party to maintain decorum. -> opponentShouldRespond false, verdictReady false.
- ENOUGH IS ENOUGH: if the proceedings below show you have ALREADY redirected or warned this party at least once for irrelevance, evasion, or contempt, and they are STILL not making a relevant legal submission — OR the party rests / has nothing further to add — then close the arguments: state briefly that the party has had the opportunity to address the court, that arguments are now concluded, and that the court will rise to deliver its judgment. -> opponentShouldRespond false, verdictReady true.

CRITICAL: Never repeat a sentence or phrase you have already used earlier in the proceedings below. If you have already made a point once, do NOT say it again in similar words — either escalate to closing the arguments, or move the proceedings forward. Vary your wording every time.

${JUDGE_SPEECH_RULES}

${langInstruction}

Case Analysis: ${analysis}

Previous proceedings:
${prevArgs}

Reply with ONLY a JSON object, no markdown and no text outside it:
{"judgeStatement": "<what the judge says aloud, plain conversational court language, 2-5 sentences>", "opponentShouldRespond": true or false, "verdictReady": true or false}

${CURRENT_LAW_NOTE}`
        },
        { role: 'user', content: 'Respond as the judge and return only the JSON.' }
      ], 700);

      // Parse the decision; on any parse failure fall back to a normal argument.
      let judgeStatement = '', opponentShouldRespond = true, verdictReady = false;
      try {
        const j = JSON.parse(String(judgeRaw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        judgeStatement = String(j.judgeStatement || '').trim();
        opponentShouldRespond = j.opponentShouldRespond !== false;
        verdictReady = j.verdictReady === true;
      } catch {
        judgeStatement = stripMarkdown(String(judgeRaw));
      }
      if (!judgeStatement) judgeStatement = stripMarkdown(String(judgeRaw));
      if (verdictReady) opponentShouldRespond = false; // court is closing — no rebuttal

      // Only summon a rebuttal for a genuine argument.
      let cleanRebuttal = '';
      if (opponentShouldRespond) {
        const rebuttalContent = await callAI([
          {
            role: 'system',
            content: `You are the ${opponentRole} in an Indian courtroom. The opposing party just argued: "${userMsg}". The judge has acknowledged it. Now deliver a strong, evidence-based rebuttal. Challenge their points using law, evidence, and logic. 4-6 sentences.\n\n${langInstruction}\n\nCase Analysis: ${analysis}\n\nPrevious proceedings:\n${prevArgs}\n\nJudge's response: ${judgeStatement}\n\nIMPORTANT: Do NOT use any markdown. Plain conversational court language only. ${CURRENT_LAW_NOTE}`
          },
          { role: 'user', content: "Deliver your rebuttal to the user's argument." }
        ], 900);
        cleanRebuttal = stripMarkdown(rebuttalContent);
      }

      const cleanJudge = stripMarkdown(judgeStatement);

      // `concludeCase` tells the client to move straight to the verdict.
      return res.json({
        content:      cleanRebuttal,   // opponent's rebuttal ('' when none) — client reads as oppText
        judgeContent: cleanJudge,      // judge's reaction — client uses directly
        dialogue:     cleanRebuttal,   // alias for older client code
        concludeCase: verdictReady,
        responses: [
          { speaker: 'Judge', content: cleanJudge, phase: 'Judge Response' },
          ...(cleanRebuttal ? [{ speaker: opponentRole, content: cleanRebuttal, phase: 'Rebuttal' }] : []),
        ]
      });
    }

    if (action === 'judgment') {
      const analysis = JSON.stringify(caseAnalysis);
      // The self-represented party is the complainant or the accused, per their role.
      // The judgment must name parties by their courtroom role, never as "the user".
      const selfParty = userRole === 'complainant' ? 'the complainant' : 'the accused';
      const oppParty  = userRole === 'complainant' ? 'the accused (represented by defence counsel)' : 'the complainant (represented by prosecution counsel)';
      // Relabel the transcript by courtroom role so the judge attributes conduct and
      // arguments to the correct party (the 'USER (COUNSEL)' speaker is the self-rep party).
      const selfSpeaker = userRole === 'complainant' ? 'Complainant (in person)' : 'Accused (in person)';
      const oppSpeaker  = userRole === 'complainant' ? 'Defence Counsel' : 'Prosecution Counsel';
      const roleLabel = (sp) => {
        const s = String(sp || '');
        if (/user/i.test(s)) return selfSpeaker;
        if (/opponent/i.test(s)) return oppSpeaker;
        return s; // Judge, etc.
      };
      const allArgs = (previousArguments || []).map(a => `[${roleLabel(a.speaker)}]: ${a.content}`).join('\n\n') || '';

      const content = await callAI([
        {
          role: 'system',
          content: `You are an AI Judge delivering a final judgment in an Indian courtroom simulation. In this hearing ${selfParty} argued in person, and ${oppParty} was represented by counsel. Refer to every party ONLY by their role in the case (for example "the complainant", "the accused", "the defence") — NEVER call anyone "the user". You must be completely neutral and base your judgment strictly on law, evidence, and logical reasoning.\n\n${JUDGE_SPEECH_RULES}\n\n${langInstruction}\n\nStructure your judgment as follows (use plain text, no markdown):\n\nCASE SUMMARY:\n[2-3 sentences summarizing the case]\n\nLEGAL ANALYSIS:\n[Analysis of the legal issues and applicable laws]\n\nEVALUATION OF ARGUMENTS:\n[Assessment of the arguments presented by each party, named by their role]\n\nEVALUATION OF EVIDENCE:\n[Assessment of evidence presented by both sides]\n\nAPPLICATION OF LAW:\n[How the relevant laws apply to the facts]\n\nREASONING:\n[Your logical reasoning for the decision]\n\nCONDUCT DURING PROCEEDINGS:\n[If any party used abusive, insulting or contemptuous language during the hearing — for example cursing or insulting the court — record it here, naming the offending party by their courtroom role (e.g. "the accused" or "the complainant"), NOT as "the user". Note that the court observed such language, that it was warned, that it amounts to contempt of court and has been disregarded as it bears nothing on the legal merits, and whether the party persisted. If the conduct was proper throughout, state in one line that the proceedings were conducted with due decorum.]\n\nFINAL DECISION:\n[Clear statement of the judgment — who prevails and the relief granted or denied]\n\nCOSTS:\n[State the order as to costs in line with Indian practice — for example whether costs are awarded to the successful party and any amount, or that there is no order as to costs, with a one-line reason]\n\nSUGGESTED NEXT STEPS:\n[2-3 practical steps for the parties, including any timeline or forum to approach]\n\nCase Analysis: ${analysis}\n\nFull proceedings:\n${allArgs}\n\nIMPORTANT: Be fair, neutral, and thorough. Do not fabricate legal sections. ${CURRENT_LAW_NOTE}`
        },
        { role: 'user', content: 'Deliver the final judgment for this case.' }
      ], 2500);

      return res.json({ judgment: stripMarkdown(content) });
    }

    return res.json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Courtroom AI error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Legal Chat function endpoint (used by frontend invokeFunction('legal-chat'))
// Retrieval-only endpoint — returns the grounded sources + raw retrieved text for a
// query WITHOUT calling the LLM. Reuses the already-loaded indexes, so it adds no
// memory and costs nothing (no Grok call). Used for zero-cost data/eval testing.
app.post('/functions/v1/retrieve', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    const sources = [];
    const collect = (ctx, type, n = 2) => {
      if (!ctx) return;
      const blocks = ctx.split('\n\n');
      for (const b of blocks.slice(0, n)) {
        const first = b.split('\n')[0].trim();
        const m = first.match(/^\[([^\]]+)\]\s*(.*)$/);
        let label = m ? (m[2] ? `${m[1].trim()} — ${m[2].trim()}` : m[1].trim()) : first;
        label = label.trim();
        if (label && label.length > 3 && !sources.some(s => s.label === label)) {
          sources.push({ type, label: label.slice(0, 160) });
        }
      }
    };
    let raw = '';
    const timings = {};
    const timed = (name, fn) => (async () => { const t = Date.now(); try { return await fn(message); } finally { timings[name] = Date.now() - t; } })();
    try {
      const [statuteContext, judgmentContext, stateLawContext, stateFullText, subordinateContext, caseLawContext, judgmentTextContext, regulationsContext] = await Promise.all([
        timed('statute', retrieveStatuteContext),
        timed('judgment', retrieveJudgmentContext),
        timed('stateLaw', retrieveStateLawContext),
        timed('stateFullText', retrieveStateFullText),
        timed('subordinate', retrieveSubordinate),
        timed('caseLaw', retrieveCaseLaw),
        timed('judgmentText', retrieveJudgmentText),
        timed('regulations', retrieveRegulations),
      ]);
      collect(statuteContext, 'Act / Section', 2);
      collect(stateFullText, 'State Act', 1);
      collect(subordinateContext, 'Rule / Notification', 1);
      collect(judgmentContext, 'Supreme Court', 1);
      collect(stateLawContext, 'State Act', 1);
      collect(caseLawContext, 'Case Law', 1);
      collect(judgmentTextContext, 'Supreme Court', 1);
      collect(regulationsContext, 'Regulator', 1);
      raw = [statuteContext, stateFullText, subordinateContext, judgmentContext, stateLawContext, caseLawContext, judgmentTextContext, regulationsContext].filter(Boolean).join('\n\n');
    } catch { /* ignore — best-effort retrieval */ }
    res.json({ sources, raw, timings });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// Greetings / small talk should NOT trigger a legal search — the vector index
// always returns its nearest neighbours, so "hi" would otherwise surface random,
// irrelevant sources. Return true only for clear chit-chat, so real short legal
// questions ("IPC 302?", "bail process") still retrieve.
function isSmalltalkOrEmpty(msg) {
  const clean = (msg || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return true;
  const GREETINGS = new Set([
    'hi', 'hii', 'hiii', 'hey', 'heyy', 'hello', 'helo', 'yo', 'hola', 'namaste', 'namaskar', 'namaskaram',
    'good morning', 'good afternoon', 'good evening', 'good night', 'gm', 'gn',
    'thanks', 'thank you', 'thank u', 'thankyou', 'ty', 'thx', 'tysm', 'welcome',
    'ok', 'okay', 'okey', 'k', 'kk', 'fine', 'cool', 'nice', 'great', 'good', 'wow', 'lol',
    'bye', 'goodbye', 'good bye', 'see you', 'see ya', 'cya', 'take care',
    'how are you', 'how r u', 'how are u', 'hru', 'how do you do', 'whats up', 'what up', 'sup', 'wassup', 'wasup',
    'who are you', 'what can you do', 'what do you do', 'what is this', 'test', 'testing', 'hi there', 'hello there',
  ]);
  if (GREETINGS.has(clean)) return true;
  // Very short (<=3 words) AND no legal keyword → treat as chit-chat, skip retrieval.
  const words = clean.split(' ');
  if (words.length <= 3) {
    const LEGAL = /\b(law|legal|act|section|sec|ipc|bns|crpc|bnss|cpc|article|court|case|judg|rent|divorce|bail|fir|gst|tax|contract|agreement|notice|property|will|company|sebi|rbi|irdai|trai|police|arrest|right|rights|penal|constitution|petition|appeal|marriage|dowry|cheque|land|tenant|lease|employ|salary|wage|fund|cheating|fraud|maintenance|custody|succession|inherit)\b/;
    if (!LEGAL.test(clean)) return true;
  }
  return false;
}

// The user wants sources shown only when they actually ask for them, not on every
// answer. Retrieval still runs for grounding — this only controls whether the
// "Sources referenced" list is returned to the UI.
function wantsReferences(msg) {
  return /\b(sources?|references?|referenced|citations?|cite|citing|case law|which (section|act|law|case|provision)|under which)\b/i.test(msg || '');
}

// Detect "give me the FULL judgment / full text of <case>" — the user wants the
// whole judgment reconstructed and handed over, not a summary.
function wantsFullJudgment(msg) {
  const s = String(msg || '');
  return /\b(full|complete|entire|whole|actual|original)\s+(judg(e)?ment|text|ruling|verdict|order|case\s*file|copy)\b/i.test(s)
      || /\bfull\s+text\s+of\b/i.test(s)
      || /\b(give|show|get|read|download|provide)\b[\s\S]{0,30}\b(full|complete|entire|whole)\b[\s\S]{0,20}\b(judg(e)?ment|case|text|ruling)\b/i.test(s)
      || /\b(judgment|judgement|case)\s+file\b/i.test(s);
}
// Max characters of a judgment to return inline (UI/payload safety). Very long
// judgments (e.g. Kesavananda ~3.3M chars) return the first portion with a note.
const FULL_JUDGMENT_MAX_CHARS = 120000;

// Follow-up query expansion. Retrieval matches on the CURRENT message only, so a
// short/anaphoric follow-up like "how many sections are there" or "what about the
// penalty" carries no subject — the retriever can't find the Act the user asked
// about one turn earlier, and the model deflects ("check the official website").
// When the message looks like a follow-up, prepend the last user turn's text so
// the subject (e.g. "Sikkim Panchayat Act") rides along into retrieval. This only
// affects the retrieval query, never what the user sees or what the model is told.
function buildRetrievalQuery(message, conversationHistory) {
  const msg = String(message || '').trim();
  if (!msg) return msg;
  const priorUser = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .filter(m => m && m.role === 'user' && m.content)
    .map(m => String(m.content));
  if (!priorUser.length) return msg;
  const clean = msg.toLowerCase();
  const contentWords = clean.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const looksAnaphoric = /\b(it|its|it's|this|that|these|those|they|them|there|the act|the section|the sections|the case|the law|the rule|the same|above|previous)\b/.test(clean)
    || /^(how many|what about|and\b|also\b|then\b|tell me more|explain|more\b|why|when|who|which|list|give me the|show me the)/.test(clean)
    || /\b(section|sections|penalt|punish|chapter|clause|schedule|amend)\b/.test(clean);
  const isShort = contentWords.length <= 7;
  if (!isShort && !looksAnaphoric) return msg; // a self-contained question retrieves as-is
  // Prepend the most recent prior user turn (truncated) to supply the subject.
  const subject = priorUser[priorUser.length - 1].slice(0, 400);
  return `${subject}\n${msg}`;
}

// Bound each retriever's latency. On this RAM-tight host the 20.6M-row case-law
// keyword search can thrash to disk for 2+ minutes on a broad query, which pushes
// total response time past Cloudflare's ~100s tunnel limit — the browser then shows
// "Network Error". A retriever that exceeds this budget resolves to '' (that one
// source is simply skipped for this query) so the answer still returns in time.
// Raise RETRIEVAL_TIMEOUT_MS once on a bigger-RAM host.
const RETRIEVAL_TIMEOUT_MS = Number(process.env.RETRIEVAL_TIMEOUT_MS) || 45000;
function withRetrievalTimeout(promise, ms = RETRIEVAL_TIMEOUT_MS) {
  let t;
  const timed = new Promise((resolve) => { t = setTimeout(() => resolve(''), ms); });
  return Promise.race([
    Promise.resolve(promise).catch(() => '').then((v) => { clearTimeout(t); return v; }),
    timed,
  ]);
}

app.post('/functions/v1/legal-chat', async (req, res) => {
  try {
    const { message, detectedLanguage, documentContent, sessionId, action, stream } = req.body;

    // Summarize action: produce a summary of an uploaded document
    if (action === 'summarize') {
      const langInstr = getLanguageInstructions(detectedLanguage || 'en-IN');
      const completion = await grok.chat.completions.create({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: `${langInstr}\n\nYou are an Indian legal assistant. Summarize the user's legal document in clear, simple language. Highlight key parties, claims, dates, legal sections, and any deadlines or risks.\n\nCRITICAL: Your ENTIRE response MUST be written in the language specified above. Do not switch languages mid-answer. Do not respond in English unless English was explicitly requested.` },
          { role: 'user', content: `Summarize this document:\n\n${(documentContent || '').slice(0, 60000)}` }
        ],
        max_tokens: 1200,
        temperature: 0.3,
      });
      return res.json({ response: stripMarkdown(completion.choices[0]?.message?.content || ''), language: detectedLanguage });
    }

    // Full-judgment request: reconstruct and return the whole Supreme Court
    // judgment text (no LLM — we hand over the stored text verbatim). This is the
    // "give me the full judgment / case file" path.
    if (message && wantsFullJudgment(message)) {
      const j = getFullJudgment(message);
      if (j) {
        const title = String(j.header || '').replace(/\s+/g, ' ').replace(/^[A-Z· ~]*\d+\s+/, '').trim().slice(0, 140);
        const truncated = j.text.length > FULL_JUDGMENT_MAX_CHARS;
        // The judgment is raw OCR text, not markdown — neutralise markdown-special
        // characters (esp. `~`, which GFM renders as strikethrough) so it shows as
        // plain, readable text in the chat instead of being mangled.
        const escapeMd = (s) => String(s).replace(/([\\`*_~#>[\]|])/g, '\\$1');
        const body = escapeMd(truncated ? j.text.slice(0, FULL_JUDGMENT_MAX_CHARS) : j.text);
        const head = `FULL JUDGMENT — SUPREME COURT OF INDIA (${j.year})\n${title}\n\n`
          + `Note: this is the complete judgment TEXT from the record (digitised/OCR — may contain minor scan errors). It is NOT an officially certified copy; for a certified copy use the Supreme Court registry or the official source.\n`
          + '———\n\n';
        const tail = truncated
          ? `\n\n———\n[This judgment is long (${j.text.length.toLocaleString()} characters). The above is the first ${FULL_JUDGMENT_MAX_CHARS.toLocaleString()} characters. Ask for a specific part, or download it, for the rest.]`
          : '';
        return res.json({ response: head + body + tail, language: detectedLanguage, sources: [], fullJudgment: true });
      }
      // Not found → fall through to normal chat, which will explain / summarise.
    }

    // Default chat — Grok-powered Indian legal assistant
    const { conversationHistory } = req.body;

    // STRONG language enforcement — the user's selected language MUST drive the response language.
    // We prepend the language directive AND repeat it at the end so the model never drifts.
    const langInstr = getLanguageInstructions(detectedLanguage || 'en-IN');

    const systemPrompt = `${langInstr}

You are Counsel AI — the user's personal legal best friend. You know Indian law deeply but you explain it like a smart, caring friend over a chai, not like a lawyer in court. Your job is to make the user feel supported, understood, and empowered.

PERSONALITY:
- Warm, friendly, and conversational. Talk like a close friend who happens to know the law.
- If the user sounds worried or stressed, acknowledge it first before diving into advice.
- Use natural openers like "Hey, don't worry about this — here's what you can do:" or "Okay so here's the deal:" or "This is actually pretty common, let me break it down for you." (Translate these openers into the target language naturally — don't keep them in English.)
- Keep things simple and relatable. No legal jargon unless you explain it right away.
- DO NOT use emojis or pictographs anywhere in your response. The answer is read aloud by a TTS voice; emojis make the voice say things like "smiling face" or "scales" which sounds broken. Convey warmth through wording, not symbols.

CONTENT:
- Give accurate, real advice based on Indian law.
- GROUNDING & HONESTY (critical — this is a legal product, a confident wrong answer is dangerous):
  • When a RELEVANT ... TEXT / PRECEDENTS / RULES block is provided below, base your answer on it and cite the exact act, section, rule or case number as given there.
  • NEVER invent or guess a section number, rule number, case name, citation, STATUTE NAME or ACT YEAR, or a specific stamp-duty / registration-fee / tax amount. Only cite specifics that appear in the retrieved blocks below, or that you are genuinely certain of. If you are not sure of the exact number, describe the law in general terms WITHOUT a fake number — and do NOT add a "please verify" note about it.
  • STAMP DUTY: most Indian states levy stamp duty under the Indian Stamp Act, 1899 (as amended in its application to that state). Only a few states have their OWN Stamp Act (e.g. Maharashtra, Karnataka, Kerala, Rajasthan, Gujarat, Tamil Nadu). NEVER fabricate a "[State] Stamp Act, [year]" for a state that does not have one (e.g. there is NO "Odisha Stamp Act" — Odisha uses the Indian Stamp Act, 1899). If unsure whether a state has its own Stamp Act, say "the Indian Stamp Act, 1899 (as applicable in <State>)". Do NOT state a specific rupee stamp-duty figure unless you are certain of it — instead refer to duty "as per the applicable Stamp Act schedule / prevailing state rates" without inventing a number.
  • If NO relevant legal text was retrieved for the question (no blocks below, or they don't fit), do not fabricate. Give the general legal position if you know it, WITHOUT inventing a section/rule/case number. Do NOT add "verify", "consult a lawyer", or "check the official source" notes — just give the general position and stop. It is always better to state the position without a number than to state a wrong section confidently.
  • KEEP EACH ACT'S RULES SEPARATE: the retrieved blocks often come from DIFFERENT Acts. A condition stated in one Act (an officer's rank, a time limit, a penalty) applies ONLY to that Act — never attach it to a section of another Act. Use a block only if it actually governs the user's situation; ignore blocks from special or unrelated Acts (passport, ferries, motor vehicles, a single state's police Act) when the question is general.
  • Do not overstate certainty. You are a legal information assistant, not the user's lawyer.
- CURRENT LAW (very important): India replaced its three main criminal laws on 1 July 2024. ALWAYS use the NEW laws as primary:
  • Bharatiya Nyaya Sanhita, 2023 (BNS) — replaced the Indian Penal Code (IPC).
  • Bharatiya Nagarik Suraksha Sanhita, 2023 (BNSS) — replaced the CrPC.
  • Bharatiya Sakshya Adhiniyam, 2023 (BSA) — replaced the Indian Evidence Act.
  Cite the current BNS/BNSS/BSA section and, when helpful, mention the old IPC/CrPC equivalent in brackets so the user can connect them (e.g. "Section 318 BNS, earlier IPC 420"). Civil/other laws that were NOT replaced (Negotiable Instruments Act, Consumer Protection Act, Hindu Marriage Act, RTI, GST, etc.) stay as they are.
- DATA CURRENCY: your statute text is current to roughly 2020 for most central acts, the 2023 criminal codes, and state acts as published on India Code. Use this only as INTERNAL awareness: do NOT invent a specific up-to-date figure you are unsure of — if you are unsure of an exact current number, give the general position without that number. But do NOT add ANY currency or verification caution to your reply — no "I'm not certain of the latest…", "please verify the current forms/limits", "rules can get updated", "check the official government site", or "confirm with a lawyer" lines. Answer directly with what you have.
- Do NOT end your answers with disclaimers, hedges, or "verify/consult a lawyer" caveats of that kind. Give the answer and stop.
- Mention relevant laws/sections naturally in conversation — don't list them in a formal table.
- Give practical next steps the user can actually take today.
- Do NOT end with a disclaimer or a "I'm your legal buddy, not your official lawyer" reminder. Just answer helpfully and stop; the app already shows a disclaimer separately.

DOCUMENTS (when the user asks you to draft, generate, create, prepare, make or write a document — Terms and Conditions, Privacy Policy, legal notice, agreement, NDA, affidavit, contract, policy, letter, resolution, etc.):
- WRITE THE FULL DOCUMENT yourself, directly in your reply, complete and ready to use, as a PROPER, LONG-FORM PROFESSIONAL LEGAL INSTRUMENT — the standard an advocate would draft, not a short summary. This overrides the "no formal structure" and "keep it short" rules above — ONLY for documents. A real agreement/deed/notice runs to several pages. Follow this structure precisely:
  1. TITLE — the document name in capitals on its own line (e.g. "EMPLOYMENT AGREEMENT", "NON-DISCLOSURE AGREEMENT", "DEED OF SALE"). Put it as a markdown H1 "# TITLE".
  2. A one-line governing-law note under the title (e.g. "Governed by the Indian Contract Act, 1872 and applicable law.").
  3. An opening recital: "THIS <DOCUMENT> is made and executed at __________ on this ____ day of __________, 20____" — use underscores for details the user did not give.
  4. The parties, each introduced by a bold label on its own line — "**BETWEEN**" then the first party with blanks for name/address, "**AND**" then the second party — and a line collectively defining them (e.g. '(collectively the "Parties")').
  5. "**WHEREAS:**" followed by recital paragraphs lettered (A), (B), (C)… setting out the background.
  6. "**NOW, THEREFORE,** in consideration of the mutual covenants and promises herein, the Parties agree as follows:"
  7. NUMBERED SECTIONS with headings in capitals, as markdown H2 "## 1. DEFINITIONS AND INTERPRETATION", "## 2. …" — a thorough document has 10 to 15 sections. Under each, number sub-clauses "1.1", "1.2", and sub-sub-clauses "(a)", "(b)", "(c)". Cover, as relevant to the document type: definitions, the substance/obligations, consideration/payment, term & termination, confidentiality, representations & warranties, indemnity, governing law & dispute resolution (courts + arbitration under the Arbitration and Conciliation Act, 1996), and a "GENERAL PROVISIONS" section (entire agreement, amendments, severability, waiver, notices, assignment, survival, counterparts).
  8. "**IN WITNESS WHEREOF**, the Parties have executed this <document> as of the date first written above."
  9. A signature block for each party (blanks for Name, Title/Designation, Signature, Date) and a "**WITNESSES:**" block with two witnesses (Name, Address, Signature).
  10. Any ANNEXURES/SCHEDULES the document needs, each on its own titled line.
  11. A final "**IMPORTANT NOTES UNDER INDIAN LAW:**" paragraph flagging stamp duty, registration and notarisation requirements where they apply (e.g. sale deeds, gift deeds, leases over 11 months, POAs).
- Use fill-in blanks (underscores like "____________") for every specific detail the user did not provide — names, addresses, dates, amounts — so the document is complete but ready for the parties to fill and sign. Do NOT leave sections out for want of a detail.
- WRAP THE DOCUMENT IN MARKERS so it can be turned into a clean file. Put a line containing exactly "===BEGIN DOCUMENT===" immediately before the document's title, and a line containing exactly "===END DOCUMENT===" immediately after the last clause. Between those two markers put ONLY the document itself — the title, headings and clauses — and NOTHING else (no "here's your document", no chit-chat). Any friendly one-line intro goes BEFORE the ===BEGIN DOCUMENT=== marker, and the short advocate-review reminder goes AFTER the ===END DOCUMENT=== marker. This matters: only the text between the markers becomes the downloaded PDF/Word, so the file must be the clean document alone.
- NEVER say you cannot create, generate or send a PDF or file. NEVER tell the user to copy-paste your text into Word, Google Docs, SmallPDF, iLovePDF or any other tool. The app automatically shows "Download PDF" and "Word" buttons under your answer, so the user turns exactly what you write into a file with one click. So just write the document — nothing about how to convert it.
- Fill in the details the user gave (business name, parties, jurisdiction, specifics). If a required detail is missing, use a clear placeholder in square brackets like [Governing State] rather than refusing or asking a long list of questions first.
- Ground the document in current Indian law and cite the relevant Act/section where natural, following the grounding rules above.
- Still add one short line at the end reminding the user to have an advocate review it before relying on it.

FORMATTING:
- Use short paragraphs and natural breaks. No huge walls of text.
- Use **bold** for key terms or important points only.
- Bullet points or numbered steps only when listing action items — keep lists short (3-5 items max).
- NO formal section headers like "Executive Summary", "Legal Analysis", "Applicable Law", "Disclaimer".
- NO rigid document structure. Just friendly, flowing conversation.

LANGUAGE LOCK (most important rule):
Your ENTIRE response — every single sentence, including greetings, headers, action steps, and the closing reminder — MUST be written in the language above (code: ${detectedLanguage || 'en-IN'}). Do NOT mix in English unless the target IS English or Hinglish. If the user types in English but their selected language is Hindi, you reply in HINDI. If they switch to Tamil mid-conversation, you switch to TAMIL. The selected language ALWAYS wins. Legal acronyms (FIR, IPC, GST) may stay in their standard form, but everything else must be in the selected language's native script.`;

    // RAG: pull the most relevant CURRENT statute sections and ground the answer
    // in the real bare-act text. Non-blocking — if it finds nothing, chat proceeds
    // exactly as before. The statute text is English; the LANGUAGE LOCK still forces
    // the reply into the user's selected language.
    let ragBlock = '';
    const sources = []; // structured citations shown to the user under the answer
    // Pull the header line(s) of the top retrieved block(s) as source labels.
    const collect = (ctx, type, n = 2) => {
      if (!ctx) return;
      const blocks = ctx.split('\n\n');
      for (const b of blocks.slice(0, n)) {
        const first = b.split('\n')[0].trim();
        // Blocks are "[Citation] Heading" (statute/state/rule) or a bare line (state-meta).
        const m = first.match(/^\[([^\]]+)\]\s*(.*)$/);
        let label = m ? (m[2] ? `${m[1].trim()} — ${m[2].trim()}` : m[1].trim()) : first;
        label = label.trim();
        if (label && label.length > 3 && !sources.some(s => s.label === label)) {
          sources.push({ type, label: label.slice(0, 160) });
        }
      }
    };
    // Skip retrieval entirely for greetings / small talk, so we don't attach
    // irrelevant nearest-neighbour sources to a simple "hi".
    const skipRetrieval = isSmalltalkOrEmpty(message);
    if (!skipRetrieval) {
    try {
      // Expand short/anaphoric follow-ups with the previous turn's subject so
      // retrieval still finds the Act/case the user is asking a follow-up about.
      const retrievalQuery = buildRetrievalQuery(message, conversationHistory);
      // Retrieve statute text + real Supreme Court precedents in parallel.
      const [statuteContext, judgmentContext, stateLawContext, stateFullText, subordinateContext, caseLawContext, judgmentTextContext, regulationsContext] = await Promise.all([
        withRetrievalTimeout(retrieveStatuteContext(retrievalQuery, { cite: codeMapNewRefs(retrievalQuery).join('; ') })),
        withRetrievalTimeout(retrieveJudgmentContext(retrievalQuery)),
        withRetrievalTimeout(retrieveStateLawContext(retrievalQuery)),
        withRetrievalTimeout(retrieveStateFullText(retrievalQuery)),
        withRetrievalTimeout(retrieveSubordinate(retrievalQuery)),
        withRetrievalTimeout(retrieveCaseLaw(retrievalQuery)),
        withRetrievalTimeout(retrieveJudgmentText(retrievalQuery)),
        withRetrievalTimeout(retrieveRegulations(retrievalQuery)),
      ]);
      collect(statuteContext, 'Act / Section', 2);
      collect(stateFullText, 'State Act', 1);
      collect(subordinateContext, 'Rule / Notification', 1);
      collect(judgmentContext, 'Supreme Court', 1);
      collect(stateLawContext, 'State Act', 1);
      collect(caseLawContext, 'Case Law', 1);
      collect(judgmentTextContext, 'Supreme Court', 1);
      collect(regulationsContext, 'Regulator', 1);
      // Most authoritative first, each capped: the prompt has room for only a few
      // thousand characters of retrieved law, and the overall trim below cuts from
      // the END. Bare-act text used to sit behind state-act and notification text
      // and was trimmed away entirely, so the model answered from memory.
      const cap = (ctx, n) => (ctx.length > n ? ctx.slice(0, n) + ' …' : ctx);
      if (statuteContext) {
        ragBlock += `\n\nRELEVANT INDIAN STATUTE TEXT (retrieved for this question — treat as authoritative, quote the exact section number, but still reply in the user's language):\n${cap(statuteContext, 4200)}`;
      }
      if (stateFullText) {
        ragBlock += `\n\nRELEVANT STATE ACT TEXT (actual section text of a state act, retrieved for this question — treat as authoritative for that state, but still reply in the user's language):\n${cap(stateFullText, 2000)}`;
      }
      if (subordinateContext) {
        ragBlock += `\n\nRELEVANT RULES / NOTIFICATIONS (subordinate legislation — rules, notifications, circulars made under an Act; use when the question is about procedure, forms, rates or details set by rules, and cite the rule/notification, but still reply in the user's language):\n${cap(subordinateContext, 1200)}`;
      }
      if (judgmentTextContext) {
        ragBlock += `\n\nSUPREME COURT JUDGMENT TEXT (actual passages from real SC judgments retrieved for this question — you MAY quote or paraphrase the reasoning shown here and attribute it to the Court; do NOT state a holding that is not visible in the passage, and never invent a case name or citation):\n${cap(judgmentTextContext, 1500)}`;
      }
      if (regulationsContext) {
        ragBlock += `\n\nREGULATOR PROVISIONS (real provisions from SEBI, RBI, IRDAI, TRAI, MCA and other regulators, retrieved for this question — each shows whether it is in force and a source link; cite it as given, tell the user if it is NOT in force, and never invent a provision):\n${cap(regulationsContext, 1000)}`;
      }
      if (judgmentContext) {
        ragBlock += `\n\nRELEVANT SUPREME COURT PRECEDENTS (real cases retrieved for this question — you MAY mention one only if it genuinely fits; cite it exactly as given; NEVER invent case names or citations):\n${cap(judgmentContext, 1000)}`;
      }
      if (caseLawContext) {
        ragBlock += `\n\nRELEVANT COURT CASES (real High Court / Supreme Court judgments matched for this question — case title, court, date and judge are accurate; the snippet is a short extract, NOT the full holding. Cite these exactly as given and NEVER invent a case name, number or citation. Do not state a holding you cannot see in the extract):\n${cap(caseLawContext, 1200)}`;
      }
      if (stateLawContext) {
        ragBlock += `\n\nRELEVANT STATE/UT ACTS (real state legislation matched by title — mention only if the question concerns that state; these are act names/years only, NOT full text, so do not fabricate section contents):\n${cap(stateLawContext, 500)}`;
      }
    } catch { /* ignore — never block chat on retrieval */ }

    // Retrieval-confidence signal: if nothing was pulled, tell the model explicitly
    // so it hedges (per the GROUNDING rule) instead of inventing a citation.
    if (!ragBlock.trim()) {
      ragBlock = `\n\nNO SPECIFIC LEGAL PROVISION WAS RETRIEVED for this question. Do NOT cite a section/rule/case number unless you are genuinely certain of it. Give the general position if you know it, without inventing a number. Do NOT add any "verify", "consult a lawyer", or "check the official source" disclaimer — just answer with the general position.`;
    }
    } // end if (!skipRetrieval) — greetings/small talk get no RAG block and no sources

    // Currency check: if the question or the retrieved context references a
    // repealed/superseded or significantly amended act, build an explicit alert so
    // the model warns the user / cites the right amendment. Computed here against
    // the FULL context, but appended AFTER trimming (below) so the token-budget cut
    // can never strip it off the tail — otherwise these authoritative notes (e.g.
    // "Article 334A was inserted by the 106th Amendment, not the 104th") get lost.
    // Currency/amendment note + criminal-code renumbering note (IPC->BNS etc.).
    // Both are computed against the full context and appended AFTER trimming so the
    // token-budget cut can never strip these authoritative corrections.
    const currencyNote = currencyBlock(`${message}\n${ragBlock}`) + codeMapNote(`${message}\n${ragBlock}`, message);

    // Location-aware drafting: default any document to the user's own state (from
    // their IP) so it uses the right jurisdiction, courts, stamp duty and rent-control
    // act — instead of the model picking a random state. The user can override by
    // naming a state; if we can't detect one, ask rather than guess.
    const userState = stateFromReq(req);
    const locationBlock = userState
      ? `\n\nUSER LOCATION & JURISDICTION: The user's network location indicates they are in ${userState}, India. When you draft ANY document (agreement, deed, notice, affidavit, etc.), use ${userState} as the default jurisdiction — the governing law and competent courts (the courts at the ${userState} district/city and the relevant High Court), the stamp duty and registration position under the Stamp Act that actually applies in ${userState} — for most states this is the Indian Stamp Act, 1899 (as amended in its application to ${userState}); use a distinct "${userState} Stamp Act" ONLY if you are certain that state has its own (e.g. Maharashtra, Karnataka, Kerala, Rajasthan, Gujarat), and NEVER invent a "${userState} Stamp Act, <year>" — if unsure, write "the Indian Stamp Act, 1899 (as applicable in ${userState})". Do NOT quote a specific rupee stamp-duty amount unless you are certain of it; otherwise refer to duty as per the applicable Stamp Act schedule / prevailing ${userState} rates without inventing a figure. Also apply any ${userState}-specific rent-control or tenancy statute where relevant. Do NOT pick a random state. State the assumed jurisdiction once (e.g. "Jurisdiction: courts at ${userState}") so the user can correct it, and if the user names a different state, use that instead.`
      : `\n\nUSER LOCATION & JURISDICTION: The user's state could not be determined from their network. When drafting a document that depends on state law (stamp duty, jurisdiction, rent control), do NOT invent or pick a random state — either ask the user which state/city the document is for, or use a neutral pan-India draft with a clear placeholder like [Governing State] and [City] for the jurisdiction.`;

    // Fit the whole request under the LLM's per-minute token budget. Free tiers are
    // tight (Groq free ≈ 8000 tokens/min) and the retrieved legal context is large,
    // so trim ragBlock and cap the answer length so the request isn't rejected.
    // Raise LLM_TPM_BUDGET on a paid tier to restore full context and long drafting.
    const TPM_BUDGET = Number(process.env.LLM_TPM_BUDGET) || 8000;
    const isDocRequest = /\b(draft|generate|create|prepare|make|write|give me)\b[\s\S]{0,40}\b(agreement|deed|contract|notice|affidavit|nda|non-disclosure|lease|rental|policy|terms|will|testament|petition|bond|letter|resolution|memorandum|mou|power of attorney|document|pdf|word)\b/i.test(message || '');
    const chatMaxTokens = Math.min(isDocRequest ? 3000 : 800, Math.max(400, TPM_BUDGET - 3000));
    // Budget the prompt CONSERVATIVELY: measured ~2.3 chars/token for this dense
    // legal/OCR text, so use 2.0 and reserve ~1000 tokens of slack — requests were
    // landing just over the 8000 limit (8048/8383) and 413-ing to blank.
    const promptCharBudget = Math.max(2000, Math.floor((TPM_BUDGET - chatMaxTokens - 1000) * 2.0));
    // Cap conversation history so a big earlier answer (e.g. a 120k-char full
    // judgment) can't blow the token limit on the next turn — keep only the last
    // few turns, each truncated. (This was the "blank reply after a full judgment".)
    const HIST_TURNS = 6, HIST_MSG_CHARS = 2000;
    const trimmedHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(m => m && m.role && m.content)
      .slice(-HIST_TURNS)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, HIST_MSG_CHARS) }));
    const historyChars = trimmedHistory.reduce((n, m) => n + m.content.length, 0);
    const fixedChars = systemPrompt.length + locationBlock.length + String(message || '').length
      + (documentContent ? Math.min(String(documentContent).length, 20000) : 0) + historyChars;
    // Reserve room for the currency/amendment note so trimming the retrieved text
    // never eats it, then append it after the trim (always kept, high priority).
    // The system prompt + location block are plain English (~4 chars/token), so
    // count them at 3.6 rather than the 2.0 used for dense legal/OCR text. Counting
    // them at 2.0 left only ~600 characters for retrieved law — effectively none.
    const englishChars = systemPrompt.length + locationBlock.length;
    const fixedTokens = Math.ceil(englishChars / 3.6) + Math.ceil((fixedChars - englishChars) / 2.0);
    const ragBudgetChars = Math.max(0, Math.floor((TPM_BUDGET - chatMaxTokens - 1400 - fixedTokens) * 2.2) - currencyNote.length);
    console.log(`[chat] prompt budget: fixed≈${fixedTokens}t, retrieved ${ragBlock.length} chars, room ${ragBudgetChars}`);
    if (ragBlock.length > ragBudgetChars) {
      ragBlock = ragBlock.slice(0, ragBudgetChars) + '\n\n[Some retrieved context was trimmed to fit the model limit.]';
    }
    ragBlock += currencyNote;

    // Add document context to the user message if present
    const userContent = documentContent
      ? `[Document Context]\n${documentContent.slice(0, 20000)}\n\n[User Question]\n${message}`
      : message;
    const buildMessages = (rag) => [
      { role: 'system', content: systemPrompt + rag + locationBlock },
      ...trimmedHistory, // the (trimmed) conversation history
      { role: 'user', content: userContent },
    ];
    // The token estimate above is approximate (dense OCR/Indic text runs over), so
    // a request can still land just past the per-minute limit (413). Rather than
    // fail the user's question, retry once with half the retrieved text — keeping
    // the currency / renumbering notes, which sit at the end.
    const createChat = async (extra = {}) => {
      const call = (rag) => grok.chat.completions.create({
        model: GROK_MODEL, messages: buildMessages(rag), max_tokens: chatMaxTokens, temperature: 0.4, ...extra,
      });
      try {
        return await call(ragBlock);
      } catch (err) {
        if (err?.status !== 413) throw err;
        const body = ragBlock.slice(0, ragBlock.length - currencyNote.length);
        console.warn(`[chat] 413 from LLM — retrying with half the retrieved text (${body.length} -> ${Math.floor(body.length / 2)} chars)`);
        return await call(body.slice(0, Math.floor(body.length / 2)) + currencyNote);
      }
    };

    // isDocRequest and chatMaxTokens are computed above, budgeted to the LLM's
    // per-minute token limit (see LLM_TPM_BUDGET).

    // STREAMING path — push tokens to client as they arrive (huge perceived-latency win)
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // Send the grounding sources first — but only when the user asked for them.
      if (wantsReferences(message) && sources.length) res.write(`data: ${JSON.stringify({ sources })}\n\n`);

      try {
        const completion = await createChat({ stream: true });

        let fullAnswer = '';
        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            fullAnswer += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        }
        // Citator guard: scan the completed answer and, if it names an overruled
        // landmark case, stream the status warning as a trailing delta.
        const guardNote = citatorGuardNote(fullAnswer);
        if (guardNote) res.write(`data: ${JSON.stringify({ delta: guardNote })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      } catch (err) {
        console.error('legal-chat stream error:', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const completion = await createChat();

    const aiText = completion.choices[0]?.message?.content || "I am unable to process that request at the moment.";
    // Citator guard: if the answer names a landmark case that has since been
    // overruled, append a factual status warning (deterministic, model-independent).
    const guardNote = citatorGuardNote(aiText);
    res.json({ response: aiText + guardNote, language: detectedLanguage, sources: wantsReferences(message) ? sources : [] });
  } catch (error) {
    console.error('legal-chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Voice-to-text function endpoint
app.post('/functions/v1/voice-to-text', async (req, res) => {
  try {
    if (!whisperClient) return res.status(501).json({ error: 'Speech-to-text requires OPENAI_API_KEY.' });
    const { audio, mimeType, language } = req.body;
    if (!audio) return res.status(400).json({ error: 'No audio data' });

    const buffer = Buffer.from(audio, 'base64');
    let extension = 'webm';
    if (mimeType?.includes('mp4') || mimeType?.includes('m4a')) extension = 'm4a';
    if (mimeType?.includes('wav')) extension = 'wav';
    if (mimeType?.includes('mp3') || mimeType?.includes('mpeg')) extension = 'mp3';

    const file = await toFile(buffer, `audio.${extension}`, { type: mimeType || 'audio/webm' });
    const transcription = await whisperClient.audio.transcriptions.create({
      file,
      model: GROK_STT_MODEL,
      response_format: 'verbose_json',
      prompt: WHISPER_LEGAL_PROMPT,
    });

    res.json({
      text: transcription.text,
      detectedLanguage: normalizeDetectedLang(transcription.language),
      detectedLanguageRaw: transcription.language,
      ok: true,
    });
  } catch (error) {
    console.error('voice-to-text error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. Speak (TTS) function endpoint — Google TTS only
// Accepts optional `role` ('judge' | 'opponent') for courtroom character voices.
// When role is set, uses COURTROOM_VOICE_CONFIG (deep male judge / fluent female lawyer).
// Without role, falls back to the standard language→voice map.
app.post('/functions/v1/speak', async (req, res) => {
  try {
    const { text, language, role } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (!GOOGLE_TTS_API_KEY) return res.status(501).json({ error: 'GOOGLE_TTS_API_KEY not configured.' });

    let voiceOverride, tuningOverride, langForTTS;

    if (role && COURTROOM_VOICE_CONFIG[role]) {
      // Courtroom character voice — ignore language param, always en-IN
      const cfg    = COURTROOM_VOICE_CONFIG[role];
      voiceOverride  = cfg.voice;
      tuningOverride = cfg.tuning;
      langForTTS     = 'en-IN';
    } else {
      // Standard voice — route English through British Neural2-C
      const english  = isEnglish(language);
      voiceOverride  = english ? ENGLISH_GOOGLE_VOICE : undefined;
      tuningOverride = undefined;
      langForTTS     = english ? 'en-GB' : language;
    }

    const audioContent = await synthFullWithGoogle(text, langForTTS, voiceOverride, tuningOverride);
    res.json({ audioContent, provider: 'google', role: role || null });
  } catch (error) {
    console.error('speak error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── 8b. Vision OCR + Understanding ──────────────────────────────────────────
// Accepts an image (PNG, JPG, WEBP, GIF, HEIC) as base64 and returns extracted
// text + a description of what's in the image. Used by AI Assistant chat and
// Courtroom AI to handle photo evidence, scanned docs as images, screenshots
// of WhatsApp/SMS, notice photos, etc.
// List the document types the generator offers, with the fields each one needs.
// The chat UI reads this to know what it can ask the user to fill in.
app.get('/functions/v1/document-templates', (_req, res) => {
  // `custom` tells the UI whether the "any document" path can be offered — it is
  // only on when a self-hosted model is configured (DOC_LLM_URL), never Grok.
  res.json({ templates: listTemplates(), custom: customDocAvailable() });
});

// Generate a legal document (Word / PDF) from a template and the user's answers.
// Deterministic and offline: no LLM, no external API. Retrieval only adds real
// supporting citations. Returns base64 files so the browser can offer a download.
app.post('/functions/v1/generate-document', async (req, res) => {
  try {
    const { templateId, fields, formats, request } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });

    let spec, files;
    if (templateId === 'custom') {
      // Freeform "any document" — needs the self-hosted model. Ground it in the
      // rules index first so it drafts against real statutory text.
      if (!request) return res.status(400).json({ error: 'A description of the document is required.' });
      let grounding = '';
      try { grounding = (await retrieveSubordinate(request)) || ''; } catch { /* non-fatal */ }
      ({ spec, files } = await generateCustomDocument({
        request,
        grounding,
        formats: Array.isArray(formats) && formats.length ? formats : ['docx', 'pdf'],
      }));
    } else {
      ({ spec, files } = await generateDocument({
        templateId,
        fields: fields || {},
        formats,
        retrieveSubordinate, // grounds citations in the rules index when available
      }));
    }

    const base = spec.docType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const out = { docType: spec.docType, filenameBase: base, sections: (spec.sections || []).length };
    for (const fmt of ['docx', 'pdf', 'xlsx', 'pptx']) {
      if (files[fmt]) out[fmt] = files[fmt].toString('base64');
    }
    res.json(out);
  } catch (e) {
    // A missing field or a disabled feature is the caller's to fix, not a fault.
    const clientErr = /Missing required field|Unknown document type|supports:|is required|not enabled/.test(e.message) || e.code === 'CUSTOM_DISABLED';
    res.status(clientErr ? 400 : 500).json({ error: e.message });
  }
});

// Render an arbitrary chat answer (its text) into a downloadable Word/PDF file.
// This is the "ask in chat, get a PDF" path: the chat model writes the document,
// the browser sends that text here, and it comes back as a file. No LLM here —
// the text is wrapped verbatim (only markdown is cleaned up for print).
app.post('/functions/v1/render-document', async (req, res) => {
  try {
    const { text, title, format } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'No text to render.' });
    const { specFromText, buildProseDocx, buildProsePdf } = await import('./documents/legalDoc.js');
    const spec = specFromText(text, title);
    const fmt = format === 'docx' ? 'docx' : 'pdf';
    const buf = fmt === 'docx' ? await buildProseDocx(spec) : await buildProsePdf(spec);
    const base = (spec.docType || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'document';
    res.json({ filenameBase: base, [fmt]: buf.toString('base64') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/functions/v1/vision-extract', async (req, res) => {
  try {
    const { imageBase64, mimeType, fileName } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    if (!whisperClient) return res.status(501).json({ error: 'OPENAI_API_KEY not configured on server.' });

    // Normalize MIME — default to image/png if missing
    const mt = (mimeType && typeof mimeType === 'string') ? mimeType : 'image/png';
    if (!/^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(mt)) {
      return res.status(400).json({ error: `Unsupported image type: ${mt}` });
    }

    // Guard payload size — OpenAI rejects >20 MB images
    const approxBytes = Math.ceil((imageBase64.length * 3) / 4);
    if (approxBytes > 18 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large (max ~18 MB after base64). Please compress and retry.' });
    }

    const dataUrl = `data:${mt};base64,${imageBase64}`;
    const prompt = `You are processing an image uploaded to an Indian legal assistant app.

Do two things and return BOTH:

1. EXTRACTED TEXT — copy EVERY readable character you can see, exactly as written, preserving line breaks and reading order. Include handwritten text, signatures (mark as [Signature]), stamps, headers, footers, page numbers, table contents. If there is no text, write "(no text visible)".

2. DESCRIPTION — describe what the image shows in 2-5 sentences, focused on what matters legally: type of document or scene, parties, dates, amounts, key clauses, injuries, damage, location, anything an Indian lawyer would care about. Be neutral and factual.

Format your response EXACTLY like this, no extra commentary:

===EXTRACTED TEXT===
<the text>

===DESCRIPTION===
<the description>`;

    const completion = await whisperClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      }],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content || '';
    const textMatch = raw.match(/===EXTRACTED TEXT===\s*([\s\S]*?)(?=\s*===DESCRIPTION===|$)/);
    const descMatch = raw.match(/===DESCRIPTION===\s*([\s\S]*?)$/);
    const text = (textMatch?.[1] || '').trim();
    const description = (descMatch?.[1] || '').trim();

    const combined = [
      fileName ? `--- Image: ${fileName} ---` : '--- Image ---',
      text && text !== '(no text visible)' ? `[Text in image]\n${text}` : '[No readable text in image]',
      description ? `[Description]\n${description}` : '',
    ].filter(Boolean).join('\n\n');

    res.json({ text, description, combined });
  } catch (error) {
    console.error('vision-extract error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Vision extraction failed' });
  }
});

// ─── 9. Custom OTP Email Verification ────────────────────────────────────────
// Completely replaces Supabase's built-in email confirmation (which has a 2 email/hour
// free-tier rate limit and poor deliverability). Our flow:
//
//   1. Frontend calls POST /functions/v1/send-verification with { email, userId }
//   2. We generate a 6-digit OTP, store it in memory for 15 min, email it via Nodemailer
//   3. User sees a 6-box OTP input screen in the app
//   4. Frontend calls POST /functions/v1/verify-otp with { email, otp }
//   5. We validate the OTP → call Supabase Admin API to confirm the user
//   6. Frontend auto-signs the user in (they already have the password in state)
//
// Requires in server/.env:
//   NOTIFY_FROM_EMAIL / NOTIFY_FROM_PASS  — Gmail sender (already configured)
//   SUPABASE_URL                          — project URL (already configured)
//   SUPABASE_SERVICE_KEY                  — service_role key from Supabase dashboard
//                                           Settings → API → service_role

// In-memory OTP store: email → { otp, userId, expiresAt }
// (Survives server restarts gracefully — user just requests a new code)
const pendingOTPs = new Map();
const OTP_TTL_MS  = 15 * 60 * 1000; // 15 minutes

const buildOTPEmailHTML = (otp, email) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family:'Segoe UI',Arial,sans-serif; background:#f4f4f5; margin:0; padding:24px; }
  .card { background:#fff; border-radius:12px; max-width:480px; margin:0 auto; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
  .header { background:#1e293b; padding:24px 28px; }
  .header h1 { color:#fff; margin:0; font-size:20px; font-weight:700; }
  .header p  { color:rgba(255,255,255,.7); margin:4px 0 0; font-size:13px; }
  .body { padding:32px 28px; text-align:center; }
  .otp-box { display:inline-block; background:#f8fafc; border:2px solid #e2e8f0; border-radius:12px; padding:20px 40px; margin:20px 0; }
  .otp { font-size:40px; font-weight:800; letter-spacing:12px; color:#1e293b; font-family:monospace; }
  .note { color:#64748b; font-size:13px; margin-top:4px; }
  .expire { color:#94a3b8; font-size:12px; margin-top:16px; }
  .footer { background:#f8fafc; padding:16px 28px; text-align:center; }
  .footer p { color:#94a3b8; font-size:11px; margin:0; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>⚖️ Counsel AI</h1>
    <p>Email Verification</p>
  </div>
  <div class="body">
    <p style="color:#334155;font-size:15px;margin-bottom:8px;">Enter this code in the app to verify <strong>${email}</strong></p>
    <div class="otp-box">
      <div class="otp">${otp}</div>
      <div class="note">Your verification code</div>
    </div>
    <p class="expire">⏱ This code expires in <strong>15 minutes</strong>.</p>
    <p style="color:#94a3b8;font-size:12px;margin-top:12px;">If you did not sign up for Counsel AI, you can safely ignore this email.</p>
  </div>
  <div class="footer"><p>Counsel AI · Automated email · Do not reply</p></div>
</div>
</body></html>`;

// POST /functions/v1/send-verification  { email, userId }
app.post('/functions/v1/send-verification', async (req, res) => {
  const { email, userId } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

  // Generate a 6-digit numeric OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  pendingOTPs.set(email.toLowerCase().trim(), {
    otp,
    userId: userId || null,
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  // Send via Nodemailer. The OTP is already stored above, so it always logs to
  // the console as a fallback (admin can relay it during an SMTP outage). But we
  // now report delivery failure to the client so the user isn't left on a dead-end
  // "code sent" screen when no email actually went out.
  try {
    await sendEmailResilient({
      from: `"Counsel AI" <${process.env.NOTIFY_FROM_EMAIL}>`,
      to: email,
      subject: `${otp} — your Counsel AI verification code`,
      html: buildOTPEmailHTML(otp, email),
    });
    console.log(`[otp] ✅ Sent code to ${email}`);
    return res.json({ ok: true });
  } catch (err) {
    // OTP is still stored + logged (admin relay / local dev), but tell the client
    // so the user isn't stuck on a dead-end "code sent" screen.
    console.error(`[otp] ❌ Email send failed: ${err.message}`);
    console.warn(`[otp] 🔑 FALLBACK — OTP for ${email}: ${otp}  (expires in 15 min)`);
    return res.json({ ok: false, error: 'We could not send the verification email right now. Please try again in a moment.' });
  }
});

// POST /functions/v1/verify-otp  { email, otp }
app.post('/functions/v1/verify-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ valid: false, error: 'Email and code required' });

  const key     = email.toLowerCase().trim();
  const stored  = pendingOTPs.get(key);

  if (!stored) {
    return res.json({ valid: false, error: 'No verification code found for this email. Please request a new one.' });
  }
  if (Date.now() > stored.expiresAt) {
    pendingOTPs.delete(key);
    return res.json({ valid: false, error: 'Code expired. Please request a new one.' });
  }
  if (stored.otp !== String(otp).trim()) {
    return res.json({ valid: false, error: 'Incorrect code. Please check and try again.' });
  }

  // ✓ OTP matches — confirm the user in AWS Cognito via Admin API
  pendingOTPs.delete(key);

  if (process.env.COGNITO_USER_POOL_ID) {
    try {
      const cognitoAdmin = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
      // Confirm the user (status UNCONFIRMED → CONFIRMED)
      await cognitoAdmin.send(new AdminConfirmSignUpCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username:   email,
      }));
      // AdminConfirmSignUpCommand does NOT automatically set email_verified.
      // We must set it explicitly so login's email_verified check passes.
      await cognitoAdmin.send(new AdminUpdateUserAttributesCommand({
        UserPoolId:     process.env.COGNITO_USER_POOL_ID,
        Username:       email,
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      }));
      console.log(`[otp] ✅ Cognito user confirmed + email verified: ${email}`);
    } catch (err) {
      // If user is already confirmed, AdminConfirmSignUpCommand throws NotAuthorizedException.
      // Still try to set email_verified in case it isn't set yet.
      if (err.name === 'NotAuthorizedException' || err.message?.includes('CONFIRMED')) {
        try {
          const cognitoAdmin2 = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
          await cognitoAdmin2.send(new AdminUpdateUserAttributesCommand({
            UserPoolId:     process.env.COGNITO_USER_POOL_ID,
            Username:       email,
            UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
          }));
          console.log(`[otp] ✅ email_verified set for already-confirmed user: ${email}`);
        } catch { /* ignore */ }
      } else {
        console.error('[otp] Cognito confirm error:', err.message);
      }
    }
  } else {
    console.warn('[otp] COGNITO_USER_POOL_ID not set — skipping user confirmation');
  }

  res.json({ valid: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── 9. Email Existence Validator ────────────────────────────────────────────
// Called from the signup / login form while the user is typing.
// Three-layer check:
//   1. Basic format regex
//   2. Disposable / throwaway domain blocklist
//   3. DNS MX record lookup — if the domain has no mail server the email can't exist
//
// Returns { valid: true } or { valid: false, reason: "human-readable message" }
// Responds in <200 ms for cached DNS; first-lookup is ~300–500 ms.

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','guerrillamailblock.com','grr.la',
  'guerrillamail.info','guerrillamail.biz','guerrillamail.de','guerrillamail.net',
  'guerrillamail.org','tempmail.com','throwam.com','yopmail.com','yopmail.fr',
  'sharklasers.com','spam4.me','trashmail.com','trashmail.me','trashmail.net',
  'trashmail.at','trashmail.io','trashmail.org','fakeinbox.com','maildrop.cc',
  '10minutemail.com','10minutemail.net','temp-mail.org','throwaway.email',
  'dispostable.com','mailnull.com','spamgourmet.com','discard.email',
  'mailforspam.com','binkmail.com','getonemail.com','mailnesia.com',
  'spamfree24.org','tempr.email','inboxkitten.com','tempinbox.com',
  'mailpoof.com','getnada.com','filzmail.com','spamgrap.com','spamgrap.org',
  'trashmail.fr','temp.email','tempail.com','tmail.com','zetmail.com',
  'spamoverlord.com','spamspot.com','spamfighter.com','fakemailgenerator.com',
  'mohmal.com','spamgourmet.net','crapmail.org','bspamfree.org','spambog.com',
  'mailnull.com','spamfree.eu','spamfree24.de','wh4f.org','uggsrock.com',
  'explodemail.com','tempe-mail.com','cool.fr.nf','jetable.fr.nf','nospam.ze.tc',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]{1,253}\.[^\s@]{2,}$/;

// Simple in-process MX cache — avoids hammering DNS for the same domain twice.
const mxCache = new Map(); // domain → { valid, ts }
const MX_CACHE_TTL = 10 * 60 * 1000; // 10 min

const checkDomainMX = async (domain) => {
  const now = Date.now();
  const cached = mxCache.get(domain);
  if (cached && (now - cached.ts) < MX_CACHE_TTL) return cached.valid;

  try {
    const records = await dnsResolve.resolveMx(domain);
    const valid = Array.isArray(records) && records.length > 0;
    mxCache.set(domain, { valid, ts: now });
    return valid;
  } catch {
    mxCache.set(domain, { valid: false, ts: now });
    return false;
  }
};

app.post('/functions/v1/validate-email', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();

  // 1. Format
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.json({ valid: false, reason: 'Please enter a valid email address.' });
  }

  const domain = email.split('@')[1];

  // 2. Disposable
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.json({ valid: false, reason: 'Temporary/disposable email addresses are not allowed. Please use a real inbox.' });
  }

  // 3. MX record — does this domain actually receive email?
  const hasMX = await checkDomainMX(domain);
  if (!hasMX) {
    return res.json({ valid: false, reason: `"${domain}" cannot receive emails. Please check for typos or use a different address.` });
  }

  return res.json({ valid: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── 9. Auth Notification Endpoint ───────────────────────────────────────────
// Called by the frontend after every successful sign-in or sign-up.
// Sends a formatted HTML email to the ADMIN_NOTIFY_EMAIL address so the owner
// can see every login/signup in real time — customer name, email, event type,
// timestamp, browser/device info.
//
// Setup (fill in server/.env):
//   NOTIFY_FROM_EMAIL = a Gmail address you own (e.g. alerts@example.com)
//   NOTIFY_FROM_PASS  = Gmail App Password (myaccount.google.com → Security → App Passwords)
//   ADMIN_NOTIFY_EMAIL = admin@example.com
//
// If credentials are missing the endpoint returns 200 silently so logins never fail.
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || '';

// Detect SMTP provider from the sender's domain — Hostinger, Outlook/365, or Gmail.
const detectSMTPConfig = (email) => {
  if (!email) return null;
  const domain = email.split('@')[1]?.toLowerCase() || '';

  // Hostinger custom-domain email (MX: mx1.hostinger.com)
  // Port 465 + secure:true (SSL) is Hostinger's recommended config for custom domains.
  // Port 587 STARTTLS triggers auth failures on many Hostinger shared-hosting accounts.
  if (domain !== 'gmail.com' && domain !== 'outlook.com' && domain !== 'hotmail.com') {
    return { host: 'smtp.hostinger.com', port: 465, secure: true };
  }
  // Microsoft / Outlook
  if (domain === 'outlook.com' || domain === 'hotmail.com') {
    return { host: 'smtp-mail.outlook.com', port: 587, secure: false };
  }
  // Gmail (needs App Password, not regular password)
  return { host: 'smtp.gmail.com', port: 587, secure: false };
};

// Build (or rebuild) the SMTP transporter. Called at startup and again to
// self-heal after a send failure. We NEVER permanently disable email on a
// transient blip — that previously left email dead until the next redeploy,
// which is why OTPs "stopped working after a few days" (an EB restart at a bad
// moment would trip the old verify() and null the transporter for good).
function buildTransporter() {
  if (!process.env.NOTIFY_FROM_EMAIL || !process.env.NOTIFY_FROM_PASS) return null;
  const smtpConfig = detectSMTPConfig(process.env.NOTIFY_FROM_EMAIL);
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: process.env.NOTIFY_FROM_EMAIL, pass: process.env.NOTIFY_FROM_PASS },
    tls: { rejectUnauthorized: false }, // tolerate self-signed certs on shared hosting
    pool: true, maxConnections: 3, maxMessages: 100,
  });
}

let emailTransporter = buildTransporter();
if (emailTransporter) {
  // Startup check is advisory ONLY — a transient failure must not disable email,
  // because sending is attempted (and self-heals) on every request below.
  emailTransporter.verify((err) => {
    if (err) console.warn('[email] ⚠️  startup SMTP check failed (will still try per-send):', err.message);
    else console.log('[email] ✅ Transporter ready →', ADMIN_NOTIFY_EMAIL);
  });
} else {
  console.warn('[email] NOTIFY_FROM_EMAIL / NOTIFY_FROM_PASS not set — email disabled.');
}

// Resilient send: try once; on failure, rebuild the transporter and retry once.
// Handles stale pooled connections, momentary auth hiccups, and Hostinger blips
// without staying broken until a redeploy.
async function sendEmailResilient(mailOptions) {
  if (!emailTransporter) emailTransporter = buildTransporter();
  if (!emailTransporter) throw new Error('email not configured');
  try {
    return await emailTransporter.sendMail(mailOptions);
  } catch (err) {
    console.warn('[email] send failed, rebuilding transporter and retrying once:', err.message);
    try { emailTransporter.close?.(); } catch { /* ignore */ }
    emailTransporter = buildTransporter();
    if (!emailTransporter) throw err;
    return await emailTransporter.sendMail(mailOptions);
  }
}

const buildNotifyHTML = ({ event, name, email, timestamp, userAgent }) => {
  const eventLabel  = event === 'signup' ? '🆕 New Sign-Up' : '🔐 New Login';
  const eventColour = event === 'signup' ? '#16a34a' : '#2563eb';
  const dt = new Date(timestamp || Date.now());
  const dateStr = dt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#f4f4f5; margin:0; padding:24px; }
  .card { background:#fff; border-radius:12px; max-width:520px; margin:0 auto; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
  .header { background:${eventColour}; padding:24px 28px; }
  .header h1 { color:#fff; margin:0; font-size:20px; font-weight:700; }
  .header p  { color:rgba(255,255,255,.8); margin:4px 0 0; font-size:13px; }
  .body { padding:28px; }
  .row { display:flex; padding:10px 0; border-bottom:1px solid #f1f5f9; }
  .row:last-child { border-bottom:none; }
  .label { color:#64748b; font-size:12px; font-weight:600; text-transform:uppercase; width:110px; flex-shrink:0; }
  .value { color:#0f172a; font-size:14px; word-break:break-all; }
  .footer { background:#f8fafc; padding:16px 28px; text-align:center; }
  .footer p { color:#94a3b8; font-size:11px; margin:0; }
</style></head>
<body>
  <div class="card">
    <div class="header">
      <h1>${eventLabel}</h1>
      <p>Counsel AI — Customer Activity Alert</p>
    </div>
    <div class="body">
      <div class="row"><span class="label">Event</span>   <span class="value">${event === 'signup' ? 'New Account Created' : 'User Signed In'}</span></div>
      <div class="row"><span class="label">Name</span>    <span class="value">${name || '—'}</span></div>
      <div class="row"><span class="label">Email</span>   <span class="value">${email}</span></div>
      <div class="row"><span class="label">Time (IST)</span><span class="value">${dateStr}</span></div>
      <div class="row"><span class="label">Device</span>  <span class="value">${(userAgent || '').slice(0, 120)}</span></div>
    </div>
    <div class="footer">
      <p>Automated notification from Counsel AI · Do not reply</p>
    </div>
  </div>
</body>
</html>`;
};

app.post('/functions/v1/auth-notify', async (req, res) => {
  // Always return 200 so a notification failure never blocks login.
  res.json({ ok: true });

  const { event, name, email, timestamp, userAgent } = req.body || {};
  if (!email) return;

  const subject = event === 'signup'
    ? `🆕 New Sign-Up: ${name || email} — Counsel AI`
    : `🔐 Login: ${name || email} — Counsel AI`;

  try {
    await sendEmailResilient({
      from: `"Counsel AI Alerts" <${process.env.NOTIFY_FROM_EMAIL}>`,
      to: ADMIN_NOTIFY_EMAIL,
      subject,
      html: buildNotifyHTML({ event, name, email, timestamp, userAgent }),
    });
    console.log(`[email] Notification sent → ${ADMIN_NOTIFY_EMAIL} (${event}: ${email})`);
  } catch (err) {
    console.error('[email] Failed to send notification:', err.message);
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  AWS COGNITO + DYNAMODB — Auth middleware + Data API
// ═════════════════════════════════════════════════════════════════════════════

// ── Cognito JWT verifier ────────────────────────────────────────────────────
let jwtVerifier = null;
if (process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID) {
  jwtVerifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    tokenUse:   'access',
    clientId:   process.env.COGNITO_CLIENT_ID,
  });
  console.log('[cognito] JWT verifier ready for pool', process.env.COGNITO_USER_POOL_ID);
} else {
  console.warn('[cognito] COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID not set — /api/* routes disabled');
}

const requireAuth = async (req, res, next) => {
  if (!jwtVerifier) return res.status(503).json({ error: 'Auth not configured (missing Cognito env vars)' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    const payload = await jwtVerifier.verify(token);
    req.userId    = payload.sub;          // Cognito sub = unique user ID
    req.userEmail = payload.username || payload['cognito:username'] || '';
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── DynamoDB client ─────────────────────────────────────────────────────────
const ddbRaw = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb    = DynamoDBDocumentClient.from(ddbRaw, {
  marshallOptions:   { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

const CASES_TABLE  = process.env.CASES_TABLE  || 'counselai-cases';
const EVENTS_TABLE = process.env.EVENTS_TABLE || 'counselai-calendar-events';

// Auto-create DynamoDB tables on startup (idempotent)
const ensureTable = async (tableName, keySchema, attrDefs) => {
  try {
    await ddbRaw.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      await ddbRaw.send(new CreateTableCommand({
        TableName: tableName, KeySchema: keySchema,
        AttributeDefinitions: attrDefs, BillingMode: 'PAY_PER_REQUEST',
      }));
      console.log(`[dynamo] ✅ Created table: ${tableName}`);
    } else {
      console.error(`[dynamo] Table check error (${tableName}):`, e.message);
    }
  }
};

if (process.env.COGNITO_USER_POOL_ID) {
  Promise.all([
    ensureTable(CASES_TABLE,
      [{ AttributeName:'userId', KeyType:'HASH' }, { AttributeName:'caseId', KeyType:'RANGE' }],
      [{ AttributeName:'userId', AttributeType:'S' }, { AttributeName:'caseId', AttributeType:'S' }]),
    ensureTable(EVENTS_TABLE,
      [{ AttributeName:'userId', KeyType:'HASH' }, { AttributeName:'eventId', KeyType:'RANGE' }],
      [{ AttributeName:'userId', AttributeType:'S' }, { AttributeName:'eventId', AttributeType:'S' }]),
  ]).then(() => console.log('[dynamo] Tables ready'))
    .catch(e => console.error('[dynamo] Setup error:', e.message));
}

// ── Confirm password reset (OTP + Cognito AdminSetUserPassword) ──────────────
app.post('/functions/v1/confirm-password-reset', async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const key    = email.toLowerCase().trim();
  const stored = pendingOTPs.get(key);

  if (!stored) return res.json({ ok: false, error: 'No reset request found. Please request a new code.' });
  if (Date.now() > stored.expiresAt) {
    pendingOTPs.delete(key);
    return res.json({ ok: false, error: 'Code expired. Please request a new one.' });
  }
  if (stored.otp !== String(otp).trim()) {
    return res.json({ ok: false, error: 'Incorrect code. Please check and try again.' });
  }

  pendingOTPs.delete(key);

  if (!process.env.COGNITO_USER_POOL_ID) {
    return res.json({ ok: false, error: 'Auth not configured on server.' });
  }

  try {
    const cognitoAdmin = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    await cognitoAdmin.send(new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username:   email,
      Password:   newPassword,
      Permanent:  true,
    }));
    console.log(`[reset] ✅ Password reset for: ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[reset] Cognito set password error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CASES CRUD ────────────────────────────────────────────────────────────────

// GET /api/cases — list all cases for the authenticated user
app.get('/api/cases', requireAuth, async (req, res) => {
  try {
    const { limit } = req.query;
    const result = await ddb.send(new QueryCommand({
      TableName: CASES_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': req.userId },
      ScanIndexForward: false, // newest first (by sort key)
    }));
    let items = result.Items || [];
    // Sort by created_at descending so newest cases appear first
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (limit) items = items.slice(0, parseInt(limit));
    res.json(items);
  } catch (err) {
    console.error('[cases] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — create a case
app.post('/api/cases', requireAuth, async (req, res) => {
  try {
    const caseId = randomUUID();
    const now    = new Date().toISOString();
    const item   = {
      userId: req.userId, caseId,
      ...req.body,
      id: caseId, created_at: now, updated_at: now,
    };
    await ddb.send(new PutCommand({ TableName: CASES_TABLE, Item: item }));
    res.json(item);
  } catch (err) {
    console.error('[cases] create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:caseId — update a case
app.put('/api/cases/:caseId', requireAuth, async (req, res) => {
  try {
    const { caseId } = req.params;
    const updated = { ...req.body, updated_at: new Date().toISOString() };
    // Build UpdateExpression dynamically
    const fields = Object.keys(updated).filter(k => k !== 'userId' && k !== 'caseId');
    const expr   = 'SET ' + fields.map((k, i) => `#f${i} = :v${i}`).join(', ');
    const names  = Object.fromEntries(fields.map((k, i) => [`#f${i}`, k]));
    const values = Object.fromEntries(fields.map((k, i) => [`:v${i}`, updated[k]]));

    const result = await ddb.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { userId: req.userId, caseId },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    res.json(result.Attributes);
  } catch (err) {
    console.error('[cases] update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:caseId
app.delete('/api/cases/:caseId', requireAuth, async (req, res) => {
  try {
    await ddb.send(new DeleteCommand({
      TableName: CASES_TABLE,
      Key: { userId: req.userId, caseId: req.params.caseId },
    }));
    res.json({ ok: true });
  } catch (err) {
    console.error('[cases] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CALENDAR EVENTS CRUD ──────────────────────────────────────────────────────

// GET /api/calendar-events?from=ISO&to=ISO&limit=N
app.get('/api/calendar-events', requireAuth, async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    let result = await ddb.send(new QueryCommand({
      TableName: EVENTS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': req.userId },
      ScanIndexForward: true,
    }));

    let items = result.Items || [];
    if (from) items = items.filter(e => e.start_time >= from);
    if (to)   items = items.filter(e => e.start_time <= to);
    if (limit) items = items.slice(0, parseInt(limit));

    res.json(items);
  } catch (err) {
    console.error('[events] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar-events — create an event
app.post('/api/calendar-events', requireAuth, async (req, res) => {
  try {
    const eventId = randomUUID();
    const now     = new Date().toISOString();
    const item    = {
      userId: req.userId, eventId,
      ...req.body,
      id: eventId, created_at: now,
    };
    await ddb.send(new PutCommand({ TableName: EVENTS_TABLE, Item: item }));
    res.json(item);
  } catch (err) {
    console.error('[events] create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar-events/:eventId
app.delete('/api/calendar-events/:eventId', requireAuth, async (req, res) => {
  try {
    await ddb.send(new DeleteCommand({
      TableName: EVENTS_TABLE,
      Key: { userId: req.userId, eventId: req.params.eventId },
    }));
    res.json({ ok: true });
  } catch (err) {
    console.error('[events] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GOOGLE SIGN-IN (bridge: Google JWT → real Cognito tokens) ────────────────
//
// Flow:
//  1. Frontend gets a Google credential (JWT) via @react-oauth/google
//  2. POST here with { credential }
//  3. We verify with Google's tokeninfo endpoint (no SDK needed)
//  4. Create/update Cognito user with a deterministic bridge-password derived
//     from the user's immutable Google sub + a server secret
//  5. Authenticate that user with Cognito → return real Cognito access tokens
//
// The bridge-password is NEVER sent to the frontend and NEVER stored in plain.
// It's derived deterministically so repeated Google sign-ins always work.

import { createHmac } from 'crypto'; // already available — Node built-in

const GOOGLE_BRIDGE_SECRET = process.env.GOOGLE_BRIDGE_SECRET || '';

const deriveGooglePassword = (googleSub) => {
  // Produces e.g. "Gg$a1b2c3d4e5f6g7h8i9j0A1!" — always satisfies Cognito policy
  const hash = createHmac('sha256', GOOGLE_BRIDGE_SECRET).update(googleSub).digest('hex').slice(0, 20);
  return `Gg$${hash}Lc1!`;
};

app.post('/functions/v1/google-signin', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Google credential required' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in not configured on server' });
  if (!process.env.COGNITO_USER_POOL_ID) return res.status(503).json({ error: 'Cognito not configured on server' });

  try {
    // 1. Verify Google JWT via Google's public endpoint (no SDK needed)
    const tokenInfoResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const payload = await tokenInfoResp.json();

    if (payload.error) return res.status(401).json({ error: `Google token error: ${payload.error}` });
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Token audience mismatch' });

    const { email, name, sub: googleSub } = payload;
    if (!email) return res.status(401).json({ error: 'No email in Google token' });

    const bridgePassword = deriveGooglePassword(googleSub);
    const cognitoAdmin = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

    // 2. Create Cognito user if they don't exist
    try {
      await cognitoAdmin.send(new AdminCreateUserCommand({
        UserPoolId:        process.env.COGNITO_USER_POOL_ID,
        Username:          email,
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'name',           Value: name || email.split('@')[0] },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction:     'SUPPRESS', // no welcome email
        TemporaryPassword: bridgePassword,
      }));
      // Promote to permanent so ADMIN_USER_PASSWORD_AUTH works immediately
      await cognitoAdmin.send(new AdminSetUserPasswordCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username:   email,
        Password:   bridgePassword,
        Permanent:  true,
      }));
      console.log(`[google] ✅ Created Cognito user: ${email}`);
    } catch (createErr) {
      if (createErr.name?.includes('UsernameExistsException') || createErr.__type?.includes('UsernameExistsException')) {
        // User exists — ensure email_verified and name are current
        await cognitoAdmin.send(new AdminUpdateUserAttributesCommand({
          UserPoolId:     process.env.COGNITO_USER_POOL_ID,
          Username:       email,
          UserAttributes: [
            { Name: 'email_verified', Value: 'true' },
            ...(name ? [{ Name: 'name', Value: name }] : []),
          ],
        }));
        console.log(`[google] ℹ️ Existing user updated: ${email}`);
      } else {
        throw createErr;
      }
    }

    // 3. Authenticate → get real Cognito access token
    const authResult = await cognitoAdmin.send(new AdminInitiateAuthCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      ClientId:   process.env.COGNITO_CLIENT_ID,
      AuthFlow:   'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: bridgePassword },
    }));

    const session = authResult.AuthenticationResult;
    console.log(`[google] ✅ Signed in via Google: ${email}`);
    res.json({
      ok:           true,
      accessToken:  session.AccessToken,
      idToken:      session.IdToken,
      refreshToken: session.RefreshToken,
      user: {
        email,
        fullName:      name || email.split('@')[0],
        emailVerified: true,
      },
    });
  } catch (err) {
    console.error('[google] sign-in error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Default route for health check
// IMPORTANT: This must return 200 OK for AWS Elastic Beanstalk health checks
app.get('/', (req, res) => {
  res.status(200).send('Counsel AI Backend is Running (Health Check OK)');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

loadStatuteIndex();  // bundled statute RAG index (~800 central acts + Constitution + criminal laws)
loadJudgmentIndex(); // bundled judgment RAG index (Supreme Court precedents, all years)
loadStateLawIndex(); // bundled state-law index (all 36 states/UTs, act metadata)
loadStateFullTextIndex(); // Tier 2: full section text of state acts (all 36 states, disk)
loadSubordinateIndex();   // rules/notifications/circulars (disk; no-op until DB present)
loadCaseLawIndex();       // High Court + Supreme Court citations (disk, keyword-only)
loadJudgmentTextIndex();  // full text of SC judgments (disk, hybrid)
loadRegulationsIndex();   // regulator provisions (disk, hybrid)
warmEmbedder();           // load the local e5 query-embedding model at boot (self-hosted, no OpenAI)

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

