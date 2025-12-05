# Safer Consensual Image Sharing (MVP)

Consent-first sharing of sensitive images with age gating, revocation, view logging, selective blurring, and per-recipient watermarking.

## What’s inside
- **Frontend (Vite + React + TS):** auth, age verify, upload with selective blur, send/receive, secure viewer, leak tracing, block list.
- **Backend (Node + Express + TS + Prisma/Postgres):** JWT auth, mocked age verification, encrypted storage, per-recipient watermark (visible + invisible), share/revoke, view/event logging, reporting/blocking, leak-trace endpoint.
- **Storage/crypto:** Images encrypted with per-image AES-GCM keys; keys encrypted with `MASTER_KEY`. Watermarks applied on view per recipient.

## Quick start
Prereqs: Node 18+, Docker Desktop (for Postgres), Git, PowerShell.

1) Clone and enter repo  
   ```powershell
   git clone <your-repo-url>
   cd <repo>
   ```

2) Start Postgres (once)  
   ```powershell
   docker run --name esafety-pg `
     -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=esafety `
     -p 5432:5432 -d postgres:15
   ```
   On restarts: `docker start esafety-pg`.

3) Backend setup  
   ```powershell
   cd backend
   copy .env.example .env   # set secrets below
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run dev
   ```
   Set in `.env`:
   - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/esafety`
   - `JWT_SECRET`, `AGE_TOKEN_SECRET` (32-byte base64 recommended)
   - `MASTER_KEY` (32-byte base64, e.g. `openssl rand -base64 32`)

4) Frontend setup  
   ```powershell
   cd ../frontend
   npm install
   npm run dev -- --host --port 5173
   ```
   Open http://localhost:5173.

## Core flows
- **Auth & age verify:** Signup/login → call `/api/age/verify` (18+ check) → gated access.
- **Upload:** Drag/drop or select file; use the canvas to blur only chosen regions; upload encrypts the processed image.
- **Share:** Pick an uploaded image (with preview), enter recipient email, set expiry/view-only, send. Revocation stops future views.
- **View:** Recipient fetches a per-recipient watermarked image (visible corner + invisible embed) and logs view events.
- **Leak trace:** Upload a leaked/screenshot image → `/api/debug/detect-watermark` attempts to recover recipient email.
- **Block/report:** Recipients can report; users can block/unblock others (Blocked tab).

## API highlights
- Auth: `POST /api/auth/signup`, `POST /api/auth/login`
- Age: `POST /api/age/verify`
- Images: `POST /api/images/upload`, `GET /api/images/mine`, `GET /api/images/:id/preview`
- Shares: `POST /api/shares`, `GET /api/shares/sent`, `GET /api/shares/received`, `POST /api/shares/:id/revoke`
- Viewing/logging: `GET /api/shares/:id/view`, `GET /api/shares/:id/events`, `POST /api/shares/:id/events/screenshot`
- Safety: `POST /api/report`, `POST /api/block`, `GET /api/blocks`, `DELETE /api/block/:userIdToUnblock`
- Debug: `GET /api/debug/stats`, `POST /api/debug/detect-watermark`

## Architecture notes
- **Encryption at rest:** AES-256-GCM with per-image keys. Stored as `iv|authTag|ciphertext`. Keys are wrapped with `MASTER_KEY`.
- **Watermarking:** Visible (small text) + invisible (LSB with subtle modulation) applied on view per recipient. Leak trace maps recovered email → user/share. Survival under heavy edits/blur is best-effort, not guaranteed.
- **Selective blur:** Client-side canvas; user paints blur/erase; the processed image is what’s encrypted.

## Threat model (MVP reality)
- Protects: at-rest encryption; basic consent gating; revocation for future views; per-recipient watermarking for traceability; view/screenshot event logging.
- Does not fully protect: determined screenshots or camera captures; heavy edits/cropping/blur can destroy watermarks; server holds keys (not E2EE); mock age verification is non-binding.

## Troubleshooting
- DB connection errors: ensure `docker start esafety-pg` and `DATABASE_URL` matches.
- Missing `MASTER_KEY`/invalid length: set a 32-byte base64 value in `.env` and restart backend.
- Frontend shows old UI: stop dev server, `npm run dev` again, hard-reload browser.
- Leak trace fails: use a fresh share/view; screenshots that heavily blur/crop the center can break the invisible mark—try less destructive edits.

## Scripts
- Backend: `npm run dev`, `npm run build`, `npm run prisma:migrate`, `npm run prisma:generate`
- Frontend: `npm run dev -- --host --port 5173`, `npm run build`, `npm run preview`

