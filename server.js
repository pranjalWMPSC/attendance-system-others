require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const connectDB = require('./src/config/db');
const requireAuth = require('./src/middleware/requireAuth');

const authRoutes = require('./src/routes/auth');
const candidateRoutes = require('./src/routes/candidates');
const sessionRoutes = require('./src/routes/sessions');
const attendanceRoutes = require('./src/routes/attendance');
const reportsRoutes = require('./src/routes/reports');

const app = express();
const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();

  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,
        sameSite: 'lax'
      }
    })
  );

  // Auth routes are open (you need to be able to log in before you're authenticated).
  app.use('/api/auth', authRoutes);

  // Candidates & sessions: reading is public (the open Mark Attendance page needs
  // the roster and session list), but adding/removing them requires admin login —
  // each router applies requireAuth on its own POST/DELETE routes.
  app.use('/api/candidates', candidateRoutes);
  app.use('/api/sessions', sessionRoutes);

  // Attendance marking is fully open — this is the "share this link" page.
  // It only exposes minimal status info (no photos/location) on its read route;
  // full detail lives behind /api/reports.
  app.use('/api/attendance', attendanceRoutes);

  // Reports (counts + photos + location per session) are admin-only.
  app.use('/api/reports', requireAuth, reportsRoutes);

  // Static frontend:
  //  - public/index.html (admin) gates itself behind /api/auth/me — see public/js/app.js
  //  - public/mark.html (open marking page) has no login gate at all — see public/js/mark.js
  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(PORT, () => {
    console.log('');
    console.log(`WMPSC Attendance running at http://localhost:${PORT}`);
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
