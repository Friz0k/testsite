const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const DB_FILE = path.join(__dirname, '../data', 'gov_tests.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, '[]', 'utf8');
}

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { gov: { webhooks: {}, roles: {}, testSettings: { passingScore: 13, questions: [] } } };
    }
}

async function sendToDiscord(webhook, payload) {
    if (!webhook) return;
    try {
        await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {}
}

function getMaxPossibleScore(questions) {
    let max = 0;
    for (let q of questions) {
        if (q.type === 'text') max += (q.isBonus ? 1 : q.points);
        else max += q.points;
    }
    return max;
}

router.get('/questions', (req, res) => {
    try {
        const config = getConfig();
        const questions = config.gov.testSettings.questions || [];
        const shuffled = [...questions].sort(() => Math.random() - 0.5);
        
        const forClient = shuffled.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options ? q.options.map(o => ({ text: o.text })) : null,
            type: q.type,
            points: q.points,
            isBonus: q.isBonus || false
        }));
        
        res.json({ success: true, questions: forClient });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/submitTest', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.gov.webhooks.test;
        const roleStr = config.gov.roles.test;
        const questions = config.gov.testSettings.questions || [];

        let totalScore = 0;
        let openAnswers = [];

        for (let i = 0; i < data.questions.length; i++) {
            const userQ = data.questions[i];
            const orig = questions.find(q => q.id === userQ.id);
            if (!orig) continue;

            if (orig.type === 'text') {
                const answerText = (userQ.textAnswer || '').trim();
                let pointsEarned = 0;
                if (answerText !== '') {
                    pointsEarned = orig.isBonus ? 1 : orig.points;
                }
                totalScore += pointsEarned;
                openAnswers.push({ question: orig.question, answer: answerText });
            } 
            else {
                const selected = userQ.selectedAnswers || [];
                const correctIndices = orig.options.reduce((acc, opt, idx) => opt.correct ? [...acc, idx] : acc, []);
                
                let isCorrect = false;
                if (orig.type === 'multiple') {
                    const sSorted = [...selected].sort();
                    const cSorted = [...correctIndices].sort();
                    isCorrect = sSorted.length === cSorted.length && sSorted.every((v, i) => v === cSorted[i]);
                } else {
                    isCorrect = selected.length === 1 && correctIndices.length === 1 && selected[0] === correctIndices[0];
                }
                
                if (isCorrect) totalScore += orig.points;
            }
        }

        const maxScore = getMaxPossibleScore(questions);
        const passingScore = config.gov.testSettings.passingScore || 13;
        const passed = totalScore >= passingScore;

        const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        dbData.push({
            id: Date.now(),
            date: new Date().toISOString(),
            nickname: data.nickname,
            discordTag: data.discordTag,
            score: totalScore,
            total: maxScore,
            passed: passed,
            openAnswers: openAnswers
        });
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

        const description = [
            `**🏛️ Имя:** ${data.nickname}`,
            `**📞 Discord:** ${data.discordTag}`,
            `**📜 Баллы:** ${totalScore} / ${maxScore}`,
            `**🔍 Статус:** ${passed ? '✅ СДАН' : '❌ НЕ СДАН'}`
        ].join('\n');

        const mainEmbed = {
            color: passed ? 0x00FF00 : 0xFF4444,
            description: description,
            footer: { text: "Made by Cop" },
            timestamp: new Date().toISOString()
        };

        const payload = {
            content: roleStr ? `<@&${roleStr}>` : '',
            username: "Секретарь Коллегии Адвокатов",
            embeds: [mainEmbed]
        };

        if (openAnswers && openAnswers.length > 0) {
            let answersText = "";
            for (let i = 0; i < openAnswers.length; i++) {
                const q = openAnswers[i];
                answersText += `**${q.question}**\nОтвет: ${q.answer || "(не указан)"}\n\n`;
                if (answersText.length > 1800) {
                    answersText += "... (обрезано из-за лимита)";
                    break;
                }
            }
            const answersEmbed = {
                color: 0x3498db,
                title: "Ответы на открытые вопросы",
                description: answersText.length > 4000 ? answersText.substring(0, 3900) + "..." : answersText,
                footer: { text: "Made by Cop" },
                timestamp: new Date().toISOString()
            };
            payload.embeds.push(answersEmbed);
        }

        await sendToDiscord(webhook, payload);
        res.json({ success: true, nickname: data.nickname, score: totalScore, maxScore: maxScore });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
