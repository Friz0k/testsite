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
            console.error(`Ошибка вебхука [GOV]: HTTP ${response.status}`);
        }
    } catch (err) {
        console.error(`Ошибка при отправке вебхука [GOV]:`, err);
    }
};

router.post('/submit', async (req, res) => {
    const { 
        answers, 
        characterName, 
        discordId, 
        staticId, 
        rank 
    } = req.body;

    const settings = getSettings();
    const govConfig = settings.gov || {};
    const testConfig = govConfig.testSettings || {};
    const whUrl = govConfig.webhooks?.test;
    const pingRole = govConfig.roles?.test;

    if (!whUrl) {
        return res.status(500).json({ error: 'Вебхук для тестов GOV не настроен' });
    }

    const testDuration = testConfig.durationMinutes || 15;
    const testPassingScore = testConfig.passingScore || 0;
    const questions = testConfig.questions || [];

    if (!answers || !characterName || !discordId || !staticId) {
        return res.status(400).json({ error: 'Заполнены не все обязательные поля' });
    }

    let score = 0;
    let maxScore = 0;
    const parsedAnswers = Array.isArray(answers) ? answers : [];

    parsedAnswers.forEach(ans => {
        const q = questions.find(question => question.id == ans.questionId);
        if (q) {
            if (q.type !== 'text') {
                if (q.isBonus) {
                    // Бонусные вопросы прибавляют баллы, но не увеличивают максимум
                    if (ans.correct) score += q.points;
                } else {
                    maxScore += q.points;
                    if (ans.correct) score += q.points;
                }
            }
        }
    });

    const isPassed = score >= testPassingScore;
    const statusText = isPassed ? "СДАЛ" : "НЕ СДАЛ";
    const statusColor = isPassed ? 3066993 : 15158332;

    const embed = {
        title: "📄 Результат тестирования (Адвокаты GOV)",
        color: statusColor,
        fields: [
            {
                name: "👤 Имя персонажа",
                value: characterName,
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
                value: `**${statusText}** (${score} из ${maxScore} баллов)`,
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

    res.json({
        success: true,
        score: score,
        maxScore: maxScore,
        passed: isPassed
    });
});

router.get('/questions', (req, res) => {
    const settings = getSettings();
    const govConfig = settings.gov || {};
    const testConfig = govConfig.testSettings || {};
    const questions = testConfig.questions || [];
    
    // Не отправляем правильные ответы на клиент
    const safeQuestions = questions.map(q => {
        const safeQ = {
            id: q.id,
            question: q.question,
            type: q.type,
            points: q.points,
            isBonus: q.isBonus
        };
        
        if (q.type !== 'text' && q.options) {
            safeQ.options = q.options.map(opt => opt.text);
        }
        
        return safeQ;
    });

    res.json({
        success: true,
        durationMinutes: testConfig.durationMinutes || 15,
        passingScore: testConfig.passingScore || 0,
        questions: safeQuestions
    });
});

module.exports = router;
