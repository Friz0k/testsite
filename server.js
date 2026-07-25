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

const checkAuth = (req, res, next) => {
    const cookies = req.headers.cookie || '';
    console.log(`[DEBUG AUTH] Проверка URL: ${req.originalUrl} | Полученные куки: "${cookies}"`);
    
    if (cookies.includes('admin_auth=true')) {
        console.log(`[DEBUG AUTH] Успешно: куки админа найдены для ${req.originalUrl}`);
        return next();
    }
    
    console.warn(`[DEBUG AUTH] Отказ в доступе: куки не найдены. Перенаправление на /login`);
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Доступ запрещен' });
    }
    return res.redirect('/login');
};

app.use(express.static(path.join(__dirname, 'public')));

const projectsFilePath = path.join(__dirname, 'data', 'projects.json');
const configFilePath = path.join(__dirname, 'data', 'config.json');
const systemsDirPath = path.join(__dirname, 'public', 'systems');

const getHtmlFile = (fileName) => {
    const viewsPath = path.join(__dirname, 'views', fileName);
    const publicPath = path.join(__dirname, 'public', fileName);
    console.log(`[DEBUG FILE] Поиск файла ${fileName}...`);
    console.log(` -> Проверка в views: ${viewsPath} (Существует: ${fs.existsSync(viewsPath)})`);
    console.log(` -> Проверка в public: ${publicPath} (Существует: ${fs.existsSync(publicPath)})`);
    
    if (fs.existsSync(viewsPath)) return viewsPath;
    if (fs.existsSync(publicPath)) return publicPath;
    return null;
};

app.get('/login', (req, res) => {
    console.log('[DEBUG ROUTE] Запрошена страница /login');
    const filePath = getHtmlFile('login.html');
    if (filePath) {
        res.sendFile(filePath);
    } else {
        console.error('[DEBUG ERROR] Файл login.html не найден ни в /views, ни в /public!');
        res.status(404).send('Файл login.html не найден');
    }
});

const handleLogin = (req, res) => {
    console.log('[DEBUG LOGIN] Получен POST запрос на авторизацию.');
    console.log('[DEBUG LOGIN] Тело запроса (req.body):', req.body);
    
    const username = req.body.username || req.body.user || req.body.login || req.body.email;
    const password = req.body.password || req.body.pass || req.body.pwd;
    
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';

    console.log(`[DEBUG LOGIN] Сравнение: введено [${username} / ${password}], ожидается [${adminUser} / ${adminPass}]`);

    if (username === adminUser && password === adminPass) {
        console.log('[DEBUG LOGIN] Пароль верный! Установка куки admin_auth=true...');
        res.setHeader('Set-Cookie', 'admin_auth=true; Path=/; HttpOnly');
        
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            console.log('[DEBUG LOGIN] Отправка JSON ответа об успешном входе.');
            return res.json({ success: true, redirect: '/admin.html' });
        }
        console.log('[DEBUG LOGIN] Выполнение редиректа на /admin.html');
        return res.redirect('/admin.html');
    } else {
        console.warn('[DEBUG LOGIN] Ошибка входа: неверный логин или пароль!');
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            return res.status(401).json({ success: false, error: 'Неверные данные' });
        }
        return res.redirect('/login?error=1');
    }
};

app.post('/login', handleLogin);
app.post('/api/auth', handleLogin);

app.get(['/admin', '/admin.html'], checkAuth, (req, res) => {
    console.log('[DEBUG ROUTE] Доступ к админке разрешен, поиск файла admin.html...');
    const filePath = getHtmlFile('admin.html');
    if (filePath) {
        console.log(`[DEBUG ROUTE] Отправка файла админки: ${filePath}`);
        res.sendFile(filePath);
    } else {
        console.error('[DEBUG ERROR] Файл admin.html не найден ни в /views, ни в /public!');
        res.status(404).send('Файл admin.html не найден');
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

app.post('/api/projects', checkAuth, (req, res) => {
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

app.post('/api/settings', checkAuth, (req, res) => {
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

app.post('/api/upload', checkAuth, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.get('/api/logs', checkAuth, (req, res) => {
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

app.get('/api/list-files', checkAuth, (req, res) => {
    const targetFiles = [
        'server.js',
        'package.json',
