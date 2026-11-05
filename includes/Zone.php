<?php
/**
 * Block zone of a post.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * The flexible content field holding the blocks of a post, as ACF loads it.
 *
 * ACF already knows which field groups apply to a post: the location rules of
 * the theme (post type, page template…) are matched by ACF itself, and clone
 * fields come expanded. The editor reads that, and nothing else.
 */
final class Zone {

	/**
	 * Name of the field CINQ themes keep their blocks in.
	 */
	public const NAME = 'blocks';

	/**
	 * Layouts of the field, keyed by name.
	 *
	 * @var array<string, array<string, mixed>>|null
	 */
	private ?array $layouts = null;

	/**
	 * Wraps a flexible content field.
	 *
	 * @param array<string, mixed> $field Field, as ACF loads it.
	 */
	public function __construct( public readonly array $field ) {}

	/**
	 * Returns the zone of a post: its root flexible content field named
	 * `blocks`, or else the first one.
	 *
	 * @param WP_Post $post Post.
	 * @return self|null Null when no field group of the post holds one.
	 */
	public static function for_post( WP_Post $post ): ?self {
		$groups = acf_get_field_groups(
			array(
				'post_id'   => $post->ID,
				'post_type' => $post->post_type,
			)
		);
		$found  = null;

		foreach ( $groups as $group ) {
			foreach ( (array) acf_get_fields( $group ) as $field ) {
				if ( 'flexible_content' !== ( $field['type'] ?? '' ) ) {
					continue;
				}

				if ( self::NAME === ( $field['name'] ?? '' ) ) {
					return new self( $field );
				}

				$found ??= $field;
			}
		}

		return null === $found ? null : new self( $found );
	}

	/**
	 * Returns the field key.
	 *
	 * @return string
	 */
	public function key(): string {
		return (string) ( $this->field['key'] ?? '' );
	}

	/**
	 * Returns the field name, which is also its meta name.
	 *
	 * @return string
	 */
	public function name(): string {
		return (string) ( $this->field['name'] ?? '' );
	}

	/**
	 * Returns the layouts of the field, keyed by name.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function layouts(): array {
		$this->layouts ??= self::index_layouts( $this->field );

		return $this->layouts;
	}

	/**
	 * Returns the rows stored on a post, unformatted: keyed by field key,
	 * images as attachment IDs.
	 *
	 * @param int $acf_id Post the rows are stored against.
	 * @return array<int, array<string, mixed>>
	 */
	public function read( int $acf_id ): array {
		$rows = acf_get_value( $acf_id, $this->field );

		return is_array( $rows ) ? array_values( $rows ) : array();
	}

	/**
	 * Writes rows onto a post, then checks they landed.
	 *
	 * @param int                              $acf_id Post the rows are stored against.
	 * @param array<int, array<string, mixed>> $rows   Rows, keyed by field key.
	 * @return true|WP_Error
	 */
	public function write( int $acf_id, array $rows ) {
		// Post meta is unslashed on its way to the database, as the slashed
		// `$_POST` of an ACF form is: slash first, or backslashes are lost.
		acf_update_value( wp_slash( $rows ), $acf_id, $this->field );
		acf_flush_value_cache( $acf_id, $this->name() );

		$stored = count( $this->read( $acf_id ) );

		if ( count( $rows ) !== $stored ) {
			return new WP_Error(
				'cinq_wp_editor_write_failed',
				sprintf(
					/* translators: 1: Blocks the page holds. 2: Blocks saved. */
					__( 'The page holds %1$d blocks after saving %2$d: reload the editor before going on.', 'cinq-wp-editor' ),
					$stored,
					count( $rows )
				),
				array( 'status' => 500 )
			);
		}

		return true;
	}

	/**
	 * Indexes the layouts of a flexible content field by name.
	 *
	 * @param array<string, mixed> $field Flexible content field.
	 * @return array<string, array<string, mixed>>
	 */
	public static function index_layouts( array $field ): array {
		$layouts = array();

		foreach ( (array) ( $field['layouts'] ?? array() ) as $layout ) {
			$name = (string) ( $layout['name'] ?? '' );

			if ( '' !== $name ) {
				$layouts[ $name ] = $layout;
			}
		}

		return $layouts;
	}
}
