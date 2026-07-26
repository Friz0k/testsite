const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'media_' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
    const logMessage = `[ВИЗИТ] ${new Date().toLocaleString()} | IP: ${req.ip} | URL: ${req.originalUrl}`;
    console.log(logMessage);
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { fs.appendFileSync(path.join(logDir, 'visits.log'), logMessage + '\n'); } catch (e) {}
    next();
});

const projectsFilePath = path.join(__dirname, 'data', 'projects.json');
const settingsFilePath = path.join(__dirname, 'data', 'settings.json');
const logsFilePath = path.join(__dirname, 'logs', 'visits.log');

const checkAuth = (req, res, next) => {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('admin_auth=true')) {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    next();
};

app.get('/api/projects', (req, res) => {
    if (!fs.existsSync(projectsFilePath)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(projectsFilePath, 'utf8')));
});

app.post('/api/projects', checkAuth, (req, res) => {
    const dataDir = path.dirname(projectsFilePath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(projectsFilePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
    if (!fs.existsSync(settingsFilePath)) return res.json({});
    res.json(JSON.parse(fs.readFileSync(settingsFilePath, 'utf8')));
});

app.post('/api/settings', checkAuth, (req, res) => {
    const dataDir = path.dirname(settingsFilePath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsFilePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
});

app.get('/api/logs', checkAuth, (req, res) => {
    if (!fs.existsSync(logsFilePath)) return res.json({ logs: 'Логов пока нет' });
    const data = fs.readFileSync(logsFilePath, 'utf8');
    const lastLines = data.split('\n').filter(Boolean).slice(-100).reverse().join('\n');
    res.json({ logs: lastLines });
});

app.get('/api/list-files', checkAuth, (req, res) => {
    const publicDir = path.join(__dirname, 'public');
    const getFiles = (dir, base = '') => {
        let results = [];
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            const relativePath = path.join(base, file);
            if (fs.statSync(filePath).isDirectory()) results = results.concat(getFiles(filePath, relativePath));
            else results.push(relativePath.replace(/\\/g, '/'));
        });
        return results;
    };
    try { res.json(getFiles(publicDir)); } catch(e) { res.json([]); }
});

app.get('/api/file', checkAuth, (req, res) => {
    const fullPath = path.join(__dirname, 'public', req.query.path.replace(/^(\.\.[\/\\])+/, ''));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Файл не найден' });
    res.json({ content: fs.readFileSync(fullPath, 'utf8') });
});

app.post('/api/file', checkAuth, (req, res) => {
    const fullPath = path.join(__dirname, 'public', req.body.filePath.replace(/^(\.\.[\/\\])+/, ''));
    fs.writeFileSync(fullPath, req.body.content, 'utf8');
    res.json({ success: true });
});

app.post('/api/upload', checkAuth, upload.single('image'), (req, res) => {
    if (!req.file && !req.body.image) return res.status(400).json({ error: 'Файл не загружен' });
    
    if (req.body.image && req.body.image.startsWith('data:image')) {
        const matches = req.body.image.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `media_${Date.now()}.${matches[1] === 'jpeg' ? 'jpg' : matches[1]}`;
        fs.writeFileSync(path.join(__dirname, 'public', 'uploads', filename), buffer);
        return res.json({ success: true, url: `/uploads/${filename}` });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin') {
        res.setHeader('Set-Cookie', 'admin_auth=true; Path=/; HttpOnly');
        res.redirect('/admin');
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/admin', (req, res) => {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('admin_auth=true')) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
