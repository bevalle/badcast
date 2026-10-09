# BadCast

Diffusion **synchronisée** d'un diaporama d'images sur plusieurs écrans d'un gymnase,
chaque écran étant relié à son propre PC sur le même réseau local (Wi-Fi ou câble).

```
             PC maître (serveur + régie)
           ┌──────────────────────────────┐
           │ node server.js               │
           │ dossier images/              │
           │ navigateur : /control        │
           └──────────────┬───────────────┘
                          │ réseau local (HTTP + Server-Sent Events)
       ┌──────────────────┼──────────────────┐
  PC écran 1         PC écran 2         PC écran N
  navigateur         navigateur         navigateur
  /screen            /screen            /screen
```

Le serveur est **l'unique horloge** : c'est lui qui décide quand on passe à l'image suivante
et il l'annonce instantanément à tous les écrans. Chaque écran **précharge l'image suivante**,
donc le changement est simultané partout (quelques millisecondes d'écart sur un réseau local).

Aucune installation de paquet : il suffit de **Node.js ≥ 18** sur le PC maître.
Les PC des écrans n'ont besoin que d'un navigateur (Edge, Chrome, Firefox…).

## Mise en route

### 1. Sur le PC maître

1. Installez Node.js (version LTS) : <https://nodejs.org>
2. Copiez ce dossier sur le PC.
3. Déposez vos images dans le dossier `images/` (jpg, png, webp, gif, svg, avif).
   Elles défilent par ordre alphabétique : nommez-les `01-…`, `02-…` pour choisir l'ordre.
4. Double-cliquez sur `start-server.bat` (Windows) ou lancez `./start-server.sh` (Linux/macOS).
   La console affiche les adresses à utiliser, par exemple :

   ```
   Régie  (PC maître) : http://192.168.1.10:8080/control
   Écrans (autres PC) : http://192.168.1.10:8080/screen
   ```
5. Ouvrez l'adresse **Régie** dans un navigateur du PC maître.

> Windows demandera peut-être d'autoriser Node.js dans le pare-feu : acceptez pour
> les **réseaux privés**, sinon les autres PC ne pourront pas se connecter.

### 2. Sur chaque PC relié à un écran

Ouvrez `http://<IP-du-PC-maître>:8080/screen` dans un navigateur, puis cliquez une fois
(ou F11) pour passer en plein écran.

Pour un démarrage automatique en mode kiosque, modifiez l'IP dans `start-screen.bat`
(Windows, Edge) ou `start-screen.sh` (Linux, Chromium) puis lancez-le. Sous Windows, placez
un raccourci vers `start-screen.bat` dans `shell:startup` pour qu'il s'ouvre au démarrage.

Le PC maître peut lui aussi afficher le diaporama sur son propre écran/projecteur :
bouton « Ouvrir un écran ici » dans la régie.

## La régie (`/control`)

- Aperçu de l'image en cours et nombre d'écrans connectés
- Précédente / Pause-Lecture / Suivante (raccourcis ← → espace)
- Clic sur une vignette pour l'afficher immédiatement sur tous les écrans
- Durée par image, transition (fondu ou aucune)
- **Bandeau texte** affiché en bas de tous les écrans (« Match terrain 3 dans 5 min »)
- « Recharger les écrans » : force le rafraîchissement de toutes les pages écran

Les images ajoutées ou supprimées dans `images/` sont détectées automatiquement (≤ 5 s).
Si un écran perd le réseau, il se reconnecte seul et se recale sur l'image en cours.

## Options

| Variable d'environnement | Défaut      | Rôle                               |
|--------------------------|-------------|------------------------------------|
| `PORT`                   | `8080`      | Port HTTP                          |
| `INTERVAL`               | `10`        | Durée par image au démarrage (s)   |
| `IMAGES_DIR`             | `./images`  | Dossier des images                 |
| `PRES_DIR`               | `./presentation` | Dossier des présentations HTML |

Sous Windows : `set INTERVAL=8` avant `node server.js`.

Côté écran : `/screen?fit=cover` remplit tout l'écran (recadrage) au lieu d'afficher
l'image entière avec des bandes noires.

## Diffuser une présentation remark.js / xaringan (compteur de matchs…)

BadCast peut aussi synchroniser une présentation HTML **remark.js** (celle générée par
xaringan depuis R) : on avance les diapos sur le PC maître, tous les écrans suivent.

1. Copiez le fichier HTML **et ses ressources** (`style.css`, `img/`, `libs/`…) dans le dossier
   `presentation/` du PC maître, en gardant la même arborescence.
2. Sur le PC maître, ouvrez la présentation **en mode maître** : lien « ▶ » dans la régie, ou
   `http://localhost:8080/pres/S.html?role=master`. Naviguez comme d'habitude (flèches, clic…).
3. Sur les PC des écrans, rien à changer : la page `/screen` bascule automatiquement sur la
   présentation et suit la diapo du maître. Un écran allumé en cours de route se recale tout seul.
4. Bouton « Revenir au diaporama d'images » dans la régie pour repasser aux images.

Le serveur ajoute lui-même le script de synchronisation à la page : le fichier HTML n'est pas
modifié et peut être régénéré depuis R à tout moment (il suffit de recharger la page).

**Gymnase sans Internet** : la présentation charge remark.js depuis `remarkjs.com`. Téléchargez
<https://remarkjs.com/downloads/remark-latest.min.js> à l'avance et déposez-le dans
`presentation/` : le serveur l'utilisera automatiquement à la place d'Internet.

## Piloter depuis votre propre page HTML

Si vous gardez votre page HTML actuelle sur le PC maître, elle peut commander les écrans
via l'API :

```js
// passer à l'image suivante / précédente / n° 3 (index à partir de 0)
fetch('http://localhost:8080/api/control', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'next' }),   // 'prev', 'play', 'pause', 'toggle'
});
// { action: 'goto', index: 2 } · { action: 'interval', interval: 8 }
// { action: 'message', message: 'Pause déjeuner' } · { action: 'reload' }
```

`GET /api/state` renvoie l'état courant (liste des images, index, lecture…).
