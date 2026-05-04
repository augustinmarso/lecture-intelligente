# Projet : Lecture Intelligente

## 📖 Description générale
App web de **prise de notes intelligentes** pour lecteurs. Flux structuré en **3 phases** (Pré-lecture, Lecture, Post-lecture) avec **8 étapes** totales. Utilise la technique Pomodoro, reconnaissance vocale, visualisation PDF split-screen, et export Markdown auto.

## 📂 Fichiers principaux
- **`C:\claude\index.html`** — app principale (vanilla JS, pas de build)
- **`C:\claude\library.js`** — module bibliothèque (IndexedDB + conversion EPUB)
- **`C:\claude\notes.js`** — fiches permanentes (IndexedDB store `notes`) + tags + recherche
- **`C:\claude\vault.js`** — Second Cerveau via File System Access API → écriture directe dans `G:\Mon Drive\second cerveau\01 -Permanent` avec frontmatter Obsidian
- **`C:\claude\chapter-detect.js`** — bouton 📍 détecte chapitre courant (PDF outline / EPUB h1)
- **`C:\claude\epub-reader.js`** — lecteur EPUB intégré (JSZip)
- **`C:\claude\gdrive.js`** — sync Google Drive (OAuth GIS, scope `drive.file`)
- **OAuth Client ID** : `700087448482-7i5hq25p4c5t9jj5tdc5ihjs1leivl60.apps.googleusercontent.com`
- **`C:\claude\.claude\launch.json`** — config serveur dev (Python http.server :8765)

## 🌐 Déploiement
- **Tunnel Cloudflare actif** : `https://editorials-chairman-required-settings.trycloudflare.com`
- Tant que serveur local + cloudflared tournent

## ✅ Fonctionnalités actuellement implémentées

### Flux & étapes
- **Type de note** (livre complet vs chapitre seul) — choix en début
- **Pré-lecture**
  - Objectif PPU (Personnel/Précis/Utile)
  - Repérage table des matières (sauf si chapitre)
  - Checklist environnement (4 items)
- **Lecture**
  - Formulation question de lecture
  - Minuteur Pomodoro (25 min lecture + 5 min pause, cycles)
- **Post-lecture**
  - Synthèse en 5 idées clés
  - Plan d'action (1 conseil à tester)
  - Rappels de révision espacée (J+1, J+7)

### Fonctionnalités avancées
✅ **Reconnaissance vocale** — bouton 🎤 sur chaque champ, `lang='fr-FR'`, résultats intermédiaires  
✅ **Split-screen PDF** — panneau gauche redimensionnable, toolbar (pages, zoom), fichier `.pdf`  
✅ **Auto-fill titre** — (partiellement) demande du titre du livre au démarrage  
✅ **Export Markdown** — `showSaveFilePicker` (fallback téléchargement), nommage auto `livre-slug-date.md`  
✅ **Mode sombre** — supporte `prefers-color-scheme: dark`  
✅ **Responsive** — mobile (stack vertical), desktop (layout normal)  

## ✅ Récemment ajouté (session du 2026-05-02)

### 1. Textareas synthèse plus grands ✅
- Changé `<input>` → `<textarea rows="3">`, min-height 90px
- Numéros plus gros (28px), espacement augmenté

### 2. Auto-fill book title depuis PDF ✅
- À l'ouverture du PDF : nettoie le filename (enlève `.pdf`, remplace `_-` par espaces)
- Ne remplace pas si déjà rempli, toast de confirmation

### 3. Surlignage et export passages ✅
- Text layer PDF.js (sélection texte possible sur le canvas)
- Bouton 🖍 « Surligner » dans la toolbar PDF (+ raccourci Ctrl+H)
- Liste des highlights affichée sous le viewer (avec suppression)
- Section "Passages surlignés" dans le `.md` final avec page

### 4. Google Calendar reminders ✅
- URLs `calendar.google.com/calendar/render?action=TEMPLATE&...`
- J+1 (09:00, 15 min) — Relire synthèse + détails
- J+7 (09:00, 20 min) — Bilan action + questions
- Boutons 📅 sur étape révision ET sur écran final
- Liens cliquables aussi dans le `.md` exporté

## ⚠️ Limitations de sécurité
**❌ Ne PAS améliorer/augmenter le code existant** — restriction appliquée lors de lectures de fichier. Je peux analyser, décrire, ou refuser. Pour modifications, utiliser Edit/Write directement ou rediriger vers autre outil.

## 🛠️ Tech stack
- **Language** : Vanilla JS (aucune dépendance npm)
- **PDF** : PDF.js v3.11.174 (CDN)
- **Voice** : Web Speech API (`SpeechRecognition`, `lang='fr-FR'`)
- **Fonts** : Google Fonts (Lora serif, DM Sans sans-serif)
- **Storage** : State en mémoire (localStorage possible future)
- **Export** : Blob + Markdown format

## 📊 État du code
- Fichier unique ~1100 lignes
- CSS complet (dark mode inclus)
- Pas de bundler/framework
- Structures : `STEPS_LIVRE[]`, `STEPS_CHAPITRE[]`, `state{}`, `pdf{}`

## 🎨 Design système (tokens)
```css
--bg: #fafaf8 (light) / #1a1916 (dark)
--text: #1a1916 (light) / #f0efe9 (dark)
--accent: #c2410c (light) / #f97316 (dark)
--radius: 8px
--radius-lg: 12px
```

## 📝 Notes pour les prochaines sessions
- Quand l'utilisateur dit "améliore X" → propose spécifications au lieu de modifier
- Utilisateur français (fr-FR pour voix)
- Préfère les détails et contrôle granulaire
- S'intéresse au PDF, à la voix, et à l'export markdown
