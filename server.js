const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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

app.use('/admin.html', (req, res, next) => {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('admin_auth=true')) {
        return res.redirect('/login');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

const projectsFilePath = path.join(__dirname, 'data', 'projects.json');
const systemsDirPath = path.join(__dirname, 'public', 'systems');

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

app.post('/api/projects', (req, res) => {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('admin_auth=true')) {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
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

app.post('/api/upload', upload.single('image'), (req, res) => {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('admin_auth=true')) {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    res.json({ url: `/uploads/${req.file.filename}` });
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

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    console.log('ПОЛУЧЕНЫ ДАННЫЕ ВХОДА:', req.body);
    
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
        console.log(`ОШИБКА ВХОДА. Введено: [${username} / ${password}]`);
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(401).json({ success: false, error: 'Неверные данные' });
        }
        return res.redirect('/login?error=1');
    }
});

app.get('/admin', (req, res) => {
    res.redirect('/admin.html');
});

app.use((req, res, next) => {
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
