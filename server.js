const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const TRACKING_LOG_FILE = 'tracklog.txt';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    
    next();
});

// Initialize tracking log file if it doesn't exist
function initializeLogFile() {
    if (!fs.existsSync(TRACKING_LOG_FILE)) {
        fs.writeFileSync(TRACKING_LOG_FILE, '', 'utf8');
        console.log('📄 Created tracking log file');
    }
}

// Enhanced tracking endpoint - FIXED LOGIC
app.get('/track/:emailId/:timestamp?/:random?', (req, res) => {
    const emailId = req.params.emailId;
    const timestamp = new Date().toISOString();
    const userAgent = req.get('User-Agent') || '';
    const referrer = req.get('Referer') || req.get('Referrer') || '';
    const realIp = req.get('X-Forwarded-For') ? req.get('X-Forwarded-For').split(',')[0] : req.ip;
    
    // Enhanced Gmail proxy detection
    const isGmailProxy = userAgent.includes('GoogleImageProxy') || 
                        userAgent.includes('Google') || 
                        userAgent.includes('ggpht.com') ||
                        userAgent.includes('googleusercontent.com');
    
    // Detailed logging
    console.log('════════════════════════════════════════');
    console.log(`📧 EMAIL TRACKING EVENT`);
    console.log(`Email ID: ${emailId}`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`IP: ${realIp}`);
    console.log(`User-Agent: ${userAgent}`);
    console.log(`Referrer: ${referrer}`);
    console.log(`Gmail Proxy: ${isGmailProxy}`);
    console.log('════════════════════════════════════════');
    
    // Create log entry
    const logEntry = {
        emailId,
        timestamp,
        ip: realIp,
        userAgent,
        referrer,
        isGmailProxy: isGmailProxy
    };
    
    // FIXED: Only skip obvious bots/crawlers, NOT Gmail proxy requests
    const isBot = userAgent.toLowerCase().includes('bot') || 
                  userAgent.toLowerCase().includes('crawler') ||
                  userAgent.toLowerCase().includes('spider') ||
                  userAgent.toLowerCase().includes('slurp');
    
    // Log all legitimate opens (including Gmail proxy requests)
    if (!isBot && emailId && emailId.length > 5) {
        try {
            fs.appendFileSync(TRACKING_LOG_FILE, JSON.stringify(logEntry) + '\n');
            console.log(`✅ Successfully logged email open: ${emailId}`);
        } catch (error) {
            console.error('❌ Failed to log email open:', error);
        }
    } else {
        console.log(`⚠️ Skipped logging - Bot: ${isBot}, EmailID: ${emailId}`);
    }
    
    // Return 1x1 transparent tracking pixel
    const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );
    
    res.set({
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Last-Modified': new Date().toUTCString()
    });
    
    res.send(pixel);
});

// Enhanced API to check tracking status
app.get('/api/email/:emailId/status', (req, res) => {
    const emailId = req.params.emailId;
    
    if (!emailId) {
        return res.status(400).json({
            success: false,
            error: 'Email ID is required'
        });
    }
    
    try {
        let emailLogs = [];
        
        if (fs.existsSync(TRACKING_LOG_FILE)) {
            const content = fs.readFileSync(TRACKING_LOG_FILE, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            emailLogs = lines
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        console.error('Failed to parse log line:', line);
                        return null;
                    }
                })
                .filter(log => log && log.emailId === emailId)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
        
        const response = {
            success: true,
            emailId: emailId,
            opened: emailLogs.length > 0,
            openCount: emailLogs.length,
            firstOpened: emailLogs.length > 0 ? emailLogs[0].timestamp : null,
            lastOpened: emailLogs.length > 0 ? emailLogs[emailLogs.length - 1].timestamp : null,
            opens: emailLogs.map(log => ({
                timestamp: log.timestamp,
                ip: log.ip,
                userAgent: log.userAgent,
                isGmailProxy: log.isGmailProxy
            }))
        };
        
        console.log(`📊 Status check for ${emailId}: ${emailLogs.length} opens`);
        res.json(response);
        
    } catch (error) {
        console.error('Error checking email status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Bulk status check endpoint
app.post('/api/emails/status', (req, res) => {
    const { emailIds } = req.body;
    
    if (!Array.isArray(emailIds)) {
        return res.status(400).json({
            success: false,
            error: 'emailIds must be an array'
        });
    }
    
    try {
        const results = {};
        
        if (fs.existsSync(TRACKING_LOG_FILE)) {
            const content = fs.readFileSync(TRACKING_LOG_FILE, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            const allLogs = lines
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(log => log);
            
            emailIds.forEach(emailId => {
                const emailLogs = allLogs
                    .filter(log => log.emailId === emailId)
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                results[emailId] = {
                    opened: emailLogs.length > 0,
                    openCount: emailLogs.length,
                    firstOpened: emailLogs.length > 0 ? emailLogs[0].timestamp : null,
                    lastOpened: emailLogs.length > 0 ? emailLogs[emailLogs.length - 1].timestamp : null
                };
            });
        } else {
            emailIds.forEach(emailId => {
                results[emailId] = {
                    opened: false,
                    openCount: 0,
                    firstOpened: null,
                    lastOpened: null
                };
            });
        }
        
        res.json({
            success: true,
            results: results
        });
        
    } catch (error) {
        console.error('Error checking bulk email status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        logFileExists: fs.existsSync(TRACKING_LOG_FILE)
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Initialize and start server
initializeLogFile();

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Email tracker server running on port ${port}`);
    console.log(`📍 Tracking endpoint: /track/:emailId/:timestamp/:random`);
    console.log(`📍 Status API: /api/email/:emailId/status`);
    console.log(`📍 Bulk Status API: /api/emails/status`);
    console.log(`📍 Health check: /health`);
    console.log(`📄 Log file: ${TRACKING_LOG_FILE}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Shutting down server gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 Shutting down server gracefully...');
    process.exit(0);
});