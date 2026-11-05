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
			$missing[] = __( 'its scripts are not built: run “pnpm install && pnpm build” in the plugin folder.', 'cinq-wp-editor' );
		}

		if ( ! function_exists( 'acf_get_field_groups' ) ) {
			$missing[] = __( 'it needs ACF Pro.', 'cinq-wp-editor' );
		}

		if ( ! class_exists( Timber::class ) ) {
			$missing[] = __( 'the theme does not use Timber.', 'cinq-wp-editor' );
		}

		if ( ! is_readable( get_theme_file_path( Preview::TEMPLATE ) ) ) {
			/* translators: %s: Template path. */
			$missing[] = sprintf( __( 'the theme has no %s template.', 'cinq-wp-editor' ), Preview::TEMPLATE );
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
