<?php
/**
 * Fixed sections of a post.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * The fields of a post outside its zone: its template's own, such as a hero.
 *
 * Each field group ACF shows on the post, in the main column, is a fixed
 * section: edited as a block is, but never moved, duplicated nor deleted. A
 * group in the side column holds settings of the post, not content, and is
 * left to the classic edit screen.
 */
final class Sections {

	/**
	 * Editor path of the sections' fields, keyed by name below it.
	 */
	public const PATH = 'fields';

	/**
	 * Wraps the field groups of a post.
	 *
	 * @param array<int, array{key: string, title: string, fields: array<int, array<string, mixed>>}> $groups Field groups, without the zone.
	 */
	public function __construct( public readonly array $groups ) {}

	/**
	 * Returns the fixed sections of a post.
	 *
	 * @param WP_Post $post Post.
	 * @param Zone    $zone Zone of the post, left out of its group.
	 * @return self
	 */
	public static function for_post( WP_Post $post, Zone $zone ): self {
		$groups = acf_get_field_groups(
			array(
				'post_id'   => $post->ID,
				'post_type' => $post->post_type,
			)
		);
		$found  = array();

		foreach ( $groups as $group ) {
			if ( 'side' === ( $group['position'] ?? '' ) ) {
				continue;
			}

			$fields = array_values(
				array_filter(
					(array) acf_get_fields( $group ),
					static fn( $field ): bool => is_array( $field ) && ( $field['key'] ?? '' ) !== $zone->key()
				)
			);

			if ( ! empty( $fields ) ) {
				$found[] = array(
					'key'    => (string) ( $group['key'] ?? '' ),
					'title'  => (string) ( $group['title'] ?? '' ),
					'fields' => $fields,
				);
			}
		}

		return new self( $found );
	}

	/**
	 * Returns the fields of every section that hold a value: tabs and
	 * messages left out.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function fields(): array {
		$fields = array();

		foreach ( $this->groups as $group ) {
			foreach ( $group['fields'] as $field ) {
				if ( '' !== (string) ( $field['name'] ?? '' ) ) {
					$fields[] = $field;
				}
			}
		}

		return $fields;
	}

	/**
	 * Returns the values stored on a post, unformatted and keyed by field key.
	 *
	 * @param int $acf_id Post the values are stored against.
	 * @return array<string, mixed>
	 */
	public function read( int $acf_id ): array {
		$row = array();

		foreach ( $this->fields() as $field ) {
			$value = acf_get_value( $acf_id, $field );

			if ( null !== $value ) {
				$row[ (string) $field['key'] ] = $value;
			}
		}

		return $row;
	}

	/**
	 * Writes values onto a post.
	 *
	 * @param int                  $acf_id Post the values are stored against.
	 * @param array<string, mixed> $row    Values, keyed by field key.
	 * @return void
	 */
	public function write( int $acf_id, array $row ): void {
		foreach ( $this->fields() as $field ) {
			$key = (string) $field['key'];

			if ( ! array_key_exists( $key, $row ) ) {
				continue;
			}

			// Slashed for the same reason as the zone's rows.
			acf_update_value( wp_slash( $row[ $key ] ), $acf_id, $field );
			acf_flush_value_cache( $acf_id, (string) $field['name'] );
		}
	}

	/**
	 * Returns the field of a section a field being loaded is, if any.
	 *
	 * @param array<string, mixed> $field Field, as ACF loads it.
	 * @return array<string, mixed>|null
	 */
	public function owner( array $field ): ?array {
		return array_find(
			$this->fields(),
			static fn( array $own ): bool => ( $field['key'] ?? '' ) === $own['key'] || ( $field['name'] ?? '' ) === $own['name']
		);
	}

	/**
	 * Finds a field of the sections by its key, at any depth.
	 *
	 * @param string $key Field key.
	 * @return array<string, mixed>|null The field, or null when the sections have none such.
	 */
	public function field( string $key ): ?array {
		return Zone::find( $this->fields(), $key );
	}
}
