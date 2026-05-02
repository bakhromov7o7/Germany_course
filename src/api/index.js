const app = require('./app');
const { config } = require('../config');

function startServer() {
  const PORT = process.env.PORT || 3000;
  
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`🚀 API Server running on port ${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { startServer };
