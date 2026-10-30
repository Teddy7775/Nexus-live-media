<?php
declare(strict_types=1);

// =========================
// FAQ entries (site-wide) and client testimonials.
// cat: booking | production | photo-booth | delivery | policies
// =========================

$FAQS = [

  [
    'cat' => 'booking',
    'q'   => 'How far in advance should we book?',
    'a'   => 'We recommend reserving your date four to six weeks ahead. Peak seasons, May through June for graduations and September through December for galas and conferences, fill early, so book sooner for those months. Last-minute requests are welcome and confirmed subject to crew and equipment availability.',
  ],
  [
    'cat' => 'booking',
    'q'   => 'What are the booking and cancellation terms?',
    'a'   => 'A 30% non-refundable retainer and a signed Master Agreement reserve your date. The remaining 70% is due 14 days before the event. You may reschedule up to 30 days before the original date, subject to calendar availability, and the retainer transfers to the new date.',
  ],
  [
    'cat' => 'booking',
    'q'   => 'Do you provide one vendor for video, LED, audio, photo booth and printing?',
    'a'   => 'Yes. Nexus Live Media supplies and operates all of it under a single contract with a single on-site lead. You coordinate with one person, receive one invoice, and the crews for video, screens, sound, photo booth and branding work from the same run of show.',
  ],
  [
    'cat' => 'booking',
    'q'   => 'Do you charge for travel?',
    'a'   => 'Travel is free within 35 miles of the Washington DC metro area, which covers Arlington, Alexandria, Bethesda, Silver Spring, Tysons and National Harbor. Beyond that radius we bill $1.75 per additional mile. The client covers venue loading dock and parking passes at actual cost.',
  ],

  [
    'cat' => 'production',
    'q'   => 'How much time do you need for setup and teardown?',
    'a'   => 'Full productions with LED walls, multi-camera video and audio require three to four hours of uninterrupted load-in before doors open and about two hours to tear down afterward. Photo-booth-only setups need 60 to 90 minutes. We confirm the venue access window with you during planning.',
  ],
  [
    'cat' => 'production',
    'q'   => 'Do you need our venue\'s Wi-Fi to live stream?',
    'a'   => 'No. Every stream runs on our bonded multi-carrier gateway, which combines AT&T, Verizon and T-Mobile into one stable connection, so we never rely on venue Wi-Fi. In the rare case of a regional network outage, the full 4K ISO master recorded on site fulfills the stream delivery.',
  ],
  [
    'cat' => 'production',
    'q'   => 'Which streaming platforms do you support?',
    'a'   => 'We stream to YouTube, Facebook, Vimeo, Zoom, Microsoft Teams, Webex and any custom RTMP destination, including private corporate players. One broadcast can go to several platforms at the same time, so in-room guests, remote staff and family abroad each watch where they already are.',
  ],
  [
    'cat' => 'production',
    'q'   => 'Can family overseas watch the live stream?',
    'a'   => 'Yes. We provide a private viewing link, or a public stream on YouTube, Facebook, Vimeo or Zoom, that works on any phone or tablet anywhere in the world. The replay is available at the same link right after the event, so relatives in other time zones can watch later.',
  ],
  [
    'cat' => 'production',
    'q'   => 'What is your policy on severe weather for outdoor setups?',
    'a'   => 'To protect people and sensitive electronics, we reserve the right to pause operations, cover equipment or strike LED walls, audio and cameras if rain, lightning or winds above 20 mph occur. Weather suspensions are non-refundable, so we recommend a covered or indoor backup location for outdoor events.',
  ],

  [
    'cat' => 'photo-booth',
    'q'   => 'What is included with the photo booth?',
    'a'   => 'Every tier includes an open-air booth with a commercial DSLR camera, a professional lighting setup, a custom overlay designed for your event, unlimited sessions during active hours and an attendant. The Essential Digital tier ($550, 2 hours) is sharing-only; Signature Print ($950, 3 hours) adds instant prints; VIP Brand Suite ($1,750, 4 hours) adds a step-and-repeat backdrop, data capture and a live slideshow.',
  ],

  [
    'cat' => 'delivery',
    'q'   => 'When will we receive photos, highlight reels and stream recordings?',
    'a'   => 'Event photography arrives as a high-resolution, color-graded cloud gallery within 48 hours. Cinematic 4K highlight reels are delivered in five to seven business days. Live stream masters and ISO camera recordings are transferred within 24 to 48 hours through a secure cloud link.',
  ],
  [
    'cat' => 'delivery',
    'q'   => 'What are the deadlines for custom merchandise and printing?',
    'a'   => 'Vector artwork at 300 DPI and apparel sizing must be approved in writing at least 14 business days before the event. Orders submitted inside that window carry a 25% rush fee or default to a standard unisex size distribution. We review artwork with you before anything goes to production.',
  ],

  [
    'cat' => 'policies',
    'q'   => 'How is overtime handled if the event runs late?',
    'a'   => 'Overtime is billed in 30-minute increments at $175 per hour for standalone services and $350 per hour for full production bundles. Our on-site lead always confirms verbal authorization with your lead planner before extending coverage, so there are no unexpected charges.',
  ],
  [
    'cat' => 'policies',
    'q'   => 'Do you carry event insurance and provide COIs?',
    'a'   => 'Yes. We carry a $2,000,000 commercial general liability policy and issue formal certificates of insurance naming your organization, the venue and the property management company as additional insured, at no extra charge. Send us the venue\'s required wording and we return the certificate promptly.',
  ],
  [
    'cat' => 'policies',
    'q'   => 'Who is liable for equipment damaged at the venue?',
    'a'   => 'The client is financially responsible for the repair or full replacement value of any equipment damaged, stolen or vandalized by event attendees, guests or third-party venue staff during the contracted window. Our crew secures cables, stands and cases, and we walk the setup with you before doors open.',
  ],

];

// Anonymous client quotes shown on the home page and the About page.
$TESTIMONIALS = [
  [
    'quote' => 'The production was smooth, the stream looked amazing, and the sound was crystal clear. Our remote guests felt like they were in the room.',
    'who'   => 'Conference Organizer',
    'event' => 'Corporate Event',
  ],
  [
    'quote' => 'They handled everything—from cameras to online platform setup. It was professional and stress-free from start to finish.',
    'who'   => 'Program Director',
    'event' => 'Hybrid Training',
  ],
  [
    'quote' => 'The LED screen transformed the stage. The visuals were sharp and the team stayed on top of every transition.',
    'who'   => 'Event Planner',
    'event' => 'Large Celebration',
  ],
];
