const fs = require('fs');
const path = require('path');

const errorLogger = (err, req, res, next) => {
  const errorLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    error: {
      message: err.message,
      stack: err.stack
    },
    body: req.body,
    params: req.params,
    query: req.query
  };

  // Log to console
  console.error('❌ ERROR:', errorLog);

  // Log to file in production (optional)
  if (process.env.NODE_ENV === 'production') {
    try {
      const logDir = path.join(__dirname, '../../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logPath = path.join(logDir, 'errors.log');
      fs.appendFileSync(logPath, JSON.stringify(errorLog) + '\n');
    } catch (logError) {
      console.error('Failed to write to log file:', logError);
    }
  }

  // Send response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorLogger;