# 🌙 Bumpify — Site vitrine

Site officiel du bot Discord **Bumpify** : présentation, **104 commandes réelles** extraites
directement du code du bot, et **documentation avancée** (12 guides).

Next.js 15 (App Router) · React 19 · 100 % statique · **compatible Vercel** (zéro config).

---

## 🚀 Déployer sur Vercel

### Méthode 1 — GitHub (recommandé)
1. Pousse le dossier `site/` sur un repo GitHub (à la racine du repo, pas en sous-dossier).
2. Sur [vercel.com](https://vercel.com/new) : **Import Git Repository** → sélectionne le repo.
3. Vercel détecte Next.js automatiquement — clique **Deploy**. C'est tout.
4. Chaque `git push` redéploie automatiquement le site.

> 💡 Si tu déploies le repo entier du bot avec `site/` en sous-dossier, mets
> **Root Directory = `site`** dans les réglages du projet Vercel (Build & Output Settings).

### Méthode 2 — Ligne de commande
```bash
cd site
npm i -g vercel
vercel          # premier déploiement (liera le projet)
vercel --prod   # déploiement en production
```

### Méthode 3 — Drag & drop
Pas besoin de compte git : `npm run build` puis glisse le dossier sur
[vercel.com/new](https://vercel.com/new) via l'option **Deploy without Git** (ou utilise
[Vercel CLI](https://vercel.com/docs/cli)). Aucune variable d'environnement n'est requise.

---

## 🔄 Mettre à jour la liste des commandes

La page /commands est générée depuis `data/commands.json`, produit par un script qui
**importe le vrai code du bot** (`src/commands/**`) et lit chaque `SlashCommandBuilder` :

```bash
# depuis la racine du projet bot (avec src/ à côté de site/)
cd site && npm run generate:commands
```

Le script :
- extrait les **104 commandes réelles** (noms, descriptions, sous-commandes, options, choix, permissions) ;
- retombe sur une extraction statique si un module ne peut pas être importé (ex. `canvas` natif absent) ;
- **ne casse pas le build Vercel** : si le dossier `src/` du bot est absent (déploiement site seul),
  il conserve le `commands.json` déjà commité.

**Workflow conseillé** : à chaque ajout de commande dans le bot → `npm run generate:commands`
→ commit → push → le site se met à jour tout seul sur Vercel.

---

## 📚 Modifier la documentation

Les 12 guides vivent dans `lib/docs.js` (structure simple : blocs `h2`, `p`, `ul`, `callout`,
avec **gras** et `code` inline supportés). Ajouter un article :

1. Ajoute un objet `{ slug, group, emoji, title, desc, updated, body }` dans `DOCS`.
2. Le slug doit être unique — la page `/docs/<slug>` et la sidebar se génèrent automatiquement
   (`generateStaticParams` s'en occupe au build).

---

## 🛠️ Développement local

```bash
cd site
npm install
npm run dev        # http://localhost:3000
npm run build      # build de production (génère commands.json + site statique)
npm start          # sert le build
```

---

## 📁 Structure

```
site/
├── app/
│   ├── page.js              # Accueil (hero, stats, features, CTA)
│   ├── commands/page.js     # /commands — recherche + filtres par catégorie
│   ├── docs/page.js         # /docs — index des guides
│   ├── docs/[slug]/page.js  # /docs/<slug> — article (SSG)
│   ├── layout.js            # Header + footer + thème
│   └── globals.css          # Design system néon sombre
├── lib/docs.js              # Les 12 articles de documentation
├── data/commands.json       # Généré — les vraies commandes du bot
├── scripts/generate-commands.js  # L'extracteur
└── next.config.js
```

---

## 🔗 Personnaliser les liens

Les liens d'invitation et de support sont dans `app/layout.js` et `app/page.js`
(`client_id=1553442824765181962`, serveur de support `discord.gg/ts5mh326ew`).
Pense aussi à mettre l'URL du site déployé dans les « Liens » du portail développeur Discord.
