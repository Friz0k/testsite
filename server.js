const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
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
            cb(new Error('Только изображения разрешены для загрузки!'), false);
        }
    }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
    const logMessage = `[ВИЗИТ] ${new Date().toLocaleString()} | IP: ${req.ip || req.connection.remoteAddress} | URL: ${req.originalUrl} | Агент: ${req.headers['user-agent'] || 'Неизвестно'}`;
    console.log(logMessage);
    
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
        try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
    }
    try {
        fs.appendFileSync(path.join(logDir, 'visits.log'), logMessage + '\n');
    } catch (e) {}
    
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

const projectsFilePath = path.join(__dirname, 'data', 'projects.json');
const configFilePath = path.join(__dirname, 'data', 'config.json');
const systemsDirPath = path.join(__dirname, 'public', 'systems');

app.get('/login', (req, res) => {
    const viewsLogin = path.join(__dirname, 'views', 'login.html');
    const publicLogin = path.join(__dirname, 'public', 'login.html');
    if (fs.existsSync(viewsLogin)) {
        res.sendFile(viewsLogin);
    } else {
        res.sendFile(publicLogin);
    }
});

app.post('/login', (req, res) => {
    const username = req.body.username || req.body.user || req.body.login || req.body.email;
    const password = req.body.password || req.body.pass || req.body.pwd;
    
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';

    if (username === adminUser && password === adminPass) {
        res.setHeader('Set-Cookie', 'admin_auth=true; Path=/; HttpOnly');
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.json({ success: true, redirect: '/admin.html' });
        }
        return res.redirect('/admin.html');
    } else {
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(401).json({ success: false, error: 'Неверные данные' });
        }
        return res.redirect('/login?error=1');
    }
});

app.get(['/admin', '/admin.html'], authMiddleware, (req, res) => {
    const viewsAdmin = path.join(__dirname, 'views', 'admin.html');
    const publicAdmin = path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(viewsAdmin)) {
        res.sendFile(viewsAdmin);
    } else {
        res.sendFile(publicAdmin);
    }
});

app.get('/api/projects', (req, res) => {
    if (!fs.existsSync(projectsFilePath)) {
        return res.json([]);
    }
    try {
        const data = fs.readFileSync(projectsFilePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения проектов' });
    }
});

app.post('/api/projects', authMiddleware, (req, res) => {
    try {
        const dataDir = path.dirname(projectsFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(projectsFilePath, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сохранения проектов' });
    }
});

app.get('/api/settings', (req, res) => {
    if (!fs.existsSync(configFilePath)) {
        return res.json({});
    }
    try {
        const data = fs.readFileSync(configFilePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения настроек' });
    }
});

app.post('/api/settings', authMiddleware, (req, res) => {
    try {
        const dataDir = path.dirname(configFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(configFilePath, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сохранения настроек' });
    }
});

app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.get('/api/logs', authMiddleware, (req, res) => {
    const logPath = path.join(__dirname, 'logs', 'visits.log');
    if (!fs.existsSync(logPath)) {
        return res.json({ logs: 'Логов пока нет' });
    }
    try {
        const data = fs.readFileSync(logPath, 'utf8');
        res.json({ logs: data });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения логов' });
    }
});

app.get('/api/list-files', authMiddleware, (req, res) => {
    const targetFiles = ['server.js', 'package.json', 'data/projects.json', 'data/config.json', 'views/admin.html', 'views/login.html', 'public/index.html'];
    const existingFiles = targetFiles.filter(f => fs.existsSync(path.join(__dirname, f)));
    res.json(existingFiles);
});

app.get('/api/file', authMiddleware, (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Путь не указан' });
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Файл не найден' });
    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения файла' });
    }
});

app.post('/api/file', authMiddleware, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Путь не указан' });
    const fullPath = path.join(__dirname, filePath);
    try {
        fs.writeFileSync(fullPath, content, 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка записи файла' });
    }
});

app.get('/api/systems', (req, res) => {
    if (!fs.existsSync(systemsDirPath)) {
        return res.json([]);
    }
    try {
        const items = fs.readdirSync(systemsDirPath, { withFileTypes: true });
        const systemsList = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory()
        }));
        res.json(systemsList);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка чтения системной директории' });
    }
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.status(404).send('Страница не найдена');
        }
    });
});

app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err.stack);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
