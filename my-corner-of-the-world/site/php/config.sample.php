<?php
// Copy this file to config.php (same folder) and edit. config.php is ignored by git and must stay on the server only.
// Until owner_email and mail_from are filled in, the contact form reports an error instead of pretending to send. The newsletter form
// still stores the addresses (api/private/subscribers.csv) but sends no alert e-mail.
return [
    'site_name'     => 'My Corner of the World',
    'owner_email'   => '',                               // REQUIRED: the address that receives contact messages and subscriber alerts
    'mail_from'     => '',                               // REQUIRED: a mailbox on your own domain (create it in hPanel > Emails) for good deliverability
    'allowed_langs' => ['en', 'fr', 'es'],
    'base_path'     => '',                               // set by the site generator to this project's URL prefix; '' when the site is at the domain root
    'data_dir'      => __DIR__ . '/private',             // subscribers.csv lives here (web access is denied by .htaccess)
    'contact_path'  => ['en' => 'contact', 'fr' => 'contact', 'es' => 'contacto'],
];
