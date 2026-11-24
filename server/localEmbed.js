// Local, self-hosted query embeddings (multilingual-e5-small, 384-dim) via
// transformers.js (onnxruntime). Replaces the OpenAI embeddings API so retrieval
// runs with no external key/credits. The bundled corpus indexes are embedded with
// the SAME model (Python sentence-transformers, full precision); this uses the
// fp32 ONNX so query and passage vectors live in the same space.
//
// e5 REQUIRES asymmetric prefixes: passages are embedded as "passage: ..." (done
// at index-build time) and queries as "query: ..." (here). Vectors are L2-normalized
// so cosine == dot product, matching the retrievers.
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _extractor = null;
let _loading = null;
let _disabled = false;

async function getExtractor() {
  if (_extractor) return _extractor;
  if (_disabled) return null;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Bundle the model with the deploy; never hit the network at runtime.
      env.allowRemoteModels = false;
      env.localModelPath = path.join(__dirname, 'models');
      const ex = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        dtype: 'q8', // int8 quantized: ~112MB, 0.998 cosine agreement with the
                     // full-precision corpus vectors — imperceptible for retrieval.
      });
      _extractor = ex;
      console.log('[embed] local e5 model ready (384d, q8)');
      return ex;
    } catch (e) {
      // Not fatal and not necessarily keyword-only: the Python sidecar is tried
      // next. Report the real reason briefly, without the huge require stack.
      const why = /onnxruntime_binding\.node/.test(e.message)
        ? 'no onnxruntime binary for this platform'
        : e.message.split('\n')[0];
      console.log(`[embed] in-process model unavailable (${why}); trying sidecar`);
      _disabled = true; // don't retry the in-process path on every query
      return null;
    }
  })();
  return _loading;
}

// Fallback path: a local Python sidecar (server/embed_service.py) running the same
// e5 model. Needed because onnxruntime-node ships no darwin/x64 binary, so on an
// Intel Mac the in-process path above cannot load at all. Prod (linux/x64) and
// Apple Silicon use transformers.js directly and never touch this.
const SIDECAR = process.env.EMBED_SERVICE_URL || 'http://127.0.0.1:8399';
let _sidecarOk = null; // null = untested, true/false = known
let _sidecarRetryAt = 0; // after a failure, try the sidecar again at this time

async function sidecarEmbed(text) {
  // A failure used to be permanent for the life of the process: one slow reply
  // while the Mac was busy at startup left every vector search keyword-only until
  // the next restart. Re-check once a minute instead.
  if (_sidecarOk === false && Date.now() < _sidecarRetryAt) return null;
  try {
    const res = await fetch(`${SIDECAR}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 2000), kind: 'query' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j.vector)) throw new Error('bad payload');
    if (_sidecarOk !== true) { _sidecarOk = true; console.log(`[embed] using embedding sidecar at ${SIDECAR} (${j.dims}d)`); }
    return j.vector;
  } catch (e) {
    if (_sidecarOk !== false) console.warn(`[embed] sidecar unavailable (${e.message}); keyword-only retrieval until it answers again`);
    _sidecarOk = false; _sidecarRetryAt = Date.now() + 60000;
    return null;
  }
}

// A single user query fans out to ~8 retrieval passes, several of which call
// embedQuery twice — all with the SAME query text. On the sidecar path that is
// a single-threaded round-trip each, so those 10-16 identical embeds serialize
// and dominate retrieval latency (seen: 10-60s/query). Two guards fix this:
//   1. in-flight de-dup — concurrent calls for the same text share ONE promise,
//      collapsing the parallel wave into a single embed;
//   2. a tiny TTL cache — a repeated query (or the second call within a pass)
//      returns instantly. Identical text always maps to an identical vector, so
//      caching is exact, never approximate.
const _qcache = new Map();   // key -> { vec, t }
const _inflight = new Map(); // key -> Promise<vec|null>
const QC_TTL = 120000;       // 2 min — queries rarely repeat beyond a session turn
const QC_MAX = 128;

async function _embedOnce(key) {
  const ex = await getExtractor();
  if (ex) {
    const out = await ex('query: ' + key, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }
  return sidecarEmbed(key);
}

// Returns a 384-length number[] (L2-normalized), or null if no embedder is
// reachable. Retrievers treat null as "keyword-only" so search still works.
export async function embedQuery(text) {
  const key = String(text).slice(0, 2000);
  const now = Date.now();
  const hit = _qcache.get(key);
  if (hit && now - hit.t < QC_TTL) return hit.vec;
  if (hit) _qcache.delete(key); // expired
  const pending = _inflight.get(key);
  if (pending) return pending;  // a concurrent call is already embedding this text
  const p = _embedOnce(key).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  const vec = await p;
  if (vec) { // never cache a null (embedder down) — let it retry
    _qcache.set(key, { vec, t: now });
    if (_qcache.size > QC_MAX) _qcache.delete(_qcache.keys().next().value);
  }
  return vec;
}

// Warm whichever embedder is available so the first user query isn't slow, and
// state plainly which path retrieval will actually use.
export async function warmEmbedder() {
  try {
    if (await getExtractor()) return;
    const v = await sidecarEmbed('warmup');
    if (!v) {
      console.warn('[embed] NO embedder available — retrieval is KEYWORD-ONLY. '
        + 'Start it with: python3.11 server/embed_service.py 8399');
    }
  } catch { /* ignore */ }
}
