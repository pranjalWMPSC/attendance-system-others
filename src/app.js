require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const connectDB = require('./config/db');
const requireAuth = require('./middleware/requireAuth');

const authRoutes = require('./routes/auth');
const candidateRoutes = require('./routes/candidates');
const sessionRoutes = require('./routes/sessions');
const attendanceRoutes = require('./routes/attendance');
const reportsRoutes = require('./routes/reports');

// Kick the connection off as soon as this module loads (once per cold start
// locally or on a serverless platform; mongoose queues queries until it's
// ready, so routes don't need to wait on this). Errors are logged here so a
// missing/bad MONGODB_URI doesn't surface as an unhandled rejection.
connectDB().catch(() => {});

const app = express();

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: 'lax',
      // Vercel deployments are always served over https, so the session
      // cookie can be marked secure there without breaking local http
      // development.
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
