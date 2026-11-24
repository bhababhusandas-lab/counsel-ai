# Counsel AI

An AI legal assistant for Indian law: ask a question by text or voice, in English or Indian languages, and get an answer grounded in the actual statutes, state Acts, rules and court judgments, with sources.

## What it does
- Chat and voice mode (speech-to-text in, text-to-speech out), multi-language replies
- Retrieval-augmented answers over central Acts, state Acts, subordinate legislation, regulations, Supreme Court and High Court judgments
- Document upload: summarise and ask questions about your own legal documents
- Document drafting helpers

## How the search works (server/)
- **Hybrid retrieval**: SQLite FTS5 (BM25 keyword) + vector search (sqlite-vec), fused with weighted Reciprocal Rank Fusion (`hybrid.js`)
- **Embeddings**: multilingual-e5-small for most indexes, BGE-M3 (1024d) for statutes, served by small Python sidecars (`embed_service.py`, `bge_embed_service.py`) with automatic fallback
- **Disk-based indexes**: large corpora (20M+ case-law rows, 1.3M rule chunks) are searched on disk, so server RAM stays low
- **Legal query expansion**: lay terms mapped to statutory wording ("cheque bounce" -> dishonour of cheque, section 138)
- **State routing**: cities, old names and Hindi names map to the right state ("landlord in Mumbai" -> Maharashtra Acts)
- **Code-map guard** (`codeMap.js`): IPC -> BNS, CrPC -> BNSS, Evidence Act -> BSA section renumbering
- **Citator guard** (`citator.js`): flags overruled judgments before they are cited
- **Token budgeting**: retrieved context is trimmed to fit the LLM's limits

## Stack
- Frontend: React + TypeScript + Vite, Tailwind, shadcn/ui (`src/`)
- Backend: Node.js + Express (`server/server.js`), any OpenAI-compatible LLM endpoint
- Auth: AWS Cognito (optional)

## Run locally
```bash
npm install
cp .env.example .env            # frontend settings
cd server && npm install
cp .env.example .env            # add your LLM key (see comments inside)
node server.js                  # backend on :8080
```
In another terminal, from the project root: `npm run dev`.

The search indexes (.db and index .json files) are not included; `server/scripts/reembed_indexes.py` rebuilds the JSON indexes with the e5-small model, and the `server/scripts/` builders show how they are made from public legal text. Without them the chat still runs, just without retrieval.
