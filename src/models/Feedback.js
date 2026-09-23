const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSession', required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    overall: { type: Number, required: true, min: 1, max: 5 }, // Q1 — session overall, 1–5
    interaction: { type: Number, required: true, min: 1, max: 5 }, // Q2 — interaction with the architects, 1–5
    learned: { type: String, required: true, trim: true }, // Q3 — most valuable thing learned
    topic: { type: String, trim: true, default: '' }, // Q4 — topic wanted in more detail (optional)
    improve: { type: String, trim: true, default: '' }, // Q5 — how to improve future sessions (optional)
    recommend: { type: String, enum: ['Yes', 'No', 'Maybe'], required: true }, // Q6
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// One feedback response per candidate per session — resubmitting overwrites it.
FeedbackSchema.index({ sessionId: 1, candidateId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', FeedbackSchema);
