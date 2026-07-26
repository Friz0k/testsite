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
        return json.gov || { webhooks: {}, roles: {}, testSettings: {} };
    } catch (e) {
        return { webhooks: {}, roles: {}, testSettings: {} };
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

router.get('/questions', (req, res) => {
    const config = getConfig();
    const testSettings = config.testSettings || {};
    const rawQuestions = testSettings.questions || [];
    const durationMinutes = testSettings.durationMinutes || 20;

    const filteredQuestions = rawQuestions.map((q, index) => ({
        id: q.id || (index + 1),
        text: q.question || q.text || '',
        type: q.type || 'single',
        points: q.points || 1,
        isBonus: q.isBonus || false,
        options: (q.options || []).map(opt => (typeof opt === 'string' ? opt : opt.text || ''))
    }));

    res.json({
        success: true,
        durationMinutes: durationMinutes,
        questions: filteredQuestions
    });
});

router.post('/submit', async (req, res) => {
    const config = getConfig();
    const testSettings = config.testSettings || {};
    const rawQuestions = testSettings.questions || [];
    const passingScore = testSettings.passingScore || 10;
    const { nickname, discordTag, questions, questionTimes, leaveCount } = req.body;

    let totalScore = 0;
    let maxPossibleScore = 0;

    rawQuestions.forEach((storedQ, idx) => {
        if (!storedQ.isBonus) maxPossibleScore += (storedQ.points || 1);

        const userQ = (questions || []).find(q => q.id === storedQ.id || q.id === (idx + 1));
        const selectedIndices = userQ && Array.isArray(userQ.selectedAnswers) ? userQ.selectedAnswers : [];
        
        let correctIndices = [];
        if (Array.isArray(storedQ.options)) {
            storedQ.options.forEach((opt, i) => {
                if (typeof opt === 'object' && opt.correct) correctIndices.push(i);
            });
        }

        const isCorrect = correctIndices.length === selectedIndices.length && 
            correctIndices.every(val => selectedIndices.includes(val));

        if (isCorrect) totalScore += (storedQ.points || 1);
    });

    const passed = totalScore >= passingScore;
    const webhookUrl = config.webhooks?.test;
    const pingRole = config.roles?.test ? `<@&${config.roles.test}>` : '';

    if (webhookUrl) {
        const embedColor = passed ? 0x10b981 : 0xf43f5e;
        const statusText = passed ? '✅ АТТЕСТАЦИЯ ПРОЙДЕНА' : '❌ НЕ ПРОЙДЕНА';
        
        const payload = {
            content: pingRole ? `Результат теста адвокатов GOV: ${pingRole}` : null,
            embeds: [
                {
                    title: '⚖️ Результат аттестации Правительства (GOV)',
                    color: embedColor,
                    fields: [
                        { name: '👤 Кандидат / Адвокат', value: `${nickname || 'Не указан'} (${discordTag || 'Нет Discord'})`, inline: true },
                        { name: '📊 Статус', value: `${statusText}`, inline: true },
                        { name: '🏆 Набрано баллов', value: `${totalScore} (из ${maxPossibleScore} основных)`, inline: true },
                        { name: '🎯 Проходной балл', value: `${passingScore}`, inline: true },
                        { name: '⚠️ Покиданий вкладки', value: `${leaveCount || 0}`, inline: true }
                    ],
                    footer: { text: `Frizworld Government Portal | ${new Date().toLocaleString('ru-RU')}` }
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
JavaScript
// routes/ems.js
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
        return json.ems || { webhooks: {}, roles: {} };
    } catch (e) {
        return { webhooks: {}, roles: {} };
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

router.post('/report', async (req, res) => {
    const config = getConfig();
    const { fullname, position, hospital, shiftDuration, patientsTreated, callsAnswered, summary } = req.body;

    if (!fullname || !position || !hospital) {
        return res.status(400).json({ success: false, message: 'Заполните основные поля отчета' });
    }

    const webhookUrl = config.webhooks?.main;
    const pingRole = config.roles?.main ? `<@&${config.roles.main}>` : '';

    if (!webhookUrl) {
        return res.json({ success: true, message: 'Отчет сохранен (вебхук Discord не настроен)' });
    }

    const payload = {
        content: pingRole ? `Новый медицинский отчет: ${pingRole}` : null,
        embeds: [
            {
                title: '🚑 Отчет сотрудника EMS',
                color: 0xef4444,
                fields: [
                    { name: '👨‍⚕️ Сотрудник', value: `${fullname}`, inline: true },
                    { name: '🩺 Должность', value: `${position}`, inline: true },
                    { name: '🏥 Отделение / Больница', value: `${hospital}`, inline: true },
                    { name: '⏱️ Длительность смены', value: `${shiftDuration || '0'} час.`, inline: true },
                    { name: '💊 Вылечено пациентов', value: `${patientsTreated || '0'}`, inline: true },
                    { name: '📞 Принято вызовов', value: `${callsAnswered || '0'}`, inline: true },
                    { name: '📋 Описание проделанной работы', value: `${summary || 'Отсутствует'}`, inline: false }
                ],
                footer: { text: `Frizworld EMS Systems | ${new Date().toLocaleString('ru-RU')}` }
            }
        ]
    };

    const sent = await sendDiscordWebhook(webhookUrl, payload);
    if (sent) {
        res.json({ success: true, message: '✓ Отчет успешно отправлен в Discord' });
    } else {
        res.status(500).json({ success: false, message: 'Ошибка отправки в Discord' });
    }
});

module.exports = router;
