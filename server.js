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
                console.log(`[INIT] Создана директория: ${dir}`);
            } catch (err) {
                console.error(`[FATAL] Ошибка создания директории ${dir}:`, err.message);
                process.exit(1);
            }
        }
    });
};

const ensureFilesExist = () => {
    if (!fs.existsSync(FILE_PROJECTS)) fs.writeFileSync(FILE_PROJECTS, '[]', 'utf8');
    if (!fs.existsSync(FILE_SETTINGS)) fs.writeFileSync(FILE_SETTINGS, '{}', 'utf8');
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
        try { fs.appendFileSync(FILE_VISITS, logMsg + '\n'); } catch (e) {}
    },
    error: (msg, err) => {
        const logMsg = `[ERROR] ${new Date().toLocaleString('ru-RU')} | ${msg} | ${err ? err.stack || err.message : ''}`;
        console.error(logMsg);
        try { fs.appendFileSync(FILE_ERRORS, logMsg + '\n'); } catch (e) {}
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
            cb(new Error('Разрешены только изображения'), false);
        }
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

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
            return res.status(403).json({ error: 'Доступ запрещен. Требуется авторизация.' });
        }
        return res.redirect('/login');
    }
    next();
};

app.get('/login', (req, res) => {
    const loginPath = path.join(DIR_VIEWS, 'login.html');
    if (!fs.existsSync(loginPath)) {
        logger.error('Файл login.html не найден в папке views');
        return res.status(500).send('Системная ошибка: файл авторизации не найден');
    }
    res.sendFile(loginPath);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const envUser = process.env.ADMIN_USER;
    const envPass = process.env.ADMIN_PASS;

    if (!envUser || !envPass) {
        logger.error('Отсутствуют ADMIN_USER или ADMIN_PASS в файле .env');
        return res.status(500).send('Ошибка конфигурации сервера');
    }

    if (username === envUser && password === envPass) {
        logger.info(`Успешный вход администратора с IP: ${req.ip}`);
        res.cookie('admin_auth', 'true', { 
            httpOnly: true, 
            path: '/', 
            maxAge: 24 * 60 * 60 * 1000 
        });
        res.redirect('/admin');
    } else {
        logger.info(`Неудачная попытка входа: логин=${username}, IP=${req.ip}`);
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
        logger.error('Файл admin.html не найден в папке views');
        return res.status(500).send('Системная ошибка: панель управления не найдена');
    }
    res.sendFile(adminPath);
});

app.get('/api/projects', (req, res) => {
    try {
        const data = fs.readFileSync(FILE_PROJECTS, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        logger.error('Ошибка чтения projects.json', err);
        res.status(500).json({ error: 'Ошибка чтения проектов' });
    }
});

app.post('/api/projects', requireAdmin, (req, res) => {
    try {
        fs.writeFileSync(FILE_PROJECTS, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        logger.error('Ошибка сохранения projects.json', err);
        res.status(500).json({ error: 'Ошибка сохранения проектов' });
    }
});

app.get('/api/settings', (req, res) => {
    try {
        const data = fs.readFileSync(FILE_SETTINGS, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        logger.error('Ошибка чтения config.json', err);
        res.status(500).json({ error: 'Ошибка чтения настроек' });
    }
});

app.post('/api/settings', requireAdmin, (req, res) => {
    try {
        fs.writeFileSync(FILE_SETTINGS, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        logger.error('Ошибка сохранения config.json', err);
        res.status(500).json({ error: 'Ошибка сохранения настроек' });
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
            return res.status(400).json({ error: 'Файл не загружен' });
        }
        
        res.json({ success: true, url: `/uploads/${req.file.filename}` });
    } catch (err) {
        logger.error('Ошибка при загрузке изображения', err);
        res.status(500).json({ error: 'Внутренняя ошибка при сохранении файла' });
    }
});

app.get('/api/logs', requireAdmin, (req, res) => {
    try {
        if (!fs.existsSync(FILE_VISITS)) return res.json({ logs: 'Логов пока нет' });
        const data = fs.readFileSync(FILE_VISITS, 'utf8');
        const lines = data.split('\n').filter(Boolean);
        const lastLines = lines.slice(-200).reverse().join('\n');
        res.json({ logs: lastLines });
    } catch (err) {
        logger.error('Ошибка чтения логов', err);
        res.status(500).json({ error: 'Ошибка чтения логов' });
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
        logger.error('Ошибка получения списка файлов', err);
        res.status(500).json({ error: 'Ошибка получения списка файлов' });
    }
});

app.get('/api/file', requireAdmin, (req, res) => {
    try {
        const filePathParam = req.query.path;
        if (!filePathParam) return res.status(400).json({ error: 'Путь не указан' });
        
        const safePath = path.normalize(filePathParam).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(DIR_PUBLIC, safePath);
        
        if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Файл не найден' });
        
        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content });
    } catch (err) {
        logger.error(`Ошибка чтения файла ${req.query.path}`, err);
        res.status(500).json({ error: 'Ошибка чтения файла' });
    }
});

app.post('/api/file', requireAdmin, (req, res) => {
    try {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).json({ error: 'Путь не указан' });
        
        const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(DIR_PUBLIC, safePath);
        
        fs.writeFileSync(fullPath, content, 'utf8');
        logger.info(`Файл изменен через админку: ${safePath}`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Ошибка сохранения файла кода', err);
        res.status(500).json({ error: 'Ошибка сохранения файла' });
    }
});

const loadModularRoute = (routeName, routeFile) => {
    const fullPath = path.join(DIR_ROUTES, routeFile);
    if (fs.existsSync(fullPath)) {
        try {
            const routeModule = require(fullPath);
            app.use(routeName, routeModule);
            logger.info(`Роут ${routeName} успешно загружен из ${routeFile}`);
        } catch (err) {
            logger.error(`Ошибка при загрузке роута ${routeFile}`, err);
        }
    } else {
        logger.info(`Роут файл ${routeFile} не найден. Пропуск.`);
    }
};

loadModularRoute('/api/external', 'api.js');
loadModularRoute('/lssd', 'lssd.js');
loadModularRoute('/lspd', 'lspd.js');
loadModularRoute('/gov', 'gov.js');
loadModularRoute('/cid', 'cid.js');

app.use((req, res, next) => {
    logger.info(`404 - Страница не найдена: ${req.originalUrl}`);
    res.status(404).send('404 - Страница не найдена');
});

app.use((err, req, res, next) => {
    logger.error(`Глобальная ошибка при обработке запроса ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Обратитесь к администратору.' });
});

process.on('uncaughtException', (err) => {
    logger.error('КРИТИЧЕСКАЯ ОШИБКА (uncaughtException): Сервер продолжает работу', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ (unhandledRejection):', reason);
});

const server = http.createServer(app);

server.listen(PORT, () => {
    logger.info(`[START] Сервер Frizworld успешно запущен на порту ${PORT}`);
    logger.info(`[ENV] Пользователь админки загружен: ${process.env.ADMIN_USER ? 'ДА' : 'НЕТ'}`);
});
