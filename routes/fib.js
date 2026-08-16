const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const googleLogger = require('../googleLogger'); // Прямое подключение логгера

const FILE_SETTINGS = path.join(__dirname, '../data/config.json');

const getSettings = () => {
    try {
        if (!fs.existsSync(FILE_SETTINGS)) return {};
        const data = fs.readFileSync(FILE_SETTINGS, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
};

const getMskTime = () => {
    const d = new Date();
    const opts = { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' };
    const parts = new Intl.DateTimeFormat('ru-RU', opts).formatToParts(d);
    const vals = {};
    parts.forEach(p => vals[p.type] = p.value);
    return `${vals.day}.${vals.month}.${vals.year} ${vals.hour}:${vals.minute}`;
};

const sendWebhook = async (url, data) => {
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) {}
};

const formatRoles = (roleStr) => {
    if (!roleStr) return '';
    return roleStr.split(/[\s,]+/).map(r => r.match(/^\d+$/) ? `<@&${r}>` : r).join(' ');
};

router.get('/settings', (req, res) => {
    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const testConfig = fibConfig.testSettings || {};
    res.json({
        success: true,
        rank5: {
            durationMinutes: testConfig.durationMinutesRank5 || 15,
            passingScore: testConfig.passingScoreRank5 || 6,
            questionCount: testConfig.questionCountRank5 || 10
        },
        rank7: {
            durationMinutes: testConfig.durationMinutesRank7 || 20,
            passingScore: testConfig.passingScoreRank7 || 15,
            questionCount: testConfig.questionCountRank7 || 20
        }
    });
});

router.get('/questions', (req, res) => {
    const rank = parseInt(req.query.rank);
    if (!rank) return res.status(400).json({ error: 'Укажите корректный ранг' });

    const settings = getSettings();
    const testConfig = (settings.fib || {}).testSettings || {};
    const allQuestions = testConfig.questions || [];

    const rankQuestions = allQuestions.filter(q => q.ranks && (q.ranks.includes(rank) || q.ranks.includes(Number(rank))));
    
    const questionCount = rank === 5 ? (testConfig.questionCountRank5 || 10) : (testConfig.questionCountRank7 || 20);
    const durationMinutes = rank === 5 ? (testConfig.durationMinutesRank5 || 15) : (testConfig.durationMinutesRank7 || 20);
    const passingScore = rank === 5 ? (testConfig.passingScoreRank5 || 6) : (testConfig.passingScoreRank7 || 15);

    const shuffled = [...rankQuestions].sort(() => 0.5 - Math.random());
    const selectedQuestions = shuffled.slice(0, Math.min(questionCount, shuffled.length));

    const safeQuestions = selectedQuestions.map(q => ({
        id: q.id,
        text: q.text || q.question || '',
        type: q.type || 'single',
        options: q.options || []
    }));

    res.json({
        success: true,
        rank, durationMinutes, passingScore, questionCount,
        questions: safeQuestions
    });
});

router.post('/submit', async (req, res) => {
    const { questions, nickname, discordTag, rank, leaveCount, timeSpent } = req.body;
    const rankNum = parseInt(rank);
    
    if (!rankNum || !nickname || !discordTag || !questions) {
        return res.status(400).json({ success: false, error: 'Заполнены не все поля' });
    }

    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const testConfig = fibConfig.testSettings || {};
    const whUrl = fibConfig.webhooks?.main;

    const allQuestions = testConfig.questions || [];
    const passingScore = rankNum === 5 ? (testConfig.passingScoreRank5 || 6) : (testConfig.passingScoreRank7 || 15);
    const questionCount = rankNum === 5 ? (testConfig.questionCountRank5 || 10) : (testConfig.questionCountRank7 || 20);

    let score = 0;
    const parsedAnswers = Array.isArray(questions) ? questions : [];
    let answersLog = '';

    parsedAnswers.forEach((ans) => {
        const q = allQuestions.find(question => question.id == ans.id);
        if (q) {
            const correctAnswers = Array.isArray(q.correctAnswers) ? q.correctAnswers : (q.correctAnswer ? [q.correctAnswer] : []);
            const userAnsArray = Array.isArray(ans.selectedAnswers) ? ans.selectedAnswers : [];
            const userAnsTexts = userAnsArray.map(i => q.options ? q.options[i] : null).filter(Boolean);
            
            let isCorrectForThisQ = false;
            if (q.type === 'multiple') {
                if (correctAnswers.length === userAnsTexts.length && correctAnswers.every(val => userAnsTexts.includes(val))) {
                    score++;
                    isCorrectForThisQ = true;
                }
            } else {
                if (userAnsTexts.length > 0 && correctAnswers.includes(userAnsTexts[0])) {
                    score++;
                    isCorrectForThisQ = true;
                }
            }

            answersLog += `Вопрос: ${q.text || q.question}\nОтвет: ${userAnsTexts.join(', ') || 'Нет ответа'} ${isCorrectForThisQ ? '✅' : '❌'}\n\n`;
        }
    });

    if (answersLog.length > 3000) answersLog = answersLog.substring(0, 3000) + '...';
    if (!answersLog) answersLog = 'Нет данных об ответах';

    const isPassed = score >= passingScore;
    
    const roundedTimeSeconds = Math.round((timeSpent || 0) / 10) * 10;
    const timeStr = timeSpent ? `${Math.floor(roundedTimeSeconds / 60)} мин ${roundedTimeSeconds % 60} сек` : 'Не передано клиентом';

    const sheetPayload = {
        "Дата": getMskTime(),
        "Ник-нейм": nickname,
        "Ранг": rankNum,
        "Кол-во набранных баллов": score,
        "Макс баллы": questionCount,
        "Затраты по времени": timeStr,
        "Ответы на вопросы": answersLog.trim()
    };

    try {
        await googleLogger('fib', 'Переаттестация', sheetPayload);
        req.body = {}; 
    } catch (e) {
        console.error('[FIB] Ошибка логирования в Google Sheets:', e);
    }

    if (whUrl) {
        const embed = {
            title: `📋 Результат переаттестации FIB`,
            color: isPassed ? 3066993 : 15158332,
            fields: [
                { name: "👤 Ник-нейм", value: String(nickname), inline: true },
                { name: "💬 Discord", value: String(discordTag), inline: true },
                { name: "🎖️ Ранг", value: String(rankNum), inline: true },
                { name: "📊 Баллы", value: `${score} / ${questionCount}`, inline: true },
                { name: "⏱️ Время", value: timeStr, inline: true },
                { name: "⚠️ Покиданий вкладки", value: String(leaveCount || 0), inline: true }
            ],
            footer: { text: `Время по МСК: ${getMskTime()}` }
        };
        const pingRole = formatRoles(fibConfig.roles?.ping);
        await sendWebhook(whUrl, { content: pingRole ? pingRole : '', embeds: [embed] });
    }

    res.json({ success: true, score, passingScore, passed: isPassed });
});

router.post('/evidence', async (req, res) => {
    const { agentName, staticId, suspectInfo, violationText, evidenceLink, discordId } = req.body;
    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const whUrl = fibConfig.webhooks?.cid_evidence;

    if (!whUrl) return res.status(500).json({ error: 'Вебхук для улик CID не настроен' });

    const embed = {
        title: "🕵️ Новая улика CID (FIB)",
        color: 3447003,
        fields: [
            { name: "🕵️ Агент", value: `${agentName} [${staticId}]`, inline: true },
            { name: "💬 Discord", value: discordId ? `<@${discordId}>` : 'Не указан', inline: true },
            { name: "👤 Подозрительное лицо", value: suspectInfo || 'Не указано', inline: false },
            { name: "📜 Описание нарушения", value: violationText, inline: false },
            { name: "🔗 Доказательства / Материалы", value: evidenceLink || 'Нет ссылки', inline: false }
        ],
        timestamp: new Date().toISOString()
    };

    const pingRole = formatRoles(fibConfig.roles?.cid_evidence);
    await sendWebhook(whUrl, { content: pingRole ? pingRole : '', embeds: [embed] });
    res.json({ success: true });
});

module.exports = router;
