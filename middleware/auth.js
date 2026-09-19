const fs = require('fs');
const path = require('path');

const FILE_SETTINGS = path.join(__dirname, '../data/config.json');

const getTokens = () => {
    try {
        if (!fs.existsSync(FILE_SETTINGS)) return [];
        const data = fs.readFileSync(FILE_SETTINGS, 'utf8');
        const json = JSON.parse(data);
        return json.apiTokens || [];
    } catch (e) {
        return [];
    }
};

module.exports = (req, res, next) => {
    if (req.signedCookies && req.signedCookies.admin_auth === 'true') {
        req.isSuperAdmin = true;
        return next();
    }

    const authHeader = req.headers['authorization'] || req.headers['x-api-token'];
    const cookieToken = req.cookies?.api_token || req.signedCookies?.api_token;
    let token = null;

    if (authHeader) {
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else {
            token = authHeader.trim();
        }
    } else if (cookieToken) {
        token = cookieToken.trim();
    }

    if (token) {
        const tokens = getTokens();
        const validToken = tokens.find(t => t.token === token && t.active !== false);

        if (validToken) {
            req.isSuperAdmin = false;
            req.tokenData = validToken;

            const targetSystem = req.query.system || req.body.system || req.query.faction || req.body.faction;

            if (targetSystem && !validToken.systems.includes(targetSystem) && !validToken.systems.includes('all')) {
                return res.status(403).json({ success: false, error: 'Access denied for system' });
            }

            if (req.path.startsWith('/file') && !validToken.permissions.includes('files')) {
                return res.status(403).json({ success: false, error: 'No permission for files' });
            }

            if (req.path.startsWith('/settings') && !validToken.permissions.includes('settings')) {
                return res.status(403).json({ success: false, error: 'No permission for settings' });
            }

            return next();
        }
    }

    if (req.xhr || (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) || req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Auth required' });
    }

    return res.redirect('/login');
};
