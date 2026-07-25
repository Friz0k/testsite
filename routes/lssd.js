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
        console.error('Discord Webhook Error:', err);
    }
}

router.post('/report', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.webhooks.lssd; 

        const embeds = [{
            title: '📊 Еженедельный отчёт LSSD',
            color: 0xC29B6E,
            fields: [
                { name: '👤 Сотрудник', value: data.employee || '—', inline: true },
                { name: '🏅 Ранг', value: data.rankName || '—', inline: true },
                { name: '📅 Период', value: `${data.startDate} — ${data.endDate} (${data.periodDays} дн.)`, inline: false },
                { name: '🏆 Итого баллов', value: `\`\`\`${data.actions ? data.actions.reduce((sum, a) => sum + a.points, 0) : 0} баллов\`\`\``, inline: true },
                { name: '📊 Количество действий', value: `\`\`\`${data.actions ? data.actions.length : 0}\`\`\``, inline: true }
            ],
            timestamp: new Date().toISOString()
        }];

        const payload = {
            username: 'LSSD Отчёты',
            avatar_url: 'https://i.imgur.com/7kZ5q2b.png',
            content: config.roles ? `<@&${config.roles}>` : '',
            embeds: embeds
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Отчет сохранен и отправлен.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/promotion', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.webhooks.lssd;

        const embeds = [{
            title: '📈 Заявка на повышение LSSD',
            color: 0xFFA500,
            fields: [
                { name: '👤 Сотрудник', value: data.employee || '—', inline: true },
                { name: '💬 Discord', value: data.discord || '—', inline: true }
            ],
            timestamp: new Date().toISOString()
        }];

        const payload = {
            username: 'LSSD Повышения',
            avatar_url: 'https://i.imgur.com/7kZ5q2b.png',
            content: config.roles ? `<@&${config.roles}>` : '',
            embeds: embeds
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Заявка отправлена.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/badge', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const payload = {
            embeds: [{
                title: '🆕 Заявка на жетон',
                color: 0xC29B6E,
                fields: [
                    { name: '👤 Имя', value: data.name || '—', inline: true },
                    { name: '🎮 Скриншот из игры', value: data.screenshotGame ? `[Ссылка](${data.screenshotGame})` : '—', inline: false },
                    { name: '🤖 Скриншот бота', value: data.screenshotBot ? `[Ссылка](${data.screenshotBot})` : '—', inline: false }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        await sendToDiscord(config.webhooks.lssd, payload);
        res.json({ success: true, message: 'Заявка принята' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/cadet', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const payload = {
            content: config.roles ? `<@&${config.roles}>` : '',
            embeds: [{
                title: '📈 Отчет кадета',
                color: 0xC29B6E,
                fields: [
                    { name: '👤 Ник', value: data.nick || '—', inline: true },
                    { name: '💬 Discord', value: data.discord || '—', inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        await sendToDiscord(config.webhooks.lssd, payload);
        res.json({ success: true, message: 'Отчет принят' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;