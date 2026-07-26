const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const DB_FILE = path.join(__dirname, '../data', 'fib_results.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, '[]', 'utf8');
}

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { fib: { webhooks: {}, roles: {}, testSettings: { questions: [] } } };
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

router.get('/questions', (req, res) => {
    const config = getConfig();
    const questions = config.fib.testSettings.questions || [];
    
    const safeQuestions = questions.map((q, index) => ({
        id: index,
        text: q.text || q.question,
        options: q.options
    }));
    
    res.json({ success: true, questions: safeQuestions });
});

router.post('/submit', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const questions = config.fib.testSettings.questions || [];

        let score = 0;
        const answers = data.answers || {}; 
        
        questions.forEach((q, index) => {
            if (answers[index] === q.correctAnswer) {
                score++;
            }
        });

        const total = questions.length;
        const passingScore = config.fib.testSettings.passingScore || Math.ceil(total * 0.7);
        const passed = total > 0 && score >= passingScore;

        const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const resultEntry = {
            id: Date.now(),
            nickname: data.nickname,
            discord: data.discordTag,
            rank: data.rank,
            score: score,
            total: total,
            leaveCount: data.leaveCount,
            passed: passed,
            date: new Date().toISOString()
        };
        dbData.push(resultEntry);
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

        const webhook = config.fib.webhooks.main;
        const roleStr = config.fib.roles.ping;

        const payload = {
            content: roleStr ? `<@&${roleStr}>` : '',
            username: "FIB Test System",
            embeds: [{
                title: "📋 Результат переаттестации FIB",
                color: passed ? 0x22c55e : 0xef4444,
                fields: [
                    { name: "👤 Агент:", value: `${data.nickname || '—'}`, inline: true },
                    { name: "💬 Discord:", value: `${data.discordTag || '—'}`, inline: true },
                    { name: "🏅 Ранг:", value: `${data.rank || '—'}`, inline: true },
                    { name: "📊 Результат:", value: `${score} из ${total}\n**${passed ? 'СДАЛ ✅' : 'НЕ СДАЛ ❌'}**`, inline: true },
                    { name: "⚠️ Выходов с вкладки:", value: `${data.leaveCount || 0}`, inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, score: score, total: total, passed: passed });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
