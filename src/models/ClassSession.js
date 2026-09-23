const mongoose = require('mongoose');

const ClassSessionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: true }, // HH:MM
    endTime: { type: String, required: true }, // HH:MM
    venueName: { type: String, required: true, trim: true },
    venueAddress: { type: String, trim: true, default: '' },
    venueLat: { type: Number, default: null },
    venueLng: { type: Number, default: null },
    radiusM: { type: Number, default: 300 },
    // Set when this session was created as part of a multi-date "class"
    // (a date range or a hand-picked set of dates, all sharing one time +
    // venue). Plain single-date sessions leave these null.
    batchId: { type: String, default: null, index: true },
    batchLabel: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ClassSession', ClassSessionSchema);
