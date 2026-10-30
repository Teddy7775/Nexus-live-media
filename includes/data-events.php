<?php
declare(strict_types=1);

// =========================
// Event-type pages: one entry per audience we serve.
// Keyed by slug; order here is the display order.
// =========================

$EVENTS = [

  'corporate' => [
    'name'       => 'Corporate & Government Events',
    'short'      => 'Corporate & Government',
    'tagline'    => 'Hybrid town halls, summits and press events that run on time and look sharp on every screen.',
    'meta_title' => 'Corporate Event Production Washington DC | Nexus Live Media',
    'meta_desc'  => 'Multi-camera live streaming, hybrid Zoom/Teams/Webex production, LED walls and pro audio for corporate and government events in Washington DC, Maryland and Virginia.',
    'image'      => 'events/corporate.jpg',
    'image_alt'  => 'Hybrid corporate town hall with a panel on stage and remote participants on an LED wall',
    'summary'    => 'We produce meetings, town halls, press events and summits for companies, agencies and associations across the DMV. In-room attendees and remote participants get the same clean picture, clear audio and a program that stays on schedule.',
    'intro'      => [
      'Corporate and government events have a short list of non-negotiables: the stream cannot drop, the executive on stage must sound as good as the one joining from Teams, and the venue wants a certificate of insurance before you load a single case. We build around those requirements. Every live stream runs on bonded multi-carrier cellular internet (AT&T, Verizon and T-Mobile together), so we never depend on hotel or office Wi-Fi, and every production carries $2,000,000 in general liability with free COIs naming your venue and organization.',
      'Hybrid is where most corporate events live now. We integrate Zoom, Microsoft Teams and Webex directly into the broadcast, bring remote speakers onto the LED wall and into the room PA, and manage moderation, screen share and attendee support so your IT team is not troubleshooting during the keynote. Whether the event is a 120-person leadership offsite in Tysons or a 300-guest awards gala at National Harbor, you get one on-site lead, a run-of-show rehearsal and a technical director calling the switch.',
      'Afterward, you receive the stream master and ISO recordings within 24 to 48 hours through a secure cloud link, ready for internal distribution, compliance archives or a highlight edit for social media.',
    ],
    'services'   => ['hybrid-conferencing', 'live-video-production', 'led-screen-rental', 'audio-sound', 'media-coverage'],
    'highlights' => [
      'Zoom, Teams and Webex production with remote speakers on the wall and in the room',
      'Three- or four-camera broadcast with graphics, lower-thirds and slide integration',
      'Modular LED walls (10×6 ft or 13×8 ft) for keynotes, IMAG and sponsor loops',
      'Digital PA with wireless microphones and a dedicated front-of-house engineer',
      'Bonded cellular streaming, never venue Wi-Fi, with full 4K ISO backup recordings',
      'Free certificates of insurance for hotels, conference centers and federal facilities',
    ],
    'faqs'       => [
      ['Can you stream to our internal platform instead of YouTube?', 'Yes. We deliver to any custom RTMP endpoint, including private corporate players, intranet video portals and password-protected Vimeo pages, and we can send to several destinations at the same time if you also want a public feed.'],
      ['Our venue requires a COI naming the property management company. Is that extra?', 'No. We carry a $2,000,000 commercial general liability policy and issue certificates naming your organization, the venue and the property manager as additional insured at no charge. Send us the exact wording they need and we turn it around quickly.'],
      ['How much lead time do you need on site?', 'Full productions with LED, multi-camera and audio need three to four hours of uninterrupted load-in before doors and two hours to tear down. We confirm the venue access window and dock or elevator logistics during planning so there are no surprises on the day.'],
    ],
    'cta'        => 'Plan a corporate event',
  ],

  'graduations' => [
    'name'       => 'Graduations & Commencements',
    'short'      => 'Graduations',
    'tagline'    => 'Every graduate seen on the big screen, every family watching live, wherever they are.',
    'meta_title' => 'Graduation Live Streaming Washington DC | Nexus Live Media',
    'meta_desc'  => 'Live streaming, giant LED screens and multi-camera recording for graduations and commencements across Washington DC, Maryland and Northern Virginia schools and universities.',
    'image'      => 'events/graduation.jpg',
    'image_alt'  => 'Graduate crossing the stage with a live close-up on a giant LED screen behind the stage',
    'summary'    => 'Commencements are the one day a year when every family wants a clear view and a lasting recording. We put the walk across the stage on a giant screen for the room and on a live stream for the relatives who could not travel.',
    'intro'      => [
      'A 2,000-seat hall is a hard place to see your graduate. Our LED walls put a live close-up of each student on screen as their name is read, so parents in the back row and grandparents watching from another country share the same moment. We coordinate camera positioning and name-reader timing with your ceremony staff during rehearsal, so the picture on the wall matches the person shaking hands, every time.',
      'Many families simply cannot attend. Visa timelines, work schedules and travel costs keep relatives away from the ceremonies they most want to see. Our live stream goes to YouTube, Facebook or a private link that works on any phone, with a replay available right after the event. Schools in Prince George\'s County, Montgomery County and Northern Virginia use the same feed for overflow rooms when the main hall is full.',
      'After the ceremony you receive the full recording within 24 to 48 hours and, if you choose media coverage, a color-graded photo gallery in 48 hours and a 4K highlight reel within 5 to 7 business days. We can also produce graduation stoles, shirts and signage so the whole day is handled by one vendor.',
    ],
    'services'   => ['live-video-production', 'led-screen-rental', 'audio-sound', 'media-coverage', 'printing-branding'],
    'highlights' => [
      'Giant LED screens (10×6 ft or 13×8 ft) with a live close-up of each graduate',
      'Multi-camera live stream to YouTube, Facebook or a private family link',
      'Ceremony-specific directing timed to the name reader and stage flow',
      'Overflow-room feeds and clear PA for large auditoriums and gymnasiums',
      'Full recording delivered in 24 to 48 hours, highlight reel in 5 to 7 business days',
      'Custom stoles, shirts, banners and step-and-repeat backdrops for photos',
    ],
    'faqs'       => [
      ['Can relatives abroad watch the ceremony live?', 'Yes. We provide a private viewing link or a public YouTube or Facebook stream that works on phones and tablets anywhere in the world, with a replay available immediately afterward. Many of our graduation streams are watched by family in Africa, the Caribbean and Europe.'],
      ['How do you make sure the right student is on screen when their name is called?', 'We attend the rehearsal, map the stage flow with your name reader and marshals, and position a dedicated close-up camera on the handshake mark. The technical director switches to that shot as each name is read, so the wall and the stream stay in sync with the ceremony.'],
      ['When should a school book for May or June?', 'Commencement season fills quickly. We recommend reserving your date four to six weeks ahead at minimum, and earlier for the last two weeks of May and the first week of June. A 30% retainer secures the date; the balance is due 14 days before the ceremony.'],
    ],
    'cta'        => 'Plan a graduation',
  ],

  'weddings' => [
    'name'       => 'Weddings & Receptions',
    'short'      => 'Weddings',
    'tagline'    => 'A cinematic record of your day, and a live stream for everyone who could not be in the room.',
    'meta_title' => 'Wedding Live Stream & Videography DMV | Nexus Live Media',
    'meta_desc'  => 'Wedding live streaming, multi-camera videography, LED screens and open-air photo booths for ceremonies and receptions in Washington DC, Maryland and Northern Virginia.',
    'image'      => 'events/wedding.jpg',
    'image_alt'  => 'Bride and groom dancing at a reception while a videographer films and an LED screen shows the live feed',
    'summary'    => 'We film and stream weddings with the discretion the ceremony deserves and the energy the reception calls for. Family overseas watches live through a private link, and you keep a polished recording and highlight film.',
    'intro'      => [
      'For many couples in the DMV, the most important guests are the ones who cannot get a visa in time or afford the flight. A private live stream lets parents, grandparents and friends in Lagos, Dakar, Port-au-Prince or Paris watch the vows as they happen, comment in real time and replay the ceremony later. The link is unlisted and shared only with the people you choose, and it works on any phone.',
      'Inside the venue, our crew directs for the ceremony rather than simply recording it. We cover the processional, the vows and the first look from the right angles without standing in the aisle, and we switch to a reception setup for speeches, the first dance and the entrance of the couple. Clean audio from the officiant and the toasts is captured with discreet wireless microphones, not from the back of the room.',
      'Add an LED wall to show the live feed or a slideshow to the whole ballroom, and an open-air photo booth with instant prints so guests leave with something in their hands. Photos are delivered in 48 hours and the 4K highlight film within 5 to 7 business days.',
    ],
    'services'   => ['special-events-video', 'live-video-production', 'photo-booth', 'led-screen-rental', 'audio-sound'],
    'highlights' => [
      'Private live stream link for family and friends abroad, with replay',
      'Ceremony-specific directing: processional, vows, rings and first look',
      'Discreet wireless microphones for the officiant, readings and toasts',
      'Open-air photo booth with instant prints, GIFs and a custom overlay',
      'LED screen for the live feed, a couple\'s slideshow or venue visuals',
      '4K highlight film in 5 to 7 business days, full edit on request',
    ],
    'faqs'       => [
      ['Will the camera crew be visible during the ceremony?', 'We keep a low profile. Cameras are placed at the sides and rear on tripods or a quiet gimbal, operators wear dark clothing, and we coordinate with your officiant and photographer so no one blocks the aisle or the first kiss.'],
      ['Can guests who miss the live stream watch it later?', 'Yes. The stream is recorded and the replay is available at the same private link right after the ceremony. You also receive the full-resolution recording within 24 to 48 hours through a secure cloud link you can share or keep private.'],
      ['Do you travel outside the DC area for weddings?', 'Yes. Travel is free within 35 miles of Washington DC, including Arlington, Alexandria, Bethesda and Silver Spring. Beyond that we bill $1.75 per additional mile, and we travel nationwide for destination weddings with a custom quote.'],
    ],
    'cta'        => 'Check your wedding date',
  ],

  'churches' => [
    'name'       => 'Churches & Faith Communities',
    'short'      => 'Churches & Faith',
    'tagline'    => 'Consistent, worship-ready production for Sunday services, conferences and conventions.',
    'meta_title' => 'Church Live Streaming & AV Washington DC | Nexus Live Media',
    'meta_desc'  => 'Live streaming, LED screens and sound reinforcement for churches, worship services, revivals and faith conferences in Washington DC, Maryland and Virginia.',
    'image'      => 'events/church.jpg',
    'image_alt'  => 'Choir on a warmly lit stage with live video on side screens and a broadcast camera in the aisle',
    'summary'    => 'Congregations expect to watch online every week and to see the stage clearly in the room. We deliver a stable multi-platform stream, screens that work for worship, and a setup your volunteers can live with.',
    'intro'      => [
      'A church stream has to work every single week, not just on the big Sunday. We build setups that are repeatable: fixed camera positions, a documented run sheet, clear audio from the pulpit and the choir, and a stream that goes to YouTube and Facebook at the same time so members can watch wherever they already are. For a special service, anniversary or revival, we scale up with more cameras and a larger LED wall without changing the workflow your team knows.',
      'Many congregations in the DMV serve families spread across several countries. A reliable stream with a replay lets a member in Silver Spring and a relative in Abidjan or Accra attend the same service. We run every stream on bonded multi-carrier cellular, so a sanctuary with weak Wi-Fi is not a problem, and the full recording is available within 24 to 48 hours for your archive or media ministry.',
      'We also train and support volunteer teams. If your church is ready to own a system, we can design it, install it and hand it over with documentation. If you prefer a crew on site, we bring the gear and operate it, and your ministry stays focused on the service.',
    ],
    'services'   => ['live-video-production', 'led-screen-rental', 'audio-sound', 'hybrid-conferencing', 'media-coverage'],
    'highlights' => [
      'Multi-platform streaming to YouTube, Facebook and your website at once',
      'Camera positions and run sheets your volunteers can repeat every week',
      'LED screens and side displays sized for sanctuaries and rented halls',
      'Wireless microphones for pastors, choirs, readers and guest speakers',
      'Bonded cellular internet, so the stream does not depend on building Wi-Fi',
      'Full service recordings in 24 to 48 hours for your media ministry',
    ],
    'faqs'       => [
      ['Can you stream to YouTube and Facebook at the same time?', 'Yes. We send one broadcast to several destinations simultaneously, including YouTube, Facebook, Vimeo and a player on your own website. Members watch on the platform they already use, and the replay is available on each of them after the service.'],
      ['Our sanctuary has no reliable internet. Can you still stream?', 'Yes. Every stream runs on our bonded gateway, which combines AT&T, Verizon and T-Mobile into one connection. We never depend on the building\'s Wi-Fi, and we record a full 4K master on site as a backup for any stream.'],
      ['Do you work with our existing volunteers and equipment?', 'Yes. We can integrate your current cameras, mixer or screens, fill the gaps with our gear, and train your volunteers on the run sheet. For churches that want to own a permanent system, we design, install and document it so your team can operate it week to week.'],
    ],
    'cta'        => 'Plan a service or conference',
  ],

  'cultural-celebrations' => [
    'name'       => 'Cultural Celebrations & Community Galas',
    'short'      => 'Cultural Celebrations',
    'tagline'    => 'Galas, anniversaries and cultural nights produced for the room and for family watching from home.',
    'meta_title' => 'Cultural Event Production DC Maryland Virginia | Nexus Live Media',
    'meta_desc'  => 'Live streaming, LED walls, sound, photo booths and printing for African diaspora galas, association anniversaries and cultural celebrations in the DMV.',
    'image'      => 'events/cultural.jpg',
    'image_alt'  => 'Guests in colorful traditional attire celebrating at a gala with a live feed on a large LED screen',
    'summary'    => 'Diaspora associations, cultural organizations and community groups across the DMV trust us with their biggest night of the year. We bring the screen, the sound, the stream and the photo booth, and we understand the audience.',
    'intro'      => [
      'A community gala in Silver Spring, Alexandria or Prince George\'s County is rarely just a dinner. It is an anniversary of an association, a fundraiser, a cultural showcase with music and dance, and a reunion for people whose families live on three continents. We produce it as a full show: an LED wall for the program, sponsor loops and live close-ups, a sound system that handles a live band and a keynote, and a stream so members abroad can join from the opening prayer to the last dance.',
      'We work comfortably in multilingual rooms. Programs that move between English, French, Spanish, Amharic or Yoruba need an audio setup ready for interpretation and a crew that follows the run of show without needing every cue in English. Our team has produced events for organizations with roots across West, Central and East Africa, the Caribbean and Latin America, and we plan with your committee rather than around it.',
      'The photo booth is often the most talked-about part of the night. Our open-air booth with a custom overlay, instant prints and GIF sharing keeps a line going all evening, and branded shirts, caps and banners from our print shop give sponsors and members something to keep. One vendor, one contract, one on-site lead for the whole celebration.',
    ],
    'services'   => ['led-screen-rental', 'live-video-production', 'audio-sound', 'photo-booth', 'printing-branding'],
    'highlights' => [
      'LED wall for the program, sponsor loops, tributes and live close-ups',
      'Sound for live bands, DJs, keynotes and multilingual programs',
      'Live stream with a private or public link for members and family abroad',
      'Open-air photo booth with a custom overlay, instant prints and GIFs',
      'Branded shirts, caps, mugs, banners and step-and-repeat backdrops',
      'Photos in 48 hours and a 4K highlight reel within 5 to 7 business days',
    ],
    'faqs'       => [
      ['Can the stream reach members in Africa, the Caribbean or Europe?', 'Yes. The stream runs on YouTube, Facebook or a private link that works on any phone, and the replay is available right away for different time zones. Many of our community events are watched by more people online than in the ballroom.'],
      ['We have a live band and several speakers. Can one sound system handle both?', 'Yes. We bring a digital console, wireless microphones for speakers and MCs, and inputs for the band and DJ, with a sound engineer at the console for the whole program. Interpretation-ready setups are available when the program runs in more than one language.'],
      ['Which package fits a 300-guest gala?', 'The Gala & Summit Immersion package, starting at $7,850, is our most popular for events up to 300 guests. It includes a 10×6 ft LED wall, a three-camera live stream, full PA with six wireless microphones, a four-hour Signature print photo booth, photography and a 90-second 4K highlight film.'],
    ],
    'cta'        => 'Plan a community event',
  ],

];
