# Déploiement PostGIS (en ligne) — GitHub → Vercel/Render + Supabase

Objectif : après un `git push`, le front (Vercel) et l’API (Render) se redéploient automatiquement. La base PostGIS (Supabase) reste persistante.

## 1) Base PostGIS (Supabase)

1. Créer un projet Supabase.
2. Récupérer la chaîne de connexion **DATABASE_URL** (Settings → Database → Connection string).
3. Activer PostGIS (Supabase l’active généralement). Sinon exécuter :
   - `create extension if not exists postgis;`

## 2) Import des données (à faire une seule fois)

### 2.1 Installer les dépendances backend

Depuis `backend/` :
- `pip install -r requirements.txt`

### 2.2 Importer le CSV incendies dans Postgres

- Définir `DATABASE_URL` (ex: variable d’environnement)
- Lancer :
  - `python scripts/import_fires_csv.py`

### 2.3 Importer les communes (INSEE) depuis le GeoJSON simplifié

- Lancer :
  - `python scripts/import_communes_geojson.py`

Notes :
- Ce script importe seulement `insee` + `nom` (suffisant pour faire les jointures par code INSEE).
- Plus tard, on pourra ajouter la géométrie dans PostGIS (pour tuiles vectorielles / choroplèthes côté serveur).

## 3) Déployer l’API Flask (Render)

Recommandé : Render (ou Railway/Fly.io) plutôt que Replit pour Postgres.

1. Créer un nouveau service Web Render depuis le repo GitHub.
2. Root directory : `backend`
3. Build command :
   - `pip install -r requirements.txt`
4. Start command :
   - `python main.py`
5. Variables d’environnement Render :
   - `DATABASE_URL=...` (Supabase)
   - `PORT=8000` (Render fournit souvent PORT automatiquement)
   - Optionnel : `DEPARTEMENTS=04,05,06,13,83,84`
   - Optionnel : `MAX_FIRES=500`

Endpoints utiles :
- `/api/health`
- `/api/fires`
- `/api/stats`
- `/api/metrics/insee` (agrégats par code INSEE pour jointure côté front)

## 4) Déployer le Front Next.js (Vercel)

1. Importer le repo GitHub dans Vercel.
2. Root directory : `nextjs-dashboard`
3. Variable d’environnement Vercel :
   - `NEXT_PUBLIC_API_URL=https://<ton-api-render>.onrender.com`

## 5) Flux “push → online”

- Push GitHub → Vercel rebuild (front)
- Push GitHub → Render rebuild (API)
- DB Supabase persistante (pas de reload CSV à chaque deploy)

## 6) Jointures CSV + visualisation

Vu que le CSV contient `Code INSEE` et les couches ont `insee`, la jointure est directe :
- API calcule les agrégats par `insee` (Postgres)
- Front applique une choroplèthe (MapLibre) via `feature-state` ou via une propriété de style.
