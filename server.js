
const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;
const TRACKING_LOG_FILE = path.join(__dirname, 'tracklog.jsonl');
const MAX_LOG_SIZE = 5 * 1024 * 1024; 
const logCache = new Map();


let version = { commit: 'unknown' };
try {
  version = require('./version');
} catch (e) {
  console.warn('⚠️ Failed to load version info:', e.message);
}


app.use(express.json());
app.use(helmet());
app.use(compression());
app.use(morgan('combined'));
app.use(express.static('public'));


app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});


const trackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many tracking requests from this IP'
});


function initializeLogFile() {
  if (!fs.existsSync(TRACKING_LOG_FILE)) {
    fs.writeFileSync(TRACKING_LOG_FILE, '', 'utf8');
    console.log('🆕 Initialized new tracking log file');
  }
}


function rotateLogFile() {
  if (fs.existsSync(TRACKING_LOG_FILE)) {
    const stats = fs.statSync(TRACKING_LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      const backup = TRACKING_LOG_FILE.replace('.jsonl', `_${Date.now()}.jsonl`);
      fs.renameSync(TRACKING_LOG_FILE, backup);
      fs.writeFileSync(TRACKING_LOG_FILE, '', 'utf8');
      console.log(`🔁 Log rotated: ${backup}`);
    }
  }
}


function logEvent(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(TRACKING_LOG_FILE, line);
  if (!logCache.has(entry.emailId)) logCache.set(entry.emailId, []);
  logCache.get(entry.emailId).push(entry);
  console.log(`📥 Cached entry: ${entry.emailId}`);
}


app.get('/track/:emailId/:timestamp?/:random?', trackLimiter, (req, res) => {
  console.log('📸 /track hit');
  const emailId = req.params.emailId;
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(emailId)) {
    console.warn('⚠️ Invalid email ID format:', emailId);
    return res.status(400).send('Invalid email ID');
  }

  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent') || '';
  const referrer = req.get('Referer') || req.get('Referrer') || '';
  const realIp = req.get('X-Forwarded-For')?.split(',')[0] || req.ip;

  console.log(`🔍 Tracking request from ${realIp} UA: ${userAgent}`);

  const isGmailProxy = /google|ggpht|googleusercontent/i.test(userAgent);
  const isBot = /bot|crawler|spider|slurp/i.test(userAgent);

  if (!isBot) {
    const entry = { emailId, timestamp, ip: realIp, userAgent, referrer, isGmailProxy };
    rotateLogFile();
    logEvent(entry);
    console.log(`✅ Logged open: ${emailId}`);
  } else {
    console.log(`🤖 Bot detected, not logging: ${emailId}`);
  }

  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.send(pixel);
});


app.get('/api/email/:emailId/status', (req, res) => {
  console.log(`📊 Checking status for: ${req.params.emailId}`);
  const emailId = req.params.emailId;
  const logs = logCache.get(emailId) || [];
  res.json({
    success: true,
    emailId,
    opened: logs.length > 0,
    openCount: logs.length,
    firstOpened: logs[0]?.timestamp || null,
    lastOpened: logs.at(-1)?.timestamp || null,
    opens: logs
  });
});


app.post('/api/emails/status', (req, res) => {
  console.log('📩 Bulk status request');
  const { emailIds } = req.body;
  if (!Array.isArray(emailIds)) {
    console.warn('❌ Invalid emailIds payload');
    return res.status(400).json({ success: false, error: 'Invalid input' });
  }

  const results = {};
  emailIds.forEach(id => {
    const logs = logCache.get(id) || [];
    results[id] = {
      opened: logs.length > 0,
      openCount: logs.length,
      firstOpened: logs[0]?.timestamp || null,
      lastOpened: logs.at(-1)?.timestamp || null
    };
  });

  res.json({ success: true, results });
});


app.get('/api/logs', (req, res) => {
  console.log('🧾 Dumping all logs');
  const all = [];
  for (const [emailId, entries] of logCache.entries()) {
    all.push(...entries);
  }
  res.json({ success: true, total: all.length, logs: all });
});


app.get('/health', (req, res) => {
  console.log('💓 Health check');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    commit: version.commit,
    memoryUsage: process.memoryUsage()
  });
});


app.use((err, req, res, next) => {
  console.error('❌ Internal server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});


initializeLogFile();
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Email tracker server running on port ${port}`);
});


process.on('SIGTERM', () => {
  console.log('🔄Server shutdown SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄Server shutdown SIGINT');
  process.exit(0);
});
