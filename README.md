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
  venue (flagged "Off-site" outside the allowed radius). **"Export all to
  Excel"** downloads one `.xlsx` covering every session together — a Summary
  sheet (counts per session) plus an "All Attendance" sheet with one row per
  candidate per session, each present mark's captured photo embedded as a
  thumbnail in the row.

**Open marking page (`/mark.html`, no login)**
- Pick a session, then for each candidate: **Present** opens the camera,
  takes a photo, then asks to confirm the location (auto-detected or typed
  in) before saving. **Absent** is instant. **Clear** resets a mistaken mark.
  This page intentionally does **not** show other candidates' photos or
  captured locations — only status pills — so it stays safe to share widely.

## Deploy to Vercel

The app already ships with a `vercel.json`, `api/index.js` and a
`src/app.js` that exports the Express app without starting its own server —
that's the shape Vercel's Node runtime expects, so deploying is just:

1. Push the repo to GitHub/GitLab/Bitbucket (skip if already done), then in
   the [Vercel dashboard](https://vercel.com/new) choose **Import Project**
   and pick that repo.
2. Vercel will detect it as a plain Node project — no build command is
   needed, so you can leave the build settings at their defaults.
3. Before the first deploy (or right after, then redeploy), open **Project
   → Settings → Environment Variables** and add every key from
   `.env.example`: `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `MONGODB_URI`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET`. `.env` itself is git-ignored and never gets
   deployed, so these have to be entered here instead — that's normal, not a
   workaround. `PORT` is not needed on Vercel.
4. In MongoDB Atlas, go to **Network Access** and allow access from
   `0.0.0.0/0` (or add Vercel's IPs if you're on a plan with static
   outbound IPs). Vercel's serverless functions don't have a single fixed
   IP by default, so a narrow allowlist will block every connection.
5. Deploy. Your app is now live at `https://<project-name>.vercel.app` —
   share the `/mark.html` link from there instead of a local address.

A couple of things work out better once you're on Vercel than they do
locally:
- **The camera/location HTTPS requirement is automatically satisfied** —
  `https://<project-name>.vercel.app/mark.html` works on any phone straight
  away, no `ngrok`/`localtunnel` tunnel needed anymore.
- Session cookies are marked `secure` automatically in production (Vercel
  sets `NODE_ENV=production` for you), so logins are only ever sent over
  HTTPS.

One limit worth knowing: Vercel serverless functions cap a single request
body at **4.5 MB**. The in-browser photo compression already added (capped
to 1024px, quality 0.8, then re-compressed again on Cloudinary's side) keeps
a typical attendance photo well under that, so you shouldn't hit it in
normal use — just don't loosen those limits without re-checking.

To update a live deployment later, just push to the branch Vercel is
tracking (or run `vercel --prod` from the CLI) — no other steps needed.

## Project layout

```
server.js                        Local dev entry point (node server.js) — not used on Vercel
api/index.js                     Vercel entry point — exports the same Express app as a serverless function
src/app.js                       Builds the Express app (middleware + routes); both entry points use this
vercel.json                      Routes every request to api/index.js and bundles public/ with the function
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
  server restart. The session cookie is marked `secure` automatically when
  `NODE_ENV=production` (which Vercel sets for you) — locally over plain
  HTTP it isn't, which is expected.
- The admin password is compared in plain text against `.env` — fine for a
  single local admin; swap in `bcrypt` hashing if you ever add more admin
  accounts.
- There's no rate limiting on `/api/auth/login` or on the public attendance
  endpoints — add some (e.g. `express-rate-limit`) before exposing this
  beyond your own network.
