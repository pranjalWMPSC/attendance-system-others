# WMPSC Attendance Tracker (local)

A local attendance system with two separate pages:

- **`/index.html`** — the admin app (behind a login): create class sessions,
  manage the candidate roster, and view reports (present/absent/not-marked
  counts, photos, location, per session).
- **`/mark.html`** — an open, no-login page for actually marking attendance.
  Share its link with whoever is on-site marking candidates. Every photo here
  is taken live through the browser's camera — there's no way to upload an
  existing picture instead.

Photos are stored in Cloudinary; everything else in MongoDB.

## 1. Install prerequisites

- **Node.js** 18 or newer — check with `node -v`.
- **MongoDB** — either:
  - a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster (get its connection string), or
  - MongoDB running locally (`mongodb://127.0.0.1:27017/wmpsc-attendance`).
- **Cloudinary** — a free account at [cloudinary.com](https://cloudinary.com). From the
  dashboard you need: **Cloud name**, **API key**, **API secret**.

## 2. Configure

```bash
cd wmpsc-attendance
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `SESSION_SECRET` — any long random string (used to sign login cookies).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — whatever you want to sign in with.
- `MONGODB_URI` — your MongoDB connection string.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — from
  your Cloudinary dashboard.

`.env` is git-ignored — your real keys never get committed.

## 3. Run it

```bash
npm start
```

- **Admin**: open **http://localhost:4000** → you'll land on the sign-in page
  first (`ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`). Sessions, roster and
  reports all require that login.
- **Mark attendance**: open **http://localhost:4000/mark.html** directly, or
  click **"Copy link"** on the admin Sessions tab — that's the link to hand to
  whoever is marking attendance. No sign-in needed there.

### The camera-only requirement and HTTPS

Photos on both pages are captured live through `getUserMedia` (a real camera
stream you capture a frame from) — there is deliberately no file/gallery
picker anywhere, so a photo can't be swapped in from an old picture.

The catch: browsers only allow `getUserMedia` on a **secure context** —
`https://`, or `http://localhost` on the *same* machine. That means:

- Testing on your own computer via `http://localhost:4000/mark.html` — camera
  works immediately.
- Opening `http://<your-pc-ip>:4000/mark.html` from a **phone** on the same
  Wi-Fi — the camera will **not** work over plain HTTP; the phone's browser
  blocks it. To test from a phone you need either:
  - a quick HTTPS tunnel for local testing (e.g. `npx localtunnel --port 4000`
    or `ngrok http 4000`), or
  - a real deployment behind HTTPS once you're past local testing.

Location (GPS) has the same secure-context rule, but degrades gracefully —
if auto-detect fails, the page just asks you to type the location in. Camera
has no such fallback by design, since the whole point is a photo taken in
the moment.

## How it works

**Admin (`/index.html`, login required)**
- **Sessions** — "Create a class" builds one or many sessions at once, all
  sharing the same start/end time, venue and radius: either a **date range**
  (with a Mon–Sun repeat filter, e.g. "every Tue and Thu from 1 Oct to 31
  Oct") or a hand-picked list of **specific dates**. A live preview shows
  exactly which dates will be created before you submit. Each date still
  becomes its own independent session with its own present/absent marks;
  dates created together are tagged with an optional class label and can be
  deleted as a group with one "Delete class" button. Attendance is only ever
  collectible on the dates you actually create here. A "Mark attendance
  link" card at the top gives you the URL to share.
- **Roster** — candidates with an optional one-time enrollment photo (also
  camera-only).
- **Reports** — a summary table across all sessions (present / absent / not
  marked / rate). Selecting a session shows the full candidate-by-candidate
  detail: status, timestamp, captured photo, location, and distance from the
  venue (flagged "Off-site" outside the allowed radius).

**Open marking page (`/mark.html`, no login)**
- Pick a session, then for each candidate: **Present** opens the camera,
  takes a photo, then asks to confirm the location (auto-detected or typed
  in) before saving. **Absent** is instant. **Clear** resets a mistaken mark.
  This page intentionally does **not** show other candidates' photos or
  captured locations — only status pills — so it stays safe to share widely.

## Project layout

```
server.js                        Express app entry point
src/config/db.js                 MongoDB connection
src/config/cloudinary.js         Cloudinary SDK config
src/config/cloudinaryUpload.js   Uploads a photo buffer straight to Cloudinary via the v2 SDK
src/models/                      Mongoose schemas (Candidate, ClassSession, Attendance)
src/middleware/requireAuth.js    Blocks admin-only routes for anyone not logged in
src/routes/auth.js               Login / logout / session check
src/routes/candidates.js         Roster — GET is public, POST/DELETE need admin login
src/routes/sessions.js           Sessions — GET is public, POST/DELETE need admin login
src/routes/attendance.js         Marking (present/absent/clear) — fully public, trimmed reads
src/routes/reports.js            Admin-only: counts + full detail with photos per session
public/index.html + js/app.js    Admin app (Sessions, Roster, Reports)
public/mark.html + js/mark.js    Open marking page
public/js/camera.js              Shared live-camera capture modal (no file picker, by design)
public/login.html                Admin sign-in
```

## A few things to know before relying on this

- **The marking link has no access control beyond the URL itself.** Anyone
  who has it can mark any candidate present/absent, or clear a mark, for any
  session — that's the tradeoff of "open to anyone with the link." If you
  want a lightweight extra barrier (a shared passcode that isn't the full
  admin login), that's a small addition — just ask and I can add it.
- Sessions use `connect-mongo` for session storage, so admin logins survive a
  server restart — fine for testing, but review `express-session` cookie
  settings (`secure: true` behind HTTPS) before putting this on the open
  internet.
- The admin password is compared in plain text against `.env` — fine for a
  single local admin; swap in `bcrypt` hashing if you ever add more admin
  accounts.
- There's no rate limiting on `/api/auth/login` or on the public attendance
  endpoints — add some (e.g. `express-rate-limit`) before exposing this
  beyond your own network.
