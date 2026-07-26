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
        return json.lspd || { webhooks: {}, roles: {}, testQuestions: [] };
    } catch (e) {
        return { webhooks: {}, roles: {}, testQuestions: [] };
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

router.post('/application', async (req, res) => {
    const config = getConfig();
    const { fullname, passport, age, years, docs, body, about, experience, why, division, discord, phone } = req.body;

    if (!fullname || !passport || !age || !discord) {
        return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    const webhookUrl = config.webhooks?.application;
    const pingRole = config.roles?.application ? `<@&${config.roles.application}>` : '';

    if (!webhookUrl) {
        return res.json({ success: true, message: 'Заявка принята (вебхук не настроен)' });
    }

    const payload = {
        content: pingRole ? `Новое заявление в LSPD: ${pingRole}` : null,
        embeds: [
            {
                title: '🚓 Электронное заявление на вступление в LSPD',
                color: 0x3b82f6,
                fields: [
                    { name: '👤 Имя Фамилия', value: `${fullname}`, inline: true },
                    { name: '🪪 Паспорт (IC)', value: `${passport}`, inline: true },
                    { name: '📅 Возраст', value: `${age} лет`, inline: true },
                    { name: '⏳ Лет в штате', value: `${years}`, inline: true },
                    { name: '📱 Телефон', value: `${phone}`, inline: true },
                    { name: '💬 Discord', value: `${discord}`, inline: true },
                    { name: '🎯 Желаемый отдел', value: `${division}`, inline: false },
                    { name: '📄 Ксерокопии документов', value: `${docs}`, inline: false },
                    { name: '🧍 Фото тела', value: `${body}`, inline: false },
                    { name: '📝 О себе', value: `${about}`, inline: false },
                    { name: '💼 Опыт в гос. структурах', value: `${experience}`, inline: false },
                    { name: '❓ Почему LSPD?', value: `${why}`, inline: false }
                ],
                footer: { text: `Frizworld LSPD Portal | ${new Date().toLocaleString('ru-RU')}` }
            }
        ]
    };

    const sent = await sendDiscordWebhook(webhookUrl, payload);
    if (sent) {
        res.json({ success: true, message: 'Заявление успешно отправлено!' });
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
        text: q.question || q.text || '',
        type: q.type || 'single',
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
    const rawQuestions = config.testQuestions || [];
    const passingScore = config.testPassingScore || 8;
    const { nickname, discordTag, questions, questionTimes, leaveCount } = req.body;

    let totalScore = 0;
    let maxPossibleScore = rawQuestions.length;

    rawQuestions.forEach((storedQ, idx) => {
        const userQ = (questions || []).find(q => q.id === storedQ.id || q.id === (idx + 1));
        const selectedIndices = userQ && Array.isArray(userQ.selectedAnswers) ? userQ.selectedAnswers : [];
        
        let correctIndices = [];
        if (Array.isArray(storedQ.correct) && storedQ.correct.length > 0) {
            correctIndices = storedQ.correct.map(ans => storedQ.options.indexOf(ans)).filter(i => i !== -1);
        } else if (storedQ.correctIndex !== undefined) {
            correctIndices = [storedQ.correctIndex];
        }

        const isCorrect = correctIndices.length === selectedIndices.length && 
            correctIndices.every(val => selectedIndices.includes(val));

        if (isCorrect) totalScore++;
    });

    const passed = totalScore >= passingScore;
    const webhookUrl = config.webhooks?.test;
    const pingRole = config.roles?.test ? `<@&${config.roles.test}>` : '';

    if (webhookUrl) {
        const embedColor = passed ? 0x22c55e : 0xef4444;
        const statusText = passed ? '✅ УСПЕШНО СДАНО' : '❌ НЕ СДАНО';
        
        const payload = {
            content: pingRole ? `Результат аттестации LSPD: ${pingRole}` : null,
            embeds: [
                {
                    title: '🚓 Результат тестирования LSPD',
                    color: embedColor,
                    fields: [
                        { name: '👤 Сотрудник / Кадет', value: `${nickname || 'Не указан'} (${discordTag || 'Нет Discord'})`, inline: true },
                        { name: '📊 Статус', value: `${statusText} (${totalScore} из ${maxPossibleScore})`, inline: true },
                        { name: '🎯 Проходной балл', value: `${passingScore}`, inline: true },
                        { name: '⚠️ Покиданий вкладки', value: `${leaveCount || 0}`, inline: true }
                    ],
                    footer: { text: `Frizworld LSPD Systems | ${new Date().toLocaleString('ru-RU')}` }
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
