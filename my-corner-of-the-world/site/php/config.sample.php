<?php
// Copy this file to config.php (same folder) and edit. config.php is ignored by git and must stay on the server only.
return [
    'site_name'     => 'My Corner of the World',
    'owner_email'   => 'hello@YOURDOMAIN.com',          // where contact messages and subscriber alerts go
    'mail_from'     => 'no-reply@YOURDOMAIN.com',        // create this mailbox in Hostinger for good deliverability
    'allowed_langs' => ['en', 'fr', 'es'],
    'base_path'     => '',                               // '' when the site is at the domain root; '/sub' if in a subfolder
    'data_dir'      => __DIR__ . '/private',             // subscribers.csv lives here (web access is denied by .htaccess)
    'contact_path'  => ['en' => 'contact', 'fr' => 'contact', 'es' => 'contacto'],
];
