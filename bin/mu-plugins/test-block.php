<?php
/**
 * Development only: a « Test de l'éditeur » block with every ACF Pro field
 * type, added to the `blocks` flexible content of the active theme, and a
 * « Section de test » field group on pages, a fixed section next to the blocks.
 *
 * Loaded by the sandbox, which mounts bin/mu-plugins. On a local site, link it
 * into wp-content/mu-plugins. The theme is not touched: the layout is added to
 * ACF's local field store once the theme has registered its fields, and its
 * template comes from bin/mu-plugins/views.
 */

const CINQ_TEST_LAYOUT = 'cinq_test';

add_action(
	'acf/include_fields',
	static function (): void {
		$blocks = null;

		foreach ( acf_get_local_fields() as $field ) {
			if ( 'flexible_content' === ( $field['type'] ?? '' ) && 'blocks' === ( $field['name'] ?? '' ) ) {
				$blocks = $field;
				break;
			}
		}

		if ( null === $blocks ) {
			return;
		}

		$key = static fn( string $name ): string => 'field_cinq_test_' . $name;

		$choices = array(
			'un'    => 'Un',
			'deux'  => 'Deux',
			'trois' => 'Trois',
		);

		$sub_fields = array(
			array(
				'key'   => $key( 'tab_basic' ),
				'label' => 'Simples',
				'type'  => 'tab',
			),
			array(
				'key'          => $key( 'text' ),
				'name'         => 'text',
				'label'        => 'Texte (requis, 60 caractères)',
				'type'         => 'text',
				'required'     => 1,
				'maxlength'    => 60,
				'placeholder'  => 'Un titre',
				'instructions' => 'Vider le champ puis publier : l’erreur d’ACF doit apparaître ici.',
			),
			array(
				'key'   => $key( 'textarea' ),
				'name'  => 'textarea',
				'label' => 'Zone de texte',
				'type'  => 'textarea',
				'rows'  => 3,
			),
			array(
				'key'   => $key( 'number' ),
				'name'  => 'number',
				'label' => 'Nombre (0 à 10)',
				'type'  => 'number',
				'min'   => 0,
				'max'   => 10,
				'step'  => 1,
			),
			array(
				'key'   => $key( 'range' ),
				'name'  => 'range',
				'label' => 'Curseur (0 à 100, pas de 5)',
				'type'  => 'range',
				'min'   => 0,
				'max'   => 100,
				'step'  => 5,
			),
			array(
				'key'   => $key( 'email' ),
				'name'  => 'email',
				'label' => 'E-mail',
				'type'  => 'email',
			),
			array(
				'key'   => $key( 'url' ),
				'name'  => 'url',
				'label' => 'URL',
				'type'  => 'url',
			),
			array(
				'key'   => $key( 'password' ),
				'name'  => 'password',
				'label' => 'Mot de passe',
				'type'  => 'password',
			),
			array(
				'key'   => $key( 'tab_content' ),
				'label' => 'Contenu',
				'type'  => 'tab',
			),
			array(
				'key'          => $key( 'wysiwyg' ),
				'name'         => 'wysiwyg',
				'label'        => 'Texte riche (complet)',
				'type'         => 'wysiwyg',
				'tabs'         => 'all',
				'toolbar'      => 'full',
				'media_upload' => 1,
			),
			array(
				'key'          => $key( 'wysiwyg_basic' ),
				'name'         => 'wysiwyg_basic',
				'label'        => 'Texte riche (basique, visuel seul)',
				'type'         => 'wysiwyg',
				'tabs'         => 'visual',
				'toolbar'      => 'basic',
				'media_upload' => 0,
			),
			array(
				'key'   => $key( 'oembed' ),
				'name'  => 'oembed',
				'label' => 'Contenu embarqué',
				'type'  => 'oembed',
			),
			array(
				'key'           => $key( 'image' ),
				'name'          => 'image',
				'label'         => 'Image',
				'type'          => 'image',
				'return_format' => 'array',
				'preview_size'  => 'medium',
			),
			array(
				'key'           => $key( 'file' ),
				'name'          => 'file',
				'label'         => 'Fichier',
				'type'          => 'file',
				'return_format' => 'array',
			),
			array(
				'key'           => $key( 'gallery' ),
				'name'          => 'gallery',
				'label'         => 'Galerie (6 images au plus)',
				'type'          => 'gallery',
				'return_format' => 'id',
				'max'           => 6,
			),
			array(
				'key'   => $key( 'tab_choices' ),
				'label' => 'Choix',
				'type'  => 'tab',
			),
			array(
				'key'        => $key( 'select' ),
				'name'       => 'select',
				'label'      => 'Liste',
				'type'       => 'select',
				'choices'    => $choices,
				'allow_null' => 1,
			),
			array(
				'key'      => $key( 'select_multiple' ),
				'name'     => 'select_multiple',
				'label'    => 'Liste à choix multiples',
				'type'     => 'select',
				'choices'  => $choices,
				'multiple' => 1,
				'ui'       => 1,
			),
			array(
				'key'     => $key( 'checkbox' ),
				'name'    => 'checkbox',
				'label'   => 'Cases à cocher',
				'type'    => 'checkbox',
				'choices' => $choices,
			),
			array(
				'key'     => $key( 'radio' ),
				'name'    => 'radio',
				'label'   => 'Boutons radio',
				'type'    => 'radio',
				'choices' => $choices,
			),
			array(
				'key'     => $key( 'button_group' ),
				'name'    => 'button_group',
				'label'   => 'Groupe de boutons',
				'type'    => 'button_group',
				'choices' => $choices,
			),
			array(
				'key'         => $key( 'true_false' ),
				'name'        => 'true_false',
				'label'       => 'Vrai / faux (affiche le champ suivant)',
				'type'        => 'true_false',
				'ui'          => 1,
				'ui_on_text'  => 'Oui',
				'ui_off_text' => 'Non',
			),
			array(
				'key'               => $key( 'conditional' ),
				'name'              => 'conditional',
				'label'             => 'Champ conditionnel',
				'type'              => 'text',
				'conditional_logic' => array(
					array(
						array(
							'field'    => $key( 'true_false' ),
							'operator' => '==',
							'value'    => '1',
						),
					),
				),
			),
			array(
				'key'   => $key( 'tab_relations' ),
				'label' => 'Relations',
				'type'  => 'tab',
			),
			array(
				'key'           => $key( 'link' ),
				'name'          => 'link',
				'label'         => 'Lien',
				'type'          => 'link',
				'return_format' => 'array',
			),
			array(
				'key'           => $key( 'post_object' ),
				'name'          => 'post_object',
				'label'         => 'Contenu (une page)',
				'type'          => 'post_object',
				'post_type'     => array( 'page' ),
				'return_format' => 'id',
			),
			array(
				'key'           => $key( 'post_object_multiple' ),
				'name'          => 'post_object_multiple',
				'label'         => 'Contenus (plusieurs pages)',
				'type'          => 'post_object',
				'post_type'     => array( 'page' ),
				'multiple'      => 1,
				'return_format' => 'id',
			),
			array(
				'key'            => $key( 'page_link' ),
				'name'           => 'page_link',
				'label'          => 'Lien vers une page ou une archive',
				'type'           => 'page_link',
				'post_type'      => array( 'page', 'post', 'case_study' ),
				'allow_archives' => 1,
			),
			array(
				'key'           => $key( 'relationship' ),
				'name'          => 'relationship',
				'label'         => 'Relation (3 au plus)',
				'type'          => 'relationship',
				'post_type'     => array( 'page', 'post' ),
				'max'           => 3,
				'return_format' => 'id',
			),
			array(
				'key'           => $key( 'taxonomy' ),
				'name'          => 'taxonomy',
				'label'         => 'Catégories',
				'type'          => 'taxonomy',
				'taxonomy'      => 'category',
				'field_type'    => 'checkbox',
				'return_format' => 'id',
			),
			array(
				'key'           => $key( 'user' ),
				'name'          => 'user',
				'label'         => 'Utilisateur',
				'type'          => 'user',
				'return_format' => 'id',
			),
			array(
				'key'   => $key( 'tab_dates' ),
				'label' => 'Dates et couleurs',
				'type'  => 'tab',
			),
			array(
				'key'            => $key( 'date' ),
				'name'           => 'date',
				'label'          => 'Date',
				'type'           => 'date_picker',
				'display_format' => 'd/m/Y',
				'return_format'  => 'd/m/Y',
				'first_day'      => 1,
			),
			array(
				'key'            => $key( 'date_time' ),
				'name'           => 'date_time',
				'label'          => 'Date et heure',
				'type'           => 'date_time_picker',
				'display_format' => 'd/m/Y H:i',
				'return_format'  => 'Y-m-d H:i:s',
				'first_day'      => 1,
			),
			array(
				'key'            => $key( 'time' ),
				'name'           => 'time',
				'label'          => 'Heure',
				'type'           => 'time_picker',
				'display_format' => 'H:i',
				'return_format'  => 'H:i',
			),
			array(
				'key'   => $key( 'color' ),
				'name'  => 'color',
				'label' => 'Couleur',
				'type'  => 'color_picker',
			),
			array(
				'key'            => $key( 'color_alpha' ),
				'name'           => 'color_alpha',
				'label'          => 'Couleur avec opacité',
				'type'           => 'color_picker',
				'enable_opacity' => 1,
				'return_format'  => 'string',
			),
			array(
				'key'   => $key( 'icon' ),
				'name'  => 'icon',
				'label' => 'Icône',
				'type'  => 'icon_picker',
				'tabs'  => array( 'dashicons', 'media_library', 'url' ),
			),
			array(
				'key'   => $key( 'map' ),
				'name'  => 'map',
				'label' => 'Carte Google',
				'type'  => 'google_map',
			),
			array(
				'key'   => $key( 'tab_structure' ),
				'label' => 'Structure',
				'type'  => 'tab',
			),
			array(
				'key'     => $key( 'message' ),
				'label'   => 'Message',
				'type'    => 'message',
				'message' => 'Un message ACF : rien à saisir.',
			),
			array(
				'key'   => $key( 'accordion' ),
				'label' => 'Accordéon',
				'type'  => 'accordion',
			),
			array(
				'key'        => $key( 'group' ),
				'name'       => 'group',
				'label'      => 'Groupe',
				'type'       => 'group',
				'sub_fields' => array(
					array(
						'key'      => $key( 'group_title' ),
						'name'     => 'title',
						'label'    => 'Titre du groupe (requis)',
						'type'     => 'text',
						'required' => 1,
					),
					array(
						'key'   => $key( 'group_toggle' ),
						'name'  => 'toggle',
						'label' => 'Option du groupe',
						'type'  => 'true_false',
						'ui'    => 1,
					),
				),
			),
			array(
				'key'          => $key( 'repeater' ),
				'name'         => 'repeater',
				'label'        => 'Répéteur (1 à 3 lignes)',
				'type'         => 'repeater',
				'min'          => 1,
				'max'          => 3,
				'layout'       => 'block',
				'button_label' => 'Ajouter une ligne',
				'sub_fields'   => array(
					array(
						'key'      => $key( 'repeater_text' ),
						'name'     => 'text',
						'label'    => 'Texte de la ligne (requis)',
						'type'     => 'text',
						'required' => 1,
					),
					array(
						'key'           => $key( 'repeater_image' ),
						'name'          => 'image',
						'label'         => 'Image de la ligne',
						'type'          => 'image',
						'return_format' => 'id',
					),
					array(
						'key'           => $key( 'repeater_link' ),
						'name'          => 'link',
						'label'         => 'Lien de la ligne',
						'type'          => 'link',
						'return_format' => 'array',
					),
				),
			),
			array(
				'key'     => $key( 'flexible' ),
				'name'    => 'flexible',
				'label'   => 'Contenu flexible imbriqué',
				'type'    => 'flexible_content',
				'layouts' => array(
					array(
						'key'        => 'layout_cinq_test_quote',
						'name'       => 'quote',
						'label'      => 'Citation',
						'sub_fields' => array(
							array(
								'key'   => $key( 'flexible_quote' ),
								'name'  => 'quote',
								'label' => 'Citation',
								'type'  => 'textarea',
							),
						),
					),
				),
			),
			array(
				'key'         => $key( 'clone_seamless' ),
				'name'        => 'clone_seamless',
				'label'       => 'Clone intégré du texte',
				'type'        => 'clone',
				'clone'       => array( $key( 'textarea' ) ),
				'display'     => 'seamless',
				'prefix_name' => 1,
			),
			array(
				'key'     => $key( 'clone_group' ),
				'name'    => 'clone_group',
				'label'   => 'Clone en groupe du lien',
				'type'    => 'clone',
				'clone'   => array( $key( 'link' ) ),
				'display' => 'group',
			),
		);

		$blocks['layouts'][] = array(
			'key'        => 'layout_' . CINQ_TEST_LAYOUT,
			'name'       => CINQ_TEST_LAYOUT,
			'label'      => 'Test de l’éditeur (tous les champs)',
			'display'    => 'block',
			'sub_fields' => $sub_fields,
		);

		// The theme's field again, with one more layout: ACF replaces it.
		acf_add_local_fields( array( $blocks ) );
	},
	99
);

// The block's template, after the theme's own views.
add_filter(
	'timber/locations',
	static function ( array $locations ): array {
		$locations[ Timber\Loader::MAIN_NAMESPACE ][] = __DIR__ . '/views/';

		return $locations;
	},
	99
);

// A fixed section on pages: fields of the template, next to the blocks.
add_action(
	'acf/include_fields',
	static function (): void {
		acf_add_local_field_group(
			array(
				'key'      => 'group_cinq_test_section',
				'title'    => 'Section de test',
				'location' => array(
					array(
						array(
							'param'    => 'post_type',
							'operator' => '==',
							'value'    => 'page',
						),
					),
				),
				'fields'   => array(
					array(
						'key'       => 'field_cinq_test_section_tagline',
						'name'      => 'cinq_test_tagline',
						'label'     => 'Accroche (20 caractères)',
						'type'      => 'text',
						'maxlength' => 20,
					),
					array(
						'key'   => 'field_cinq_test_section_subtitle',
						'name'  => 'cinq_test_subtitle',
						'label' => 'Sous-titre',
						'type'  => 'text',
					),
				),
			)
		);
	}
);

// The section's template: its tagline and subtitle in one element, named as a
// theme names the fields it renders.
add_action(
	'wp_footer',
	static function (): void {
		$tagline  = is_page() ? get_field( 'cinq_test_tagline', get_queried_object_id() ) : '';
		$subtitle = is_page() ? get_field( 'cinq_test_subtitle', get_queried_object_id() ) : '';

		if ( $tagline || $subtitle ) {
			printf( '<p data-field="cinq_test_tagline cinq_test_subtitle">%s %s</p>', esc_html( (string) $tagline ), esc_html( (string) $subtitle ) );
		}
	}
);
