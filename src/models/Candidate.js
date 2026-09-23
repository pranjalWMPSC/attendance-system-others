const mongoose = require('mongoose');

const CandidateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    photoUrl: { type: String, default: null },
    photoPublicId: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Candidate', CandidateSchema);
