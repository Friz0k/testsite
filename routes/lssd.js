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
        return json.lssd || { webhooks: {}, roles: {}, testQuestions: [] };
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
    const pingRole = config.roles?.sa ? `<@&${config.roles.sa}>` : '';

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
                        { name: '⚠️ Покиданий вкладки', value: `${leaveCount || 0}`, inline: true }
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
