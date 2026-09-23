const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { uploadBuffer } = require('../config/cloudinaryUpload');
const Candidate = require('../models/Candidate');
const Attendance = require('../models/Attendance');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// GET /api/candidates — public (the open Mark Attendance page needs names/photos
// to render the roster). Phone numbers are only included for a signed-in admin.
router.get('/', async (req, res) => {
  try {
    const candidates = await Candidate.find().sort({ name: 1 });
    const isAdmin = !!(req.session && req.session.isAdmin);
    const out = isAdmin
      ? candidates
      : candidates.map((c) => ({ _id: c._id, name: c.name, photoUrl: c.photoUrl }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates  (multipart: name, phone, photo?) — admin only
router.post('/', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    let photoUrl = null;
    let photoPublicId = null;
    if (req.file) {
      const result = await uploadBuffer(req.file.buffer);
      photoUrl = result.secure_url;
      photoPublicId = result.public_id;
    }

    const doc = await Candidate.create({
      name: name.trim(),
      phone: (phone || '').trim(),
      photoUrl,
      photoPublicId
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/candidates/:id  — admin only; also removes their attendance records and photos
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const cand = await Candidate.findById(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Not found' });

    const records = await Attendance.find({ candidateId: cand._id });
    for (const r of records) {
      if (r.photoPublicId) {
        try { await cloudinary.uploader.destroy(r.photoPublicId); } catch (e) { /* best effort */ }
      }
    }
    await Attendance.deleteMany({ candidateId: cand._id });

    if (cand.photoPublicId) {
      try { await cloudinary.uploader.destroy(cand.photoPublicId); } catch (e) { /* best effort */ }
    }
    await cand.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
