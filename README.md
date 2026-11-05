# CINQ WP Editor (V0, prototype)

Un plugin WordPress qui édite les blocs ACF d'une page **à la manière de l'éditeur de thème
Shopify** : la liste des blocs à gauche, la vraie page au centre, les réglages du bloc
sélectionné à droite. On modifie un titre, la page se met à jour sous les yeux.

> Statut : prototype à discuter. Il tourne de bout en bout sur le thème agencecinq dans un
> WordPress de test, mais il n'a jamais été installé sur un vrai site.

## Le principe

Nos sites sont faits de blocs ACF (un champ flexible content `blocks`). Dans l'admin classique,
le client édite une pile de formulaires repliés, sans voir le résultat, puis clique sur
« Aperçu » dans un autre onglet. Shopify a résolu ça : on voit la page, on clique sur une
section, on la règle à côté.

Ce plugin ajoute cette surcouche **sans rien changer à ACF ni au thème** :

- **Les mêmes données.** Les blocs restent des lignes ACF, écrites au même endroit. On peut
  repasser par l'éditeur classique à tout moment, et désactiver le plugin ne casse rien.
- **Le vrai rendu.** L'aperçu au centre est la vraie page servie par le thème (Timber, Twig,
  CSS et JS du site), pas une imitation.
- **Un brouillon par personne.** Tant qu'on ne clique pas sur « Publier », le public voit la
  page d'avant. « Abandonner » revient à la version publiée.
- **Rien à configurer.** Les blocs, leurs champs et leurs contraintes sont lus dans ACF. Les
  descriptions et consignes de `mcp.json` (celles que lit Claude) servent aussi au catalogue de
  blocs. Un layout ajouté au thème apparaît dans l'éditeur sans toucher au plugin.

Il ne dépend que d'ACF Pro et du thème. Au démarrage, il vérifie que le thème a la bonne
architecture : ACF Pro actif, Timber, et un gabarit `views/blocks/blocks.html.twig`. Sinon, il
reste éteint et le dit dans l'admin. Pour chaque contenu, il demande à ACF quels groupes de
champs s'y appliquent (type de contenu, gabarit de page…) et y cherche le contenu flexible
`blocks` : une page sans zone de blocs n'a pas de lien vers l'éditeur.

| Ce que fait l'éditeur | Avec quoi |
|---|---|
| Trouver la zone de blocs d'un contenu | `acf_get_field_groups()`, qui applique les règles d'emplacement du thème |
| Savoir quels blocs proposer | `acf_prepare_field()`, comme l'écran d'édition, moins les blocs `hidden` de `mcp.json` |
| Valider | `acf_validate_value()` : les mêmes règles et les mêmes messages que l'écran d'édition |
| Enregistrer | `acf_update_value()`, avec le filtrage HTML d'ACF pour qui n'a pas `unfiltered_html` |
| Décrire les blocs | `blocks` de `mcp.json`, lu dans le thème parent puis le thème enfant |

[CINQ WP MCP](https://github.com/agencecinq/cinq-wp-mcp) lit les mêmes champs ACF et le même
`mcp.json` : Claude et l'éditeur proposent les mêmes blocs sans partager de code.

## Ce que voit la personne qui édite

| Colonne | Contenu |
|---|---|
| Gauche | Les blocs de la page, dans l'ordre. Glisser-déposer ou flèches pour déplacer, dupliquer, supprimer, « Ajouter un bloc » ouvre le catalogue (nom, description, consignes du thème). |
| Centre | La page en direct, en vue bureau ou mobile. Survoler un bloc l'encadre, cliquer dessus le sélectionne. Les liens ne mènent nulle part, pour ne pas quitter l'éditeur. |
| Droite | Les champs du bloc sélectionné : textes, images et galeries (médiathèque WordPress), liens, contenus liés (recherche), répéteurs, cases, listes. Un champ refusé par la validation (requis vide, valeur hors liste…) est signalé sous le champ. |
| En haut | État du brouillon (« Enregistrement du brouillon… », « Brouillon enregistré », « À jour »), **Abandonner**, **Publier** (**Enregistrer** pour une page pas encore publiée). |

On l'ouvre depuis la liste des pages (**Éditeur visuel** au survol d'une ligne), depuis l'écran
d'édition d'une page (**Ouvrir l'éditeur visuel**) ou depuis la barre d'admin sur le site
(**Éditer en visuel**).

## Comment ça marche

| Étape | Ce qui se passe |
|---|---|
| Ouverture | `GET /cinq-editor/v1/posts/{id}` renvoie les layouts proposés, les blocs publiés et le brouillon éventuel. |
| Modification | Après 300 ms sans frappe, un seul appel `PUT …/draft` valide les blocs avec ACF, les écrit avec ACF sur un post caché `cinq_editor_draft` (un par page et par utilisateur) et renvoie le HTML des seuls blocs modifiés ou ajoutés. C'est le principe de la *Section Rendering API* de Shopify. |
| Aperçu | L'iframe affiche la vraie page avec `?cinq-editor={id}`. Le filtre `acf/pre_load_value` sert les lignes du brouillon à la place de celles de la page : ACF les formate comme d'habitude, le thème les affiche sans rien savoir. Une copie de `blocks/blocks.html.twig` placée devant celle du thème entoure chaque bloc d'un repère `data-cinq-block`. |
| Mise à jour | Le bloc renvoyé remplace l'ancien dans l'aperçu. Déplacer ou supprimer un bloc se fait directement dans l'aperçu, sans attendre le serveur ; un bloc ajouté affiche « Chargement du bloc… » jusqu'à son rendu. Si un bloc ne peut pas être rendu seul, l'aperçu recharge la page entière. |
| Publication | `POST …/publish` valide tout, refuse en bloc si un champ est invalide (jamais une demi-page), écrit avec ACF puis supprime le brouillon. |

L'interface utilise `wp.element` et `wp.components`, déjà fournis par WordPress : pas d'étape de
build, les fichiers de `assets/` sont servis tels quels.

```
cinq-editor.php          en-tête du plugin, chargement des classes
includes/
  Admin.php              écran plein page, liens d'accès, scripts
  Rest.php               les quatre routes (état, brouillon, abandon, publication)
  Model.php              ce que l'éditeur sait d'un contenu : zone, blocs proposés, champs
  Zone.php               le contenu flexible d'un contenu, lu et écrit avec ACF
  Blocks.php             blocs de l'éditeur ↔ lignes ACF, validées par ACF
  Annotations.php        descriptions des blocs, lues dans le mcp.json du thème
  Drafts.php             brouillons (post caché par page et par utilisateur)
  Preview.php            la vraie page, servie avec le brouillon et les repères
  Renderer.php           rendu d'un bloc seul pour la mise à jour rapide
views/                   gabarits Twig placés devant ceux du thème
assets/                  éditeur (editor.js/css) et script de l'aperçu (preview.js/css)
bin/sandbox.sh           WordPress de test jetable
```

## Prérequis

- WordPress 6.9+, PHP 8.4+
- ACF Pro
- Un thème Timber qui affiche ses blocs via `views/blocks/blocks.html.twig` (convention des thèmes CINQ)
- Facultatif : un `mcp.json` à la racine du thème, pour les descriptions du catalogue

Pour l'installer sur un site : cloner ce dépôt dans `wp-content/plugins/`, puis activer
**CINQ Éditeur**.

## L'essayer en local

```bash
bash bin/sandbox.sh
```

Lance un WordPress jetable ([WP Playground](https://github.com/WordPress/wordpress-playground),
PHP 8.4, SQLite) sur http://127.0.0.1:9400, déjà connecté en admin, avec :

- le thème agencecinq tel que sur GitHub (`origin/main`, construit) ;
- Secure Custom Fields, à la place d'ACF Pro, qui demande une licence ;
- ce plugin monté en direct : une modification se voit au rechargement ;
- une page **Test éditeur visuel** remplie de vrais blocs (`bin/mu-plugins/seed.json`).

Le script attend le dépôt `wp-cinq` à côté de celui-ci, et demande Node,
Composer et pnpm. La base vit en mémoire : elle repart de zéro à chaque lancement. L'éditeur est
sur http://127.0.0.1:9400/wp-admin/admin.php?page=cinq-editor&post=4.

## Limites de la V0

- Fluidité : dans le WordPress de test, le bloc modifié s'affiche environ 1,5 s après la
  dernière frappe, dont 1,2 s de démarrage de WordPress à chaque requête. Pas encore mesuré sur
  un vrai serveur.
- Seule la zone principale (`blocks`) d'un type de contenu est éditée : pas les pages d'options
  ni les termes.
- Le WYSIWYG est un champ texte HTML, pas un vrai éditeur de texte riche.
- Les flexible content imbriqués dans un bloc restent à modifier dans l'éditeur classique.
- La logique conditionnelle ACF n'est évaluée qu'entre champs voisins.
- Un composant JS du thème absent au chargement (bloc d'un type jamais vu sur la page) peut ne
  pas s'initialiser avant un rechargement de l'aperçu.
- Pas d'annulation pas à pas : « Abandonner » revient à la version publiée.
- Deux personnes sur la même page ont chacune leur brouillon : la dernière qui publie l'emporte.
- L'aperçu masque le bandeau cookies du thème (`cinq-consent`) : à généraliser pour d'autres thèmes.
- Le glisser-déposer de la liste n'a pas pu être testé automatiquement (les flèches, qui font
  le même déplacement, l'ont été).

Repéré en passant, côté thème : `footer.html.twig` plante (erreur 500) quand aucun menu n'est
assigné au pied de page. Le bac à sable crée ces menus pour contourner.

## Pistes pour la suite

1. Un vrai éditeur de texte riche pour les champs WYSIWYG.
2. Annuler / rétablir.
3. Les pages d'options (en-tête, pied de page) dans le même écran.
4. Mesurer et optimiser sur un vrai serveur.
