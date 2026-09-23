const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSession', required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    status: { type: String, enum: ['present', 'absent'], required: true },
    markedAt: { type: Date, default: Date.now },
    photoUrl: { type: String, default: null },
    photoPublicId: { type: String, default: null },
    locLat: { type: Number, default: null },
    locLng: { type: Number, default: null },
    locText: { type: String, default: null },
    distanceM: { type: Number, default: null },
    withinRadius: { type: Boolean, default: null }
  },
  { timestamps: true }
);

// One attendance record per candidate per session — a re-mark overwrites it.
AttendanceSchema.index({ sessionId: 1, candidateId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
