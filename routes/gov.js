const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');

const FILE_SETTINGS = path.join(__dirname, '../data/config.json');

const getConfig = () => {
    try {
        if (!fs.existsSync(FILE_SETTINGS)) return {};
        const data = fs.readFileSync(FILE_SETTINGS, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
};

const sendDiscordWebhook = (webhookUrl, payload) => {
    return new Promise((resolve) => {
        if (!webhookUrl || !webhookUrl.startsWith('http')) {
            return resolve(false);
        }
        const parsedUrl = url.parse(webhookUrl);
        const postData = JSON.stringify(payload);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
        });
        req.on('error', () => resolve(false));
        req.write(postData);
        req.end();
    });
};

router.get('/config', (req, res) => {
    const settings = getConfig();
    const govConfig = settings.gov || {};
    res.json({
        success: true,
        actions: govConfig.actions || []
    });
});

router.post('/report', async (req, res) => {
    try {
        const { employee, discordTag, startDate, endDate, actions, totalPoints } = req.body;
        const settings = getConfig();
        const govConfig = settings.gov || {};
        
        const whUrl = govConfig.webhooks?.report;
        const pingRole = govConfig.roles?.report;

        if (!whUrl) {
            return res.status(500).json({ success: false, message: 'Вебхук для отчетов GOV не настроен в админ-панели.' });
        }

        let actionsText = '';
        if (actions && actions.length > 0) {
            actionsText = actions.map(a => `- ${a.name} (x${a.quantity}): ${a.points} баллов\n  Док-ва: ${a.evidence}`).join('\n\n');
        } else {
            actionsText = 'Нет действий';
        }
        
        if (actionsText.length > 2048) actionsText = actionsText.substring(0, 2040) + '...';

        const embed = {
            title: '⚖️ Еженедельный отчет адвоката (GOV)',
            color: 0xD4AF37,
            fields: [
                { name: '👤 Адвокат', value: employee || 'Не указан', inline: true },
                { name: '💬 Discord', value: discordTag || 'Не указан', inline: true },
                { name: '📅 Период', value: `${startDate} — ${endDate}`, inline: false },
                { name: '💯 Итого баллов', value: `${totalPoints || 0}`, inline: false },
                { name: '📋 Проделанная работа', value: actionsText, inline: false }
            ],
            timestamp: new Date().toISOString()
        };

        const payload = {
            content: pingRole ? `<@&${pingRole}>` : null,
            embeds: [embed]
        };

        const sent = await sendDiscordWebhook(whUrl, payload);
        
        if (sent) {
            res.json({ success: true, message: 'Отчет успешно отправлен!' });
        } else {
            res.status(500).json({ success: false, message: 'Сбой при отправке в Discord. Проверьте ссылку вебхука.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
