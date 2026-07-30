require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const http = require('http');
const crypto = require('crypto');
const authMiddleware = require('./middleware/auth');
const googleLogger = require('./googleLogger');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

app.use((req, res, next) => {
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

const DIR_DATA = path.join(__dirname, 'data');
const DIR_LOGS = path.join(__dirname, 'logs');
const DIR_PUBLIC = path.join(__dirname, 'public');
const DIR_UPLOADS = path.join(__dirname, 'public', 'uploads');
const DIR_SYSTEMS = path.join(__dirname, 'public', 'systems');
const DIR_VIEWS = path.join(__dirname, 'views');
const DIR_ROUTES = path.join(__dirname, 'routes');
const DIR_BACKUPS = path.join(__dirname, 'backups');

const FILE_PROJECTS = path.join(DIR_DATA, 'projects.json');
const FILE_SETTINGS = path.join(DIR_DATA, 'config.json');
const FILE_BANS = path.join(DIR_DATA, 'banned_ips.json');
const FILE_SESSIONS = path.join(DIR_DATA, 'user_sessions.json');
const FILE_NOTES = path.join(DIR_DATA, 'ip_notes.json');
const FILE_DISCORD_LOGS = path.join(DIR_DATA, 'discord_logs.json');

const LOG_RETENTION_DAYS = 14;

const ensureDirectoriesExist = () => {
    const directories = [DIR_DATA, DIR_LOGS, DIR_PUBLIC, DIR_UPLOADS, DIR_SYSTEMS, DIR_VIEWS, DIR_ROUTES, DIR_BACKUPS];
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { process.exit(1); }
        }
    });
};

const ensureFilesExist = () => {
    if (!fs.existsSync(FILE_PROJECTS)) fs.writeFileSync(FILE_PROJECTS, '[]', 'utf8');
    if (!fs.existsSync(FILE_SETTINGS)) fs.writeFileSync(FILE_SETTINGS, '{}', 'utf8');
    if (!fs.existsSync(FILE_BANS)) fs.writeFileSync(FILE_BANS, '[]', 'utf8');
    if (!fs.existsSync(FILE_SESSIONS)) fs.writeFileSync(FILE_SESSIONS, '{}', 'utf8');
    if (!fs.existsSync(FILE_NOTES)) fs.writeFileSync(FILE_NOTES, '{}', 'utf8');
    if (!fs.existsSync(FILE_DISCORD_LOGS)) fs.writeFileSync(FILE_DISCORD_LOGS, '[]', 'utf8');
};

ensureDirectoriesExist();
ensureFilesExist();

let bannedIps = [];
try { bannedIps = JSON.parse(fs.readFileSync(FILE_BANS, 'utf8')); } catch (e) { bannedIps = []; }

let userSessions = {};
try { userSessions = JSON.parse(fs.readFileSync(FILE_SESSIONS, 'utf8')); } catch (e) { userSessions = {}; }

let ipNotes = {};
try { ipNotes = JSON.parse(fs.readFileSync(FILE_NOTES, 'utf8')); } catch (e) { ipNotes = {}; }

let discordLogs = [];
try { discordLogs = JSON.parse(fs.readFileSync(FILE_DISCORD_LOGS, 'utf8')); } catch (e) { discordLogs = []; }

const saveBannedIps = () => {
    try { fs.writeFileSync(FILE_BANS, JSON.stringify(bannedIps, null, 2), 'utf8'); } catch (e) {}
};

const saveUserSessions = () => {
    try { fs.writeFileSync(FILE_SESSIONS, JSON.stringify(userSessions, null, 2), 'utf8'); } catch (e) {}
};

const saveIpNotes = () => {
    try { fs.writeFileSync(FILE_NOTES, JSON.stringify(ipNotes, null, 2), 'utf8'); } catch (e) {}
};

const saveDiscordLogs = () => {
    try { fs.writeFileSync(FILE_DISCORD_LOGS, JSON.stringify(discordLogs, null, 2), 'utf8'); } catch (e) {}
};

const requestCounts = new Map();
setInterval(() => { requestCounts.clear(); }, 60000);
setInterval(() => { saveUserSessions(); }, 30000);
setInterval(() => { saveDiscordLogs(); }, 30000);

const getMskTimestamp = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

const originalFetch = global.fetch;
if (originalFetch) {
    global.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const isDiscord = url && (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks'));
        if (!isDiscord) return originalFetch(...args);

        const options = args[1] || {};
        let payloadData = null;
        if (options.body) {
            try { payloadData = JSON.parse(options.body); } catch (e) { payloadData = options.body; }
        }

        const startTime = Date.now();
        let status = 0;
        let responseData = null;
        let errorMsg = null;

        try {
            const res = await originalFetch(...args);
            status = res.status;
            const resClone = res.clone();
            try { responseData = await resClone.json(); } catch (e) {
                try { responseData = await resClone.text(); } catch (e2) { responseData = null; }
            }
            return res;
        } catch (err) {
            status = 500;
            errorMsg = err.message || String(err);
            throw err;
        } finally {
            const duration = Date.now() - startTime;
            const safeUrl = url.replace(/(api\/webhooks\/\d+\/)[^/]+/, '$1[СКРЫТО]');
            discordLogs.unshift({
                id: Date.now().toString() + '_' + Math.round(Math.random() * 1000),
                time: getMskTimestamp(),
                timestamp: Date.now(),
                url: safeUrl,
                rawUrl: url,
                method: options.method || 'POST',
                status: status,
                duration: duration,
                payload: payloadData,
                response: responseData,
                error: errorMsg
            });
            if (discordLogs.length > 200) discordLogs = discordLogs.slice(0, 200);
            saveDiscordLogs();
        }
    };
}

app.use((req, res, next) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || 'unknown';
    const cleanIp = clientIp.replace(/^::ffff:/, '');

    if (bannedIps.some(item => item.ip === cleanIp)) {
        return res.status(403).send('Доступ заблокирован.');
    }

    if (!req.originalUrl.startsWith('/uploads') && !req.originalUrl.startsWith('/systems')) {
        const currentCount = (requestCounts.get(cleanIp) || 0) + 1;
        requestCounts.set(cleanIp, currentCount);

        if (currentCount > 180) {
            if (!bannedIps.some(item => item.ip === cleanIp)) {
                bannedIps.push({ ip: cleanIp, reason: 'Автобан: частые запросы', date: new Date().toISOString() });
                saveBannedIps();
            }
            return res.status(429).send('Превышен лимит запросов.');
        }
    }

    req.clientIpClean = cleanIp;
    next();
});

class RotatingLogger {
    constructor(baseName) {
        this.baseName = baseName;
        this.currentDate = null;
        this.stream = null;
    }
    _dateStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    _rotateIfNeeded() {
        const dateStr = this._dateStr();
        if (dateStr !== this.currentDate) {
            if (this.stream) this.stream.end();
            this.currentDate = dateStr;
            const filePath = path.join(DIR_LOGS, `${this.baseName}-${dateStr}.log`);
            this.stream = fs.createWriteStream(filePath, { flags: 'a' });
            this._cleanup();
        }
    }
    _cleanup() {
        try {
            const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
            fs.readdirSync(DIR_LOGS).filter(f => f.startsWith(this.baseName + '-')).forEach(f => {
                const filePath = path.join(DIR_LOGS, f);
                if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
            });
        } catch (e) {}
    }
    latestFile() {
        try {
            const files = fs.readdirSync(DIR_LOGS).filter(f => f.startsWith(this.baseName + '-')).map(f => ({ name: f, mtime: fs.statSync(path.join(DIR_LOGS, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
            return files.length ? path.join(DIR_LOGS, files[0].name) : null;
        } catch (e) { return null; }
    }
    write(line) {
        this._rotateIfNeeded();
        this.stream.write(line + '\n');
    }
}

const accessLog = new RotatingLogger('access');
const errorLog = new RotatingLogger('error');
const appLog = new RotatingLogger('app');

const logger = {
    info: (msg) => { const line = `[${getMskTimestamp()}] [INFO] ${msg}`; console.log(line); appLog.write(line); },
    warn: (msg) => { const line = `[${getMskTimestamp()}] [WARN] ${msg}`; console.warn(line); appLog.write(line); },
    error: (msg, err) => { const line = `[${getMskTimestamp()}] [ERROR] ${msg}${err ? ' | ' + (err.stack || err.message || String(err)) : ''}`; console.error(line); errorLog.write(line); appLog.write(line); },
    access: (req, res, durationMs, payloadStr) => {
        const userAgent = req.headers['user-agent'] || 'No-Agent';
        const line = `[${getMskTimestamp()}] IP: ${req.clientIpClean || 'unknown'} | "${req.method} ${req.originalUrl}" | Статус: ${res.statusCode} | Время: ${durationMs}ms | Данные: ${payloadStr} | Устройство: ${userAgent}`;
        console.log(line);
        accessLog.write(line);
    }
};

const createBackupArchive = () => {
    try {
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupFolder = path.join(DIR_BACKUPS, `backup-${dateStr}`);
        fs.mkdirSync(backupFolder, { recursive: true });
        
        const itemsToBackup = [
            'data',
            'public',
            'views',
            'routes',
            'middleware',
            'server.js',
            'package.json',
            '.env'
        ];

        itemsToBackup.forEach(item => {
            const srcPath = path.join(__dirname, item);
            const destPath = path.join(backupFolder, item);
            if (fs.existsSync(srcPath)) {
                const stat = fs.statSync(srcPath);
                if (stat.isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true });
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        });
        
        const allBackups = fs.readdirSync(DIR_BACKUPS).filter(f => f.startsWith('backup-')).map(f => ({ name: f, time: fs.statSync(path.join(DIR_BACKUPS, f)).mtimeMs })).sort((a, b) => b.time - a.time);
        if (allBackups.length > 10) {
            allBackups.slice(10).forEach(old => { fs.rmSync(path.join(DIR_BACKUPS, old.name), { recursive: true, force: true }); });
        }
        logger.info(`Полный бэкап проекта успешно создан: backup-${dateStr}`);
        return `backup-${dateStr}`;
    } catch (err) {
        logger.error('Ошибка создания полного бэкапа', err);
        return null;
    }
};

setInterval(createBackupArchive, 24 * 60 * 60 * 1000);
setTimeout(createBackupArchive, 60 * 1000);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_UPLOADS),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'media_' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 150 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Разрешены только изображения'), false);
    }
});

const backupStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_BACKUPS),
    filename: (req, file, cb) => cb(null, 'uploaded_backup_' + Date.now() + '_' + file.originalname)
});
const backupUpload = multer({ storage: backupStorage });

app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-insecure-secret-change-me'));

// === ИСПРАВЛЕННЫЙ БЛОК САНИТАЙЗЕРА ===
// Теперь он безопасно пропускает любые поля, в названии которых есть слово "image" или "file", 
// предотвращая зависание сервера при попытке проверить огромные Base64 строки гифок
const sanitizeInput = (req, res, next) => {
    const sqlRegex = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b)|(['"])/i;
    
    const isExcluded = (key) => {
        const k = key.toLowerCase();
        const allowedExact = ['content', 'path', 'reason', 'summary', 'desc', 'fullDesc', 'note'];
        return allowedExact.includes(k) || k.includes('image') || k.includes('file');
    };

    const checkObj = (obj) => {
        for (let key in obj) {
            if (typeof obj[key] === 'string' && !isExcluded(key)) {
                if (sqlRegex.test(obj[key])) obj[key] = obj[key].replace(/['"]/g, '');
                obj[key] = obj[key].replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                checkObj(obj[key]);
            }
        }
    };
    if (req.body) checkObj(req.body);
    if (req.query) checkObj(req.query);
    next();
};
app.use(sanitizeInput);

const detectBot = (req) => {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const url = req.originalUrl.toLowerCase();
    
    if (!ua || ua === 'no-agent' || ua === 'unknown') {
        return { isBot: true, reason: 'Отсутствует User-Agent' };
    }
    
    const botKeywords = [
        'bot', 'crawler', 'spider', 'slurp', 'zgrab', 'curl', 'python', 
        'discordbot', 'telegrambot', 'yandex', 'google', 'bing', 'yahoo',
        'headless', 'phantom', 'postman', 'insomnia', 'java', 'wget'
    ];
    
    for (let word of botKeywords) {
        if (ua.includes(word)) {
            return { isBot: true, reason: `UA: ${word}` };
        }
    }

    if (url.includes('wp-admin') || url.includes('wp-login') || url.includes('xmlrpc') || url.includes('actuator')) {
        return { isBot: true, reason: 'Сканирование уязвимостей' };
    }

    return { isBot: false, reason: null };
};

app.use((req, res, next) => {
    const start = Date.now();
    const sanitizeForLogs = (data) => {
        if (!data || typeof data !== 'object') return data;
        const copy = JSON.parse(JSON.stringify(data));
        const hiddenKeys = ['password', 'token', 'file', 'content'];
        for (let key in copy) {
            if ((hiddenKeys.includes(key) || key.toLowerCase().includes('image')) && copy[key]) {
                copy[key] = '[СКРЫТО]';
            }
            else if (typeof copy[key] === 'string' && copy[key].length > 200) copy[key] = copy[key].substring(0, 200) + '...';
            else if (typeof copy[key] === 'object' && copy[key] !== null) copy[key] = sanitizeForLogs(copy[key]);
        }
        return copy;
    };

    res.on('finish', () => {
        if (!req.originalUrl.startsWith('/api/logs') && !req.originalUrl.startsWith('/api/list-files') && !req.originalUrl.startsWith('/api/bans') && !req.originalUrl.startsWith('/api/user-sessions') && !req.originalUrl.startsWith('/api/backups') && !req.originalUrl.startsWith('/api/discord-monitor')) {
            const payloadObj = {
                query: Object.keys(req.query).length ? sanitizeForLogs(req.query) : null,
                body: Object.keys(req.body).length ? sanitizeForLogs(req.body) : null
            };
            const payloadStr = (payloadObj.query || payloadObj.body) ? JSON.stringify(payloadObj) : 'Нет данных';
            
            logger.access(req, res, Date.now() - start, payloadStr);

            const monitoredSystems = ['lssd', 'lspd', 'gov', 'fib', 'cid', 'deadly', 'ems'];
            const pathParts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
            if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 400 && pathParts.length > 0 && monitoredSystems.includes(pathParts[0])) {
                const payloadToLog = res.locals.sheetPayload || req.body;
                if (payloadToLog && Object.keys(payloadToLog).length > 0) {
                    const actionType = pathParts[1] || 'request';
                    googleLogger(pathParts[0], actionType, payloadToLog);
                }
            }

            const ip = req.clientIpClean || 'unknown';
            if (!req.originalUrl.startsWith('/uploads') && !req.originalUrl.startsWith('/systems')) {
                const botInfo = detectBot(req);
                
                if (!userSessions[ip]) {
                    userSessions[ip] = {
                        ip: ip,
                        firstSeen: getMskTimestamp(),
                        lastSeen: getMskTimestamp(),
                        lastSeenTimestamp: Date.now(),
                        userAgent: req.headers['user-agent'] || 'Неизвестное устройство',
                        requestsCount: 0,
                        isBot: botInfo.isBot,
                        botReason: botInfo.reason,
                        history: []
                    };
                }
                userSessions[ip].lastSeen = getMskTimestamp();
                userSessions[ip].lastSeenTimestamp = Date.now();
                userSessions[ip].userAgent = req.headers['user-agent'] || userSessions[ip].userAgent;
                userSessions[ip].requestsCount++;
                
                if (!userSessions[ip].isBot && botInfo.isBot) {
                    userSessions[ip].isBot = true;
                    userSessions[ip].botReason = botInfo.reason;
                }
                
                userSessions[ip].history.unshift({
                    time: getMskTimestamp(),
                    method: req.method,
                    url: req.originalUrl,
                    status: res.statusCode,
                    data: (payloadObj.query || payloadObj.body) ? payloadObj : null
                });

                if (userSessions[ip].history.length > 100) {
                    userSessions[ip].history = userSessions[ip].history.slice(0, 100);
                }
            }
        }
    });
    next();
});

app.use(express.static(DIR_PUBLIC));

app.get('/login', (req, res) => {
    const loginPath = path.join(DIR_VIEWS, 'login.html');
    if (!fs.existsSync(loginPath)) return res.status(500).send('Error 500');
    res.sendFile(loginPath);
});

app.post('/login', (req, res) => {
    const { username, password, token } = req.body;
    if (username && password && username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        res.cookie('admin_auth', 'true', { httpOnly: true, signed: true, path: '/', maxAge: 24 * 60 * 60 * 1000 });
        return res.redirect('/admin');
    }
    if (token) {
        try {
            const config = JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'));
            const validToken = (config.apiTokens || []).find(t => t.token === token.trim() && t.active !== false);
            if (validToken) {
                res.cookie('api_token', validToken.token, { httpOnly: true, path: '/', maxAge: 24 * 60 * 60 * 1000 });
                return res.redirect('/admin');
            }
        } catch (e) {}
    }
    res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
    res.clearCookie('admin_auth');
    res.clearCookie('api_token');
    res.redirect('/login');
});

app.get('/admin', authMiddleware, (req, res) => {
    const adminPath = path.join(DIR_VIEWS, 'admin.html');
    if (!fs.existsSync(adminPath)) return res.status(500).send('Error 500');
    res.sendFile(adminPath);
});

app.use('/api', authMiddleware);

app.get('/api/me', (req, res) => {
    if (req.isSuperAdmin) return res.json({ isSuperAdmin: true, systems: ['all'], permissions: ['all'] });
    if (req.tokenData) return res.json({ isSuperAdmin: false, name: req.tokenData.name, systems: req.tokenData.systems || [], permissions: req.tokenData.permissions || [] });
    res.status(401).json({ error: 'Not authenticated' });
});

app.get('/api/user-sessions', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    res.json({ success: true, sessions: userSessions, notes: ipNotes });
});

app.post('/api/ip-notes', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const { ip, note } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP required' });
    ipNotes[ip] = note || '';
    saveIpNotes();
    res.json({ success: true, notes: ipNotes });
});

app.get('/api/discord-monitor', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    
    let totalSent = discordLogs.length;
    let successCount = 0;
    let rateLimitCount = 0;
    let errorCount = 0;

    discordLogs.forEach(l => {
        if (l.status === 200 || l.status === 204 || l.status === 202) successCount++;
        else if (l.status === 429) rateLimitCount++;
        else errorCount++;
    });

    const memUsage = process.memoryUsage();
    const systemHealth = {
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
        heapMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        uptimeSec: Math.round(process.uptime()),
        totalSent,
        successCount,
        rateLimitCount,
        errorCount
    };

    res.json({ success: true, health: systemHealth, logs: discordLogs });
});

app.post('/api/discord-monitor/test', async (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const { webhookUrl, payloadText } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'Укажите URL вебхука' });

    let parsedPayload = { content: "🔔 Тестовое уведомление из панели Frizworld Admin" };
    if (payloadText && payloadText.trim()) {
        try {
            parsedPayload = JSON.parse(payloadText || '{}');
        } catch (e) {
            return res.status(400).json({ error: 'Синтаксическая ошибка в JSON: ' + e.message });
        }
    }

    try {
        const response = await fetch(webhookUrl.trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsedPayload)
        });
        
        let resBody = null;
        try { resBody = await response.json(); } catch (err1) {
            try { resBody = await response.text(); } catch (err2) { resBody = null; }
        }

        res.json({ 
            success: true, 
            status: response.status, 
            statusText: response.statusText, 
            responseBody: resBody 
        });
    } catch (err) {
        res.status(500).json({ error: 'Сбой отправки запроса: ' + (err.message || String(err)) });
    }
});

app.delete('/api/discord-monitor/clear', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    discordLogs = [];
    saveDiscordLogs();
    res.json({ success: true });
});

app.get('/api/backups', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try {
        const backups = fs.readdirSync(DIR_BACKUPS).map(name => {
            const fullPath = path.join(DIR_BACKUPS, name);
            const stat = fs.statSync(fullPath);
            return {
                name: name,
                sizeBytes: stat.size || 0,
                time: stat.mtimeMs,
                date: new Date(stat.mtimeMs).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
                isDirectory: stat.isDirectory()
            };
        }).sort((a, b) => b.time - a.time);
        res.json({ success: true, backups: backups });
    } catch (err) {
        res.status(500).json({ error: 'Backup error' });
    }
});

app.post('/api/backups/create', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const createdName = createBackupArchive();
    if (createdName) {
        res.json({ success: true, name: createdName });
    } else {
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

app.post('/api/backups/restore', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Backup name required' });

    const targetBackup = path.join(DIR_BACKUPS, name);
    if (!fs.existsSync(targetBackup)) {
        return res.status(404).json({ error: 'Backup not found' });
    }

    try {
        const itemsToRestore = ['data', 'public', 'views', 'routes', 'middleware', 'server.js', 'package.json', '.env'];

        itemsToRestore.forEach(item => {
            const srcPath = path.join(targetBackup, item);
            const destPath = path.join(__dirname, item);
            if (fs.existsSync(srcPath)) {
                const stat = fs.statSync(srcPath);
                if (stat.isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        });

        try { bannedIps = JSON.parse(fs.readFileSync(FILE_BANS, 'utf8')); } catch (e) {}
        try { userSessions = JSON.parse(fs.readFileSync(FILE_SESSIONS, 'utf8')); } catch (e) {}
        try { ipNotes = JSON.parse(fs.readFileSync(FILE_NOTES, 'utf8')); } catch (e) {}
        try { discordLogs = JSON.parse(fs.readFileSync(FILE_DISCORD_LOGS, 'utf8')); } catch (e) {}

        logger.info(`Весь проект успешно восстановлен из: ${name}`);
        res.json({ success: true, message: 'Восстановление завершено успешно' });
    } catch (err) {
        logger.error('Ошибка восстановления из бэкапа', err);
        res.status(500).json({ error: 'Restore failed' });
    }
});

app.get('/api/backups/download/:name', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const targetPath = path.join(DIR_BACKUPS, req.params.name);
    if (!fs.existsSync(targetPath)) return res.status(404).send('Not found');
    res.download(targetPath);
});

app.post('/api/backups/upload', backupUpload.single('backupFile'), (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, filename: req.file.filename });
});

app.get('/api/bans', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    res.json({ success: true, banned: bannedIps });
});

app.post('/api/bans', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP required' });
    const cleanIp = ip.trim().replace(/^::ffff:/, '');
    if (!bannedIps.some(item => item.ip === cleanIp)) {
        bannedIps.push({ ip: cleanIp, reason: reason || 'Заблокирован вручную', date: new Date().toISOString() });
        saveBannedIps();
    }
    res.json({ success: true, banned: bannedIps });
});

app.delete('/api/bans/:ip', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    const targetIp = req.params.ip;
    bannedIps = bannedIps.filter(item => item.ip !== targetIp);
    saveBannedIps();
    res.json({ success: true, banned: bannedIps });
});

app.get('/api/tokens', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try {
        const config = JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'));
        res.json({ success: true, tokens: config.apiTokens || [] });
    } catch (err) { res.status(500).json({ error: 'Read error' }); }
});

app.post('/api/tokens/create', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try {
        const { name, systems, permissions } = req.body;
        if (!name || !systems || systems.length === 0) return res.status(400).json({ error: 'Invalid parameters' });
        const newToken = {
            id: Date.now().toString(),
            token: 'friz_' + crypto.randomBytes(24).toString('hex'),
            name: name.trim(),
            systems: Array.isArray(systems) ? systems : [systems],
            permissions: Array.isArray(permissions) ? permissions : ['settings'],
            createdAt: new Date().toISOString(),
            active: true
        };
        const config = JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'));
        if (!config.apiTokens) config.apiTokens = [];
        config.apiTokens.push(newToken);
        fs.writeFileSync(FILE_SETTINGS, JSON.stringify(config, null, 2), 'utf8');
        res.json({ success: true, token: newToken });
    } catch (err) { res.status(500).json({ error: 'Write error' }); }
});

app.delete('/api/tokens/:id', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try {
        const config = JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'));
        if (config.apiTokens) {
            config.apiTokens = config.apiTokens.filter(t => t.id !== req.params.id);
            fs.writeFileSync(FILE_SETTINGS, JSON.stringify(config, null, 2), 'utf8');
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Delete error' }); }
});

app.get('/api/projects', (req, res) => {
    try { res.json(JSON.parse(fs.readFileSync(FILE_PROJECTS, 'utf8'))); } 
    catch (err) { res.status(500).json({ error: 'Read error' }); }
});

app.post('/api/projects', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try { fs.writeFileSync(FILE_PROJECTS, JSON.stringify(req.body, null, 2), 'utf8'); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: 'Write error' }); }
});

app.get('/api/settings', (req, res) => {
    try { res.json(JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'))); } 
    catch (err) { res.status(500).json({ error: 'Read error' }); }
});

app.post('/api/settings', (req, res) => {
    try {
        const currentConfig = JSON.parse(fs.readFileSync(FILE_SETTINGS, 'utf8'));
        const newConfig = req.body;
        if (!req.isSuperAdmin && req.tokenData) {
            req.tokenData.systems.forEach(sys => { if (newConfig[sys]) currentConfig[sys] = newConfig[sys]; });
            fs.writeFileSync(FILE_SETTINGS, JSON.stringify(currentConfig, null, 2), 'utf8');
            return res.json({ success: true, scoped: true });
        }
        fs.writeFileSync(FILE_SETTINGS, JSON.stringify(newConfig, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Write error' }); }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (req.body && typeof req.body === 'object') {
            for (let key in req.body) {
                if (typeof req.body[key] === 'string' && req.body[key].startsWith('data:image')) {
                    const matches = req.body[key].match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        let ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                        ext = ext.replace(/[^a-z0-9]/gi, ''); 
                        const buffer = Buffer.from(matches[2], 'base64');
                        const filename = `media_${Date.now()}_${Math.round(Math.random() * 1000)}.${ext}`;
                        fs.writeFileSync(path.join(DIR_UPLOADS, filename), buffer);
                        return res.json({ success: true, url: `/uploads/${filename}` });
                    }
                }
            }
        }
        
        if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
        res.json({ success: true, url: `/uploads/${req.file.filename}` });
    } catch (err) { 
        logger.error('Ошибка загрузки файла', err);
        res.status(500).json({ error: 'Upload error' }); 
    }
});

app.get('/api/logs', (req, res) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });
    try {
        const typeAlias = { visits: 'access', errors: 'error', access: 'access', error: 'error', app: 'app' };
        const type = typeAlias[req.query.type] || 'access';
        const logSource = { access: accessLog, error: errorLog, app: appLog }[type];
        const filePath = logSource.latestFile();
        if (!filePath || !fs.existsSync(filePath)) return res.json({ logs: 'Пусто' });
        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n').filter(Boolean);
        res.json({ logs: lines.slice(-300).reverse().join('\n'), file: path.basename(filePath) });
    } catch (err) { res.status(500).json({ error: 'Log error' }); }
});

app.get('/api/list-files', (req, res) => {
    try {
        const getFilesRecursive = (dir, base = '') => {
            let results = [];
            fs.readdirSync(dir).forEach(file => {
                const filePath = path.join(dir, file);
                const relativePath = path.join(base, file);
                if (fs.statSync(filePath).isDirectory()) results = results.concat(getFilesRecursive(filePath, relativePath));
                else results.push(relativePath.replace(/\\/g, '/'));
            });
            return results;
        };
        res.json(getFilesRecursive(DIR_PUBLIC));
    } catch (err) { res.status(500).json({ error: 'Files error' }); }
});

app.get('/api/file', (req, res) => {
    try {
        const filePathParam = req.query.path;
        if (!filePathParam) return res.status(400).json({ error: 'Path error' });
        const safePath = path.normalize(filePathParam).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(DIR_PUBLIC, safePath);
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '404' });
        res.json({ content: fs.readFileSync(fullPath, 'utf8') });
    } catch (err) { res.status(500).json({ error: 'File error' }); }
});

app.post('/api/file', (req, res) => {
    try {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).json({ error: 'Path error' });
        const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        fs.writeFileSync(path.join(DIR_PUBLIC, safePath), content, 'utf8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'File error' }); }
});

const loadModularRoute = (routeName, routeFile) => {
    const fullPath = path.join(DIR_ROUTES, routeFile);
    if (fs.existsSync(fullPath)) {
        try { app.use(routeName, require(fullPath)); } 
        catch (err) { logger.error(`Ошибка загрузки роута ${routeName}`, err); }
    }
};

loadModularRoute('/lssd', 'lssd.js');
loadModularRoute('/lspd', 'lspd.js');
loadModularRoute('/gov', 'gov.js');
loadModularRoute('/fib', 'fib.js');
loadModularRoute('/cid', 'cid.js');
loadModularRoute('/deadly', 'deadly.js');
loadModularRoute('/ems', 'ems.js');

app.use((req, res) => res.status(404).send('404'));
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
    res.status(500).json({ error: '500' });
});

process.on('uncaughtException', (err) => { logger.error('uncaughtException', err); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.error('unhandledRejection', reason); });

const server = http.createServer(app);
server.on('error', (err) => { logger.error('Server error', err); process.exit(1); });
server.listen(PORT, () => { logger.info(`Server started on port ${PORT}`); });

const gracefulShutdown = () => {
    saveUserSessions();
    saveIpNotes();
    saveDiscordLogs();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
