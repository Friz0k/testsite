const express = require('express');
const fs = require('fs');
const path = require('path');
const upload = require('../middleware/upload');
const requireAuth = require('../middleware/auth');

const router = express.Router();
const PROJECTS_FILE = path.join(__dirname, '../data', 'projects.json');
const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');

router.get('/projects', (req, res) => {
    try {
        const data = fs.readFileSync(PROJECTS_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.json([]);
    }
});

router.post('/projects', requireAuth, upload.single('image'), (req, res) => {
    try {
        const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        const newProject = {
            id: Date.now(),
            title: req.body.title,
            desc: req.body.desc,
            link: req.body.link || '#',
            tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
            image: req.file ? `/uploads/${req.file.filename}` : ''
        };
        projects.push(newProject);
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        res.json({ success: true, message: 'Проект добавлен' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.delete('/projects/:id', requireAuth, (req, res) => {
    try {
        let projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        projects = projects.filter(p => p.id != req.params.id);
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        res.json({ success: true, message: 'Проект удален' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/config', requireAuth, (req, res) => {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.json({});
    }
});

router.post('/config', requireAuth, (req, res) => {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Конфигурация обновлена' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;