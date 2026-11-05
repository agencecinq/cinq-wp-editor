<?php
/**
 * What the editor knows about a post.
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

use CinqWpMcp\Abilities\Discovery;
use CinqWpMcp\Acf\BlockNormalizer;
use CinqWpMcp\Acf\ValueMapper;
use CinqWpMcp\Acf\Zone;
use CinqWpMcp\Acf\ZoneRegistry;
use CinqWpMcp\Content\Target;
use CinqWpMcp\Content\ZoneStore;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Reads the zone, the layouts and the blocks of a post through CINQ WP MCP.
 *
 * The editor only edits the primary zone of a post type: the `blocks` field of
 * a page or a case study. Options pages and term zones are out of scope here.
 */
final class Model {

	/**
	 * Keys of an ACF field definition the editor needs to draw a control.
	 *
	 * @var array<int, string>
	 */
	private const FIELD_KEYS = array(
		'key',
		'name',
		'label',
		'type',
		'instructions',
		'required',
		'default_value',
		'placeholder',
		'choices',
		'multiple',
		'allow_null',
		'min',
		'max',
		'step',
		'rows',
		'post_type',
		'taxonomy',
		'field_type',
		'conditional_logic',
		'button_label',
		'ui_on_text',
		'ui_off_text',
		'prepend',
		'append',
		'mime_types',
	);

	/**
	 * Returns the primary zone of a post, or an error when it has none.
	 *
	 * @param WP_Post $post Post.
	 * @return Zone|WP_Error
	 */
	public static function zone( WP_Post $post ) {
		$zone = ZoneRegistry::primary_for_post_type( $post->post_type );

		if ( null === $zone ) {
			return new WP_Error(
				'cinq_editor_no_zone',
				sprintf( 'Le type de contenu « %s » n’a pas de zone de blocs.', $post->post_type ),
				array( 'status' => 400 )
			);
		}

		return $zone;
	}

	/**
	 * Returns whether a post can be opened in the editor.
	 *
	 * @param WP_Post $post Post.
	 * @return bool
	 */
	public static function supports( WP_Post $post ): bool {
		return null !== ZoneRegistry::primary_for_post_type( $post->post_type );
	}

	/**
	 * Returns the layouts offered on a post, ready for the client.
	 *
	 * @param Zone    $zone Zone.
	 * @param WP_Post $post Post.
	 * @return array<int, array<string, mixed>>
	 */
	public static function layouts( Zone $zone, WP_Post $post ): array {
		$offered = ZoneRegistry::layouts_for_post_type( $zone, $post->post_type, $post->ID );
		$out     = array();

		// Layouts already on the page but no longer offered stay editable.
		foreach ( $zone->layouts() as $name => $layout ) {
			$annotation = Discovery::annotation( (string) $name );

			$out[] = array(
				'name'        => (string) $name,
				'label'       => (string) ( $layout['label'] ?? $name ),
				'description' => $annotation['description'] ?? '',
				'guidance'    => $annotation['guidance'] ?? '',
				'offered'     => isset( $offered[ $name ] ),
				'fields'      => self::fields( $layout['sub_fields'] ?? array() ),
			);
		}

		return $out;
	}

	/**
	 * Returns the blocks stored on a post, in the shape the mapper accepts back.
	 *
	 * @param Zone $zone    Zone.
	 * @param int  $acf_id  Post ID the values are stored against.
	 * @return array<int, array<string, mixed>>
	 */
	public static function read_blocks( Zone $zone, int $acf_id ): array {
		$rows = acf_get_value( $acf_id, $zone->storage_field() );

		return BlockNormalizer::normalize_blocks( is_array( $rows ) ? array_values( $rows ) : array(), $zone->layouts() );
	}

	/**
	 * Maps blocks sent by the editor onto ACF rows.
	 *
	 * @param Zone                             $zone   Zone.
	 * @param WP_Post                          $post   Post being edited.
	 * @param array<int, array<string, mixed>> $blocks Blocks, keyed by field name.
	 * @return array{rows: array<int, array<string, mixed>>, errors: array<int, array{path: string, message: string}>}
	 */
	public static function map( Zone $zone, WP_Post $post, array $blocks ): array {
		$mapper = ( new ValueMapper( false ) )->scope_to_zone( $zone, $post->post_type, $post->ID );
		$rows   = $mapper->map_blocks( $blocks );

		return array(
			'rows'   => $rows,
			'errors' => $mapper->get_errors(),
		);
	}

	/**
	 * Writes mapped rows onto the post itself.
	 *
	 * @param Zone                             $zone Zone.
	 * @param WP_Post                          $post Post.
	 * @param array<int, array<string, mixed>> $rows Mapped rows.
	 * @return true|WP_Error
	 */
	public static function publish( Zone $zone, WP_Post $post, array $rows ) {
		$target = Target::post( $post->ID );

		if ( is_wp_error( $target ) ) {
			return $target;
		}

		return ZoneStore::write( $zone, $target, $rows );
	}

	/**
	 * Keeps what the client needs from a list of resolved ACF fields.
	 *
	 * @param array<int, mixed> $fields Resolved fields.
	 * @return array<int, array<string, mixed>>
	 */
	private static function fields( array $fields ): array {
		$out = array();

		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) || '' === (string) ( $field['name'] ?? '' ) ) {
				continue;
			}

			$kept = array_intersect_key( $field, array_flip( self::FIELD_KEYS ) );

			if ( isset( $kept['instructions'] ) ) {
				$kept['instructions'] = wp_strip_all_tags( (string) $kept['instructions'] );
			}

			if ( ! empty( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) {
				$kept['sub_fields'] = self::fields( $field['sub_fields'] );
			}

			if ( 'flexible_content' === ( $field['type'] ?? '' ) ) {
				$kept['layouts'] = array();

				foreach ( Zone::index_layouts( $field ) as $name => $layout ) {
					$kept['layouts'][] = array(
						'name'   => (string) $name,
						'label'  => (string) ( $layout['label'] ?? $name ),
						'fields' => self::fields( $layout['sub_fields'] ?? array() ),
					);
				}
			}

			$out[] = $kept;
		}

		return $out;
	}
}
