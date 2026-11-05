<?php
/**
 * Plugin bootstrap.
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Wires the services together.
 */
final class Plugin {

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
	 * Returns the version of an asset: the plugin's, plus the file's date so a
	 * changed file is never served from the browser cache.
	 *
	 * @param string $path Path from the plugin root.
	 * @return string
	 */
	public static function asset_version( string $path ): string {
		$mtime = filemtime( CINQ_EDITOR_PATH . $path );

		return VERSION . ( false === $mtime ? '' : '.' . $mtime );
	}
}
