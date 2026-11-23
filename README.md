# 🧩 Brogaard Suite

**En lynhurtig, moderne og samlet Mailcow-suite med Webmail (`IMAP/SMTP/ManageSieve`), Webkalender (`CalDAV`) og Adressebog (`CardDAV`) — bygget med fælles Single Sign-On, 11 røgfarvede glas-temaer, tastaturvenlige Copy/Paste-workflows, offline PWA-understøttelse og enterprise-grade sikkerhed.**

---

## 🎯 Vision & Filosofi

**Brogaard Suite** erstatter behovet for den tunge klassiske SOGo-brugerflade ved at samle alle tre søjler fra Mailcow i én hurtig, sammenhængende og brugervenlig Vue 3 web-applikation — uden en tung server-database:

* **✉️ Mail (`IMAP` / `SMTP` / `ManageSieve`):** Direkte opkobling mod Dovecot/Postfix og port `4190`. Inkluderer smart afsender-alias styring, `Ctrl+C`/`Ctrl+X`/`Ctrl+V` mellem mapper, global søgning i alle mapper, Rich-Text/HTML editor med Smart Dark-Mode kontrast og Rspamd spam/ham-træning.
* **📅 Kalender (`CalDAV`):** 5 fleksible visninger (**År**, **Måned**, **Uge**, **Dag**, **Liste**), danske ugenumre, Excel-lignende `Ctrl+C`/`Ctrl+X`/`Ctrl+V` på tværs af dage, 1-kliks Danske Helligdage, `.ics`/`webcal://`-abonnementer, mødesikkerhed og offentlige Read-Only delingslinks (`?share=<token>`).
* **👥 Kontakter (`CardDAV`):** Fuld tovejs-synkronisering af dine Mailcow/SOGo-adressebøger (`personal` m.fl. inkl. mobil-kontakter), grupper/tags, instant søgning, fødselsdage og import/eksport af `.vcf` (vCard 3.0).

---

## ⚡ Kryds-Integration ("Suite-Superkræfter")

Når Mail, Kalender og Kontakter bor under samme tag med ét fælles login, arbejder de direkte sammen:

1. **Én samlet Single Sign-On session:** Log ind én gang med din Mailcow e-mail og adgangskode — øjeblikkelig adgang til både Mail, Kalender og Kontakter. Skift mellem moduler på 0,1 sekund med venstre App-Rail eller `Alt+1`, `Alt+2`, `Alt+3`.
2. **1-Kliks `.ics` Mødeinvitation & Konflikttjek i Mail:** Når du modtager en kalenderinvitation (`.ics`) på e-mail, tjekker suiten øjeblikkeligt din CalDAV-kalender for overlap/konflikter (*"Tidspunktet er ledigt"* eller *"⚠️ Konflikt med ..."*) og lader dig tilføje begivenheden direkte til en valgt kalender med ét klik.
3. **Auto-Complete på Kontakter:** Når du skriver en e-mail (`Til`, `CC`, `BCC`) eller inviterer deltagere til et kalendermøde, foreslås dine Mailcow CardDAV-kontakter automatisk mens du taster.
4. **"Gem afsender i kontakter" & "Opret aftale fra e-mail":** Tilføj nye afsendere direkte til din adressebog med ét klik i mailvisningen, eller konvertér en e-mail til en kalenderaftale via værktøjslinjen eller højrekliksmenuen.
5. **Automatisk Fødselsdagskalender:** Kontakter med registreret fødselsdag vises automatisk som pink heldagsbegivenheder (inkl. alder) i alle 5 kalendervisninger (kan slås til/fra i kalenderens sidepanel).
6. **"Send e-mail" fra Kontaktkortet:** Klik på en kontakts e-mailadresse eller knap i Kontakter for straks at åbne ny e-mail med modtageren udfyldt.

---

## 🔒 Sikkerhed & Hærdning (Security)

* **Fælles AES-256-GCM HttpOnly Session Cookie:** Legitimationsoplysninger gemmes aldrig i browserens `localStorage`. De krypteres med AES-256-GCM på serveren og opbevares i én sikker `HttpOnly`, `SameSite=Lax` cookie på `/api`.
* **DOMPurify HTML-Sanitering & Tracking-kontrol:** Indgående HTML-mails renses strengt mod XSS (`<script>`, `<iframe>`, `<object>`, `<form>` fjernes) før visning, og eksterne billeder kan skjules/vises med ét klik.
* **SSRF- & Origin-validering:** Mail-, CalDAV-, CardDAV- og abonnementskald valideres mod lokale loopback-, link-local- og cloud-metadata-adresser. Offentlige kalenderdelingslinks (`?share=<token>`) er låst til udelukkende at læse fra ejerens autentificerede server.
* **Rate Limiting & OWASP Headers:** Brute-force-beskyttelse på login, mail-afsendelse og offentlige delingslinks, samt streng Content Security Policy (`CSP`), `X-Frame-Options: DENY` og `Referrer-Policy: no-referrer`.
* **Container-sikkerhed:** Minimal Alpine Linux (`node:24-alpine`) med opdaterede OS-pakker, uden `npm`/`yarn`/`corepack` i runtime-imaget, afviklet under uprivilegeret bruger (`USER node`).

---

## ⌨️ Genvejstaster

### Globale Suite-genveje
| Handling | Genvej |
| :--- | :--- |
| **Skift til Mail** | `Alt + 1` |
| **Skift til Kalender** | `Alt + 2` |
| **Skift til Kontakter** | `Alt + 3` |
| **Luk aktiv modal / kontekstmenu** | `Esc` |

### Mail
| Handling | Genvej |
| :--- | :--- |
| **Skriv ny e-mail** | `Ctrl + N` |
| **Send e-mail (i editor)** | `Ctrl + Enter` |
| **Næste / Forrige e-mail** | `↓` / `↑` |
| **Kopiér / Klip / Indsæt i mappe** | `Ctrl + C` / `Ctrl + X` / `Ctrl + V` |
| **Markér alle / Fortryd (30 sek.)** | `Ctrl + A` / `Ctrl + Z` |
| **Flyt til papirkurv / Slet** | `Delete` / `Backspace` |

### Kalender & Kontakter
| Handling | Genvej |
| :--- | :--- |
| **Kopiér / Klip / Indsæt på valgt dag** | `Ctrl + C` / `Ctrl + X` / `Ctrl + V` |
| **Fortryd seneste handling (30 sek.)** | `Ctrl + Z` |
| **Slet valgt(e) begivenhed(er)** | `Delete` / `Backspace` |
| **Opret ny kontakt (i Kontakter)** | `Ctrl + N` |

---

## 🐳 Kørsel i Docker (Multi-Arch: `x86_64` & `ARM64`)

Projektet bygges automatisk via GitHub Actions til både **x86 (`linux/amd64`)** og **ARM (`linux/arm64`)** og udgives på GitHub Container Registry:
**`ghcr.io/mrbridgefarm/brogaard-suite:latest`**

### Hurtig start med `compose.yaml` (og `pangolin` netværk)

```bash
# 1. Sørg for at dit "pangolin" Docker-netværk findes:
docker network inspect pangolin >/dev/null 2>&1 || docker network create pangolin

# 2. Kopiér .env.example til .env og udfyld DEFAULT_MAIL_HOST
cp .env.example .env

# 3. Hent det seneste multi-arch image og start containeren:
docker compose pull
docker compose up -d
```

I **Pangolin** kan du pege direkte på **`http://brogaard-suite:3000`**. Se også [`compose.example.yaml`](compose.example.yaml).

### Miljøvariabler (`.env`)

| Variabel | Standard | Beskrivelse |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porten som webserveren og API-proxyen lytter på |
| `DEFAULT_MAIL_HOST` | *(tom)* | Din Mailcow-vært (f.eks. `mail.ditdomæne.dk`). Konfigurerer automatisk IMAP, SMTP, ManageSieve, CalDAV (`/SOGo/dav/`) og CardDAV (`/SOGo/dav/`) og skjules i login-skærmen |
| `DEFAULT_IMAP_HOST` | `DEFAULT_MAIL_HOST` | Valgfri separat IMAP-vært |
| `DEFAULT_IMAP_PORT` | `993` | Standard IMAP SSL/TLS port |
| `DEFAULT_SMTP_HOST` | `DEFAULT_MAIL_HOST` | Valgfri separat SMTP-vært |
| `DEFAULT_SMTP_PORT` | `465` | Standard SMTP SSL/TLS port |
| `DEFAULT_SIEVE_PORT` | `4190` | ManageSieve port |
| `DEFAULT_CALDAV_URL` | `https://<DEFAULT_MAIL_HOST>/SOGo/dav/` | Valgfri eksplicit CalDAV/CardDAV URL |
| `APP_MODULES` | `mail,calendar,contacts` | Styrer hvilke moduler der er aktiveret i suiten |
| `SOGO_URL` | *(tom)* | Valgfrit link til klassisk SOGo (f.eks. `https://mail.ditdomæne.dk/SOGo`), som giver brugere en genvej til frit at vælge mellem Brogaard Suite og SOGo |
| `ALLOW_INSECURE_TLS` | `false` | Sæt til `true` ved selv-signerede certifikater på lokalt LAN |
| `SESSION_SECRET` | *(auto-genereret)* | Valgfri fast krypteringsnøgle til session-cookies og delingslinks |
| `DATA_DIR` | `/app/data` | Persistent mappe til krypteringsnøgle, aliaser, abonnementer og delingslinks |

---

## 🔗 Integration med Mailcow (Frit valg mellem Brogaard Suite & SOGo)

SOGo skal **fortsat køre** på din Mailcow-server (den leverer CalDAV/CardDAV-protokollerne i baggrunden), så dine brugere bevarer fuld frihed:

1. **I Brogaard Suite (`.env`):** Sæt f.eks. `SOGO_URL=https://mail.ditdomæne.dk/SOGo`. Så vises et diskret **"SOGo"**-link både på loginskærmen og nederst i sidepanelet, hvis nogen vil skifte til klassisk SOGo.
2. **I Mailcow UI (`data/web/inc/vars.local.inc.php`):** Tilføj en genvej direkte i Mailcow's brugerpanel, så man kan vælge mellem **Brogaard Suite** og **SOGo**:

```php
<?php
$CUSTOM_APPS[] = array(
  'name' => 'Brogaard Suite',
  'link' => 'https://suite.ditdomæne.dk',
  'description' => 'Moderne Webmail, Kalender & Kontakter',
  'blank' => true
);
```

Genstart derefter `php-fpm-mailcow`:
```bash
docker compose restart php-fpm-mailcow
```

---

## 🛠️ Teknologisk Stack

* **Frontend:** Vue 3 (Composition API) + TypeScript + Vite 6 + Tailwind CSS + Pinia + Dexie.js (IndexedDB) + VitePWA + FullCalendar (`dayGrid`, `timeGrid`, `list`, `interaction`) + specialbygget `YearView` + DOMPurify.
* **Backend:** Node.js 24 + Express 5 + TypeScript + `imapflow` + `mailparser` + `nodemailer` + ManageSieve (`node:net`/`node:tls`) + `tsdav` + `ical.js` + direkte CalDAV/CardDAV XML & vCard 3.0 engine.
