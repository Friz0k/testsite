require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

const DIR_DATA = path.join(__dirname, 'data');
const DIR_LOGS = path.join(__dirname, 'logs');
const DIR_PUBLIC = path.join(__dirname, 'public');
const DIR_UPLOADS = path.join(__dirname, 'public', 'uploads');
const DIR_SYSTEMS = path.join(__dirname, 'public', 'systems');
const DIR_VIEWS = path.join(__dirname, 'views');
const DIR_ROUTES = path.join(__dirname, 'routes');

const FILE_PROJECTS = path.join(DIR_DATA, 'projects.json');
const FILE_SETTINGS = path.join(DIR_DATA, 'config.json');

const LOG_RETENTION_DAYS = 14;

const ensureDirectoriesExist = () => {
    const directories = [DIR_DATA, DIR_LOGS, DIR_PUBLIC, DIR_UPLOADS, DIR_SYSTEMS, DIR_VIEWS, DIR_ROUTES];
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (err) {
                process.exit(1);
            }
        }
    });
};

const ensureFilesExist = () => {
    if (!fs.existsSync(FILE_PROJECTS)) {
        fs.writeFileSync(FILE_PROJECTS, '[]', 'utf8');
    }
    if (!fs.existsSync(FILE_SETTINGS)) {
        fs.writeFileSync(FILE_SETTINGS, '{}', 'utf8');
    }
};

ensureDirectoriesExist();
ensureFilesExist();

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
            fs.readdirSync(DIR_LOGS)
                .filter(f => f.startsWith(this.baseName + '-'))
                .forEach(f => {
                    const filePath = path.join(DIR_LOGS, f);
                    if (fs.statSync(filePath).mtimeMs < cutoff) {
                        fs.unlinkSync(filePath);
                    }
                });
        } catch (e) {}
    }

    latestFile() {
        try {
            const files = fs.readdirSync(DIR_LOGS)
                .filter(f => f.startsWith(this.baseName + '-'))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(DIR_LOGS, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            return files.length ? path.join(DIR_LOGS, files[0].name) : null;
        } catch (e) {
            return null;
        }
    }

    write(line) {
        this._rotateIfNeeded();
        this.stream.write(line + '\n');
    }
}

const accessLog = new RotatingLogger('access');
const errorLog = new RotatingLogger('error');
const appLog = new RotatingLogger('app');

const ts = () => new Date().toISOString();

const logger = {
    info: (msg) => {
        const line = `[${ts()}] [INFO] ${msg}`;
        console.log(line);
        appLog.write(line);
    },
    warn: (msg) => {
        const line = `[${ts()}] [WARN] ${msg}`;
        console.warn(line);
        appLog.write(line);
    },
    error: (msg, err) => {
        const line = `[${ts()}] [ERROR] ${msg}${err ? ' | ' + (err.stack || err.message || String(err)) : ''}`;
        console.error(line);
        errorLog.write(line);
        appLog.write(line);
    },
    access: (req, res, durationMs) => {
        const line = `[${ts()}] ${req.ip} "${req.method} ${req.originalUrl}" ${res.statusCode} ${durationMs}ms`;
        console.log(line);
        accessLog.write(line);
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, DIR_UPLOADS);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'media_' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Format error'), false);
        }
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-insecure-secret-change-me'));

const sanitizeInput = (req, res, next) => {
    const sqlRegex = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b)|(['"])/i;

    const checkObj = (obj) => {
        for (let key in obj) {
            if (typeof obj[key] === 'string' && key !== 'content' && key !== 'image' && key !== 'imageUrl' && key !== 'path') {
                if (sqlRegex.test(obj[key])) {
                    obj[key] = obj[key].replace(/['"]/g, '');
                }
                obj[key] = obj[key].replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                checkObj(obj[key]);
            }
        }
    };

    if (req.body) {
        checkObj(req.body);
    }
    if (req.query) {
        checkObj(req.query);
    }

    next();
};

app.use(sanitizeInput);

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        if (!req.originalUrl.startsWith('/api/logs')) {
            logger.access(req, res, Date.now() - start);
        }
    });
    next();
});

app.use(express.static(DIR_PUBLIC));

const requireAdmin = (req, res, next) => {
    const isAdmin = req.signedCookies && req.signedCookies.admin_auth === 'true';
    if (!isAdmin) {
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Auth required' });
        }
        return res.redirect('/login');
    }
    next();
};

app.get('/login', (req, res) => {
    const loginPath = path.join(DIR_VIEWS, 'login.html');
    if (!fs.existsSync(loginPath)) {
        return res.status(500).send('Error 500');
    }
    res.sendFile(loginPath);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const envUser = process.env.ADMIN_USER;
    const envPass = process.env.ADMIN_PASS;

    if (username === envUser && password === envPass) {
        res.cookie('admin_auth', 'true', {
            httpOnly: true,
            signed: true,
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.redirect('/admin');
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('admin_auth');
    res.redirect('/login');
});

app.get('/admin', requireAdmin, (req, res) => {
    const adminPath = path.join(DIR_VIEWS, 'admin.html');
    if (!fs.existsSync(adminPath)) {
        return res.status(500).send('Error 500');
    }
    res.sendFile(adminPath);
});

app.get('/api/projects', (req, res) => {
    try {
        const data = fs.readFileSync(FILE_PROJECTS, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: 'Read error' });
    }
});

app.post('/api/projects', requireAdmin, (req, res) => {
    try {
        fs.writeFileSync(FILE_PROJECTS, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Write error' });
    }
});

app.get('/api/settings', (req, res) => {
    try {
        const data = fs.readFileSync(FILE_SETTINGS, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: 'Read error' });
    }
});

app.post('/api/settings', requireAdmin, (req, res) => {
    try {
        fs.writeFileSync(FILE_SETTINGS, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Write error' });
    }
});

app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
    try {
        if (req.body.image && req.body.image.startsWith('data:image')) {
            const matches = req.body.image.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                const filename = `media_${Date.now()}_b64.${ext}`;
                fs.writeFileSync(path.join(DIR_UPLOADS, filename), buffer);
                return res.json({ success: true, url: `/uploads/${filename}` });
            }
        }

        if (!req.file) {
            return res.status(400).json({ error: 'File error' });
        }

        res.json({ success: true, url: `/uploads/${req.file.filename}` });
    } catch (err) {
        res.status(500).json({ error: 'Upload error' });
    }
});

app.get('/api/logs', requireAdmin, (req, res) => {
    try {
        const typeAlias = { visits: 'access', errors: 'error', access: 'access', error: 'error', app: 'app' };
        const type = typeAlias[req.query.type] || 'access';
        const logSource = { access: accessLog, error: errorLog, app: appLog }[type];

        const filePath = logSource.latestFile();
        if (!filePath || !fs.existsSync(filePath)) {
            return res.json({ logs: 'Пусто' });
        }

        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n').filter(Boolean);
        const lastLines = lines.slice(-200).reverse().join('\n');

        res.json({ logs: lastLines, file: path.basename(filePath) });
    } catch (err) {
        res.status(500).json({ error: 'Log error' });
    }
});

app.get('/api/list-files', requireAdmin, (req, res) => {
    try {
        const getFilesRecursive = (dir, base = '') => {
            let results = [];
            const list = fs.readdirSync(dir);

            list.forEach(file => {
                const filePath = path.join(dir, file);
                const relativePath = path.join(base, file);
                const stat = fs.statSync(filePath);

                if (stat && stat.isDirectory()) {
                    results = results.concat(getFilesRecursive(filePath, relativePath));
                } else {
                    results.push(relativePath.replace(/\\/g, '/'));
                }
            });

            return results;
        };

        const allFiles = getFilesRecursive(DIR_PUBLIC);
        res.json(allFiles);
    } catch (err) {
        res.status(500).json({ error: 'Files error' });
    }
});

app.get('/api/file', requireAdmin, (req, res) => {
    try {
        const filePathParam = req.query.path;

        if (!filePathParam) {
            return res.status(400).json({ error: 'Path error' });
        }

        const safePath = path.normalize(filePathParam).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(DIR_PUBLIC, safePath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: '404' });
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: 'File error' });
    }
});

app.post('/api/file', requireAdmin, (req, res) => {
    try {
        const { filePath, content } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'Path error' });
        }

        const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(DIR_PUBLIC, safePath);

        fs.writeFileSync(fullPath, content, 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'File error' });
    }
});

const loadModularRoute = (routeName, routeFile) => {
    const fullPath = path.join(DIR_ROUTES, routeFile);
    if (fs.existsSync(fullPath)) {
        try {
            const routeModule = require(fullPath);
            app.use(routeName, routeModule);
        } catch (err) {
            logger.error(`Ошибка загрузки роута ${routeName}`, err);
        }
    }
};

loadModularRoute('/lssd', 'lssd.js');
loadModularRoute('/lspd', 'lspd.js');
loadModularRoute('/gov', 'gov.js');
loadModularRoute('/fib', 'fib.js');
loadModularRoute('/deadly', 'deadly.js');
loadModularRoute('/ems', 'ems.js');

app.use((req, res) => {
    res.status(404).send('404');
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    res.status(500).json({ error: '500' });
});

process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
});

const server = http.createServer(app);

server.on('error', (err) => {
    logger.error('Server error', err);
    process.exit(1);
});

server.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
});

const gracefulShutdown = (signal) => {
    server.close(() => {
        process.exit(0);
    });
    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
