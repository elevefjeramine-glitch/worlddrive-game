# WorldDrive — Les Passeurs d'Aube

Jeu de voiture et d'avion en monde ouvert, sur la vraie carte du monde (OpenStreetMap).

## Distinction claire — à ne pas confondre

- **WorldDrive** = jeu de voiture et d'avion en monde ouvert, histoire originale « Les Passeurs d'Aube », carte réelle OpenStreetMap.
- **Moncef IA** = plateforme éducative IA, projet totalement différent.
- Aucun code partagé, aucun lien, aucune marque commune, aucun site commun.
- Dépôt GitHub séparé : `worlddrive-game`.
- Site Netlify séparé, à créer à partir de ce dépôt uniquement.
- Ce projet est autonome : il se joue et se déploie seul, sans Moncef IA.

## Version actuelle — chef-d'œuvre vérifié (25/10/2026)
- Caméra GTA : vue derrière la voiture, vue Conducteur avec habitacle, vue Capot, angle libre (C / V, 0°, ±45°, ±90°, 180°)
- Tesla Roadster personnelle d'Amine FJER : 402 km/h, 0–100 en 2,1 s, toit verre retirable, propulseurs SpaceX, autopilote d'aube
- 13 voitures réelles avec fiche réelle et habitacle réel, 6 avions réels avec fiche réelle et cockpit réel : F-22, YF-23, 747-400, 777-300ER, 787-9, 737-800
- Histoire originale « Les Passeurs d'Aube », campagne 6 chapitres, 13 personnages peaufinés (rôle, traits, réplique)
- Missions libres dont TAXI, radio (Aube FM, Nitro FM, Casa Waves), minimap façon GTA, trophées, objectifs, sauvegarde locale
- Multijoueur 100 % gratuit en pair-à-pair WebRTC (PeerJS, MIT) : salon à code 6 caractères, positions synchronisées ~8 Hz, sans serveur de jeu payant
- Qualité vérifiée : trafic avec silhouettes de modèles réels distincts, recherche de ville, chronos, caméras et sauvegarde corrigés et revérifiés en jeu

## Contenu
- `index.html` — jeu monde ouvert, carte réelle, conduite (module Arena)
- `cargame.js` — physique, gameplay et personnages (module Claude)
- `missions.js` — missions et progression (module Qwen)
- `gemini-histoire.html` — histoire et personnages à pied (module Gemini)
- `car3d-world.js` — monde 3D Three.js (module Claude 3D)
- `checklist-qualite.md` — checklist qualité du jeu

Note honnête : la version assemblée complète vérifiée dans l'artefact n'est pas exportable fichier par fichier depuis l'artefact ; ce dépôt contient les modules locaux jouables qui la composent, plus cette documentation de la version actuelle.

## Jouer en local
Ouvrir `index.html` dans un navigateur. Aucune clé API payante requise.
Les tuiles OpenStreetMap et la recherche Nominatim se chargent dans le navigateur du joueur.

## Déploiement Netlify
Site statique : publier ce dossier tel quel.
