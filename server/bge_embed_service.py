#!/usr/bin/env python3
"""BGE-M3 query-embedding sidecar for the statute index.

The statute sections are embedded with BAAI/bge-m3 (1024d); a query must be
embedded with the SAME model to be comparable. Every other index still uses
multilingual-e5-small via embed_service.py (:8399), so this runs as a separate
small service instead of replacing that one. BGE-M3 takes no query/passage prefix.

  POST /embed  {"text": "..."}  -> {"vector": [...1024], "dims": 1024}
  GET  /health                  -> {"ok": true, "model": ..., "dims": ...}

If this service is down, statuteRag.js falls back to the e5 vectors on its own.
Start with:  python3.11 server/bge_embed_service.py [port]
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
import torch
torch.set_num_threads(int(os.environ.get('BGE_THREADS', '4')))

MODEL = os.environ.get('BGE_MODEL', 'BAAI/bge-m3')
PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('BGE_PORT', 8398))

print(f'[bge-service] loading {MODEL} ...', flush=True)
from sentence_transformers import SentenceTransformer
# CPU on purpose: on this Intel Mac the Metal backend runs out of memory.
_model = SentenceTransformer(MODEL, device='cpu')
_model.max_seq_length = 256  # queries are short; keeps latency low and bounded
DIMS = _model.get_sentence_embedding_dimension()
print(f'[bge-service] ready on :{PORT} dims={DIMS}', flush=True)


def embed(text):
    v = _model.encode([text[:2000]], normalize_embeddings=True)[0]
    return [float(x) for x in v]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/health'):
            self._send(200, {'ok': True, 'model': MODEL, 'dims': DIMS})
        else:
            self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not self.path.startswith('/embed'):
            return self._send(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', 0))
            req = json.loads(self.rfile.read(n) or b'{}')
            text = req.get('text') or ''
            if not text.strip():
                return self._send(400, {'error': 'text required'})
            self._send(200, {'vector': embed(text), 'dims': DIMS})
        except Exception as e:  # never take the API down over one bad query
            self._send(500, {'error': str(e)[:200]})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
