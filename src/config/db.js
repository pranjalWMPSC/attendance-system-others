const mongoose = require('mongoose');

// Cached so repeated calls (including a warm serverless invocation reusing
// this module) reuse the same connection instead of opening a new one.
let connectionPromise = null;

module.exports = function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const err = new Error(
      'MONGODB_URI is not set. Locally: copy .env.example to .env and fill it in. ' +
        'On Vercel: add it under Project Settings → Environment Variables.'
    );
    console.error(err.message);
    return Promise.reject(err);
  }

  connectionPromise = mongoose
    .connect(uri)
    .then((conn) => {
      console.log('MongoDB connected');
      return conn;
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      connectionPromise = null; // let the next call retry instead of staying stuck on a dead promise
      throw err;
    });

  return connectionPromise;
};
