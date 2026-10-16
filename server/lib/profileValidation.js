const AVATAR_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
function validTimezone(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0)); return true; }
  catch { return false; }
}
function ownAvatarPath(value, userId, projectURL, bucket = 'avatars') {
  if (typeof value !== 'string' || value.length > 500 || !/^-?[0-9]+$/.test(String(userId)) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(bucket)) return null;
  try {
    const base = new URL(projectURL), url = new URL(value);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
    const prefix = base.pathname.replace(/\/$/, '') + '/storage/v1/object/public/' + bucket + '/' + String(userId) + '/';
    if (!url.pathname.startsWith(prefix)) return null;
    const file = url.pathname.slice(prefix.length);
    const match = file.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i);
    return match ? { path: String(userId) + '/' + file, mime: AVATAR_MIME[match[1].toLowerCase()] } : null;
  } catch { return null; }
}
// Company time zone (D4-A): stricter than a user zone. Same rule as public.cfo_business_tz:
// IANA Area/Location only. POSIX names ("GMT+7", "+07:00") mean the opposite sign in PostgreSQL
// and abbreviations ("WIB") are unknown to it, so an opening date would shift by a day.
const IANA_AREA_LOCATION = /^[A-Z][A-Za-z]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/;
function validBusinessTimezone(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || value.length > 64 || !IANA_AREA_LOCATION.test(value)) return false;
  return validTimezone(value);
}

module.exports = { validTimezone, validBusinessTimezone, IANA_AREA_LOCATION, ownAvatarPath };
