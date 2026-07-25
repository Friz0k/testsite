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

router.post('/badge', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const payload = {
            content: config.roles ? `<@&${config.roles}>` : '',
            embeds: [{
                title: '🆕 Новая заявка на проверку жетона (LSPD)',
                color: 16758502,
                fields: [
                    { name: '👤 Ник', value: data.name || '—', inline: true },
                    { name: '🔗 Ссылка на сообщение', value: data.messageLink || '—', inline: false }
                ],
                image: data.photoUrl ? { url: data.photoUrl } : null,
                timestamp: new Date().toISOString()
            }]
        };
        await sendToDiscord(config.webhooks.lspd, payload);
        res.json({ success: true, message: 'Заявка отправлена!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/cadet', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const payload = {
            content: config.roles ? `<@&${config.roles}> Новый отчёт!` : '',
            embeds: [{
                title: data.type === '1-2' ? '📈 Повышение 1→2' : '📈 Повышение 2→3',
                color: 16758502,
                fields: [
                    { name: '👤 Ник', value: data.nick || '—', inline: true },
                    { name: '💬 Discord', value: data.discord || '—', inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        await sendToDiscord(config.webhooks.lspd, payload);
        res.json({ success: true, message: 'Отчёт отправлен!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/test', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const payload = {
            embeds: [{
                title: 'Результат теста (1→2) LSPD',
                color: 0xFF3EB0,
                fields: [
                    { name: 'Ник', value: data.nickname || '—', inline: true },
                    { name: 'Discord', value: data.discordTag || '—', inline: true },
                    { name: 'Результат', value: `${data.score}/${data.total}`, inline: true },
                    { name: 'Статус', value: data.passed ? '✅ Сдал' : '❌ Не сдал', inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        await sendToDiscord(config.webhooks.lspd, payload);
        res.json({ success: true, message: 'Результат сохранён' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;