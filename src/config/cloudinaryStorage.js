const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinary');

// multer-storage-cloudinary uploads the incoming file straight to Cloudinary
// and hands back { path: <secure_url>, filename: <public_id> } on req.file.
const storage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: 'wmpsc-attendance',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1280, crop: 'limit', quality: 'auto' }]
  })
});

module.exports = storage;
