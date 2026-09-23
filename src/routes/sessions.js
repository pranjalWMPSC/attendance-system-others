const express = require('express');
const crypto = require('crypto');
const ClassSession = require('../models/ClassSession');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');
const cloudinary = require('../config/cloudinary');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function deleteSessionsCascade(sessionDocs) {
  const ids = sessionDocs.map((s) => s._id);
  const records = await Attendance.find({ sessionId: { $in: ids } });
  for (const r of records) {
    if (r.photoPublicId) {
      try { await cloudinary.uploader.destroy(r.photoPublicId); } catch (e) { /* best effort */ }
    }
  }
  await Attendance.deleteMany({ sessionId: { $in: ids } });
  await Feedback.deleteMany({ sessionId: { $in: ids } });
  await ClassSession.deleteMany({ _id: { $in: ids } });
}

// GET /api/sessions — public (the open Mark Attendance page needs the session list
// to let whoever is marking pick today's class).
router.get('/', async (req, res) => {
  try {
    const sessions = await ClassSession.find().sort({ date: -1, startTime: -1 });
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions — admin only
router.post('/', requireAuth, async (req, res) => {
  try {
    const { date, startTime, endTime, venueName, venueAddress, venueLat, venueLng, radiusM } = req.body || {};
    if (!date || !startTime || !endTime || !venueName || !venueName.trim()) {
      return res.status(400).json({ error: 'Date, start/end time and venue name are required' });
    }
    const doc = await ClassSession.create({
      date,
      startTime,
      endTime,
      venueName: venueName.trim(),
      venueAddress: (venueAddress || '').trim(),
      venueLat: venueLat !== undefined && venueLat !== null && venueLat !== '' ? Number(venueLat) : null,
      venueLng: venueLng !== undefined && venueLng !== null && venueLng !== '' ? Number(venueLng) : null,
      radiusM: radiusM !== undefined && radiusM !== null && radiusM !== '' ? Number(radiusM) : 300
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/:id — admin only; also removes that session's attendance
// records, photos and feedback responses
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const doc = await ClassSession.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Session not found' });
    await deleteSessionsCascade([doc]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/batch — admin only. Creates one session per date out of
// a date range or a hand-picked list of dates, all sharing the same time and
// venue — this is the "create a class" flow: attendance is only ever
// required on the exact dates given here, each still tracked as its own
// independent session (its own present/absent marks and report row).
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { label, dates, startTime, endTime, venueName, venueAddress, venueLat, venueLng, radiusM } = req.body || {};

    if (!startTime || !endTime || !venueName || !venueName.trim()) {
      return res.status(400).json({ error: 'Start/end time and venue name are required' });
    }
    if (!Array.isArray(dates) || !dates.length) {
      return res.status(400).json({ error: 'At least one date is required' });
    }
    const cleanDates = Array.from(new Set(dates)).filter((d) => typeof d === 'string' && DATE_RE.test(d)).sort();
    if (!cleanDates.length) {
      return res.status(400).json({ error: 'No valid dates were given' });
    }

    const batchId = cleanDates.length > 1 ? crypto.randomUUID() : null;
    const cleanVenue = venueName.trim();
    const cleanAddress = (venueAddress || '').trim();
    const cleanLat = venueLat !== undefined && venueLat !== null && venueLat !== '' ? Number(venueLat) : null;
    const cleanLng = venueLng !== undefined && venueLng !== null && venueLng !== '' ? Number(venueLng) : null;
    const cleanRadius = radiusM !== undefined && radiusM !== null && radiusM !== '' ? Number(radiusM) : 300;
    const cleanLabel = (label || '').trim();

    const created = [];
    const skipped = [];
    for (const date of cleanDates) {
      const dupe = await ClassSession.findOne({ date, startTime, venueName: cleanVenue });
      if (dupe) { skipped.push(date); continue; }
      const doc = await ClassSession.create({
        date,
        startTime,
        endTime,
        venueName: cleanVenue,
        venueAddress: cleanAddress,
        venueLat: cleanLat,
        venueLng: cleanLng,
        radiusM: cleanRadius,
        batchId,
        batchLabel: batchId ? cleanLabel : ''
      });
      created.push(doc);
    }

    res.status(201).json({ batchId, created, skippedDates: skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/batch/:batchId — admin only; deletes every session in
// a class at once, cascading attendance + Cloudinary cleanup for all of them.
router.delete('/batch/:batchId', requireAuth, async (req, res) => {
  try {
    const docs = await ClassSession.find({ batchId: req.params.batchId });
    if (!docs.length) return res.status(404).json({ error: 'Class not found' });
    await deleteSessionsCascade(docs);
    res.json({ ok: true, count: docs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
