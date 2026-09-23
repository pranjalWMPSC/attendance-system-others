const express = require('express');
const Feedback = require('../models/Feedback');
const Candidate = require('../models/Candidate');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const RECOMMEND_VALUES = ['Yes', 'No', 'Maybe'];
function isRating(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

// GET /api/feedback/status/:sessionId/:candidateId — public. Says only whether
// feedback was already given, never its content, so the open marking page can
// skip re-asking without exposing anyone's answers.
router.get('/status/:sessionId/:candidateId', async (req, res) => {
  try {
    const doc = await Feedback.findOne(
      { sessionId: req.params.sessionId, candidateId: req.params.candidateId },
      '_id'
    );
    res.json({ submitted: !!doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feedback — public (this is filled in right after a public "mark
// present", on the same no-login page), tagged to exactly one session and
// one candidate.
router.post('/', async (req, res) => {
  try {
    const { sessionId, candidateId, overall, interaction, learned, topic, improve, recommend } = req.body || {};
    if (!sessionId || !candidateId) {
      return res.status(400).json({ error: 'sessionId and candidateId are required' });
    }
    if (!isRating(overall)) return res.status(400).json({ error: 'Please rate the session overall (1–5).' });
    if (!isRating(interaction)) return res.status(400).json({ error: 'Please rate the interaction with the architects (1–5).' });
    if (!learned || !String(learned).trim()) return res.status(400).json({ error: 'Please share the most valuable thing you learned.' });
    if (!RECOMMEND_VALUES.includes(recommend)) return res.status(400).json({ error: 'Please answer the recommend question.' });

    const doc = await Feedback.findOneAndUpdate(
      { sessionId, candidateId },
      {
        sessionId,
        candidateId,
        overall: Number(overall),
        interaction: Number(interaction),
        learned: String(learned).trim(),
        topic: (topic || '').trim(),
        improve: (improve || '').trim(),
        recommend,
        submittedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/session/:sessionId — admin only; every response for a
// session, with the candidate's name attached.
router.get('/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const [rows, candidates] = await Promise.all([
      Feedback.find({ sessionId: req.params.sessionId }).sort({ submittedAt: -1 }),
      Candidate.find()
    ]);
    const nameById = new Map(candidates.map((c) => [String(c._id), c.name]));
    const out = rows.map((r) => {
      const obj = r.toObject();
      obj.candidateName = nameById.get(String(r.candidateId)) || 'Unknown';
      return obj;
    });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
