const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Path to our tracking log file
const LOG_FILE = path.join(__dirname, 'tracklog.txt');

// Initialize log file if it doesn't exist
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, 'Email Tracking Log\n===================\n\n');
}

// Function to write to log file with simple log rotation (5MB)
function writeToLog(message) {
  try {
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > maxSize) {
      const rotated = LOG_FILE.replace('.txt', `_${Date.now()}.txt`);
      fs.renameSync(LOG_FILE, rotated);
      fs.writeFileSync(LOG_FILE, 'Email Tracking Log\n===================\n\n');
    }
  } catch (e) {
    console.error('Log rotation error:', e);
  }
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
  console.log(logEntry.trim());
}

// Function to read tracking data from log
function getTrackingStats() {
  try {
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    const sentEmails = (logContent.match(/Email sent with tracking ID/g) || []).length;
    const openedEmails = (logContent.match(/Email opened - Tracking ID/g) || []).length;
    const openRate = sentEmails > 0 ? Math.round((openedEmails / sentEmails) * 100) : 0;
    
    return {
      totalSent: sentEmails,
      totalOpened: openedEmails,
      openRate: openRate
    };
  } catch (error) {
    return { totalSent: 0, totalOpened: 0, openRate: 0 };
  }
}

// Helper: Validate trackingId (alphanumeric, dash, underscore, 5-64 chars)
const isValidTrackingId = id => /^[a-zA-Z0-9-_]{5,64}$/.test(id);

// Routes

const firstAccessTimes = new Map();

// Helper to check if User-Agent is a real browser
function isRealBrowser(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return ua.includes('mozilla') && (ua.includes('chrome') || ua.includes('firefox') || ua.includes('safari'));
}

// Helper to check if User-Agent is a bot/crawler
function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return ua.includes('bot') || ua.includes('crawler') || ua.includes('spider') || ua.includes('googleimageproxy');
}

// Track email opens (this is called when the tracking pixel is loaded)
app.get('/track/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  if (!isValidTrackingId(trackingId)) {
    return res.status(400).send('Invalid tracking ID');
  }

  const userAgent = req.get('User-Agent') || '';
  const now = Date.now();

  // Simple bot filter
  const isDefinitelyBot = isBot(userAgent);
  const alreadyLogged = firstAccessTimes.get(trackingId + '_opened');

  if (!alreadyLogged && !isDefinitelyBot) {
    writeToLog(`Email opened - Tracking ID: ${trackingId} (UA: ${userAgent})`);
    firstAccessTimes.set(trackingId + '_opened', true);
  } else if (!alreadyLogged && isDefinitelyBot) {
    writeToLog(`Bot skipped open log - Tracking ID: ${trackingId} (UA: ${userAgent})`);
  }

  // Always serve the pixel
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  res.set({
    'Content-Type': 'image/png',
    'Content-Disposition': 'inline; filename="pixel.png"',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });

  res.send(pixel);
});


// Create new tracking entry
app.post('/api/create-tracking', (req, res) => {
  const { trackingId, timestamp, status } = req.body;
  if (!isValidTrackingId(trackingId)) {
    return res.status(400).json({ error: 'Invalid tracking ID' });
  }
  writeToLog(`Email sent with tracking ID: ${trackingId} at ${timestamp}`);
  res.json({ success: true, trackingId });
});

// Get tracking statistics
app.get('/api/stats', (req, res) => {
  const stats = getTrackingStats();
  res.json(stats);
});

// Get full tracking log
app.get('/api/log', (req, res) => {
  try {
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    res.json({ log: logContent });
  } catch (error) {
    res.status(500).json({ error: 'Could not read log file' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  writeToLog(`Email tracking server started on http://localhost:${PORT}`);
  console.log(`🚀 Email Tracker Server running on http://localhost:${PORT}`);
  console.log(`📊 View stats at: http://localhost:${PORT}/api/stats`);
  console.log(`📝 View logs at: http://localhost:${PORT}/api/log`);
});