# WIP — carte Aether en 3D

État du checkpoint : 2026-10-09. Ce fichier décrit une expérimentation isolée ; il ne constitue ni une fonctionnalité publiée, ni une approbation de l'intégration à l'interface publique.

## Ce que contient ce checkpoint

- **js/world/parc.js** est un module de scène WebGL (environ 43 Ko au moment de la sauvegarde), écrit pour représenter le parc Aether en 3D avec des nœuds de projet et des relations.
- Le commentaire d'en-tête indique que le graphe est prévu pour FULL 3D, avec la carte SVG comme solution de repli.
- Le fichier était orphelin dans le clone local : aucun import de la branche publique courante ne le référençait. Il utilise aussi des versions de ressources plus anciennes, qui doivent être comparées à la version courante avant une intégration.

## État volontairement incomplet

- Le module n'est pas branché à **js/world/world.js** ni à l'interface.
- Aucun test de compilation/intégration ou test navigateur n'a été exécuté pour ce module dans ce checkpoint.
- Ne pas fusionner ce branchement ni le publier comme fonctionnalité terminée.
- Comparer les nœuds et relations avec la carte SVG canonique, et vérifier les étiquettes, les états « spécifié / en code / inscrit / vision », les liens accessibles au clavier et au tactile.
- Préserver le budget de pixels, les solutions de repli WebGL, les performances mobiles et les préférences de mouvement réduit.
- La carte publique n'est pas l'observatoire privé futur : ne pas transformer cette expérimentation en remplacement implicite du projet privé plus large.

## Reprise

1. Lire ce document et examiner le module complet.
2. Comparer les imports, versions de gl.js, API de la scène, shaders et modèle d'Aether avec la branche main courante.
3. Faire une intégration dans un lot isolé et vérifier les effets sur la scène WebGL existante, FULL 3D/LITE, le repli SVG, l'accessibilité et le mobile.
4. Ne proposer une PR qu'avec tests réels et preuve que la carte principale garde les mêmes relations factuelles que les fiches canoniques.

Ce checkpoint existe pour conserver le travail retrouvé sans faire passer une expérimentation orpheline pour du code validé.
