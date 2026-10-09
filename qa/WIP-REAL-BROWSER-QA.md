# WIP — vérification navigateur réel du site

Cette branche conserve un petit harnais de QA repris après une session arrêtée. Il n'est pas intégré à la chaîne de déploiement et ne constitue pas une suite de tests complète.

## Script

**qa/verify-real-browser.cjs** lance Brave dans un profil isolé, se connecte au port de débogage Chromium, ouvre le site public et :
- relève l'état initial et les ressources CSS principales ;
- ouvre le menu et vérifie son attribut aria-expanded ;
- prend des captures à 100 ms et 330 ms après le clic sur Développement ;
- attend la navigation, relève le titre et les erreurs JavaScript/requêtes, et écrit un rapport JSON.

Il utilise des variables d'environnement pour éviter les chemins de poste inscrits dans le dépôt :
- BRAVE_PATH : chemin de l'exécutable Brave ;
- PUPPETEER_MODULE : module Puppeteer à charger ;
- SITE_URL : URL de la version à tester, sinon le site public avec un paramètre de cache-bypass ;
- DEBUG_PORT : port CDP, par défaut 9333 ;
- BROWSER_PROFILE et SCREENSHOT_DIR : profil et répertoire de captures isolés.

Un exemple PowerShell pour le poste disposant déjà de Node, Brave et Puppeteer :

    $env:BRAVE_PATH = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
    $env:PUPPETEER_MODULE = "CHEMIN_LOCAL_VERS_NODE_MODULES\puppeteer"
    $env:SITE_URL = "https://yosuljin.github.io/"
    node qa/verify-real-browser.cjs

Le chemin local de Puppeteer doit être fourni par l'environnement ; aucun chemin ou profil local personnel n'est commité.

## Limites connues

- Le script ne prouve pas que la transition est perceptible : les deux captures sont des pièces à examiner, pas un oracle visuel.
- Il ne teste pas le téléphone physique ni le maintien du plein écran/immersif, et ne vérifie pas le mode FULL 3D/LITE en profondeur.
- La récupération de contexte WebGL, les sons, retour/arrière, la préférence de réduction du mouvement et les scénarios tactiles exigent des parcours distincts.
- Les requêtes échouées sont consignées, mais ne font pas toutes échouer automatiquement le script car une requête annulée pendant la navigation peut être normale.
## Dernier résultat observé — smoke test bureau limité (2026-10-09 18:23:24 UTC)

Le script a été vérifié syntaxiquement avec Node puis exécuté contre le **site publié en direct**, dans une vraie fenêtre Brave de bureau, à 2304×1214. La ressource utilisée était `styles.css?v=20261009-r2`.

Résultat observé :
- écran CRT de veille franchi par **Allumer sans le son** ; la boîte de veille a disparu et la page d'entrée était active ;
- menu ouvert, `aria-expanded=true`, visibilité `visible` ;
- clic sur Développement : arrivée sur `https://yosuljin.github.io/developpement.html`, titre visible « Développement », `worldReady=true` ;
- erreurs JavaScript : **0** ; requêtes échouées : **0** ; échecs des assertions : **0** ; code de sortie : **0**.
- Preuves : `qa/evidence/2026-10-09/report.json` et captures de bureau compressées dans le même dossier. La capture à 100 ms montre encore le menu/la sélection ; celle à 330 ms montre la page de destination avec l'ancien intitulé « Développement » en image rémanente. Cela démontre un effet de transition dans ce seul parcours bureau, pas sa qualité universelle.

Il s'agit d'un **smoke test limité**, pas d'une QA complète. Il ne prouve pas que l'animation soit correcte pour toutes les pages/appareils, ni que le plein écran survive à tous les scénarios de navigation, ni que le mobile se comporte comme le bureau. Restent à tester séparément : téléphone physique, réduction des animations et accessibilité, retour/arrière, bascule FULL 3D/LITE et perte/récupération du contexte WebGL. Les images sont des JPEG redimensionnés ; le rapport garde l'état mesuré, la fenêtre et la version de ressource exactes.

Cette branche est un checkpoint. Ne pas la fusionner ou la présenter comme une validation actuelle de l'ensemble du site.
