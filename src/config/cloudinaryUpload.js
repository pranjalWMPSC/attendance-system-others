const { Readable } = require('stream');
const cloudinary = require('./cloudinary');

/**
 * Upload an in-memory file buffer (from multer's memoryStorage) straight to
 * Cloudinary via the v2 SDK's upload_stream — no extra adapter package, no
 * peer-dependency conflicts.
 *
 * Resolves the Cloudinary result object; the caller stores
 * result.secure_url (display URL) and result.public_id (for later deletion).
 */
function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      Object.assign(
        {
          folder: 'wmpsc-attendance',
          resource_type: 'image',
          // "limit" only shrinks images bigger than this — it never upscales.
          // This is a server-side backstop on top of the browser-side resize
          // in camera.js, so storage stays small even from an older/cached
          // client. quality: 'auto:eco' asks Cloudinary's algorithm to bias
          // toward a smaller file over top-tier fidelity, which is plenty
          // for a headshot-sized verification photo.
          transformation: [{ width: 900, height: 900, crop: 'limit', quality: 'auto:eco' }]
        },
        options
      ),
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload failed:', error);
          return reject(error);
        }
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

module.exports = { uploadBuffer };
