# WorldDrive — Les Passeurs d'Aube

Jeu de voiture et d'avion en monde ouvert, sur la vraie carte du monde (OpenStreetMap).

## Distinction claire — à ne pas confondre

- **WorldDrive** = jeu de voiture et d'avion en monde ouvert, histoire originale « Les Passeurs d'Aube », carte réelle OpenStreetMap.
- **Moncef IA** = plateforme éducative IA, projet totalement différent.
- Aucun code partagé, aucun lien, aucune marque commune, aucun site commun.
- Dépôt GitHub séparé : `worlddrive-game`.
- Site Netlify séparé, à créer à partir de ce dépôt uniquement.
- Ce projet est autonome : il se joue et se déploie seul, sans Moncef IA.

## Contenu
- `index.html` — jeu monde ouvert, carte réelle, conduite (module Arena)
- `cargame.js` — physique, gameplay et personnages (module Claude)
- `missions.js` — missions et progression (module Qwen)
- `gemini-histoire.html` — histoire et personnages à pied (module Gemini)
- `car3d-world.js` — monde 3D Three.js (module Claude 3D)
- `checklist-qualite.md` — checklist qualité du jeu

## Jouer en local
Ouvrir `index.html` dans un navigateur. Aucune clé API payante requise.
Les tuiles OpenStreetMap et la recherche Nominatim se chargent dans le navigateur du joueur.

## Déploiement Netlify
Site statique : publier ce dossier tel quel.
