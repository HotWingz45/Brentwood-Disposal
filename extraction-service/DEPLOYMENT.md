# Brentwood Disposal — Extraction Service Deployment

## Local development

```bash
cd extraction-service
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
```

Service starts on `http://localhost:3000`.

Test:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/version
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (Railway injects this automatically) |
| `NODE_ENV` | `development` | Set to `production` on host |
| `MAX_PAYLOAD_BYTES` | `26214400` (25 MB) | Max request body size |
| `EXTRACTION_TIMEOUT_MS` | `60000` | Per-request extraction timeout |
| `OCR_TIMEOUT_MS` | `30000` | Per-page OCR timeout |
| `ENABLE_OCR` | `false` | Set to `true` to enable scanned PDF OCR |
| `OCR_THRESHOLD_CHARS_PER_PAGE` | `80` | Below this → detected as scanned |
| `AI_CLEANUP_PROVIDER` | _(empty)_ | `openai` to enable AI address cleanup |
| `OPENAI_API_KEY` | — | Required if `AI_CLEANUP_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model for cleanup |
| `ALLOWED_ORIGINS` | _(empty = all)_ | Comma-separated CORS origins |
| `EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL` | — | Set this in the **app's** `.env`, not here |

---

## Mobile app wiring

In `/Users/oscarelden/Dev/BrentwoodDisposal/.env`:
```
EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL=https://your-service-url.com
```

---

## Deploy: Railway

1. `railway login && railway init`
2. Set environment variables in Railway dashboard
3. `railway up`

Railway detects Node.js automatically. Add `"engines": { "node": ">=18" }` to `package.json` if needed.

For OCR support on Railway, add a `nixpacks.toml`:
```toml
[phases.setup]
nixPkgs = ["cairo", "pango", "libpng", "libjpeg", "giflib", "librsvg", "pixman"]
```

Then `npm install canvas` will succeed.

---

## Deploy: Render

1. Create a new Web Service
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Set environment variables in Render dashboard

For OCR on Render, use a Docker-based deploy:

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3100
CMD ["npm", "start"]
```

---

## Deploy: Supabase Edge Functions

Not recommended for this service — Edge Functions have a 150ms CPU time limit which is insufficient for PDF parsing. Use Railway or Render instead.

---

## Deploy: Self-hosted (VPS)

```bash
npm install
npm run build
PORT=3100 NODE_ENV=production node dist/server.js
```

Use `pm2` for process management:
```bash
npm install -g pm2
pm2 start dist/server.js --name brentwood-extraction
pm2 save
```

---

## OCR setup (optional)

OCR enables extraction from scanned PDFs. Without it, the service works for selectable-text PDFs and DOCX — which covers most dispatch software exports.

To enable OCR:
1. Install system libraries (see Docker example above)
2. `npm install canvas` (optional dependency)
3. Set `ENABLE_OCR=true` in `.env`

Tesseract.js downloads language data on first use (~4 MB for English). In production, this is cached between requests automatically.

---

## AI address cleanup (optional)

When enabled, extracted text is passed through an LLM to reconstruct broken address lines, remove OCR noise, and normalize formatting.

```
AI_CLEANUP_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Cost estimate: ~$0.002 per typical route sheet (gpt-4o-mini pricing). Only runs when extraction produces text — not on empty/failed files.

---

## Supported file types

| Format | Extraction | OCR needed? |
|---|---|---|
| PDF (selectable text) | ✅ pdf-parse | No |
| PDF (scanned) | ✅ Tesseract OCR | Yes — enable OCR |
| DOCX | ✅ mammoth | No |
| DOC (old Word) | ⚠ mammoth (partial) | No |

CSV, XLSX, TXT are handled **on-device** in the mobile app and never reach this service.
