const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

const sendWebhook = async (url, data) => {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            console.error(`Ошибка вебхука [FIB]: HTTP ${response.status}`);
        }
    } catch (err) {
        console.error(`Ошибка при отправке вебхука [FIB]:`, err);
    }
};

router.get('/settings', (req, res) => {
    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const testConfig = fibConfig.testSettings || {};

    res.json({
        success: true,
        rank5: {
            durationMinutes: testConfig.durationMinutesRank5 || 5,
            passingScore: testConfig.passingScoreRank5 || 6,
            questionCount: testConfig.questionCountRank5 || 10
        },
        rank7: {
            durationMinutes: testConfig.durationMinutesRank7 || 10,
            passingScore: testConfig.passingScoreRank7 || 15,
            questionCount: testConfig.questionCountRank7 || 20
        }
    });
});

router.get('/questions', (req, res) => {
    const rank = parseInt(req.query.rank);
    if (!rank || (rank !== 5 && rank !== 7)) {
        return res.status(400).json({ error: 'Неверный ранг (только 5 или 7)' });
    }

    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const testConfig = fibConfig.testSettings || {};
    const allQuestions = testConfig.questions || [];

    const rankQuestions = allQuestions.filter(q => q.ranks && (q.ranks.includes(rank) || q.ranks.includes(Number(rank))));
    
    const questionCount = rank === 5 ? (testConfig.questionCountRank5 || 10) : (testConfig.questionCountRank7 || 20);
    const durationMinutes = rank === 5 ? (testConfig.durationMinutesRank5 || 5) : (testConfig.durationMinutesRank7 || 10);
    const passingScore = rank === 5 ? (testConfig.passingScoreRank5 || 6) : (testConfig.passingScoreRank7 || 15);

    const shuffled = [...rankQuestions].sort(() => 0.5 - Math.random());
    const selectedQuestions = shuffled.slice(0, Math.min(questionCount, shuffled.length));

    const safeQuestions = selectedQuestions.map(q => {
        return {
            id: q.id,
            text: q.text || q.question || '',
            type: q.type || 'single',
            options: q.options || []
        };
    });

    res.json({
        success: true,
        rank: rank,
        durationMinutes: durationMinutes,
        passingScore: passingScore,
        questionCount: questionCount,
        questions: safeQuestions
    });
});

router.post('/submit', async (req, res) => {
    const { 
        answers, 
        characterName, 
        discordId, 
        staticId, 
        rank 
    } = req.body;

    const rankNum = parseInt(rank);
    if (!rankNum || (rankNum !== 5 && rankNum !== 7)) {
        return res.status(400).json({ error: 'Указан неверный ранг' });
    }

    if (!characterName || !discordId || !staticId || !answers) {
        return res.status(400).json({ error: 'Заполнены не все обязательные поля' });
    }

    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const testConfig = fibConfig.testSettings || {};
    const whUrl = fibConfig.webhooks?.main;
    const pingRole = fibConfig.roles?.ping;

    const allQuestions = testConfig.questions || [];
    const passingScore = rankNum === 5 ? (testConfig.passingScoreRank5 || 6) : (testConfig.passingScoreRank7 || 15);
    const questionCount = rankNum === 5 ? (testConfig.questionCountRank5 || 10) : (testConfig.questionCountRank7 || 20);

    let score = 0;
    const parsedAnswers = Array.isArray(answers) ? answers : [];

    parsedAnswers.forEach(ans => {
        const q = allQuestions.find(question => question.id == ans.questionId);
        if (q) {
            const correctAnswers = Array.isArray(q.correctAnswers) ? q.correctAnswers : (q.correctAnswer ? [q.correctAnswer] : []);
            
            if (q.type === 'multiple') {
                const userAnsArray = Array.isArray(ans.userAnswer) ? ans.userAnswer : [ans.userAnswer];
                if (correctAnswers.length === userAnsArray.length && correctAnswers.every(val => userAnsArray.includes(val))) {
                    score++;
                }
            } else {
                if (correctAnswers.includes(ans.userAnswer)) {
                    score++;
                }
            }
        }
    });

    const isPassed = score >= passingScore;
    const statusText = isPassed ? "СДАЛ" : "НЕ СДАЛ";
    const statusColor = isPassed ? 3066993 : 15158332;

    if (whUrl) {
        const embed = {
            title: `📄 Результат переаттестации FIB (${rankNum} ранг)`,
            color: statusColor,
            fields: [
                {
                    name: "👤 Имя персонажа",
                    value: String(characterName),
                    inline: true
                },
                {
                    name: "🆔 Статик (ID)",
                    value: String(staticId),
                    inline: true
                },
                {
                    name: "💬 Discord",
                    value: `<@${discordId}>`,
                    inline: true
                },
                {
                    name: "📊 Результат",
                    value: `**${statusText}** (${score} из ${questionCount} баллов, минимум нужно: ${passingScore})`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString()
        };

        const textPing = pingRole ? `<@&${pingRole}>` : '';

        await sendWebhook(whUrl, {
            content: textPing,
            embeds: [embed]
        });
    }

    res.json({
        success: true,
        score: score,
        maxScore: questionCount,
        passingScore: passingScore,
        passed: isPassed
    });
});

router.post('/evidence', async (req, res) => {
    const { 
        agentName, 
        staticId, 
        suspectInfo, 
        violationText, 
        evidenceLink, 
        discordId 
    } = req.body;

    const settings = getSettings();
    const fibConfig = settings.fib || {};
    const whUrl = fibConfig.webhooks?.cid_evidence;
    const pingRole = fibConfig.roles?.cid_evidence;

    if (!whUrl) {
        return res.status(500).json({ error: 'Вебхук для улик CID не настроен' });
    }

    if (!agentName || !staticId || !violationText) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }

    const embed = {
        title: "🕵️ Новая улика CID (FIB)",
        color: 3447003,
        fields: [
            {
                name: "🕵️ Агент",
                value: `${agentName} [${staticId}]`,
                inline: true
            },
            {
                name: "💬 Discord",
                value: discordId ? `<@${discordId}>` : 'Не указан',
                inline: true
            },
            {
                name: "👤 Подозрительное лицо",
                value: suspectInfo || 'Не указано',
                inline: false
            },
            {
                name: "📜 Описание нарушения",
                value: violationText,
                inline: false
            },
            {
                name: "🔗 Доказательства / Материалы",
                value: evidenceLink || 'Нет ссылки',
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    const textPing = pingRole ? `<@&${pingRole}>` : '';

    await sendWebhook(whUrl, {
        content: textPing,
        embeds: [embed]
    });

    res.json({ success: true });
});

module.exports = router;
