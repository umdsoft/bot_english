function ensureAuth(req, res, next) {
  if (req.session && req.session.adminUser) return next();
  return res.redirect('/admin/login');
}

function ensureGuest(req, res, next) {
  if (req.session && req.session.adminUser) return res.redirect('/admin');
  return next();
}

module.exports = { ensureAuth, ensureGuest };
