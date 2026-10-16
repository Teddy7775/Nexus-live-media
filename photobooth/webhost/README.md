# Web host receiver (for QR codes and email links that work from anywhere)

These files go on **your own web hosting** (for example the Hostinger plan that runs nexuslivemedia). The booth uploads each
guest's gallery here, and the QR code / email link opens it. Guests only ever see their own private, unguessable address.

```
booth PC  --signed upload-->  https://yourdomain.com/booth/upload.php  -->  /booth/s/<token>/index.html, final.jpg, ...
guest's phone  --QR / email link-->  https://yourdomain.com/booth/s/<token>/
```

## Set up (about 10 minutes)

The menu names below are from general knowledge of Hostinger's panel and may differ slightly on your account.

1. In your hosting panel open **File Manager** and, inside `public_html`, create a folder named `booth`.
2. Upload these four files into it: `upload.php`, `cleanup.php`, `.htaccess`, `config.sample.php`.
3. Rename `config.sample.php` to **`config.php`** and edit it: replace the placeholder with your own long random secret.
   Make one on the booth PC with:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
4. On the booth PC set the same secret as the environment variable **`BOOTH_UPLOAD_SECRET`** (preferred, so it is not in a file)
   and add this to `config.json`:

   ```json
   "sharing": {
     "enabled": true,
     "mode": "upload",
     "publicBaseUrl": "https://yourdomain.com/booth",
     "upload": { "url": "https://yourdomain.com/booth/upload.php" }
   }
   ```
5. Start the booth, open the operator panel and press **Check web host** on the Sharing card. It should say "Web host reachable".
   If it does not, the message says why (wrong URL, wrong secret, the PC clock is off by more than 10 minutes, folder not writable).
6. **Delete old galleries automatically.** In the panel's **Cron Jobs**, add a daily job running
   `php /home/<your-user>/domains/<your-domain>/public_html/booth/cleanup.php 30`
   (the path is shown in File Manager). `30` is the number of days to keep galleries.

## Optional: the "thank you" page for card payments

If guests pay by card (`payments.provider: "stripe"`), their phone shows a page after paying. Upload `paid.html` next to `upload.php` and set `payments.stripe.returnUrl` to its address, e.g. `https://example.com/booth/paid.html`. It is a plain static page with no scripts; it only tells the guest to look at the booth screen.

## Check these yourself before an event

These rely on the web server reading `.htaccess`, which could **not** be tested where this was developed. Open each address in a browser:

- `https://yourdomain.com/booth/config.php` must show **nothing** or "forbidden" - never a secret.
- `https://yourdomain.com/booth/s/` must **not** list folders.
- `https://yourdomain.com/booth/cleanup.php` must show "forbidden" or nothing.
- After a test session, the QR code on the print opens the guest gallery on your phone **on mobile data (not the venue Wi-Fi)**.

## Privacy and security

- A gallery address contains 128 random bits. It cannot be guessed or listed, but **anyone who has the link can open it**.
- Only a booth that knows the secret can upload; every upload is signed, so it cannot be altered or replayed after 10 minutes.
- The receiver stores only fixed file names (`index.html`, `final.jpg`, `shot-N.jpg`, `animation.gif`), checks that images really are images, and refuses anything else, so it cannot be used to put scripts on your site.
- Tell guests how long photos are kept (the cleanup job above) and where to ask for removal. To remove one gallery early, delete its folder under `booth/s/`.

## What it needs

PHP 7.4 or newer (tested on 8.3) and a writable `booth` folder. No database.
