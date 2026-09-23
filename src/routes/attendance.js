const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { uploadBuffer } = require('../config/cloudinaryUpload');
const Attendance = require('../models/Attendance');
const ClassSession = require('../models/ClassSession');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/attendance/session/:sessionId — public, but deliberately minimal:
// this backs the open Mark Attendance page, so it only returns enough to show
// each candidate's current status (not anyone's photo or captured location).
// Full detail for admins lives at GET /api/reports/session/:sessionId.
router.get('/session/:sessionId', async (req, res) => {
  try {
    const records = await Attendance.find({ sessionId: req.params.sessionId });
    const isAdmin = !!(req.session && req.session.isAdmin);
    const out = isAdmin
      ? records
      : records.map((r) => ({
          candidateId: r.candidateId,
          status: r.status,
          markedAt: r.markedAt,
          withinRadius: r.withinRadius
        }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/present  (multipart: sessionId, candidateId, locLat?, locLng?, locText?, photo)
router.post('/present', upload.single('photo'), async (req, res) => {
  try {
    const { sessionId, candidateId, locLat, locLng, locText } = req.body || {};
    if (!sessionId || !candidateId) {
      return res.status(400).json({ error: 'sessionId and candidateId are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'A photo is required to mark present' });
    }

    const session = await ClassSession.findById(sessionId);
    const hasLoc = locLat !== undefined && locLat !== '' && locLng !== undefined && locLng !== '';
    let distanceM = null;
    let withinRadius = null;
    if (hasLoc && session && session.venueLat != null && session.venueLng != null) {
      distanceM = haversineMeters(Number(locLat), Number(locLng), session.venueLat, session.venueLng);
      withinRadius = distanceM <= (session.radiusM != null ? session.radiusM : 300);
    }

    const existing = await Attendance.findOne({ sessionId, candidateId });
    if (existing && existing.photoPublicId) {
      try { await cloudinary.uploader.destroy(existing.photoPublicId); } catch (e) { /* best effort */ }
    }

    const uploaded = await uploadBuffer(req.file.buffer);

    const update = {
      sessionId,
      candidateId,
      status: 'present',
      markedAt: new Date(),
      photoUrl: uploaded.secure_url,
      photoPublicId: uploaded.public_id,
      locLat: hasLoc ? Number(locLat) : null,
      locLng: hasLoc ? Number(locLng) : null,
      locText: locText ? String(locText).trim() : null,
      distanceM,
      withinRadius
    };

    const doc = await Attendance.findOneAndUpdate({ sessionId, candidateId }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/absent  (json: sessionId, candidateId)
router.post('/absent', async (req, res) => {
  try {
    const { sessionId, candidateId } = req.body || {};
    if (!sessionId || !candidateId) {
      return res.status(400).json({ error: 'sessionId and candidateId are required' });
    }
    const existing = await Attendance.findOne({ sessionId, candidateId });
    if (existing && existing.photoPublicId) {
      try { await cloudinary.uploader.destroy(existing.photoPublicId); } catch (e) { /* best effort */ }
    }
    const doc = await Attendance.findOneAndUpdate(
      { sessionId, candidateId },
      {
        sessionId,
        candidateId,
        status: 'absent',
        markedAt: new Date(),
        photoUrl: null,
        photoPublicId: null,
        locLat: null,
        locLng: null,
        locText: null,
        distanceM: null,
        withinRadius: null
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attendance/:sessionId/:candidateId — clear a mark
router.delete('/:sessionId/:candidateId', async (req, res) => {
  try {
    const existing = await Attendance.findOne({
      sessionId: req.params.sessionId,
      candidateId: req.params.candidateId
    });
    if (existing) {
      if (existing.photoPublicId) {
        try { await cloudinary.uploader.destroy(existing.photoPublicId); } catch (e) { /* best effort */ }
      }
      await existing.deleteOne();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
