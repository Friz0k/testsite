const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { webhooks: {}, roles: "", testSettings: { questions: [] } };
    }
}

async function sendToDiscord(webhook, payload) {
    if (!webhook) return;
    try {
        await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error(err);
    }
}

router.get('/questions', (req, res) => {
    const config = getConfig();
    const questions = config.testSettings && config.testSettings.questions ? config.testSettings.questions : [];
    res.json({ success: true, questions: questions });
});

router.post('/submit', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();

        const payload = {
            content: config.roles ? `<@&${config.roles}>` : '',
            username: "FIB Cop bot",
            embeds: [{
                title: "📋 FIB переаттестация",
                color: 0x00FF00,
                fields: [
                    { name: "👤 Никнейм:", value: `${data.nickname || '—'} (${data.discordTag || '—'})\n🏅 Ранг: ${data.rank || '—'}`, inline: false },
                    { name: "⚠️ Количество выхода из страницы:", value: `${data.leaveCount || 0}`, inline: false }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(config.webhooks.fib, payload);
        res.json({ success: true, score: 0 });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
