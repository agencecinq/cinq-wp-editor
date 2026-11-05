<?php
/**
 * Sandbox only: menus the theme's footer needs, and a page filled with real blocks.
 * Runs once per Playground boot (the database lives in memory).
 */

add_action(
	'wp_loaded',
	static function (): void {
		if ( get_option( 'cinq_sandbox_seeded' ) || ! class_exists( '\CinqWpMcp\Acf\ZoneRegistry' ) ) {
			return;
		}

		// The blueprint creates the page after WordPress first loads: wait for it.
		$page = get_page_by_path( 'test-editeur-visuel' );
		$zone = \CinqWpMcp\Acf\ZoneRegistry::primary_for_post_type( 'page' );

		if ( ! $page || ! $zone ) {
			return;
		}

		update_option( 'cinq_sandbox_seeded', 1 );

		$locations = array();

		foreach ( array( 'footer' => 'Pied de page', 'legals' => 'Mentions' ) as $location => $name ) {
			$menu_id = wp_create_nav_menu( $name );

			if ( is_wp_error( $menu_id ) ) {
				continue;
			}

			$parent = wp_update_nav_menu_item(
				$menu_id,
				0,
				array(
					'menu-item-title'  => 'legals' === $location ? 'Mentions légales' : 'Agence',
					'menu-item-url'    => home_url( '/' ),
					'menu-item-status' => 'publish',
				)
			);

			if ( 'footer' === $location ) {
				wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'     => 'Contact',
						'menu-item-url'       => home_url( '/contact/' ),
						'menu-item-status'    => 'publish',
						'menu-item-parent-id' => $parent,
					)
				);
			}

			$locations[ $location ] = $menu_id;
		}

		set_theme_mod( 'nav_menu_locations', $locations );

		$blocks = json_decode( (string) file_get_contents( __DIR__ . '/seed.json' ), true );
		$mapper = ( new \CinqWpMcp\Acf\ValueMapper( false ) )->scope_to_zone( $zone, 'page', $page->ID );
		$rows   = $mapper->map_blocks( $blocks );

		\CinqWpMcp\Content\ZoneStore::write( $zone, \CinqWpMcp\Content\Target::post( $page->ID ), $rows );

		if ( $mapper->has_errors() ) {
			file_put_contents( __DIR__ . '/seed-errors.log', print_r( $mapper->get_errors(), true ) );
		}
	},
	99
);
