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
 * Reads the zone, the layouts, the fixed sections and the blocks of a post out
 * of ACF.
 *
 * The editor edits the zone of a post, the `blocks` field of a page or a case
 * study, and the fields of its template around it. Options pages and terms are
 * out of scope here.
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
		'display_format',
		'first_day',
		'enable_opacity',
		'role',
		'center_lat',
		'center_lng',
		'zoom',
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
				/* translators: %s: Post title. */
				sprintf( __( '“%s” has no block zone.', 'cinq-wp-editor' ), get_the_title( $post ) ),
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
	 * Returns the fixed sections of a post.
	 *
	 * @param Zone    $zone Zone.
	 * @param WP_Post $post Post.
	 * @return Sections
	 */
	public static function sections( Zone $zone, WP_Post $post ): Sections {
		return Sections::for_post( $post, $zone );
	}

	/**
	 * Returns the fixed sections, ready for the client.
	 *
	 * @param Sections $sections Sections.
	 * @return array<int, array{key: string, title: string, fields: array<int, array<string, mixed>>}>
	 */
	public static function groups( Sections $sections ): array {
		return array_map(
			static fn( array $group ): array => array(
				'key'    => $group['key'],
				'title'  => $group['title'],
				'fields' => self::fields( $group['fields'] ),
			),
			$sections->groups
		);
	}

	/**
	 * Returns the blocks and the fixed sections' values stored on a post,
	 * keyed by field name.
	 *
	 * @param Zone     $zone     Zone.
	 * @param Sections $sections Sections.
	 * @param int      $acf_id   Post ID the values are stored against.
	 * @return array{blocks: array<int, array<string, mixed>>, fields: array<string, mixed>}
	 */
	public static function read( Zone $zone, Sections $sections, int $acf_id ): array {
		return array(
			'blocks' => Blocks::read( $zone, $acf_id ),
			'fields' => Blocks::read_fields( $sections, $acf_id ),
		);
	}

	/**
	 * Turns the blocks and the fields sent by the editor into ACF values,
	 * validated by ACF.
	 *
	 * @param Zone                                                                          $zone     Zone.
	 * @param Sections                                                                      $sections Sections.
	 * @param WP_Post                                                                       $post     Post being edited.
	 * @param array{blocks: array<int, array<string, mixed>>, fields: array<string, mixed>} $sent     Blocks and fields, keyed by field name.
	 * @return array{rows: array<int, array<string, mixed>>, row: array<string, mixed>, errors: array<int, array{path: string, message: string}>}
	 */
	public static function map( Zone $zone, Sections $sections, WP_Post $post, array $sent ): array {
		$blocks = Blocks::prepare( $zone, $sent['blocks'], self::offered( $zone, $post ) );
		$fields = Blocks::prepare_fields( $sections, $sent['fields'] );

		return array(
			'rows'   => $blocks['rows'],
			'row'    => $fields['row'],
			'errors' => array_merge( $blocks['errors'], $fields['errors'] ),
		);
	}

	/**
	 * Writes the zone's rows and the sections' row onto the post itself.
	 *
	 * @param Zone                                                                     $zone     Zone.
	 * @param Sections                                                                 $sections Sections.
	 * @param WP_Post                                                                  $post     Post.
	 * @param array{rows: array<int, array<string, mixed>>, row: array<string, mixed>} $mapped   Values, keyed by field key.
	 * @return true|WP_Error
	 */
	public static function publish( Zone $zone, Sections $sections, WP_Post $post, array $mapped ) {
		$written = $zone->write( $post->ID, $mapped['rows'] );

		if ( is_wp_error( $written ) ) {
			return $written;
		}

		$sections->write( $post->ID, $mapped['row'] );

		return true;
	}

	/**
	 * Returns the tabs of an icon picker the editor can draw, as ACF offers
	 * them: its own list, filtered by the user's capabilities and by
	 * `acf/fields/icon_picker/tabs`, then by the field's setting.
	 *
	 * @param array<string, mixed> $field Icon picker field.
	 * @return array<int, array{name: string, label: string}>
	 */
	private static function icon_tabs( array $field ): array {
		$tabs    = acf_get_field_type( 'icon_picker' )->get_tabs();
		$allowed = is_array( $field['tabs'] ?? null ) ? $field['tabs'] : array_keys( $tabs );
		$out     = array();

		foreach ( $tabs as $name => $label ) {
			// Custom icon lists from other plugins are left to the edit screen.
			if ( in_array( $name, $allowed, true ) && in_array( $name, array( 'dashicons', 'media_library', 'url' ), true ) ) {
				$out[] = array(
					'name'  => (string) $name,
					'label' => wp_strip_all_tags( (string) $label ),
				);
			}
		}

		return $out;
	}

	/**
	 * Returns the archives a page link may point to, as ACF lists them: those
	 * of the field's post types, or of every public post type.
	 *
	 * @param array<string, mixed> $field Page link field.
	 * @return array<int, array{id: string, title: string}>
	 */
	private static function archives( array $field ): array {
		$post_types = empty( $field['post_type'] ) ? get_post_types( array( 'public' => true ) ) : (array) $field['post_type'];
		$out        = array();

		foreach ( $post_types as $post_type ) {
			$link   = get_post_type_archive_link( (string) $post_type );
			$object = get_post_type_object( (string) $post_type );

			if ( $link && $object ) {
				$out[] = array(
					'id'    => $link,
					/* translators: %s: Post type name. */
					'title' => sprintf( __( 'Archive: %s', 'cinq-wp-editor' ), $object->labels->name ),
				);
			}
		}

		return $out;
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

			if ( 'icon_picker' === ( $kept['type'] ?? '' ) ) {
				$kept['icon_tabs'] = self::icon_tabs( $field );
			}

			if ( 'page_link' === ( $kept['type'] ?? '' ) && ! empty( $field['allow_archives'] ) ) {
				$kept['archives'] = self::archives( $field );
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
