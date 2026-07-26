const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const DB_DIR = path.join(__dirname, '../data');

const dbFiles = ['lspd_applications.json', 'lspd_badges.json', 'lspd_cadets.json', 'lspd_tests.json'];

dbFiles.forEach(file => {
    const filePath = path.join(DB_DIR, file);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
});

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return { lspd: { webhooks: {}, roles: {}, testQuestions: [] } };
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

router.post('/application', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.lspd.webhooks.application;
        const roleStr = config.lspd.roles.application;

        const dbFile = path.join(DB_DIR, 'lspd_applications.json');
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        dbData.push({ id: Date.now(), date: new Date().toISOString(), ...data });
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2));

        const roleMentions = roleStr ? roleStr.split(' ').map(id => `<@&${id}>`).join(' ') : '';

        const payload = {
            content: roleMentions,
            username: 'Электронные заявления LSPD',
            avatar_url: 'https://i.ytimg.com/vi/-73syMbr0oA/maxresdefault.jpg',
            embeds: [{
                title: 'LSPD · Новая заявка',
                color: 0x00ffff,
                fields: [
                    { name: 'Имя Фамилия', value: data.fullname, inline: false },
                    { name: 'Номер паспорта (IC)', value: data.passport, inline: true },
                    { name: 'Возраст (IC)', value: data.age, inline: true },
                    { name: 'Лет в штате (уровень)', value: data.years, inline: false },
                    { name: 'Копии документов', value: data.docs, inline: false },
                    { name: 'Фото тела', value: data.body, inline: false },
                    { name: 'О себе', value: data.about.substring(0, 1024), inline: false },
                    { name: 'Опыт в гос. структурах', value: data.experience.substring(0, 1024), inline: false },
                    { name: 'Почему LSPD?', value: data.why.substring(0, 1024), inline: false },
                    { name: 'Желаемый отдел', value: data.division, inline: true },
                    { name: 'Дискорд', value: data.discord, inline: true },
                    { name: 'Номер телефона', value: data.phone, inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Заявка отправлена в LSPD.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/badge', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.lspd.webhooks.badge;
        const roleStr = config.lspd.roles.badge;

        const dbFile = path.join(DB_DIR, 'lspd_badges.json');
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        dbData.push({ id: Date.now(), date: new Date().toISOString(), ...data });
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2));

        const roleMentions = roleStr ? roleStr.split(' ').map(id => `<@&${id}>`).join(' ') : '';

        const payload = {
            content: roleMentions,
            embeds: [{
                title: '🆕 Новая заявка на проверку жетона',
                color: 16758502,
                fields: [
                    { name: '👤 Ник', value: data.name, inline: true },
                    { name: '🔗 Ссылка на сообщение', value: data.messageLink, inline: false }
                ],
                image: { url: data.photoUrl },
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Заявка отправлена!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/cadet', async (req, res) => {
    try {
        const data = req.body;
        const config = getConfig();
        const webhook = config.lspd.webhooks.cadet;
        const roleStr = config.lspd.roles.cadet;

        const dbFile = path.join(DB_DIR, 'lspd_cadets.json');
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        dbData.push({ id: Date.now(), date: new Date().toISOString(), ...data });
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2));

        const roleMentions = roleStr ? roleStr.split(' ').map(id => `<@&${id}>`).join(' ') : '';

        const fields = data.type === '1-2' ? [
            { name: '👤 Ник', value: data.nick, inline: true },
            { name: '💬 Discord', value: data.discord, inline: true },
            { name: '🪪 Жетон', value: data.badge, inline: false },
            { name: '📝 Онлайн тест', value: data.test, inline: false },
            { name: '🚓 Задержание', value: data.arrest || '—', inline: false },
            { name: '📚 Лекция', value: data.lecture, inline: false },
            { name: '🔞 ЧП Discord', value: data.chp, inline: false }
        ] : [
            { name: '👤 Ник', value: data.nick, inline: true },
            { name: '💬 Discord', value: data.discord, inline: true },
            { name: '📝 Экзамен', value: data.exam, inline: false },
            { name: '💰 Штрафы (5)', value: data.fines || '—', inline: false },
            { name: '📦 Поставки (2)', value: data.supplies || '—', inline: false },
            { name: '🎁 Аирдропы (3)', value: data.airdrops || '—', inline: false },
            { name: '🎭 РП задание', value: data.rpTask || '—', inline: false }
        ];

        const payload = {
            content: roleMentions ? `${roleMentions} Новый отчёт!` : 'Новый отчёт!',
            embeds: [{
                title: data.type === '1-2' ? '📈 Повышение 1→2' : '📈 Повышение 2→3',
                color: 16758502,
                fields: fields,
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: 'Отчёт отправлен!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/questions', (req, res) => {
    try {
        const config = getConfig();
        const questions = config.lspd.testQuestions || [];
        const shuffled = [...questions].sort(() => Math.random() - 0.5);
        
        const forClient = shuffled.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options
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
        const webhook = config.lspd.webhooks.test;
        const questions = config.lspd.testQuestions || [];

        let totalScore = 0;
        
        data.questions.forEach(userQ => {
            const orig = questions.find(q => q.id === userQ.id);
            if (!orig) return;
            
            const selected = userQ.selectedAnswers || [];
            
            if (orig.correct.length > 1) {
                const sortedSelected = [...selected].sort();
                const sortedCorrect = [...orig.correct].sort();
                if (JSON.stringify(sortedSelected) === JSON.stringify(sortedCorrect)) {
                    totalScore += 1;
                }
            } else {
                if (selected.length === 1 && selected[0] === orig.correct[0]) {
                    totalScore += 1;
                }
            }
        });

        const passingScore = config.lspd.testPassingScore || 20;
        const passed = totalScore >= passingScore;

        const dbFile = path.join(DB_DIR, 'lspd_tests.json');
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        dbData.push({
            id: Date.now(),
            date: new Date().toISOString(),
            nickname: data.nickname,
            discordTag: data.discordTag,
            score: totalScore,
            total: data.questions.length,
            passed: passed
        });
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2));

        const payload = {
            embeds: [{
                title: '📝 Результат теста (1→2)',
                color: passed ? 0x6C8B5E : 0xC46A5A,
                fields: [
                    { name: 'Ник', value: data.nickname, inline: true },
                    { name: 'Discord', value: data.discordTag, inline: true },
                    { name: 'Результат', value: `${totalScore}/${data.questions.length}`, inline: true },
                    { name: 'Статус', value: passed ? '✅ Сдал' : '❌ Не сдал', inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        await sendToDiscord(webhook, payload);
        res.json({ success: true, message: passed ? `✅ Сдано (${totalScore}/${data.questions.length})` : `❌ Не сдано (${totalScore}/${data.questions.length})` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
