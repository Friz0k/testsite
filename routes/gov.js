const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { webhooks: {}, roles: "" };
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

router.post('/submit', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        
        const payload = {
            content: config.roles ? `<@&${config.roles}>` : '',
            username: "Секретарь Коллегии Адвокатов",
            embeds: [{
                color: 0x00FF00,
                description: `**🏛️ Имя:** ${data.nickname || '—'}\n**📞 Discord:** ${data.discordTag || '—'}\n**🔍 Статус:** ЗАВЕРШЕНО`,
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(config.webhooks.gov, payload);
        res.json({ success: true, message: 'Результаты успешно отправлены' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;