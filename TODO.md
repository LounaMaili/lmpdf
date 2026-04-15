## MVP immédiat
- [ ] Upload PDF/image côté web
- [ ] Affichage page importée dans canvas
- [ ] Créer/déplacer/redimensionner champs overlay
- [ ] Sauvegarder template en base (Postgres)
- [ ] Lister/charger template existant

## Backend
- [x] Endpoint upload fichier + stockage objet (Garage S3-compatible)
- [x] Persistance templates + champs (Postgres + Prisma)
- [x] Contrat API stable pour vision (`POST /api/detect`)

## Vision (préparation)
- [ ] Définir format de sortie des champs suggérés
- [ ] Ajouter stub OpenCV/OCR
