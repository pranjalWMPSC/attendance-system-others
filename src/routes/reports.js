const express = require('express');
const ExcelJS = require('exceljs');
const Candidate = require('../models/Candidate');
const ClassSession = require('../models/ClassSession');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');

const router = express.Router();
// Mounted with requireAuth in server.js — every route here is admin-only.

function sortSessions(list) {
  return list.slice().sort((a, b) => {
    const ka = (a.date || '') + 'T' + (a.startTime || '');
    const kb = (b.date || '') + 'T' + (b.startTime || '');
    return kb < ka ? -1 : kb > ka ? 1 : 0; // newest first
  });
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
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

// GET /api/reports/export — one .xlsx covering every session together:
//   • Summary        — present/absent/not-marked per session, plus feedback
//                      response count and average ratings
//   • All Attendance — one row per candidate per session, each present
//                      mark's captured photo embedded as a thumbnail
//   • Feedback       — one row per submitted feedback response, tagged with
//                      its session and candidate
router.get('/export', async (req, res) => {
  try {
    const [sessions, candidates, attendance, feedback] = await Promise.all([
      ClassSession.find(),
      Candidate.find().sort({ name: 1 }),
      Attendance.find(),
      Feedback.find()
    ]);
    const sortedSessions = sortSessions(sessions);
    const totalCandidates = candidates.length;

    const bySession = new Map();
    for (const a of attendance) {
      const key = String(a.sessionId);
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key).push(a);
    }

    const feedbackBySession = new Map();
    for (const f of feedback) {
      const key = String(f.sessionId);
      if (!feedbackBySession.has(key)) feedbackBySession.set(key, []);
      feedbackBySession.get(key).push(f);
    }
    const candidateById = new Map(candidates.map((c) => [String(c._id), c]));

    // Fetch every distinct photo once, however many sessions/candidates
    // reference it, so the same image is never downloaded twice.
    const photoUrls = new Set();
    for (const a of attendance) if (a.photoUrl) photoUrls.add(a.photoUrl);
    const imageBuffers = new Map();
    await Promise.all(
      Array.from(photoUrls).map(async (url) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          imageBuffers.set(url, Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          // A photo that fails to download just leaves that cell blank —
          // the rest of the export still goes out.
        }
      })
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WMPSC Attendance';
    workbook.created = new Date();

    // ---- Summary sheet ----
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Start', key: 'start', width: 9 },
      { header: 'End', key: 'end', width: 9 },
      { header: 'Venue', key: 'venue', width: 28 },
      { header: 'Present', key: 'present', width: 10 },
      { header: 'Absent', key: 'absent', width: 10 },
      { header: 'Not marked', key: 'unmarked', width: 12 },
      { header: 'Rate', key: 'rate', width: 9 },
      { header: 'Feedback responses', key: 'fbCount', width: 19 },
      { header: 'Avg. overall (1–5)', key: 'fbOverall', width: 18 },
      { header: 'Avg. interaction (1–5)', key: 'fbInteraction', width: 22 },
      { header: 'Would recommend (Yes)', key: 'fbYes', width: 21 }
    ];
    summary.getRow(1).font = { bold: true };
    sortedSessions.forEach((s) => {
      const records = bySession.get(String(s._id)) || [];
      const present = records.filter((r) => r.status === 'present').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const unmarked = Math.max(0, totalCandidates - present - absent);
      const rate = totalCandidates ? Math.round((present / totalCandidates) * 100) : 0;
      const fbs = feedbackBySession.get(String(s._id)) || [];
      const avg = (field) =>
        fbs.length ? Math.round((fbs.reduce((sum, f) => sum + f[field], 0) / fbs.length) * 10) / 10 : '';
      summary.addRow({
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        venue: s.venueName,
        present,
        absent,
        unmarked,
        rate: rate + '%',
        fbCount: fbs.length,
        fbOverall: avg('overall'),
        fbInteraction: avg('interaction'),
        fbYes: fbs.length ? fbs.filter((f) => f.recommend === 'Yes').length + ' of ' + fbs.length : ''
      });
    });

    // ---- All Attendance sheet ----
    const sheet = workbook.addWorksheet('All Attendance');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Start', key: 'start', width: 9 },
      { header: 'End', key: 'end', width: 9 },
      { header: 'Venue', key: 'venue', width: 24 },
      { header: 'Candidate', key: 'name', width: 22 },
      { header: 'Phone', key: 'phone', width: 14 },
      { header: 'Status', key: 'status', width: 11 },
      { header: 'Marked at', key: 'markedAt', width: 18 },
      { header: 'Location', key: 'location', width: 26 },
      { header: 'Distance (m)', key: 'distance', width: 12 },
      { header: 'On-site', key: 'onsite', width: 9 },
      { header: 'Photo', key: 'photo', width: 14 }
    ];
    sheet.getRow(1).font = { bold: true };
    const photoColIndex = sheet.columns.length - 1; // 0-based, last column

    let rowIndex = 1; // header occupies row 1
    sortedSessions.forEach((s) => {
      const records = bySession.get(String(s._id)) || [];
      const byCandidate = new Map(records.map((r) => [String(r.candidateId), r]));
      candidates.forEach((c) => {
        const a = byCandidate.get(String(c._id));
        rowIndex += 1;
        const status = a ? a.status : 'unmarked';
        const locationText =
          a && a.locText
            ? a.locText
            : a && isNum(a.locLat) && isNum(a.locLng)
              ? a.locLat.toFixed(4) + ', ' + a.locLng.toFixed(4)
              : '';
        sheet.addRow({
          date: s.date,
          start: s.startTime,
          end: s.endTime,
          venue: s.venueName,
          name: c.name,
          phone: c.phone || '',
          status: status.charAt(0).toUpperCase() + status.slice(1),
          markedAt: a && a.markedAt ? new Date(a.markedAt).toLocaleString() : '',
          location: locationText,
          distance: a && isNum(a.distanceM) ? Math.round(a.distanceM) : '',
          onsite: a ? (a.withinRadius === true ? 'Yes' : a.withinRadius === false ? 'No' : '') : '',
          photo: ''
        });
        sheet.getRow(rowIndex).height = 46;
        if (a && a.photoUrl && imageBuffers.has(a.photoUrl)) {
          const imgId = workbook.addImage({ buffer: imageBuffers.get(a.photoUrl), extension: 'jpeg' });
          sheet.addImage(imgId, {
            tl: { col: photoColIndex, row: rowIndex - 1 },
            ext: { width: 46, height: 46 }
          });
        }
      });
    });

    // ---- Feedback sheet ----
    const fbSheet = workbook.addWorksheet('Feedback');
    fbSheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Start', key: 'start', width: 9 },
      { header: 'End', key: 'end', width: 9 },
      { header: 'Venue', key: 'venue', width: 24 },
      { header: 'Candidate', key: 'name', width: 22 },
      { header: 'Phone', key: 'phone', width: 14 },
      { header: 'Overall (1–5)', key: 'overall', width: 14 },
      { header: 'Interaction with architects (1–5)', key: 'interaction', width: 20 },
      { header: 'Most valuable thing learned', key: 'learned', width: 44 },
      { header: 'Topic wanted in more detail', key: 'topic', width: 36 },
      { header: 'How to improve future sessions', key: 'improve', width: 36 },
      { header: 'Would recommend', key: 'recommend', width: 16 },
      { header: 'Submitted at', key: 'submittedAt', width: 18 }
    ];
    fbSheet.getRow(1).font = { bold: true };
    fbSheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    ['learned', 'topic', 'improve'].forEach((key) => {
      fbSheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
    });
    sortedSessions.forEach((s) => {
      const fbs = (feedbackBySession.get(String(s._id)) || [])
        .map((f) => ({ f, c: candidateById.get(String(f.candidateId)) }))
        .sort((a, b) => ((a.c && a.c.name) || '').localeCompare((b.c && b.c.name) || ''));
      fbs.forEach(({ f, c }) => {
        fbSheet.addRow({
          date: s.date,
          start: s.startTime,
          end: s.endTime,
          venue: s.venueName,
          name: c ? c.name : 'Unknown',
          phone: (c && c.phone) || '',
          overall: f.overall,
          interaction: f.interaction,
          learned: f.learned,
          topic: f.topic || '',
          improve: f.improve || '',
          recommend: f.recommend,
          submittedAt: f.submittedAt ? new Date(f.submittedAt).toLocaleString() : ''
        });
      });
    });

    const filename = 'wmpsc-attendance-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
