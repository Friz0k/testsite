const express = require('express');
const path = require('path');
const requireAuth = require('../middleware/auth');
const router = express.Router();

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../views', 'login.html'));
});

router.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../views', 'admin.html'));
});

module.exports = router;