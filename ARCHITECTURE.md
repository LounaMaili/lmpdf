# Architecture v1 (MVP)

## Principe

Approche "fond scanné + champs superposés" pour garantir fidélité visuelle sans conversion CSS complète du document.

## Composants

1. **Frontend (React)**
   - éditeur visuel (canvas)
   - positionnement précis des champs
   - sauvegarde d'un template

2. **Backend (NestJS)**
   - API upload/template
   - stockage métadonnées
   - orchestration des jobs

3. **Vision service (Python / apps/vision)**
   - détection assistée des zones (futur)
   - OCR/table detection

4. **Infra**
   - PostgreSQL (métadonnées)
   - Redis (jobs)
   - Garage S3-compatible (fichiers source + sorties)
