<?php
// =============================================================
// Pricing data — 2026–2027 rate card (edit prices here only)
// =============================================================
declare(strict_types=1);

$PRICING = [
  'packages' => [
    [
      'slug' => 'executive-hybrid-suite',
      'label' => 'Corporate & Hybrid',
      'name' => 'Executive Hybrid Suite',
      'price' => '$4,450',
      'price_note' => 'starting',
      'savings' => 'Save $800',
      'guests' => 'Up to 120 guests',
      'desc' => 'Multi-camera live stream, pro audio, photo kiosk and media coverage for corporate meetings, trainings and town halls.',
      'features' => [
        '3-camera live stream + bonded cellular internet',
        'Digital PA, 4 wireless mics + front-of-house tech',
        'Digital photo kiosk (3 hrs)',
        'Photographer + 48-hour cloud gallery',
        '4K ISO recordings of every camera',
      ],
      'featured' => false,
    ],
    [
      'slug' => 'gala-summit-immersion',
      'label' => 'Most Popular',
      'name' => 'Gala & Summit Immersion',
      'price' => '$7,850',
      'price_note' => 'starting',
      'savings' => 'Save $1,650',
      'guests' => 'Up to 300 guests',
      'desc' => 'Full broadcast, LED wall, Signature print photo booth, concert-grade audio and a media recap for galas, summits and award nights.',
      'features' => [
        'Modular LED wall (10×6 ft) + video processor',
        '3-camera live stream + broadcast technical director',
        'Full PA, 6 wireless mics + sound engineer',
        'Signature Print photo booth (4 hrs)',
        'Photography (48 h) + 90-second 4K highlight film',
      ],
      'featured' => true,
    ],
    [
      'slug' => 'enterprise-360',
      'label' => 'Full Enterprise',
      'name' => 'Enterprise 360 Experience',
      'price' => '$11,500',
      'price_note' => '+ starting',
      'savings' => 'Save $2,600+',
      'guests' => '300+ guests',
      'desc' => 'The complete production: 4-camera broadcast, giant LED stage, VIP photo suite, multi-zone audio, media coverage and branded merchandise.',
      'features' => [
        'Giant LED display (13×8 ft) + video processor',
        '4-camera broadcast + jib/gimbal + ISO records',
        'VIP Brand Suite photo booth + data capture',
        'Multi-zone audio + 8 wireless mics',
        'Photo, 4K film, same-day social clips + 100 shirts/hats',
      ],
      'featured' => false,
    ],
  ],

  'standalone' => [
    ['service' => 'photo-booth',            'name' => 'Open-Air Photo Booths',             'range' => '$550 – $1,750',     'note' => '2–4 hours · Essential, Signature or VIP tier'],
    ['service' => 'live-video-production',  'name' => 'Multi-Camera Live Video & Stream',  'range' => '$1,850 – $2,500+',  'note' => 'Up to 4 hrs active · 3 or 4 cameras + bonded internet'],
    ['service' => 'led-screen-rental',      'name' => 'Modular HD LED Wall Rental',        'range' => '$3,000 – $4,300',   'note' => 'Includes $500 logistics · install + video tech'],
    ['service' => 'audio-sound',            'name' => 'Pro Audio & Sound Reinforcement',   'range' => '$850 – $1,800',     'note' => 'Up to 300+ guests · digital console + wireless mics'],
    ['service' => 'media-coverage',         'name' => 'Media Coverage & Highlight Recap',  'range' => '$1,250 – $2,400',   'note' => 'Half to full day · photos in 48 h, 4K reel in 5–7 days'],
    ['service' => 'hybrid-conferencing',    'name' => 'Hybrid & Online Conferencing',      'range' => 'Custom',            'note' => 'Scoped to platform, speakers and audience size'],
    ['service' => 'special-events-video',   'name' => 'Special Events Video',              'range' => 'From $1,850',       'note' => 'Ceremony live stream + recording + private link'],
    ['service' => 'printing-branding',      'name' => 'Print-on-Demand Merchandise',       'range' => 'Custom',            'note' => 'Shirts, hats, stoles, mugs · live heat-press available'],
  ],

  'booth_tiers' => [
    [
      'label' => 'Starter / Social',
      'name' => 'Essential Digital',
      'price' => '$550',
      'hours' => '2 active hours',
      'desc' => 'Sleek, modern and built for instant social sharing. Ideal for birthdays, mixers and private parties.',
      'features' => ['Stills, GIFs & boomerangs', 'Instant SMS, AirDrop & QR sharing', 'Custom digital overlay', 'Standard backdrop + props', 'One professional attendant', 'Online gallery after the event'],
      'featured' => false,
    ],
    [
      'label' => 'Most Popular',
      'name' => 'Signature Print',
      'price' => '$950',
      'hours' => '3 active hours',
      'desc' => 'Instant dye-sub prints guests take home, plus everything digital. Our go-to for weddings, galas and graduations.',
      'features' => ['Everything in Essential Digital', 'Unlimited instant 2×6 or 4×6 prints', 'Premium backdrop selection', 'Deluxe prop collection', 'Dual-attendant service', 'Post-event USB drive'],
      'featured' => true,
    ],
    [
      'label' => 'Corporate & Luxury',
      'name' => 'VIP Brand Suite',
      'price' => '$1,750',
      'hours' => '4 active hours',
      'desc' => 'Engineered for brand activations, corporate galas, trade shows and high-impact VIP marketing events.',
      'features' => ['Everything in Signature Print', 'Custom 8×8 step-and-repeat backdrop', 'Branded microsite + data capture', 'Real-time TV/monitor slideshow', 'Glam skin filter', 'Audio / video confessional', 'Detailed analytics report'],
      'featured' => false,
    ],
  ],

  'booth_addons' => [
    ['Additional active coverage', '+$175 / hr'],
    ['Idle / standby time', '+$60 / hr'],
    ['Roaming ring photo unit', '+$150 / hr'],
    ['Luxe guest memory album', '+$125 flat'],
    ['Retro vintage audio guestbook', '+$195 flat'],
  ],

  'policies' => [
    ['Booking', 'A 30% non-refundable retainer secures your date. Balance due 14 days before the event.'],
    ['Overtime', '$175/hr for standalone services, $350/hr for turnkey bundles, billed in 30-minute increments.'],
    ['Travel', 'Free within 35 miles of Washington, DC. $1.75 per mile beyond. Client covers parking and dock passes.'],
    ['Insurance', '$2,000,000 general liability. Certificates of insurance naming your venue are issued free of charge.'],
  ],
];
