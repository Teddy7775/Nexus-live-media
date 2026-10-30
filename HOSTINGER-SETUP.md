# Déploiement sur Hostinger — nexuslivemedia.com

Site multi-pages en PHP 8 (aucune base de données, aucune dépendance). Tout se configure dans **`includes/config.php`**.

## 1. Structure

```
public_html/
├── index.php                 Accueil
├── services.php              Hub services  → /services
├── services/*.php            8 pages services (ex. /services/led-screen-rental)
├── events.php                Hub événements → /events
├── events/*.php              5 pages par type d'événement
├── pricing.php  about.php  faq.php  contact.php  thank-you.php  404.php
├── fr.php                    Page communauté francophone → /fr
├── includes/                 Config, helpers, header/footer, données, formulaire (bloqué par .htaccess)
├── assets/css, assets/js, assets/img
├── tools/                    Pipeline images (Node) + routeur de prévisualisation locale
├── .htaccess  .user.ini  robots.txt  sitemap.xml  favicon.ico  apple-touch-icon.png
```

Les URL sont « propres » (`/pricing`, pas `/pricing.php`) grâce au `.htaccess`. `www.nexuslivemedia.com` et `http://` redirigent en 301 vers `https://nexuslivemedia.com`.

## 2. Mise en ligne

**Option A — Git (recommandé)** : hPanel → *Avancé* → *Git* → déployer le dépôt `Teddy7775/Nexus-live-media`, branche `main`, dans `public_html`. Chaque fusion sur `main` redéploie le site.

**Option B — Gestionnaire de fichiers** : uploader tout le dépôt dans `public_html` **sauf** `tools/node_modules`, `.claude`, `photobooth/`. Supprimer l'ancien `photo-booth-tiers.jpg` à la racine (il est maintenant dans `assets/img/`).

Ensuite, dans hPanel → *Sites web* → *Configuration PHP* : choisir **PHP 8.2 ou 8.3** (le code utilise des fonctionnalités 8.1+).

## 3. À renseigner dans `includes/config.php`

| Constante | Quoi mettre |
|---|---|
| `GA_MEASUREMENT_ID` | l'ID GA4 `G-XXXXXXXXXX` (analytics.google.com → Admin → Flux de données). Vide = aucun script chargé. |
| `GSC_VERIFICATION` | facultatif : la valeur de la balise HTML Search Console (le domaine est déjà vérifié par DNS). |
| `SOCIAL[...]` | vos URL Instagram, Facebook, YouTube, LinkedIn, TikTok. Seules les non vides s'affichent. |
| `GOOGLE_BUSINESS_URL` | le lien « Rédiger un avis » de votre fiche Google Business. |
| `WHATSAPP_E164` | numéro WhatsApp (chiffres seulement). Vide = boutons WhatsApp masqués. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | facultatif : Cloudflare Turnstile (anti-bot gratuit, sans puzzle). |
| `EMAIL_TO`, `EMAIL_CC`, `MAIL_FROM` | déjà remplis ; `no-reply@nexuslivemedia.com` doit exister comme boîte mail. |

## 4. Formulaire de devis : sécurité et fichiers créés

Le formulaire (`/contact`) est traité par `includes/form-handler.php`. Protections actives :

1. **Jeton signé** (HMAC) avec âge minimum de 4 s et expiration 6 h — plus de session PHP, donc les pages sont cacheables par le CDN.
2. **Pot de miel** (champ `fax_line` invisible).
3. **Vérification d'origine** (Origin/Referer = nexuslivemedia.com).
4. **Limite par IP** : 3 envois / 15 min, 10 / jour.
5. **Refus des liens** dans le message (les robots en mettent toujours).
6. **Filtre de contenu** : mots-clés publicitaires (SEO, backlink, wholesale, 广告, 推广…), messages majoritairement en caractères chinois/japonais/coréens/cyrilliques, noms aberrants → **rejet silencieux** (le robot voit une page « merci », rien n'est envoyé).
7. **Domaine email vérifié** (enregistrement MX/A).
8. Turnstile Cloudflare si les clés sont renseignées.

Fichiers créés automatiquement **un niveau au-dessus de `public_html`** (jamais accessibles par le web) :

```
/home/uXXXXXXXX/.nlm-form-secret     clé de signature (générée au 1er chargement)
/home/uXXXXXXXX/submissions.log      demandes envoyées
/home/uXXXXXXXX/blocked-spam.log     spam bloqué, avec la raison — à consulter si un vrai client dit n'avoir pas pu envoyer
/home/uXXXXXXXX/form-errors.log      échecs de mail()
/home/uXXXXXXXX/ratelimit/           compteurs par IP
```

Pour ajuster les règles : constantes `SPAM_WORDS`, `RATE_LIMIT_*`, `FORM_MIN_SECONDS` dans `config.php`.

## 5. Email : éviter le spam et les usurpations

- SPF actuel : `v=spf1 include:_spf.mail.hostinger.com ~all` ✔
- DKIM actif (sélecteur `hostingermail1`) ✔
- DMARC actuel : `p=none`. Après 2 à 4 semaines de rapports propres, passer à :
  `v=DMARC1; p=quarantine; rua=mailto:executive@nexuslivemedia.com; adkim=r; aspf=r`
  puis à `p=reject`. Cela bloque les emails qui usurpent `@nexuslivemedia.com`.
- Les spams « annonceurs » reçus directement dans la boîte (hors formulaire) : hPanel → *Emails* → *Filtres anti-spam* ; créer une règle sur les mots « advertising », « SEO », « wholesale », et une règle sur les caractères chinois dans l'objet.

## 6. Checklist après mise en ligne

1. `https://nexuslivemedia.com/` s'affiche, cadenas HTTPS, favicon visible.
2. `http://www.nexuslivemedia.com/pricing` → redirige vers `https://nexuslivemedia.com/pricing`.
3. `https://nexuslivemedia.com/includes/config.php` → **403**.
4. Menu mobile : ouvrir sur un téléphone, les sous-menus Services / Events se déplient.
5. Formulaire : envoyer une vraie demande → email reçu sur `executive@` et `theonana@`, page `/thank-you`, ligne dans `submissions.log`.
6. Formulaire : envoyer un message contenant `http://` → message d'erreur « remove web links ».
7. Partager le lien sur WhatsApp : l'image de prévisualisation (`og.jpg`) apparaît.
8. Search Console → *Sitemaps* → envoyer `https://nexuslivemedia.com/sitemap.xml`, puis *Inspection d'URL* → *Demander l'indexation* pour l'accueil, `/services`, `/pricing`, `/fr`.

## 7. Images

Les visuels sont générés par IA (Kling) et optimisés par `tools/optimize-images.mjs` (JPG + WebP en 800/1600/1920 px). Pour remplacer une image par une vraie photo d'événement :

```bash
cd tools && npm install
node optimize-images.mjs  /chemin/vers/vos/photos   # noms attendus dans tools/images.json
```

Dès que vous avez de vraies photos et vidéos, remplacez les visuels : c'est ce qui convertit le mieux.

## 8. Prévisualisation locale

```bash
php -S 127.0.0.1:8080 -t . tools/dev-router.php
```
puis ouvrir `http://127.0.0.1:8080/`.
