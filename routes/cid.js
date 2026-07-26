const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const DB_FILE = path.join(__dirname, '../data', 'cid_evidence.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, '[]', 'utf8');
}

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { cid: { webhooks: {}, roles: {} } };
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

router.post('/evidence', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.cid.webhooks.evidence;
        const rolesStr = config.cid.roles.evidence;

        const evidences = data.evidences || [];
        const orgs = [...new Set(evidences.map(ev => ev.organization).filter(Boolean))];
        
        const evidenceList = evidences.map((ev, i) => {
            let line = `${i+1}. **${ev.name}**`;
            if (ev.description) line += ` — ${ev.description}`;
            if (ev.link) line += `\n🔗 [Ссылка](${ev.link})`;
            return line;
        }).join('\n');

        const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        evidences.forEach(ev => {
            dbData.push({
                id: Date.now() + Math.random(),
                date: new Date().toISOString(),
                nickname: data.nickname,
                badgeNumber: data.badgeNumber,
                name: ev.name,
                organization: ev.organization || '',
                description: ev.description || '',
                link: ev.link || ''
            });
        });
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

        const roleMentions = rolesStr ? rolesStr.split(' ').map(id => `<@&${id}>`).join(' ') : '';

        const payload = {
            username: 'Улики CID',
            content: roleMentions,
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

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Улики сохранены и отправлены!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
