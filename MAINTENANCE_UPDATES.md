# MAINTENANCE_UPDATES.md

Guide de maintenance et mise à jour des dépendances pour LMPdf.

## État des dépendances (Février 2026)

### Vision (Python)
- `opencv-python-headless`: 4.10.0.84
- `numpy`: 2.2.2
- `pytesseract`: 0.3.13
- `Pillow`: 11.1.0
- **Risques** : OpenCV est sensible aux updates (la détection de lignes peut varier). Toujours tester `apps/vision/detector.py` après update.

### Frontend (React)
- `react-pdf`: 9.2.1 / `pdfjs-dist`: 4.8.69
- **Important** : la version de `pdfjs-dist` doit correspondre exactement à celle requise par `react-pdf`. Ne pas mettre à jour l'un sans l'autre.
- `pdf-lib`: 1.17.1 (stable, peu de mouvements)

### Backend (NestJS)
- `nestjs/*`: ^11.1.13
- `prisma`: ^6.3.1
- **Process** : après update Prisma, toujours relancer `pnpm exec prisma generate`.

## Procédure de mise à jour mensuelle

### 1. Python (Service Vision)
```bash
cd apps/vision
# Vérifier les versions récentes
pip list --outdated
# Mettre à jour requirements.txt avec les nouvelles versions figées
# Rebuild et test
docker compose up -d --build vision
```

### 2. Node (Web & API)
```bash
pnpm -r update --interactive --latest
# Attention aux peer dependencies (react-pdf <-> pdfjs-dist)
pnpm -r build
docker compose up -d --build frontend backend
```

### 3. Tests de non-régression (Smoke Test)
Après mise à jour, vérifier impérativement :
1. **Upload** : charger un nouveau PDF.
2. **Vision** : lancer "Détecter les champs" (vérifier que les lignes sont toujours trouvées).
3. **Export** : exporter un PDF rempli.

## En cas de pépin
Rollback via Git :
```bash
git checkout package.json pnpm-lock.yaml apps/vision/requirements.txt
docker compose up -d --build
```
