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
        const json = JSON.parse(data);
        return json.lssd || { webhooks: {}, roles: {}, testQuestions: [], actions: [] };
    } catch (e) {
        return { webhooks: {}, roles: {}, testQuestions: [], actions: [] };
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

const formatRoles = (roleStr) => {
    if (!roleStr) return '';
    return roleStr.split(/[\s,]+/).map(r => r.match(/^\d+$/) ? `<@&${r}>` : r).join(' ');
};

router.get('/config', (req, res) => {
    const config = getConfig();
    res.json({
        success: true,
        actions: config.actions || []
    });
});

router.post('/badge', async (req, res) => {
    const config = getConfig();
    const data = req.body;
    const webhookUrl = config.webhooks?.badge;
    
    if (!webhookUrl) return res.json({ success: true, message: 'Жетон сохранен (вебхук не настроен)' });

    const payload = {
        embeds: [{
            title: '🛡️ Регистрация жетона LSSD',
            color: 0xffb6e6,
            fields: [
                { name: '👤 Имя', value: data.name || 'Не указано', inline: true },
                { name: '🎮 Отыгровка в игре', value: data.screenshotGame || 'Нет', inline: false },
                { name: '🤖 Бот', value: data.screenshotBot || 'Нет', inline: false }
            ],
            timestamp: new Date().toISOString()
        }]
    };

    const sent = await sendDiscordWebhook(webhookUrl, payload);
    if (sent) {
        res.json({ success: true, message: 'Жетон успешно отправлен!' });
    } else {
        res.status(500).json({ success: false, message: 'Ошибка отправки в Discord' });
    }
});

router.post('/cadet', async (req, res) => {
    const config = getConfig();
    const data = req.body;
    const webhookUrl = config.webhooks?.cadet;
    const pingRole = formatRoles(config.roles?.sa);

    if (!webhookUrl) return res.json({ success: true, message: 'Отчет сохранен (вебхук не настроен)' });

    let embed = {};

    if (data.type === '1-2') {
        embed = {
            title: '🎓 Отчет кадета LSSD (1 ➔ 2 ранг)',
            color: 0xffb6e6,
            fields: [
                { name: '👤 Ник', value: data.nick || 'Не указан', inline: true },
                { name: '💬 Discord', value: data.discord || 'Не указан', inline: true },
                { name: '🛡️ Жетон', value: data.badge || 'Нет ссылки', inline: false },
                { name: '📻 ЧП Discord', value: data.chp || 'Нет ссылки', inline: false },
                { name: '📝 Тест 1-2', value: data.test || 'Нет ссылки', inline: false },
                { name: '⚕️ Медкарта', value: data.medCard || 'Нет ссылки', inline: false },
                { name: '🔫 Лицензия на оружие', value: data.weaponLicense || 'Нет ссылки', inline: false },
                { name: '📚 Вводная лекция', value: data.lecture || 'Нет ссылки', inline: false }
            ],
            timestamp: new Date().toISOString()
        };
    } else if (data.type === '2-3') {
        let actionFields = [];
        if (data.actions && data.actions.length > 0) {
            const maxActions = data.actions.slice(0, 15);
            maxActions.forEach((a, idx) => {
                let evStr = a.evidence || 'Нет док-в';
                if (evStr.length > 300) evStr = evStr.substring(0, 300) + '...';
                actionFields.push({
                    name: `${idx + 1}. ${a.name}`,
                    value: `x${a.quantity} → **${a.points} баллов**\n📎 Док-ва: ${evStr}`,
                    inline: false
                });
            });
            if (data.actions.length > 15) {
                actionFields.push({ name: '...', value: `И еще ${data.actions.length - 15} действий`, inline: false });
            }
        } else {
            actionFields.push({ name: 'Действия', value: 'Отсутствуют', inline: false });
        }

        embed = {
            title: '🎓 Отчет кадета LSSD (2 ➔ 3 ранг)',
            color: 0xffb6e6,
            fields: [
                { name: '👤 Ник', value: data.nick || 'Не указан', inline: true },
                { name: '💬 Discord', value: data.discord || 'Не указан', inline: true },
                { name: '📑 Экзамен 2-3', value: data.exam || 'Нет ссылки', inline: false },
                { name: '💯 Итого баллов', value: `${data.totalPoints || 0} / 25`, inline: false },
                ...actionFields
            ],
            timestamp: new Date().toISOString()
        };
    }

    const payload = {
        content: pingRole ? `Новый отчет: ${pingRole}` : null,
        embeds: [embed]
    };

    const sent = await sendDiscordWebhook(webhookUrl, payload);
    if (sent) {
        res.json({ success: true, message: 'Отчет успешно отправлен!' });
    } else {
        res.status(500).json({ success: false, message: 'Ошибка отправки в Discord' });
    }
});

router.get('/questions', (req, res) => {
    const config = getConfig();
    const rawQuestions = config.testQuestions || [];
    const durationMinutes = config.testDurationMinutes || 15;

    const filteredQuestions = rawQuestions.map((q, index) => ({
        id: q.id || (index + 1),
        question: q.question || q.text || '',
        type: q.type || 'single',
        options: (q.options || []).map(opt => (typeof opt === 'string' ? opt : opt.text || ''))
    }));

    res.json({
        success: true,
        durationMinutes: durationMinutes,
        questions: filteredQuestions
    });
});

router.post('/submitTest', async (req, res) => {
    const config = getConfig();
    const rawQuestions = config.testQuestions || [];
    const passingScore = config.testPassingScore || 8;
    const { nickname, discordTag, questions, timeSpent, leaveCount } = req.body;

    let totalScore = 0;
    let maxPossibleScore = rawQuestions.length;

    rawQuestions.forEach((storedQ, idx) => {
        const userQ = (questions || []).find(q => q.id === storedQ.id || q.id === (idx + 1));
        const selectedIndices = userQ && Array.isArray(userQ.selectedAnswers) ? userQ.selectedAnswers : [];
        
        let correctIndices = [];
        if (Array.isArray(storedQ.correctIndices) && storedQ.correctIndices.length > 0) {
            correctIndices = storedQ.correctIndices;
        } else if (storedQ.correctIndex !== undefined) {
            correctIndices = [storedQ.correctIndex];
        }

        const isCorrect = correctIndices.length === selectedIndices.length && 
            correctIndices.every(val => selectedIndices.includes(val));

        if (isCorrect) totalScore++;
    });

    const passed = totalScore >= passingScore;
    const webhookUrl = config.webhooks?.test;
    const pingRole = formatRoles(config.roles?.sa);

    if (webhookUrl) {
        const embedColor = passed ? 0x22c55e : 0xef4444;
        const statusText = passed ? '✅ УСПЕШНО СДАНО' : '❌ НЕ СДАНО';
        
        const payload = {
            content: pingRole ? `Результат теста LSSD: ${pingRole}` : null,
            embeds: [
                {
                    title: '🤠 Результат тестирования LSSD',
                    color: embedColor,
                    fields: [
                        { name: '👤 Сотрудник', value: `${nickname || 'Не указан'} (${discordTag || 'Нет Discord'})`, inline: true },
                        { name: '📊 Статус', value: `${statusText} (${totalScore} из ${maxPossibleScore})`, inline: true },
                        { name: '🎯 Проходной балл', value: `${passingScore}`, inline: true },
                        { name: '⚠️ Покиданий вкладки', value: `${leaveCount || 0}`, inline: true },
                        { name: '⏱️ Затрачено времени', value: timeSpent ? `${Math.floor(timeSpent / 60)} мин ${timeSpent % 60} сек` : 'Неизвестно', inline: true }
                    ],
                    footer: { text: `Frizworld LSSD Portal | ${new Date().toLocaleString('ru-RU')}` }
                }
            ]
        };

        await sendDiscordWebhook(webhookUrl, payload);
    }

    res.json({
        success: true,
        passed: passed,
        score: totalScore,
        total: maxPossibleScore,
        passingScore: passingScore
    });
});

module.exports = router;
