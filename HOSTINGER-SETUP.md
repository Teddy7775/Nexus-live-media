# Guide de déploiement — Nexus Live Media sur Hostinger

## 1. Fichiers à uploader

Connectez-vous au **hPanel Hostinger** → **Gestionnaire de fichiers** → dossier `public_html`.

Uploadez les fichiers suivants dans `public_html/` :

| Fichier local | Destination sur le serveur |
|---|---|
| `index.php` | `public_html/index.php` |
| `.htaccess` | `public_html/.htaccess` |
| `robots.txt` | `public_html/robots.txt` |
| `sitemap.xml` | `public_html/sitemap.xml` |

> **Note :** Le fichier `submissions.log` sera créé automatiquement par PHP lors du premier envoi du formulaire. Il est protégé par `.htaccess` (accès web bloqué). Pour une sécurité renforcée, déplacez-le un niveau au-dessus de `public_html` et mettez à jour le chemin `$logPath` dans `index.php` (voir section 5).

---

## 2. Configuration Email (CRITIQUE)

### Créer l'adresse d'expédition
1. Dans hPanel → **Emails** → **Comptes Email**
2. Créer l'adresse : `no-reply@nexuslivemedia.com`
3. Notez bien le mot de passe (même si PHP `mail()` ne l'utilise pas directement, le compte doit exister pour que le domaine soit valide)

### Enregistrement SPF (DNS)
Dans hPanel → **DNS** → **Zone DNS**, ajoutez ou modifiez l'enregistrement TXT :

```
Type : TXT
Nom  : @
Valeur : v=spf1 include:spf.hostinger.com ~all
```

> Si vous utilisez un service externe (SendGrid, Brevo), ajoutez également leur entrée `include:`.

### DKIM
1. hPanel → **Emails** → **Sécurité Email**
2. Activez **DKIM** pour `nexuslivemedia.com`
3. Hostinger génère automatiquement la clé et l'ajoute à votre DNS

### DMARC (recommandé)
Ajoutez un enregistrement TXT dans votre DNS :

```
Type  : TXT
Nom   : _dmarc
Valeur: v=DMARC1; p=none; rua=mailto:executive@nexuslivemedia.com
```

### Important
PHP `mail()` fonctionne mieux quand le domaine de l'expéditeur (`MAIL_FROM`) correspond au domaine hébergé sur le même serveur. C'est pourquoi `no-reply@nexuslivemedia.com` est utilisé comme expéditeur.

---

## 3. Version PHP

1. hPanel → **Sites Web** → votre domaine → **PHP Configuration**
2. Sélectionnez **PHP 8.1** ou **PHP 8.2**
3. Cliquez sur **Enregistrer**

> Les fonctions utilisées dans le code (`bin2hex`, `random_bytes`, `quoted_printable_encode`, `match`, `fn()`) requièrent PHP 7.4 minimum — PHP 8.1/8.2 est recommandé.

---

## 4. SSL / HTTPS

1. hPanel → **Sites Web** → votre domaine → **SSL**
2. Activez le **SSL gratuit Let's Encrypt** si ce n'est pas déjà fait
3. Le fichier `.htaccess` inclus force automatiquement la redirection HTTP → HTTPS (301)
4. Attendez la propagation DNS (quelques minutes à 24h) avant de tester

---

## 5. Protection du fichier de log

Le fichier `submissions.log` stocke chaque envoi de formulaire.

**Situation actuelle :** il est créé dans `public_html/` et protégé par `.htaccess` (toute tentative d'y accéder via le navigateur retourne une erreur 403).

**Situation idéale (production) :**
1. Déplacez le log un niveau au-dessus de `public_html` :
   ```
   /home/u123456789/submissions.log   (hors public_html)
   ```
2. Dans `index.php`, modifiez la ligne `$logPath` :
   ```php
   // Avant :
   $logPath = __DIR__ . '/submissions.log';
   // Après :
   $logPath = dirname(__DIR__) . '/submissions.log';
   ```
3. Vérifiez que PHP a les droits d'écriture sur ce dossier parent

---

## 6. Test du formulaire

Après déploiement, suivez ces étapes :

1. **Visitez** `https://nexuslivemedia.com/` — vérifiez que le site s'affiche correctement
2. **HTTPS** — vérifiez le cadenas dans la barre d'adresse
3. **Formulaire** — remplissez tous les champs obligatoires (Nom, Email, Service) et soumettez
4. **Email reçu** — vérifiez la boîte de `executive@nexuslivemedia.com` (et `theonana@nexuslivemedia.com` en CC)
5. **Log** — vérifiez que `submissions.log` a été créé avec une ligne de log
6. **Honeypot** — inspectez le code source de la page : le champ `company` doit être hors écran et invisible
7. **CSRF** — tentez de soumettre le formulaire avec un token invalide : vous devriez voir le message d'erreur de sécurité
8. **Rate limit** — soumettez 3 fois en moins de 10 minutes : la 4e tentative doit être bloquée

---

## 7. Si les emails n'arrivent pas

**Étape 1 — Vérifiez les logs Hostinger :**
- hPanel → **Emails** → **Journaux Email** ou **Logs d'erreur PHP**

**Étape 2 — Vérifiez le dossier spam :**
- Vérifiez le dossier spam/junk de `executive@nexuslivemedia.com`
- Ajoutez `no-reply@nexuslivemedia.com` aux contacts fiables

**Étape 3 — PHP `mail()` ne fonctionne pas :**
Certains hébergeurs désactivent `mail()`. Dans ce cas, passez à un service SMTP externe :

**Option A : SMTP Hostinger** (si disponible dans votre plan)
- Paramètres dans hPanel → **Emails** → **Configuration Email**

**Option B : Brevo (ex-Sendinblue)** — gratuit jusqu'à 300 emails/jour
```
SMTP Host : smtp-relay.brevo.com
Port      : 587
User      : votre email Brevo
Password  : votre clé API SMTP
```

**Option C : SendGrid** — fiable, plan gratuit disponible
```
SMTP Host : smtp.sendgrid.net
Port      : 587
User      : apikey
Password  : votre clé API SendGrid
```

> Pour utiliser SMTP avec PHP, installez la librairie **PHPMailer** via Composer, ou utilisez l'extension `mail()` configurée avec un relais SMTP dans `php.ini`.

---

## 8. Optimisations SEO

### Google Search Console
1. Allez sur [search.google.com/search-console](https://search.google.com/search-console)
2. Ajoutez la propriété `https://nexuslivemedia.com/`
3. Vérifiez la propriété via la méthode **Balise HTML** (copiez la meta tag dans `<head>` de `index.php`)
4. Soumettez le sitemap : `https://nexuslivemedia.com/sitemap.xml`

### Google Analytics (GA4)
1. Créez un compte sur [analytics.google.com](https://analytics.google.com)
2. Créez une propriété GA4 pour `nexuslivemedia.com`
3. Copiez le snippet `gtag.js` fourni
4. Collez-le dans `index.php` juste avant `</head>`

### Google Business Profile
1. Créez ou revendiquez votre fiche sur [business.google.com](https://business.google.com)
2. Renseignez les horaires, photos, description, et numéro de téléphone
3. Demandez des avis clients après chaque événement réussi — utilisez-les pour remplacer les témoignages placeholder dans `index.php`

### Mises à jour du sitemap
- Mettez à jour `sitemap.xml` à chaque modification majeure du site
- Renvoyez le sitemap dans Google Search Console après chaque mise à jour
