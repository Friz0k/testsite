const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'frizworld-secure-key-gta5rp-2026',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const authMiddleware = (req, res, next) => {
    const cookies = req.headers.cookie || '';
    if ((req.session && req.session.isAdmin) || cookies.includes('admin_auth=true')) {
        return next();
    }
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Доступ запрещен' });
    }
    res.redirect('/login');
};

const getHtmlFile = (fileName) => {
    const viewsPath = path.join(__dirname, 'views', fileName);
    const publicPath = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(viewsPath)) return viewsPath;
    if (fs.existsSync(publicPath)) return publicPath;
    return null;
};

app.get('/login', (req, res) => {
    const filePath = getHtmlFile('login.html');
    if (filePath) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Файл login.html не найден');
    }
});

const handleLogin = (req, res) => {
    const username = req.body.username || req.body.user || req.body.login || req.body.email;
    const password = req.body.password || req.body.pass || req.body.pwd;
    
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';

    if (username === adminUser && password === adminPass) {
        if (req.session) req.session.isAdmin = true;
        res.setHeader('Set-Cookie', 'admin_auth=true; Path=/; HttpOnly');
        
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.json({ success: true, redirect: '/admin' });
        }
        return res.redirect('/admin');
    } else {
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(401).json({ success: false, error: 'Неверные данные' });
        }
        return res.redirect('/login?error=1');
    }
};

app.post('/login', handleLogin);
app.post('/api/auth', handleLogin);

app.get(['/admin', '/admin.html'], authMiddleware, (req, res) => {
    const filePath = getHtmlFile('admin.html');
    if (filePath) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Файл admin.html не найден');
    }
});

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const settingsFilePath = path.join(dataDir, 'settings.json');
const projectsFilePath = path.join(dataDir, 'projects.json');

function ensureDataFiles() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(settingsFilePath)) {
        fs.writeFileSync(settingsFilePath, JSON.stringify({}));
    }
    if (!fs.existsSync(projectsFilePath)) {
        fs.writeFileSync(projectsFilePath, JSON.stringify([]));
    }
}
ensureDataFiles();

app.get('/api/settings', (req, res) => {
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
    
    ensureDataFiles();

    const base64Data = image.replace(/^data:image\/[a-zA-Z0-9-+.]+;base64,/i, '');
    const ext = filename ? path.extname(filename) : '.png';
    const uniqueName = 'media_' + Date.now() + ext;
    const filePath = path.join(uploadsDir, uniqueName);

    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).json({ error: 'Save error' });
        res.json({ success: true, url: '/uploads/' + uniqueName });
    });
});

app.get('/api/projects', (req, res) => {
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

function getFilesRecursive(dir, baseDir = dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
        if (relativePath.startsWith('node_modules') || relativePath.startsWith('.git') || relativePath.startsWith('data') || relativePath.startsWith('public/uploads')) {
            return;
        }
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFilesRecursive(filePath, baseDir));
        } else {
            results.push(relativePath);
        }
    });
    return results;
}

app.get('/api/list-files', authMiddleware, (req, res) => {
    try {
        const files = getFilesRecursive(__dirname);
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/file', authMiddleware, (req, res) => {
    const targetFile = req.query.path;
    if (!targetFile) return res.status(400).json({ error: 'Path not specified' });
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

const FIB_CONFIG = {
    DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1498677954937487370/PAVXARtu3bSeJodua89uIT8nFAAX1c_8FX0EMxZDMIukD2Y9Mnu_1M5gVMHZ4Vv8gvVW',
    DISCORD_ROLE_ID: '839596804785176577'
};

const TEST_QUESTIONS = [
    { id: 1, question: "Что, согласно УК, является основным источником уголовного права в штате Сан-Андреас?", options: [{ text: "Конституция штата.", correct: false }, { text: "Судебный Кодекс.", correct: false }, { text: "Уголовный Кодекс.", correct: true }, { text: "Процессуальный Кодекс.", correct: false }], type: "single", points: 1 },
    { id: 2, question: "Какой орган осуществляет надзор за законностью в штате?", options: [{ text: "FIB", correct: false }, { text: "Прокуратура", correct: true }, { text: "LSPD", correct: false }, { text: "Суд", correct: false }], type: "single", points: 1 }
];

app.get('/api/test-settings', (req, res) => {
    ensureDataFiles();
    fs.readFile(settingsFilePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Error' });
        try {
            const parsed = JSON.parse(data);
            res.json(parsed.testSettings || { questions: TEST_QUESTIONS });
        } catch (e) {
            res.json({ questions: TEST_QUESTIONS });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
