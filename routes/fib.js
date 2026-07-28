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
        return json.fib || { webhooks: {}, roles: {}, testSettings: {} };
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

const getMskTime = () => {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

router.get('/questions', (req, res) => {
    const config = getConfig();
    const rank = parseInt(req.query.rank) || 5;
    const testSettings = config.testSettings || {};
    const rawQuestions = testSettings.questions || [];

    let filteredQuestions = rawQuestions.filter(q => {
        if (!q.ranks) return true;
        const mappedRanks = q.ranks.map(r => r === 3 ? 5 : r);
        return mappedRanks.includes(rank);
    });

    for (let i = filteredQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filteredQuestions[i], filteredQuestions[j]] = [filteredQuestions[j], filteredQuestions[i]];
    }

    const questionCount = rank === 7 
        ? (testSettings.questionCountRank7 || 20) 
        : (testSettings.questionCountRank5 || 10);

    filteredQuestions = filteredQuestions.slice(0, questionCount);

    const mappedQuestions = filteredQuestions.map((q) => ({
        id: q.id,
        text: q.text || q.question || '',
        type: q.type || 'single',
        options: (q.options || []).map(opt => (typeof opt === 'string' ? opt : opt.text || ''))
    }));

    const durationMinutes = rank === 7 
        ? (testSettings.durationMinutesRank7 || 20)
        : (testSettings.durationMinutesRank5 || 15);

    res.json({
        success: true,
        durationMinutes: durationMinutes,
        questions: mappedQuestions
    });
});

router.post('/submit', async (req, res) => {
    const config = getConfig();
    const testSettings = config.testSettings || {};
    const rawQuestions = testSettings.questions || [];
    const { rank, nickname, discordTag, questions, questionTimes, leaveCount } = req.body;

    const numericRank = parseInt(rank) || 5;
    const passingScore = numericRank === 7 
        ? (testSettings.passingScoreRank7 || 14) 
        : (testSettings.passingScoreRank5 || 6);

    let totalScore = 0;
    let maxPossibleScore = 0;

    (questions || []).forEach((userQ) => {
        const storedQ = rawQuestions.find(q => q.id === userQ.id);
        if (!storedQ) return;

        maxPossibleScore++;
        
        const selectedIndices = Array.isArray(userQ.selectedAnswers) ? userQ.selectedAnswers : [];
        let correctIndices = [];
        
        if (Array.isArray(storedQ.correctAnswers) && storedQ.correctAnswers.length > 0) {
            correctIndices = storedQ.correctAnswers.map(ans => storedQ.options.indexOf(ans)).filter(i => i !== -1);
        } else if (storedQ.correctAnswer) {
            const idxCorrect = storedQ.options.indexOf(storedQ.correctAnswer);
            if (idxCorrect !== -1) correctIndices = [idxCorrect];
        }

        correctIndices.sort();
        selectedIndices.sort();

        const isCorrect = correctIndices.length === selectedIndices.length && 
            correctIndices.every((val, i) => val === selectedIndices[i]);

        if (isCorrect) totalScore++;
    });

    const passed = totalScore >= passingScore;
    const webhookUrl = config.webhooks?.main;
    const pingRole = config.roles?.ping ? `<@&${config.roles.ping}>` : '';

    if (webhookUrl) {
        const embedColor = passed ? 65450 : 16724838;
        const statusText = passed ? 'СДАНО' : 'НЕ СДАНО';
        const mskTime = getMskTime();
        
        const payload = {
            content: pingRole ? pingRole : null,
            embeds: [
                {
                    title: `📋 Результат переаттестации FIB | Ранг: ${numericRank}`,
                    color: embedColor,
                    fields: [
                        { name: 'Сотрудник', value: `${nickname || 'Не указан'}`, inline: true },
                        { name: 'Тег дс', value: `${discordTag || 'Нет Discord'}`, inline: true },
                        { name: 'Статус', value: `${statusText} (${totalScore})`, inline: true },
                        { name: 'Покиданий вкладки', value: `${leaveCount || 0}`, inline: true }
                    ],
                    footer: { text: `Время по МСК: ${mskTime} | by Frizworld` }
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

router.post('/evidence', async (req, res) => {
    const config = getConfig();
    const { nickname, badgeNumber, evidences } = req.body;

    if (!nickname || !badgeNumber || !Array.isArray(evidences) || evidences.length === 0) {
        return res.status(400).json({ success: false, message: 'Некорректные данные улики' });
    }

    const webhookUrl = config.webhooks?.cid_evidence;
    const pingRole = config.roles?.cid_evidence ? `<@&${config.roles.cid_evidence}>` : '';

    if (!webhookUrl) {
        return res.json({ success: true, message: 'Улики приняты (вебхук Discord не настроен в админке)' });
    }

    const fields = evidences.slice(0, 20).map((ev, index) => ({
        name: `🕵️ Улика #${index + 1}: ${ev.name || 'Без названия'} [${ev.organization || 'Нет орг.'}]`,
        value: `**Ссылка:** ${ev.link || 'Нет ссылки'}\n**Описание:** ${ev.description || 'Отсутствует'}`,
        inline: false
    }));

    const payload = {
        content: pingRole ? `Новое дело CID: ${pingRole}` : null,
        embeds: [
            {
                title: '📁 Регистрация улик CID',
                color: 0x7c3aed,
                fields: [
                    { name: '👮 Агент', value: `${nickname}`, inline: true },
                    { name: '🏷️ Жетон', value: `${badgeNumber}`, inline: true },
                    { name: '📦 Всего улик', value: `${evidences.length}`, inline: true },
                    ...fields
                ],
                footer: { text: `Frizworld CID Archive | ${new Date().toLocaleString('ru-RU')}` }
            }
        ]
    };

    const sent = await sendDiscordWebhook(webhookUrl, payload);
    if (sent) {
        res.json({ success: true, message: '✓ Улики успешно отправлены в базу и Discord' });
    } else {
        res.status(500).json({ success: false, message: 'Ошибка при отправке в Discord' });
    }
});

module.exports = router;
