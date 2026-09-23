// Vercel entry point. Vercel wraps the exported Express app as a serverless
// function; every request (API routes and static files under /public alike)
// is rewritten here by vercel.json and handled by Express as usual.
module.exports = require('../src/app');
