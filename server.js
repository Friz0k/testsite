require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true
    }
}));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const authRoutes = require('./routes/auth');
const pagesRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');

const lssdRoutes = require('./routes/lssd');
const lspdRoutes = require('./routes/lspd');
const govRoutes = require('./routes/gov');
const cidRoutes = require('./routes/cid');
const fibRoutes = require('./routes/fib');

app.use('/', authRoutes);
app.use('/', pagesRoutes);
app.use('/api', apiRoutes);

app.use('/api/lssd', lssdRoutes);
app.use('/api/lspd', lspdRoutes);
app.use('/api/gov', govRoutes);
app.use('/api/cid', cidRoutes);
app.use('/api/fib', fibRoutes);

app.use((req, res, next) => {
    res.status(404).send('Страница не найдена или доступ запрещен');
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Внутренняя ошибка сервера');
});

app.listen(port, () => {
    console.log(`Сервер защищен и работает на порту ${port}`);
});