const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');

const FILE_SETTINGS = path.join(__dirname, '../data/config.json');

const DEFAULT_GOV_ACTIONS = [
    { id: 'assist_arrest', name: 'Помощь при задержании', points: 2, isCurator: false },
    { id: 'bail_release', name: 'Выпуск под залог', points: 1, isCurator: false },
    { id: 'lawsuit', name: 'Написание иска (одобренный)', points: 10, isCurator: false },
    { id: 'court_rep', name: 'Представление в суде', points: 15, isCurator: false },
    { id: 'practice', name: 'Проведение практики', points: 10, isCurator: false },
    { id: 'exam', name: 'Проведение экзамена (для Курирующих)', points: 10, isCurator: true },
    { id: 'exam_plus', name: 'Проведение экзамен+ (для Курирующих)', points: 8, isCurator: true },
    { id: 'recruitment', name: 'Участие в наборе (для Курирующих)', points: 15, isCurator: true }
];

const getSettings = () => {
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
    const settings = getSettings();
    const govConfig = settings.gov || {};
    
    let actions = govConfig.actions || [];
    if (actions.length === 0) {
        actions = DEFAULT_GOV_ACTIONS;
    }

    res.json({
        success: true,
        actions: actions
    });
});

router.post('/report', async (req, res) => {
    try {
        const { employee, discordTag, lawyerType, startDate, endDate, actions, totalPoints } = req.body;
        const settings = getSettings();
        const govConfig = settings.gov || {};
        
        const whUrl = govConfig.webhooks?.report;
        const pingRole = govConfig.roles?.report;

        if (!whUrl) {
            return res.status(500).json({ success: false, message: 'Вебхук для отчетов GOV не настроен в админ-панели.' });
        }

        let contentStr = '';
        if (pingRole) {
            contentStr = pingRole.split(/[\s,]+/).map(r => r.match(/^\d+$/) ? `<@&${r}>` : r).join(' ');
        }

        const embeds = [];
        
        embeds.push({
            title: '📊 Еженедельный отчет адвоката (GOV)',
            color: 0xffffff,
            fields: [
                { name: '👤 Адвокат', value: employee || 'Не указан', inline: true },
                { name: '💬 Discord', value: discordTag || 'Не указан', inline: true },
                { name: '🎖️ Должность', value: lawyerType === 'curator' ? 'Курирующий адвокат' : 'Адвокат', inline: true },
                { name: '📅 Период', value: `${startDate} — ${endDate}`, inline: false },
                { name: '💯 Итого баллов', value: `${totalPoints || 0}`, inline: false }
            ]
        });

        if (actions && actions.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < actions.length; i += chunkSize) {
                const chunk = actions.slice(i, i + chunkSize);
                const chunkFields = chunk.map((a, idx) => {
                    let evStr = a.evidence || 'Нет док-в';
                    if (evStr.length > 1000) evStr = evStr.substring(0, 1000) + '...';
                    return {
                        name: `${i + idx + 1}. 🛡️ ${a.name}`,
                        value: `x${a.quantity} → **${a.points} баллов**\n📎 Доказательства:\n${evStr}`,
                        inline: false
                    };
                });
                
                embeds.push({
                    title: `📁 Действия (часть ${Math.floor(i / chunkSize) + 1})`,
                    color: 0x2a2a2a,
                    fields: chunkFields
                });
            }
        } else {
            embeds[0].fields.push({ name: '📋 Действия', value: 'Нет действий', inline: false });
        }

        if (embeds.length > 10) {
            embeds.splice(10);
        }

        const payload = {
            content: contentStr || null,
            embeds: embeds
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

router.post('/submit', async (req, res) => {
    const { answers, characterName, discordId, staticId } = req.body;
    const settings = getSettings();
    const govConfig = settings.gov || {};
    const testConfig = govConfig.testSettings || {};
    const whUrl = govConfig.webhooks?.test;
    const pingRole = govConfig.roles?.test;

    if (!whUrl) {
        return res.status(500).json({ error: 'Вебхук для тестов GOV не настроен' });
    }

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
        if (q && q.type !== 'text') {
            if (q.isBonus) {
                if (ans.correct) score += q.points;
            } else {
                maxScore += q.points;
                if (ans.correct) score += q.points;
            }
        }
    });

    const isPassed = score >= testPassingScore;
    const statusText = isPassed ? "СДАЛ" : "НЕ СДАЛ";
    const statusColor = isPassed ? 0x22c55e : 0xef4444;

    const embed = {
        title: "📄 Результат тестирования (Адвокаты GOV)",
        color: statusColor,
        fields: [
            { name: "👤 Имя персонажа", value: characterName, inline: true },
            { name: "🆔 Статик (ID)", value: String(staticId), inline: true },
            { name: "💬 Discord", value: `<@${discordId}>`, inline: true },
            { name: "📊 Результат", value: `**${statusText}** (${score} из ${maxScore} баллов)`, inline: false }
        ],
        timestamp: new Date().toISOString()
    };

    let contentStr = '';
    if (pingRole) {
        contentStr = pingRole.split(/[\s,]+/).map(r => r.match(/^\d+$/) ? `<@&${r}>` : r).join(' ');
    }

    await sendDiscordWebhook(whUrl, {
        content: contentStr || null,
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

module.exports = router;
