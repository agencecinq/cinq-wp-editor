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
	 * ACF Pro the editor is built against: its latest release.
	 */
	public const ACF_VERSION = '6.8';

	/**
	 * Timber the editor is built against: its latest release.
	 */
	public const TIMBER_VERSION = '2.5';

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

		// The latest releases only, as for WordPress.
		if ( ! defined( 'ACF_PRO' ) || version_compare( ACF_VERSION, self::ACF_VERSION, '<' ) ) {
			/* translators: %s: ACF Pro version. */
			$missing[] = sprintf( __( 'it needs ACF Pro %s or later.', 'cinq-wp-editor' ), self::ACF_VERSION );
		}

		if ( ! class_exists( Timber::class ) || version_compare( Timber::VERSION, self::TIMBER_VERSION, '<' ) ) {
			/* translators: %s: Timber version. */
			$missing[] = sprintf( __( 'the theme needs Timber %s or later.', 'cinq-wp-editor' ), self::TIMBER_VERSION );
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
