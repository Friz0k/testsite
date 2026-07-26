const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const DB_FILE = path.join(__dirname, '../data', 'deadly_applications.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, '[]', 'utf8');
}

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { deadly: { webhooks: {}, roles: {} } };
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
    } catch (err) {}
}

router.post('/application', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.deadly.webhooks.application;
        const roleStr = config.deadly.roles.ping;

        const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        dbData.push({
            id: Date.now(),
            date: new Date().toISOString(),
            ...data
        });
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

        const roleMentions = roleStr ? roleStr.split(' ').map(id => `<@&${id}>`).join(' ') : '';

        const payload = {
            content: roleMentions,
            embeds: [{
                title: '📋 Новая заявка в семью Deadly',
                color: 0x36393F,
                fields: [
                    { name: '🆔 Ник-нейм', value: data.nick, inline: true },
                    { name: '👤 Настоящее имя', value: data.realName, inline: true },
                    { name: '📅 Возраст', value: data.age.toString(), inline: true },
                    { name: '📊 Уровень', value: data.level.toString(), inline: true },
                    { name: '⏱️ Часов в день', value: data.hoursPerDay.toString(), inline: true },
                    { name: '🏠 Опыт в семьях', value: data.pastFamilies || 'Нет', inline: false },
                    { name: '💍 Сменить фамилию', value: data.changeSurname, inline: true },
                    { name: '💰 Взнос готов', value: data.weeklyFee, inline: true },
                    { name: '💬 Discord', value: data.discord, inline: false }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'Deadly Family' }
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: '✅ Заявка сохранена. Уведомление в Discord отправлено.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
