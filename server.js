// Local development entry point. Vercel deployments use api/index.js
// instead, which exports the same Express app without calling listen().
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log(`WMPSC Attendance running at http://localhost:${PORT}`);
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
