const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxpZJhsOM8FtjEBIvizWoC5P_xVjEMEGU7OMUju0Ze8fFHhwKGBnAPqqxx9jP9vdUnm/exec';

const logToSheet = async (systemName, actionType, payload) => {
    if (!SCRIPT_URL) return;
    try {
        const fetchMethod = global.fetch || require('node-fetch');
        await fetchMethod(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system: systemName,
                type: actionType,
                data: payload,
                timestamp: new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
            })
        });
    } catch (e) {}
};

module.exports = logToSheet;
