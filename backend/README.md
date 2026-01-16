# Backend API – PACA Incendies Dashboard

## QGIS2Web map integration via GitHub Releases

### Comment publier une nouvelle carte QGIS2Web

1. **Exporter la carte dans QGIS2Web (Leaflet)**
2. **Supprimer les couches inutiles** dans QGIS avant export
3. **Compresser le dossier exporté** en ZIP (ex: `qgis2web_paca_v1.zip`)
4. **Créer une Release sur GitHub**
   - Onglet "Releases" → "Draft a new release"
   - Tag: `mapsV0.1` (ou autre)
   - Titre: "Cartes QGIS2Web v0.1"
   - Description: "Export QGIS2Web du 16/01/2026, version allégée."
   - Uploader le ZIP comme asset
   - Publier la release
5. **Copier le lien de téléchargement direct du ZIP**
   - Exemple: `https://github.com/M-AIT-ICHOU/PACA_Incendies_Dashboard/releases/download/mapsV0.1/qgis2web_2026_01_15-20_41_40_640046.zip`
6. **Mettre à jour la variable d’environnement** dans `.env` :
   - `QGIS2WEB_EXPORT_ZIP_URL=<lien direct>`
7. **Redémarrer le backend**
   - Le ZIP sera téléchargé et décompressé automatiquement dans `backend/data/cartes/`

### Notes
- Le dossier `backend/data/cartes/` est ignoré dans git (pas de quota GitHub)
- Les utilisateurs du dashboard n’ont pas à télécharger le ZIP
- Pour mettre à jour la carte, il suffit de publier une nouvelle release et de changer l’URL

### Exemple de variable d’environnement
```
QGIS2WEB_EXPORT_ZIP_URL=https://github.com/M-AIT-ICHOU/PACA_Incendies_Dashboard/releases/download/mapsV0.1/qgis2web_2026_01_15-20_41_40_640046.zip
```
