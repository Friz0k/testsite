module.exports = (req, res, next) => {
    if (req.signedCookies && req.signedCookies.admin_auth === 'true') {
        return next();
    }
    
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Доступ запрещен' });
    }
    
    return res.redirect('/login');
};
