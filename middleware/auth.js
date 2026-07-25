module.exports = (req, res, next) => {
    const cookies = req.headers.cookie || '';
    if (cookies.includes('admin_auth=true')) {
        return next();
    }
    
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Доступ запрещен' });
    }
    
    return res.redirect('/login');
};
