<?php
/**
 * Plugin Name:       CINQ Éditeur
 * Description:       Édite les blocs ACF d'une page à la manière de l'éditeur de thème Shopify : la liste des blocs, l'aperçu en direct du vrai site et les réglages du bloc sélectionné.
 * Version:           0.1.0
 * Requires at least: 6.9
 * Requires PHP:      8.4
 * Author:            CINQ
 * Author URI:        https://agencecinq.com
 * License:           MIT
 * Text Domain:       cinq-editor
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.1.0';

define( 'CINQ_EDITOR_PATH', plugin_dir_path( __FILE__ ) );

define( 'CINQ_EDITOR_URL', plugin_dir_url( __FILE__ ) );

spl_autoload_register(
	static function ( string $class_name ): void {
		$prefix = __NAMESPACE__ . '\\';

		if ( ! str_starts_with( $class_name, $prefix ) ) {
			return;
		}

		$file = CINQ_EDITOR_PATH . 'includes/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';

		if ( is_readable( $file ) ) {
			require_once $file;
		}
	}
);

// The editor runs on what the theme already has: its ACF fields, its Timber
// views and its `blocks/blocks.html.twig`. Missing one, it stays off. After
// the theme is set up: Timber comes with the theme's dependencies.
add_action(
	'after_setup_theme',
	static function (): void {
		$missing = Plugin::missing();

		if ( ! empty( $missing ) ) {
			add_action(
				'admin_notices',
				static function () use ( $missing ): void {
					if ( ! current_user_can( 'activate_plugins' ) ) {
						return;
					}

					echo '<div class="notice notice-error"><p>' . esc_html__( 'CINQ Éditeur est inactif :', 'cinq-editor' ) . ' ' . esc_html( implode( ' ', $missing ) ) . '</p></div>';
				}
			);
			return;
		}

		Plugin::run();
	},
	20
);
