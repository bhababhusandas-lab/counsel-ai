#!/usr/bin/env python3
"""Re-embed the RAG JSON indexes with multilingual-e5-small (384d).

The retrievers (statuteRag.js, judgmentRag.js, stateLawRag.js) only load an index
whose `dims` is 384, because queries are embedded with e5-small at runtime
(localEmbed.js / embed_service.py). Older indexes were built with OpenAI
text-embedding-3-small at 512d and are skipped entirely — including their keyword
search — so answers had no legal grounding at all.

This keeps each index's `meta` exactly as-is and only replaces the vectors.
Passages get e5's "passage: " prefix and are L2-normalised, matching the queries.

Usage:
  python3.11 server/scripts/reembed_indexes.py <source-data-dir> <output-dir> [index ...]
  e.g. python3.11 server/scripts/reembed_indexes.py server/data ~/counsel-ai-rag

Then point the server at the output with RAG_DATA_DIRS=<output-dir> in server/.env.
Progress is checkpointed per index, so an interrupted run resumes where it stopped.
"""
import base64, json, os, sys, time

import numpy as np

MODEL = 'intfloat/multilingual-e5-small'
# Small enough that a batch of long statute sections fits in Apple-GPU (MPS)
# memory; 64 ran out of memory on an Intel Mac. Override with REEMBED_BATCH.
BATCH = int(os.environ.get('REEMBED_BATCH', 16))
MAX_CHARS = 1500  # e5-small sees at most 512 tokens; this keeps batches fast

# How each index turns one meta record into the passage that gets embedded.
PASSAGE = {
    'statute-rag-index.json': lambda m: f"{m.get('act', '')} {m.get('section', '')} {m.get('heading', '')}: {m.get('text', '')}",
    'judgment-rag-index.json': lambda m: f"{m.get('title', '')} {m.get('citation', '')} {m.get('text', '')}",
    'state-law-index.json': lambda m: f"{m.get('state', '')} {m.get('title', '')} {m.get('year', '')}",
}


def _free_gpu_memory():
    try:
        import torch
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:
        pass


def reembed(model, src_dir, out_dir, name):
    src = os.path.join(src_dir, name)
    dst = os.path.join(out_dir, name)
    ckpt = dst + '.partial.npy'
    if os.path.exists(dst):
        print(f'[{name}] already done, skipping', flush=True)
        return

    with open(src, encoding='utf-8') as f:
        raw = json.load(f)
    meta = raw['meta']
    n = len(meta)
    texts = [('passage: ' + PASSAGE[name](m).strip())[:MAX_CHARS] for m in meta]

    done = np.load(ckpt) if os.path.exists(ckpt) else np.zeros((0, 384), dtype=np.float32)
    print(f'[{name}] {n} passages, resuming at {len(done)}', flush=True)
    parts = [done]
    start = time.time()
    i = len(done)
    while i < n:
        chunk = texts[i:i + BATCH * 16]
        vecs = model.encode(chunk, batch_size=BATCH, normalize_embeddings=True,
                            convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
        parts.append(vecs)
        i += len(chunk)
        _free_gpu_memory()
        np.save(ckpt, np.concatenate(parts))
        rate = (i - len(done)) / max(time.time() - start, 1e-6)
        print(f'[{name}] {i}/{n}  ({rate:.0f}/s, ~{(n - i) / max(rate, 1e-6) / 60:.1f} min left)', flush=True)

    vectors = np.concatenate(parts)
    assert vectors.shape == (n, 384), vectors.shape
    out = {
        'model': 'multilingual-e5-small',
        'dims': 384,
        'count': n,
        'meta': meta,
        'vectors_b64': base64.b64encode(vectors.astype('<f4').tobytes()).decode('ascii'),
    }
    tmp = dst + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, dst)
    os.remove(ckpt)
    print(f'[{name}] wrote {dst}', flush=True)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src_dir, out_dir = sys.argv[1], os.path.expanduser(sys.argv[2])
    names = sys.argv[3:] or list(PASSAGE)
    os.makedirs(out_dir, exist_ok=True)

    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL)
    model.max_seq_length = 512
    assert model.get_sentence_embedding_dimension() == 384

    for name in names:
        reembed(model, src_dir, out_dir, name)
    print('all done', flush=True)


if __name__ == '__main__':
    main()
