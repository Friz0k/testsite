const express = require('express');
const router = express.Router();

router.post('/api/auth', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.loggedIn = true;
        res.redirect('/admin');
    } else {
        res.status(401).send(`
            <body style="background:#050505; color:#fff; text-align:center; padding:50px; font-family:sans-serif;">
                <h2>Неверные данные</h2>
                <a href="/login" style="color:#8a2be2; text-decoration:none; font-weight:bold;">Вернуться</a>
            </body>
        `);
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

module.exports = router;