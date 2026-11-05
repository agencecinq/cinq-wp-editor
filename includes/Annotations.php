<?php
/**
 * Block annotations of the theme.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Reads what the theme says about its blocks in `mcp.json`.
 *
 * The file is the theme's: CINQ WP MCP reads it for Claude, the editor reads
 * the same `blocks` entries for its catalogue. A child theme's entry replaces
 * the parent's, key by key. A theme without the file still works: its blocks
 * come without descriptions.
 */
final class Annotations {

	/**
	 * Config file name at the theme root.
	 */
	public const FILE = 'mcp.json';

	/**
	 * Annotations, keyed by layout name.
	 *
	 * @var array<string, array<string, mixed>>|null
	 */
	private static ?array $blocks = null;

	/**
	 * Returns the annotation of a block.
	 *
	 * @param string $name Layout name.
	 * @return array{description: string, guidance: string, hidden: bool}
	 */
	public static function get( string $name ): array {
		$annotation = self::blocks()[ $name ] ?? array();

		return array(
			'description' => is_string( $annotation['description'] ?? null ) ? $annotation['description'] : '',
			'guidance'    => is_string( $annotation['guidance'] ?? null ) ? $annotation['guidance'] : '',
			'hidden'      => ! empty( $annotation['hidden'] ),
		);
	}

	/**
	 * Returns the `blocks` entries of the parent theme, then the child theme.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private static function blocks(): array {
		if ( null !== self::$blocks ) {
			return self::$blocks;
		}

		self::$blocks = array();

		$directories = array_unique( array( get_template_directory(), get_stylesheet_directory() ) );

		foreach ( $directories as $directory ) {
			$path = trailingslashit( $directory ) . self::FILE;

			if ( ! is_readable( $path ) ) {
				continue;
			}

			$config = json_decode( (string) file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local theme file.
			$blocks = is_array( $config ) && is_array( $config['blocks'] ?? null ) ? $config['blocks'] : array();

			foreach ( $blocks as $name => $annotation ) {
				if ( is_array( $annotation ) ) {
					self::$blocks[ (string) $name ] = array_replace( self::$blocks[ (string) $name ] ?? array(), $annotation );
				}
			}
		}

		return self::$blocks;
	}
}
