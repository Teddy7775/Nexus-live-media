// Shared by the kiosk (in the browser) and the server (in Node), so both always agree on what a valid address is.
// Pure functions, no DOM and no Node APIs.

const LOCAL_CHARS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^([a-z]{2,}|xn--[a-z0-9-]+)$/;

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

/** A practical check (not the full RFC): catches typos and junk without rejecting real addresses. */
export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (email.length < 6 || email.length > 254) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || email.indexOf('@') !== at) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_CHARS.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  return TLD.test(labels[labels.length - 1]);
}

const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'iclould.com': 'icloud.com',
  'icoud.com': 'icloud.com',
};

/** A corrected address when the domain looks like a common typo ("ana@gmial.com" -> "ana@gmail.com"), else null. */
export function suggestEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (DOMAIN_TYPOS[domain]) return `${local}@${DOMAIN_TYPOS[domain]}`;
  if (/\.(con|cmo|vom|ocm)$/.test(domain)) return `${local}@${domain.replace(/\.(con|cmo|vom|ocm)$/, '.com')}`;
  return null;
}

/** "jane.doe@gmail.com" -> "j***@gmail.com": enough for a person to recognise their own address, nothing more. */
export function maskEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}
