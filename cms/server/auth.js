/**
 * CMS RBAC Authentication Middleware
 * Independent session auth with least-privilege role separation.
 * Completely isolated from financial application authentication.
 */

const jwt = require('jsonwebtoken');

const CMS_JWT_SECRET = process.env.CMS_JWT_SECRET || 'cfo_ai_cms_secure_isolated_secret_2026';

function generateCmsToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    CMS_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyCmsToken(token) {
  try {
    return jwt.verify(token, CMS_JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Middleware enforcing CMS authentication.
 */
function requireCmsAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required for CMS administration.' });
  }

  const decoded = verifyCmsToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired CMS session token.' });
  }

  req.cmsUser = decoded;
  next();
}

/**
 * Middleware enforcing specific role permissions.
 * @param {Array<string>} allowedRoles ['owner', 'editor', 'reviewer']
 */
function requireCmsRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.cmsUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.cmsUser.role)) {
      return res.status(403).json({
        error: `Permission denied. Required role(s): [${allowedRoles.join(', ')}]. Current role: '${req.cmsUser.role}'.`
      });
    }

    next();
  };
}

module.exports = {
  generateCmsToken,
  verifyCmsToken,
  requireCmsAuth,
  requireCmsRole
};
