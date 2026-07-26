require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

const DIR_DATA = path.join(__dirname, 'data');
const DIR_LOGS = path.join(__dirname, 'logs');
const DIR_PUBLIC = path.join(__dirname, 'public');
const DIR_UPLOADS = path.join(__dirname, 'public', 'uploads');
const DIR_SYSTEMS = path.join(__dirname, 'public', 'systems');
const DIR_VIEWS = path.join(__dirname, 'views');
const DIR_ROUTES = path.join(__dirname, 'routes');

const FILE_PROJECTS = path.join(DIR_DATA, 'projects.json');
const FILE_SETTINGS = path.join(DIR_DATA, 'config.json');
const FILE_VISITS = path.join(DIR_LOGS, 'visits.log');
const FILE_ERRORS = path.join(DIR_LOGS, 'errors.log');

const ensureDirectoriesExist = () => {
    const directories = [DIR_DATA, DIR_LOGS, DIR_PUBLIC, DIR_UPLOADS, DIR_SYSTEMS, DIR_VIEWS, DIR_ROUTES];
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[INIT] ${dir}`);
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

const logger = {
    info: (msg) => {
        const logMsg = `[INFO] ${new Date().toLocaleString('ru-RU')} | ${msg}`;
        console.log(logMsg);
    },
    visit: (req) => {
        const logMsg = `[VISIT] ${new Date().toLocaleString('ru-RU')} | IP: ${req.ip} | URL: ${req.originalUrl} | Method: ${req.method}`;
        console.log(logMsg);
        try { 
            fs.appendFileSync(FILE_VISITS, logMsg + '\n'); 
        } catch (e) {}
    },
    error: (msg, err) => {
        const logMsg = `[ERROR] ${new Date().toLocaleString('ru-RU')} | ${msg} | ${err ? err.stack || err.message : ''}`;
        console.error(logMsg);
        try { 
            fs.appendFileSync(FILE_ERRORS, logMsg + '\n'); 
        } catch (e) {}
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
app.use(cookieParser());

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
    if (!req.originalUrl.includes('/api/logs')) {
        logger.visit(req);
    }
    next();
});

app.use(express.static(DIR_PUBLIC));

const requireAdmin = (req, res, next) => {
    const isAdmin = req.cookies && req.cookies.admin_auth === 'true';
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
        const type = req.query.type || 'visits';
        const file = type === 'errors' ? FILE_ERRORS : FILE_VISITS;
        
        if (!fs.existsSync(file)) {
            return res.json({ logs: 'Empty' });
        }
        
        const data = fs.readFileSync(file, 'utf8');
        const lines = data.split('\n').filter(Boolean);
        const lastLines = lines.slice(-200).reverse().join('\n');
        
        res.json({ logs: lastLines });
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
        } catch (err) {}
    }
};

loadModularRoute('/api/external', 'api.js');
loadModularRoute('/lssd', 'lssd.js');
loadModularRoute('/lspd', 'lspd.js');
loadModularRoute('/gov', 'gov.js');
loadModularRoute('/cid', 'cid.js');

app.use((req, res, next) => {
    res.status(404).send('404');
});

app.use((err, req, res, next) => {
    res.status(500).json({ error: '500' });
});

process.on('uncaughtException', (err) => {});
process.on('unhandledRejection', (reason, promise) => {});

const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`[OK] Port ${PORT}`);
});
