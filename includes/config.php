<?php
// =============================================================
// Nexus Live Media — site configuration
// Edit this file only. Everything else reads from these values.
// =============================================================
declare(strict_types=1);

// ---- Identity ----
const SITE_NAME   = 'Nexus Live Media';
const LEGAL_NAME  = 'US AFRIK MEDIA LLC';
const SITE_URL    = 'https://nexuslivemedia.com';   // canonical host, no trailing slash (www redirects here)
const SITE_TAGLINE = 'Live Video Production • Hybrid Events • LED Walls • Photo Booths';

// ---- Contact ----
const PHONE_DISPLAY = '+1 (202) 243-8880';
const PHONE_E164    = '12022438880';     // digits only, with country code
const WHATSAPP_E164 = '12022438880';     // leave '' to hide the WhatsApp buttons
const EMAIL_TO      = 'executive@nexuslivemedia.com';
const EMAIL_CC      = 'theonana@nexuslivemedia.com';   // '' to disable
const MAIL_FROM     = 'no-reply@nexuslivemedia.com';   // must exist as a mailbox on the domain for best deliverability
const SUBJECT_PREFIX = 'Quote Request — Nexus Live Media';

// ---- Location (used in the footer and in LocalBusiness schema) ----
const ADDRESS_LOCALITY = 'Washington';
const ADDRESS_REGION   = 'DC';
const ADDRESS_COUNTRY  = 'US';
const SERVICE_AREA     = 'Washington DC • Maryland • Virginia';
const GEO_LAT = 38.9072;
const GEO_LNG = -77.0369;
const OPENING_HOURS = 'Mo-Su 08:00-22:00';

// ---- Social profiles: fill in the ones you have, leave the rest '' ----
const SOCIAL = [
  'instagram' => '',
  'facebook'  => '',
  'youtube'   => '',
  'linkedin'  => '',
  'tiktok'    => '',
];
// Google Business Profile review / map link (shown as "Reviews" once set)
const GOOGLE_BUSINESS_URL = '';

// ---- Measurement ----
const GA_MEASUREMENT_ID  = '';   // e.g. 'G-XXXXXXXXXX' — leave '' until you create the GA4 property
const GSC_VERIFICATION   = '';   // Google Search Console HTML-tag verification value (optional; DNS record already exists)

// ---- Anti-spam ----
// Optional Cloudflare Turnstile (free, no puzzle for humans): https://dash.cloudflare.com/?to=/:account/turnstile
const TURNSTILE_SITE_KEY = '';
const TURNSTILE_SECRET   = '';
// Form timing: a human needs at least this many seconds between page load and submit
const FORM_MIN_SECONDS = 4;
const FORM_MAX_SECONDS = 6 * 3600;
// Rate limits per IP
const RATE_LIMIT_15MIN = 3;
const RATE_LIMIT_DAY   = 10;
// Words that mark a message as advertising spam (case-insensitive, matched as substrings)
const SPAM_WORDS = [
  'seo service', 'backlink', 'guest post', 'link building', 'rank your', 'ranking on google', 'first page of google',
  'web traffic', 'increase traffic', 'crypto', 'bitcoin', 'forex', 'loan offer', 'casino', 'viagra',
  'bulk sms', 'email list', 'lead list', 'database of', 'cheap price', 'wholesale', 'factory price',
  'manufacturer', 'supplier', 'alibaba', 'oem', 'odm', 'free quote for', 'advertising services',
  '广告', '推广', '外链', '优化', '营销', '工厂', '供应', '批发', 'реклама', 'продвижение',
];

// ---- Secret for signed form tokens ----
// Stored OUTSIDE the web root so it is never committed or served. Created automatically on first use.
function form_secret(): string {
  static $secret = null;
  if ($secret !== null) return $secret;
  $file = dirname(__DIR__, 2) . '/.nlm-form-secret';
  if (is_file($file)) {
    $secret = trim((string)@file_get_contents($file));
    if ($secret !== '') return $secret;
  }
  $secret = bin2hex(random_bytes(32));
  @file_put_contents($file, $secret, LOCK_EX);
  @chmod($file, 0600);
  return $secret;
}

// Where submissions and blocked spam are logged (outside the web root)
function log_dir(): string {
  return dirname(__DIR__, 2);
}
