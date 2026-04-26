# Rapport d'analyse : Alignement des champs date dans LMPdf

**Date :** 2026-04-26  
**Branche :** `feat/document-display` (vs `main`)  
**Commit actuel :** `ef49791`

---

## 1. Le problème

Dans l'export PDF, les champs de type `date` apparaissent **trop haut** par rapport à ce qui s'affiche dans l'éditeur. Les champs texte sont correctement alignés. Malgré plusieurs tentatives (ajustement de baseline, padding, isDate, dateYOffset), le problème persiste.

---

## 2. Architecture d'affichage : main vs feat/document-display

### Sur `main` (état original)

| Aspect | Comportement |
|---|---|
| **Scaling** | `zoom` (index dans `ZOOM_STEPS`), appliqué via `transform: scale(zoom)` sur le wrapper de page |
| **Champ date** | Toujours un `<input>` avec `className="field-input field-date-input"`, pas de mode lecture seule en div |
| **Export fontSize** | `f.style.fontSize * 72 / 96` (conversion CSS px → PDF pt) |
| **Export padding** | Proportionnel : `padX = max(1.5, boxW * 0.06)`, `padTop = max(1.5, boxH * 0.06)` |
| **Export lineHeight** | `max(fontSize * 1.2, 10)` |
| **Export baseline** | `pdfY + boxH - padTop - ascent - lineHeight * idx` (ascent = fontSize * 0.718) |
| **CSS padding** | `.field-input { padding: 2px 6px }` |

### Sur `feat/document-display` (état actuel)

| Aspect | Comportement |
|---|---|
| **Scaling** | `dispRatio` + `renderW` via ResizeObserver, CSS `zoom: dispRatio` directement sur le `.field` |
| **Champ date** | Mode édition = `<input>`, mode lecture seule = `<div>` avec `dangerouslySetInnerHTML` |
| **Export fontSize** | `f.style.fontSize` brut (pas de conversion 72/96) |
| **Export padding** | Fixe : `padX = 2`, `padTop = 2` |
| **Export lineHeight** | `max(fontSize * 1.15, 8)` |
| **Export baseline** | `pdfY + boxH - padTop - ascent - lineHeight * idx + dateYOffset` (ascent = fontSize * 0.718, dateYOffset = fontSize * 0.25 pour les dates) |
| **CSS padding** | `.field-input { padding: 1px 2px }` |

---

## 3. Liste complète des différences `main` → `feat/document-display`

### `exportPdf.ts`

| Élément | `main` | `feat/document-display` | Impact |
|---|---|---|---|
| `PAD_RATIO_X/Y` | 0.06 / 0.06 | 0.02 / 0.02 | Padding réduit de 6% → 2% |
| `MIN_PAD_PT` | 1.5 | 0.5 | Seuil de padding réduit |
| `BASELINE_RATIO` | N/A | 0.0 | Inutilisé (était prévu, valeur 0) |
| `fontSize` | `f.style.fontSize * 72/96` | `f.style.fontSize` brut | **⚠️ SUPPRESSION de la conversion CSS→PDF** |
| `padX/padTop` | Proportionnel (max(1.5, box*0.06)) | Fixe (2, 2) | Padding simplifié |
| `baselineDown` | N/A | 0 | Inutilisé |
| `lineHeight` | `max(fontSize * 1.2, 10)` | `max(fontSize * 1.15, 8)` | Ligne plus serrée |
| `maxLines` | `floor((boxH - padTop*2) / lineHeight)` | `floor(boxH / lineHeight)` | Pas de déduction du padding |
| **Y position** | `pdfY + boxH - padTop - ascent - lineHeight * idx` | Idem + `dateYOffset` (fontSize * 0.25 pour date) | **Offset spécial pour les dates** |
| `drawFieldLandscape` PAD | 2 | 3 | Padding paysage augmenté |
| `drawFieldLandscape` lineHeight | `max(fontSize * 1.2, 10)` | `max(fontSize * 1.15, 8)` | Même changement que portrait |

### `FieldOverlay.tsx`

| Élément | `main` | `feat/document-display` | Impact |
|---|---|---|---|
| `zoom` prop | `zoom` (float discret) | `dispRatio` (float continu) | Scaling continu au lieu de steps |
| CSS positioning | `transform: scale(zoom)` sur le wrapper | `zoom: dispRatio` sur le `.field` directement | **Mécanisme de scaling changé** |
| Champ date | `<input>` toujours | `<input>` en édition, `<div>` en lecture seule | Mode lecture seule = div |
| `lineHeight` style | Non spécifié (hérité) | `lineHeight: 1.15` inline sur tous les champs | Forçage du line-height |
| `e.stopPropagation()` | Absent sur mousedown | Ajouté | Prévient le marquee |
| Checkbox fontSize | `checkboxFontSize` | `field.style.checkSize ?? max(12, min(w,h)*0.75)` | Taille checkbox dynamique |

### `styles.css`

| Élément | `main` | `feat/document-display` | Impact |
|---|---|---|---|
| `.field-input` padding | `2px 6px` | `1px 2px` | **Padding réduit** |
| `.field` border | `2px solid` | `1px solid` | Bordure plus fine |
| `.field` border-radius | `4px` | `2px` | Coins moins arrondis |
| `.field-date-input` | `letter-spacing: 0.5px` seulement | Idem + ajout sur la branche fix: `padding-top: 0 !important; padding-bottom: 0 !important; line-height: 1.15 !important` | **Tentative CSS de forcer l'alignement date** |
| Layout éditeur | `display: flex; justify-content: center; align-items: flex-start` | `overflow: hidden; max-width: 100vw` | **Layout complètement réécrit** |
| Print styles | `.page-zoom-wrapper` | Supprimé | Print réécrit |

### `App.tsx`

| Élément | `main` | `feat/document-display` | Impact |
|---|---|---|---|
| Zoom | `ZOOM_STEPS[index]` discret | `userZoom` continu (step 0.05) | Zoom fluide |
| `renderW` | Calculé via `displayDims()` | `ResizeObserver` + `calcFitRenderW()` | **Mécanisme de dimensionnement réécrit** |
| `dispRatio` | `zoom` (passé à FieldOverlay) | `renderW / (pageW * 96/72)` | Ratio calculé différemment |

### `PdfViewer.tsx`

| Élément | `main` | `feat/document-display` | Impact |
|---|---|---|---|
| `renderWidth` | État interne calculé par pdf.js | Prop `renderWidth` + état interne | Contrôle externe de la largeur |
| `onDimensionsDetected` | Met à jour `renderWidth` | Ne met à jour que `pageW/pageH` | Séparation des responsabilités |

---

## 4. Le cœur du problème : pourquoi la date est trop haut

### Analyse du pipeline complet

**Dans l'éditeur** (FieldOverlay.tsx), un champ date en mode lecture seule s'affiche comme :
```html
<div class="field-input field-textarea" style="line-height: 1.15; ...">
  26/04/2026  ← texte rendu par le navigateur
</div>
```

Ce `<div>` a `padding: 1px 2px` (CSS `.field-input`). Le texte est positionné en haut par défaut (baseline du navigateur).

**Dans l'export PDF** (exportPdf.ts), la position Y est :
```
y = pdfY + boxH - padTop - ascent - lineHeight * idx + dateYOffset
```
Avec `padTop = 2`, `ascent = fontSize * 0.718`, `lineHeight = fontSize * 1.15`, `dateYOffset = fontSize * 0.25` pour les dates.

### Le problème fondamental

L'architecture de `feat/document-display` a **supprimé la conversion `fontSize * 72/96`**. Sur `main`, le fontSize était converti de CSS px (96 DPI) vers PDF pt (72 DPI), ce qui donnait un fontSize plus petit dans le PDF (ex: 14px CSS → 10.5pt PDF). Avec la suppression de cette conversion, le fontSize dans le PDF est maintenant **14pt** au lieu de **10.5pt**.

Mais les champs sont positionnés en **coordonnées normalisées (0→1)** qui sont mappées vers les dimensions du PDF. Le padding CSS (`1px 2px`) correspond à des pixels à 96 DPI, mais dans le PDF on utilise des points à 72 DPI. Les constantes `padX = 2` et `padTop = 2` en points PDF ne correspondent pas au `1px 2px` CSS.

**C'est ce décalage qui crée le problème.** Sur `main`, la conversion 72/96 alignait les unités. Sans elle, les paddings et les positions de baseline ne correspondent plus.

### Pourquoi le `dateYOffset` ne fonctionne pas

Le `dateYOffset` de `fontSize * 0.25` est une approximation qui tente de compenser le centrage vertical du navigateur. Mais :
1. Le problème n'est pas le centrage vertical du `<input>` — le champ date en lecture seule est un `<div>` maintenant
2. Le vrai problème est le **décalage d'unités** entre le CSS (96 DPI) et le PDF (72 DPI) qui n'est plus compensé
3. Le `dateYOffset` ne fait que masquer le symptôme sans corriger la cause

---

## 5. Code mort / inutile sur `feat/document-display`

| Élément | Fichier | Statut |
|---|---|---|
| `BASELINE_RATIO = 0.0` | exportPdf.ts | Inutilisé — jamais référencé |
| `baselineDown = 0` | exportPdf.ts | Inutilisé — passé à drawFieldPortrait mais jamais utilisé |
| `dateYOffset` | exportPdf.ts | Workaround qui ne corrige pas le vrai problème |
| `PAD_RATIO_X/Y = 0.02` | exportPdf.ts | Définis mais plus utilisés (padding fixe) |
| `MIN_PAD_PT = 0.5` | exportPdf.ts | Défini mais plus utilisé (padding fixe) |
| `normalizeBox()` | exportPdf.ts | Utilisé ✅ |
| `normalizedToPdf()` | exportPdf.ts | Utilisé ✅ |
| CSS `.field-date-input` overrides | styles.css (branche fix/) | `padding-top: 0 !important; padding-bottom: 0 !important` — inutile car le champ est un `<div>` en lecture seule |

### Commits d'hier soir (bricolage)

Les 17 commits entre `9decdb4` et `ef49791` sont des **tentatives itératives** qui n'ont pas résolu le problème :
- `876b87b` — remove isDate conditional
- `c3cb5a6` — date centered baseline formula
- `205b786` — revert to 9decdb4
- `95719f3` — disable browser cache
- `0f8ad29` — no-cache headers
- `fc7ab58` — add local IPs
- `de733a0` — console.log debug
- `e64676d` — lineHeight formula
- `3a0b497` — restore 0ae2f8e
- etc.

**Ces commits devraient être squashés ou retirés** avant merge dans `main`. Seul le commit `f0d4c9f` (normalized coords) apporte une vraie valeur architecturale.

---

## 6. Recommandations

### 6.1. Corriger le problème de date (la bonne approche)

Le problème fondamental est que **les unités CSS et PDF ne sont plus alignées**. Deux options :

**Option A : Rétablir la conversion `fontSize * 72/96`** (recommandé)
- Remettre `const fontSize = Math.min(f.style.fontSize * 72/96, boxH - 2)`
- Ajuster le padding en conséquence : `padX = Math.max(1, boxW * 72/96 * 0.01)`, `padTop = Math.max(1, boxH * 72/96 * 0.01)`
- Supprimer `dateYOffset` — tous les champs utilisent la même formule
- Supprimer le `<div>` en lecture seule pour les dates — revenir au `<input>` uniforme

**Option B : Aligner le CSS sur les unités PDF**
- Garder `fontSize` brut dans l'export
- Mais ajuster le CSS pour que les paddings correspondent aux pts PDF
- C'est plus complexe et fragile

### 6.2. Nettoyer le code

1. **Supprimer** `BASELINE_RATIO`, `baselineDown`, `PAD_RATIO_X/Y`, `MIN_PAD_PT` — inutilisés
2. **Supprimer** `dateYOffset` si on corrige le problème à la racine
3. **Supprimer** les CSS `.field-date-input` overrides (`padding-top: 0 !important` etc.)
4. **Revenir** au `<input>` unique pour les dates (supprimer le mode lecture seule en `<div>`)
5. **Squasher** les commits de debug d'hier en un seul commit propre

### 6.3. Documentation à mettre à jour

- **ARCHITECTURE.md** : Ajouter une section "Coordinate System" qui documente le pipeline d'affichage et d'export
- **CHANGELOG.md** : Ajouter une entrée pour la branche `feat/document-display` avec les vrais changements (scaling, zoom, layout)
- **README.md** : Pas de changement majeur nécessaire

---

## 7. Historique des tentatives de correction (hier, 25/04)

| Commit | Approche | Résultat |
|---|---|---|
| `9decdb4` | ascent formula, padX=1, padTop=1 | Texte OK, date OK (?) |
| `0ae2f8e` | fontSize * 72/96, pad 6% | Texte OK, date décalée |
| `e64676d` | lineHeight * (idx+1) pour date | Pas de changement |
| `c3cb5a6` | centered baseline pour date | Pas de changement |
| `876b87b` | même formule pour tout | Pas de changement |
| `fe3a5a5` | date en `<div>` en lecture seule | Pas de changement |
| `ef49791` | padX=2, padTop=2, dateYOffset=0 | Pas de changement |
| `414f596` (fix branch) | dateYOffset = fontSize * 0.15 | Légèrement meilleur |
| `414f596` modifié | dateYOffset = fontSize * 0.25 | Pas de différence visible |

**Constat :** Le problème n'est pas un simple offset. C'est un problème d'unités.