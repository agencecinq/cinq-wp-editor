<?php
/**
 * What the editor knows about a post.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Reads the zone, the layouts and the blocks of a post out of ACF.
 *
 * The editor only edits the zone of a post: the `blocks` field of a page or a
 * case study. Options pages and terms are out of scope here.
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
		'toolbar',
		'tabs',
		'media_upload',
	);

	/**
	 * Returns the zone of a post, or an error when it has none.
	 *
	 * @param WP_Post $post Post.
	 * @return Zone|WP_Error
	 */
	public static function zone( WP_Post $post ) {
		$zone = Zone::for_post( $post );

		if ( null === $zone ) {
			return new WP_Error(
				'cinq_wp_editor_no_zone',
				sprintf( 'Le contenu « %s » n’a pas de zone de blocs.', get_the_title( $post ) ),
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
		return null !== Zone::for_post( $post );
	}

	/**
	 * Returns the layouts offered on a post.
	 *
	 * The theme may narrow the layouts of the field for a post with an
	 * `acf/prepare_field` filter, as the classic edit screen applies it; a
	 * block marked `hidden` in `mcp.json` is offered to no client.
	 *
	 * @param Zone    $zone Zone.
	 * @param WP_Post $post Post.
	 * @return array<string, true>
	 */
	public static function offered( Zone $zone, WP_Post $post ): array {
		// The theme reads the post being edited out of ACF's form data, the way
		// the edit screen sets it. Put it back afterwards: this runs mid-request.
		$previous = acf_get_form_data( 'post_id' );

		acf_set_form_data( 'post_id', $post->ID );
		$prepared = acf_prepare_field( $zone->field );
		acf_set_form_data( 'post_id', $previous );

		$offered = array();

		foreach ( is_array( $prepared ) ? Zone::index_layouts( $prepared ) : array() as $name => $layout ) {
			if ( isset( $zone->layouts()[ $name ] ) && ! Annotations::get( $name )['hidden'] ) {
				$offered[ $name ] = true;
			}
		}

		return $offered;
	}

	/**
	 * Returns the layouts of a zone, ready for the client.
	 *
	 * @param Zone    $zone Zone.
	 * @param WP_Post $post Post.
	 * @return array<int, array<string, mixed>>
	 */
	public static function layouts( Zone $zone, WP_Post $post ): array {
		$offered = self::offered( $zone, $post );
		$out     = array();

		// Layouts already on the page but no longer offered stay editable.
		foreach ( $zone->layouts() as $name => $layout ) {
			$annotation = Annotations::get( (string) $name );

			$out[] = array(
				'name'        => (string) $name,
				'label'       => (string) ( $layout['label'] ?? $name ),
				'description' => $annotation['description'],
				'guidance'    => $annotation['guidance'],
				'offered'     => isset( $offered[ $name ] ),
				'fields'      => self::fields( $layout['sub_fields'] ?? array() ),
			);
		}

		return $out;
	}

	/**
	 * Returns the blocks stored on a post, keyed by field name.
	 *
	 * @param Zone $zone   Zone.
	 * @param int  $acf_id Post ID the values are stored against.
	 * @return array<int, array<string, mixed>>
	 */
	public static function read_blocks( Zone $zone, int $acf_id ): array {
		return Blocks::read( $zone, $acf_id );
	}

	/**
	 * Turns blocks sent by the editor into ACF rows, validated by ACF.
	 *
	 * @param Zone                             $zone   Zone.
	 * @param WP_Post                          $post   Post being edited.
	 * @param array<int, array<string, mixed>> $blocks Blocks, keyed by field name.
	 * @return array{rows: array<int, array<string, mixed>>, errors: array<int, array{path: string, message: string}>}
	 */
	public static function map( Zone $zone, WP_Post $post, array $blocks ): array {
		return Blocks::prepare( $zone, $blocks, self::offered( $zone, $post ) );
	}

	/**
	 * Writes rows onto the post itself.
	 *
	 * @param Zone                             $zone Zone.
	 * @param WP_Post                          $post Post.
	 * @param array<int, array<string, mixed>> $rows Rows, keyed by field key.
	 * @return true|WP_Error
	 */
	public static function publish( Zone $zone, WP_Post $post, array $rows ) {
		return $zone->write( $post->ID, $rows );
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

			// A clone shown as a group holds its fields as a group does.
			if ( 'clone' === ( $kept['type'] ?? '' ) ) {
				$kept['type'] = 'group';
			}

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
