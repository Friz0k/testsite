require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const authMiddleware = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/login');
};

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        return res.redirect('/admin');
    }
    res.redirect('/login?error=1');
});

app.get('/admin', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

const dataDir = path.join(__dirname, 'data');
const settingsFilePath = path.join(dataDir, 'settings.json');
const projectsFilePath = path.join(dataDir, 'projects.json');

function ensureDataFiles() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(settingsFilePath)) {
        fs.writeFileSync(settingsFilePath, JSON.stringify({}));
    }
    if (!fs.existsSync(projectsFilePath)) {
        fs.writeFileSync(projectsFilePath, JSON.stringify([]));
    }
}
ensureDataFiles();

app.get('/api/settings', authMiddleware, (req, res) => {
    ensureDataFiles();
    fs.readFile(settingsFilePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Error' });
        try {
            res.json(JSON.parse(data));
        } catch (e) {
            res.json({});
        }
    });
});

app.post('/api/settings', authMiddleware, (req, res) => {
    ensureDataFiles();
    fs.writeFile(settingsFilePath, JSON.stringify(req.body, null, 2), 'utf8', (err) => {
        if (err) return res.status(500).json({ error: 'Error' });
        res.json({ success: true });
    });
});

app.post('/api/upload', authMiddleware, (req, res) => {
    const { image, filename } = req.body;
    if (!image) return res.status(400).json({ error: 'No image' });
    
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const ext = filename ? path.extname(filename) : '.png';
    const uniqueName = 'media_' + Date.now() + ext;
    const filePath = path.join(uploadsDir, uniqueName);

    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).json({ error: 'Save error' });
        res.json({ success: true, url: '/uploads/' + uniqueName });
    });
});

app.get('/api/projects', authMiddleware, (req, res) => {
    ensureDataFiles();
    fs.readFile(projectsFilePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Error' });
        try {
            res.json(JSON.parse(data));
        } catch (e) {
            res.json([]);
        }
    });
});

app.post('/api/projects', authMiddleware, (req, res) => {
    ensureDataFiles();
    const projects = req.body;
    fs.writeFile(projectsFilePath, JSON.stringify(projects, null, 2), 'utf8', (err) => {
        if (err) return res.status(500).json({ error: 'Error' });
        res.json({ success: true });
    });
});

app.get('/api/logs', authMiddleware, (req, res) => {
    exec('pm2 logs frizworld --lines 100 --nostream', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: stderr || error.message });
        }
        res.json({ logs: stdout });
    });
});

app.get('/api/file', authMiddleware, (req, res) => {
    const targetFile = req.query.path || 'server.js';
    const filePath = path.join(__dirname, targetFile);
    if (!filePath.startsWith(__dirname)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).json({ error: 'File not found' });
        res.json({ content: data });
    });
});

app.post('/api/file', authMiddleware, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Path not specified' });
    const fullPath = path.join(__dirname, filePath);
    if (!fullPath.startsWith(__dirname)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    fs.writeFile(fullPath, content, 'utf8', (err) => {
        if (err) return res.status(500).json({ error: 'Save error' });
        res.json({ success: true });
    });
});

try {
    const pagesRouter = require('./routes/pages');
    app.use('/', pagesRouter);
} catch (e) {}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
