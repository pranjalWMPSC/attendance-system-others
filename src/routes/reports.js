const express = require('express');
const Candidate = require('../models/Candidate');
const ClassSession = require('../models/ClassSession');
const Attendance = require('../models/Attendance');

const router = express.Router();
// Mounted with requireAuth in server.js — every route here is admin-only.

function sortSessions(list) {
  return list.slice().sort((a, b) => {
    const ka = (a.date || '') + 'T' + (a.startTime || '');
    const kb = (b.date || '') + 'T' + (b.startTime || '');
    return kb < ka ? -1 : kb > ka ? 1 : 0; // newest first
  });
}

// GET /api/reports/sessions — one row per session with present/absent/not-marked counts.
router.get('/sessions', async (req, res) => {
  try {
    const [sessions, candidates, attendance] = await Promise.all([
      ClassSession.find(),
      Candidate.find(),
      Attendance.find()
    ]);
    const totalCandidates = candidates.length;

    const bySession = new Map();
    for (const a of attendance) {
      const key = String(a.sessionId);
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key).push(a);
    }

    const rows = sortSessions(sessions).map((s) => {
      const records = bySession.get(String(s._id)) || [];
      const present = records.filter((r) => r.status === 'present').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const unmarked = Math.max(0, totalCandidates - present - absent);
      const rate = totalCandidates ? Math.round((present / totalCandidates) * 100) : 0;
      return {
        _id: s._id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        venueName: s.venueName,
        venueAddress: s.venueAddress,
        radiusM: s.radiusM,
        batchId: s.batchId || null,
        batchLabel: s.batchLabel || '',
        total: totalCandidates,
        present,
        absent,
        unmarked,
        rate
      };
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/session/:sessionId — full per-candidate detail for one session,
// including each candidate's captured photo and location.
router.get('/session/:sessionId', async (req, res) => {
  try {
    const session = await ClassSession.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const [candidates, attendance] = await Promise.all([
      Candidate.find().sort({ name: 1 }),
      Attendance.find({ sessionId: req.params.sessionId })
    ]);

    const byCandidate = new Map();
    for (const a of attendance) byCandidate.set(String(a.candidateId), a);

    const rows = candidates.map((c) => {
      const a = byCandidate.get(String(c._id));
      return {
        candidateId: c._id,
        name: c.name,
        phone: c.phone,
        enrollmentPhotoUrl: c.photoUrl,
        status: a ? a.status : 'unmarked',
        markedAt: a ? a.markedAt : null,
        photoUrl: a ? a.photoUrl : null,
        locLat: a ? a.locLat : null,
        locLng: a ? a.locLng : null,
        locText: a ? a.locText : null,
        distanceM: a ? a.distanceM : null,
        withinRadius: a ? a.withinRadius : null
      };
    });

    const present = rows.filter((r) => r.status === 'present').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const total = rows.length;
    const unmarked = Math.max(0, total - present - absent);
    const rate = total ? Math.round((present / total) * 100) : 0;

    res.json({
      session,
      counts: { total, present, absent, unmarked, rate },
      rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
