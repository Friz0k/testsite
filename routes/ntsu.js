const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');

const FILE_NTSU = path.join(__dirname, '../data/ntsu.json');

router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(FILE_NTSU)) {
            fs.writeFileSync(FILE_NTSU, JSON.stringify({ events: [] }), 'utf8');
        }
        let data = JSON.parse(fs.readFileSync(FILE_NTSU, 'utf8'));
        if (!data.events) {
            data.events = [];
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Data error' });
    }
});

router.post('/', authMiddleware, (req, res) => {
    try {
        fs.writeFileSync(FILE_NTSU, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Write error' });
    }
});

module.exports = router;
