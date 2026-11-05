<?php
/**
 * Plugin bootstrap.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use Timber\Timber;

defined( 'ABSPATH' ) || exit;

/**
 * Wires the services together.
 */
final class Plugin {

	/**
	 * What the build writes next to the editor's script: its dependencies and version.
	 */
	public const SCRIPT_ASSET = 'build/editor.asset.php';

	/**
	 * Registers every hook of the plugin.
	 *
	 * @return void
	 */
	public static function run(): void {
		Drafts::register();
		Preview::register();
		Rest::register();
		Admin::register();
	}

	/**
	 * Returns what the site lacks for the editor to run.
	 *
	 * @return array<int, string> Human-readable reasons, empty when it can run.
	 */
	public static function missing(): array {
		$missing = array();

		if ( ! is_readable( CINQ_WP_EDITOR_PATH . self::SCRIPT_ASSET ) ) {
			$missing[] = 'ses scripts ne sont pas construits : lancez « pnpm install && pnpm build » dans le dossier du plugin.';
		}

		if ( ! function_exists( 'acf_get_field_groups' ) ) {
			$missing[] = 'il a besoin d’ACF Pro.';
		}

		if ( ! class_exists( Timber::class ) ) {
			$missing[] = 'le thème n’utilise pas Timber.';
		}

		if ( ! is_readable( get_theme_file_path( Preview::TEMPLATE ) ) ) {
			$missing[] = sprintf( 'le thème n’a pas de gabarit %s.', Preview::TEMPLATE );
		}

		return $missing;
	}

	/**
	 * Returns the version of an asset: the plugin's, plus the file's date so a
	 * changed file is never served from the browser cache.
	 *
	 * @param string $path Path from the plugin root.
	 * @return string
	 */
	public static function asset_version( string $path ): string {
		$mtime = filemtime( CINQ_WP_EDITOR_PATH . $path );

		return VERSION . ( false === $mtime ? '' : '.' . $mtime );
	}
}
