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

router.get('/config', (req, res) => {
    const settings = getSettings();
    const govConfig = settings.gov || {};
    res.json({
        success: true,
        actions: govConfig.actions || []
    });
});

router.post('/report', async (req, res) => {
    try {
        const { employee, discordTag, startDate, endDate, actions, totalPoints } = req.body;
        const settings = getSettings();
        const govConfig = settings.gov || {};
        
        let whUrl = govConfig.webhooks?.report;
        if (!whUrl) {
            whUrl = 'https://discord.com/api/webhooks/1536769098380484618/rJjpmT8trPIPdiSHBMJ-j791gWCgRdlyQ0AP6_G-y5lZCQdnYRM9_AWAQy95jBvnZAeb';
        }
        
        const pingRole = govConfig.roles?.report;

        let actionsText = '';
        if (actions && actions.length > 0) {
            actionsText = actions.map(a => `- ${a.name} (x${a.quantity}): ${a.points} баллов\n  Док-ва: ${a.evidence}`).join('\n\n');
        } else {
            actionsText = 'Нет действий';
        }
        
        if (actionsText.length > 2048) actionsText = actionsText.substring(0, 2040) + '...';

        const embed = {
            title: '📊 Еженедельный отчет адвоката (GOV)',
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

        await sendWebhook(whUrl, payload);
        res.json({ success: true, message: 'Отчет успешно отправлен!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
