// =============================================================
// Schedule social/posts.json through the Postiz CLI.
//   node tools/postiz-schedule.mjs --dry-run        # show what would be created
//   node tools/postiz-schedule.mjs                  # create DRAFTS in Postiz
//   node tools/postiz-schedule.mjs --publish        # schedule for real
//   node tools/postiz-schedule.mjs --start 2026-11-02 --only p01,p02
// Requires: npm i -g postiz, then `postiz auth:login` and every social
// account connected inside Postiz. Media is uploaded once and reused.
// =============================================================
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = flag('--dry-run');
const PUBLISH = flag('--publish');
const START = opt('--start', '2026-11-02');          // day 1 of the calendar (a Monday)
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean);
const ET_OFFSET_HOURS = 5;                           // America/New_York is UTC-5 after 2026-11-01 (EST)

const posts = JSON.parse(readFileSync(join(root, 'social', 'posts.json'), 'utf8'));
const assets = join(root, 'social', 'assets');

function postiz(...a) {
  const r = spawnSync('postiz', a, { shell: true, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && !/success|created|path/i.test(out)) throw new Error(`postiz ${a.join(' ')}\n${out}`);
  return out;
}
function json(text) {                                 // the CLI may print a header line before the JSON
  const i = Math.min(...['[', '{'].map((c) => text.indexOf(c)).filter((x) => x >= 0));
  return JSON.parse(text.slice(i));
}
function when(day, timeEt) {
  const [h, m] = (timeEt || '11:00').split(':').map(Number);
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (day - 1));
  d.setUTCHours(h + ET_OFFSET_HOURS, m, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---- Integrations: map our platform keys to Postiz channel ids ----
const ALIASES = {
  instagram: ['instagram', 'instagram-standalone'], facebook: ['facebook'], linkedin: ['linkedin-page', 'linkedin'],
  tiktok: ['tiktok'], youtube: ['youtube'], gmb: ['gmb', 'google-my-business', 'googlemybusiness'],
  pinterest: ['pinterest'], x: ['x', 'twitter'], threads: ['threads'],
};
let channels = [];
if (!DRY) channels = json(postiz('integrations:list'));
const channelFor = (platform) => channels.find((c) => (ALIASES[platform] || [platform]).includes((c.identifier || '').toLowerCase()) && !c.disabled);

// ---- Settings per platform ----
function settingsFor(platform, post) {
  const yt = post.caption?.youtube;
  switch (platform) {
    case 'instagram': return { post_type: post.type === 'story' ? 'story' : 'post' };
    case 'tiktok':    return { privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, stitch: true, content_posting_method: 'DIRECT_POST' };
    case 'youtube':   return { title: yt?.title || 'Nexus Live Media', type: 'public', tags: (yt?.tags || []).map((t) => ({ value: t, label: t })) };
    case 'x':         return { who_can_reply_post: 'everyone' };
    default:          return null;
  }
}
function captionFor(platform, post) {
  const c = post.caption || {};
  if (platform === 'youtube') return c.youtube?.description || c.facebook || c.instagram || '';
  return c[platform] || c.instagram || c.facebook || '';
}

// ---- Upload media once ----
const uploaded = new Map();
function upload(file) {
  if (uploaded.has(file)) return uploaded.get(file);
  const path = join(assets, file);
  if (!existsSync(path)) throw new Error(`missing media ${path}`);
  if (DRY) { uploaded.set(file, `<upload:${file}>`); return uploaded.get(file); }
  const url = json(postiz('upload', `"${path}"`)).path;
  uploaded.set(file, url);
  return url;
}

// ---- Create posts ----
let created = 0, skipped = 0;
for (const post of posts) {
  if (ONLY.length && !ONLY.includes(post.id)) continue;
  const date = when(post.day, post.time_et);
  for (const platform of post.platforms) {
    const ch = DRY ? { id: `<${platform}-id>` } : channelFor(platform);
    if (!ch) { console.warn(`skip ${post.id}/${platform}: no connected ${platform} channel in Postiz`); skipped++; continue; }
    const media = (post.media || []).map(upload).join(',');
    const caption = captionFor(platform, post);
    const settings = settingsFor(platform, post);
    const a = ['posts:create', '-c', JSON.stringify(caption), '-s', date, '-i', ch.id];
    if (media) a.push('-m', `"${media}"`);
    if (settings) a.push('--settings', JSON.stringify(JSON.stringify(settings)));
    if (!PUBLISH) a.push('-t', 'draft');
    if (DRY) { console.log(`[dry] ${post.id} ${platform} ${date}\n      media=${media || '-'}\n      ${caption.slice(0, 90).replace(/\n/g, ' ')}…`); continue; }
    const out = postiz(...a);
    console.log(`${PUBLISH ? 'scheduled' : 'draft'} ${post.id} ${platform} ${date} ${out.trim().split('\n').pop()}`);
    created++;
  }
}
console.log(`\n${DRY ? 'dry run complete' : `${created} post(s) ${PUBLISH ? 'scheduled' : 'drafted'}, ${skipped} skipped`}`);
