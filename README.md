# 쏙쏙 어휘왕 · Vocab-King 👑
### TOPIK I Korean Vocabulary Mastery & Certification Platform
*Learn Korean. Learn Confidently.*

---

## 📌 Table of Contents
1. [Project Overview & Academic Background](#-project-overview--academic-background)
2. [Key Features](#-key-features)
3. [Accounts, Administrators & Security](#-accounts-administrators--security)
4. [Project Architecture & Directory Structure](#-project-architecture--directory-structure)
5. [Getting Started & Local Development](#-getting-started--local-development)
6. [Deployment (Netlify)](#-deployment-netlify-connected-to-github)
7. [Credits & Academic Attribution](#-credits--academic-attribution)

---

## 🌟 Project Overview & Academic Background

**쏙쏙 어휘왕 (Vocab-King)** is an interactive, gamified Korean vocabulary learning and certification platform specifically engineered for students preparing for the **TOPIK I (Test of Proficiency in Korean)** examination.

The application systematically covers all **1,470 essential TOPIK I vocabulary words** and **229 contextual example sentences** organized across 49 textbook units and structured into 5 intensive program days.

- **Project Initiator & Lead Developer**: **Alingilya Crispin Njewa**
- **Academic Supervisor & Course Evaluator**: **Prof. Hyejoon Yoon** (Korean Language Program, KyungDong University Global)

---

## 🚀 Key Features

- **📖 1,470 Essential Vocabulary Words**: Structured into 5 study days covering curriculum units 1–49.
- **🔊 Native Korean Speech Audio (`ko-KR`)**: Instant pronunciation using the browser's Web Speech API with no external API key required.
- **🧠 Study First Mode**: Review words, meanings, parts of speech, and sample sentences before taking quizzes.
- **🎯 Smart Quiz Engine**:
  - Intelligent part-of-speech matched distractors (nouns with nouns, verbs with verbs).
  - Four multiple-choice options with keyboard shortcuts (`1`, `2`, `3`, `4`, or `Enter`).
- **⚡ Fail Review Mode**: Automatically tracks incorrect answers and creates a focused review queue.
- **🔍 Searchable Dictionary**: Fast search across Korean headwords, English definitions, part of speech, and curriculum day.
- **🏆 Class Leaderboard & Cohorts**: Differentiates students by semester cohort (e.g., *2026 Spring*, *2025 Fall*, *Alumni*).
- **📜 Official TOPIK I Certificate**:
  - Automatically generated upon passing the final examination.
  - Features university insignia, custom seals, student metadata, and supervisor signature.
  - Printable and exportable.
- **📱 PWA & Offline Support**: Progressive Web App with service worker caching (`sw.js`) for reliable offline review.
- **🔑 Secure Accounts**: Email verification, welcome email, password reset, sign-in with Student ID or email.

---

## 🔐 Accounts, Administrators & Security

All data is stored in **Supabase** (free plan): profiles, progress, review words, exam results, cohorts,
certificate template, contact details and admin roles. The browser keeps only the sign-in session.

### Students
- **Register** with full name, Student ID, email, nickname (shown on the leaderboard) and a password.
- Every new student gets an automatic **welcome email** with a link to **verify** their account.
- **Sign in** with either the **Student ID** or the **email**, plus the password.
- **Forgot your password?** sends a reset link by email.

### Administrators
- Admins sign in with their own Supabase account (email + password) through the 🔐 button.
- Roles: **Super Admin** (manages admins, cohorts and settings) and **Academic / Co-Admin** (reviews students, cohorts, certificates).
- No passwords are stored in this repository.

### Setting up the database
Follow **[supabase/README.md](supabase/README.md)**. It covers running `supabase/setup.sql`, creating the first
Super Admin, email confirmation, free email sending (Gmail or Brevo SMTP) and the email templates.

The Supabase key in `app.js` is the public *anon* key, which is meant to be in the browser.
Access is enforced by Row Level Security: students can only read and write their own data,
scores go through server-side checks, and only admins can see the full roster.

---

## 📁 Project Architecture & Directory Structure

```text
topik_game/                        # repository root
├── index.html                     # Single-page app: screens, forms & modals
├── styles.css                     # Brand styling & animations
├── app.js                         # App logic: quiz engine, accounts, admin portal, TTS
├── vocab-data.js                  # 1,470 words, 229 sentences, synonym groups, logo
├── sw.js                          # Service worker (offline support)
├── manifest.json                  # PWA manifest
├── server.js                      # Local Node.js static server (development only)
├── netlify.toml                   # Netlify hosting settings
├── vk_logo.jpg                    # Vocab-King logo
└── supabase/
    ├── README.md                  # Step-by-step database & email setup
    ├── setup.sql                  # Tables, security rules & database functions
    └── email-templates/           # Welcome/verify and password-reset emails
```

---

## 💻 Getting Started & Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) (version 16 or newer recommended) or any modern web browser.

### Running the App Locally

1. **Clone or navigate to the project directory**:
   ```bash
   cd topik_game
   ```

2. **Start the local development server**:
   ```bash
   node server.js
   ```

3. **Open the application in your browser**:
   Navigate to:
   ```text
   http://localhost:3000/
   ```

*(Alternative: You can also use Python: `python -m http.server 3000`)*

---

## 🚀 Deployment (Netlify, connected to GitHub)

The live site is hosted on **Netlify** (free) and connected to this GitHub repository.
Every push to the `main` branch publishes the new version automatically in about a minute.

- There is no build step. Netlify serves the repository root as it is (see `netlify.toml`).
- To update the site, edit the files, test locally with `node server.js`, then commit and push to `main`.
- Netlify → **Deploys** shows each published version. You can roll back to an earlier deploy with one click.
- If the Netlify address changes, also update **Site URL** and **Redirect URLs** in Supabase
  (see [supabase/README.md](supabase/README.md)). Otherwise the verification and password-reset emails will link to the wrong place.

---

## 🎓 Credits & Academic Attribution

- **Initiator & Lead Developer**:  
  **Alingilya Crispin Njewa**  
  *Software Developer & Korean Language Learner*

- **Academic Supervisor & Course Evaluator**:  
  **Prof. Hyejoon Yoon**  
  *Korean Language Program Faculty & Certificate Signatory*  
  *KyungDong University Global, South Korea*

- **Academic Institution**:  
  **KyungDong University Global** (Goseong Campus, Gangwon-do, Republic of Korea)

---

*Made with ❤️ for Korean language students worldwide.*
