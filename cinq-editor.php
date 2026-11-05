<?php
/**
 * Plugin Name:       CINQ Éditeur
 * Description:       Édite les blocs ACF d'une page à la manière de l'éditeur de thème Shopify : la liste des blocs, l'aperçu en direct du vrai site et les réglages du bloc sélectionné.
 * Version:           0.1.0
 * Requires at least: 6.9
 * Requires PHP:      8.1
 * Requires Plugins:  cinq-wp-mcp
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

// The zones, the layouts, the value mapping and the storage all come from
// CINQ WP MCP: the editor is a second client of the same model, not a copy.
add_action(
	'plugins_loaded',
	static function (): void {
		if ( ! class_exists( '\CinqWpMcp\Acf\ZoneRegistry' ) || ! function_exists( 'acf_get_value' ) ) {
			add_action(
				'admin_notices',
				static function (): void {
					echo '<div class="notice notice-error"><p>' . esc_html__( 'CINQ Éditeur a besoin de CINQ WP MCP et d’ACF Pro (ou Secure Custom Fields).', 'cinq-editor' ) . '</p></div>';
				}
			);
			return;
		}

		Plugin::run();
	},
	20
);
