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

router.post('/evidence', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();

        const evidences = data.evidences || [];
        const orgs = [...new Set(evidences.map(ev => ev.organization).filter(Boolean))];
        const evidenceList = evidences.map((ev, i) => {
            let line = `${i+1}. **${ev.name}**`;
            if (ev.description) line += ` — ${ev.description}`;
            if (ev.link) line += `\n🔗 [Ссылка](${ev.link})`;
            return line;
        }).join('\n');

        const payload = {
            username: 'Улики CID',
            content: config.roles ? `<@&${config.roles}>` : '',
            embeds: [{
                title: '🔍 Новые улики CID',
                color: 0xFFFFFF,
                fields: [
                    { name: '👤 Никнейм', value: data.nickname || '—', inline: true },
                    { name: '🪪 Номер жетона', value: data.badgeNumber || '—', inline: true },
                    { name: '🎯 Организация', value: orgs.length ? orgs.join(', ') : 'Не указана', inline: true },
                    { name: '📋 Улики', value: evidenceList || '—', inline: false }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(config.webhooks.cid, payload);
        res.json({ success: true, message: 'Улики сохранены и отправлены!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;