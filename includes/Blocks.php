<?php
/**
 * Blocks between the editor and ACF.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Turns ACF rows into the editor's blocks, and back, validated by ACF.
 *
 * ACF keys stored rows by field key; the editor keys its blocks by field name,
 * which is what its controls show. Values themselves stay as ACF stores them:
 * images as attachment IDs, links as `{url, title, target}`. The editor's
 * controls produce those values already, so nothing else is translated.
 *
 * Validation is ACF's own, `acf_validate_value()`, the one the classic edit
 * screen runs: required fields, min and max, field type rules, and the
 * `acf/validate_value` filters of the theme. Its errors carry the input name
 * of the form, `blocks[0][field_…]`; they are reported on the editor's path,
 * `blocks[0].title`.
 *
 * The fields of the fixed sections go the same way, as one row: input names
 * `acf[field_…]`, as the edit screen posts them, and editor paths
 * `fields.hero.title`.
 */
final class Blocks {

	/**
	 * Editor path of each input name, filled while the rows are built.
	 *
	 * @var array<string, string>
	 */
	private array $paths = array();

	/**
	 * Errors found before ACF validates.
	 *
	 * @var array<int, array{path: string, message: string}>
	 */
	private array $errors = array();

	/**
	 * Returns the blocks stored on a post, keyed by field name.
	 *
	 * @param Zone $zone   Zone.
	 * @param int  $acf_id Post the rows are stored against.
	 * @return array<int, array<string, mixed>>
	 */
	public static function read( Zone $zone, int $acf_id ): array {
		return self::from_blocks( $zone->layouts(), $zone->read( $acf_id ) );
	}

	/**
	 * Builds the ACF rows of the editor's blocks, and validates them.
	 *
	 * A block whose layout the theme no longer has is left out of the rows. A
	 * block the post no longer offers is kept, so the preview still shows it,
	 * and reported.
	 *
	 * @param Zone                             $zone    Zone.
	 * @param array<int, array<string, mixed>> $blocks  Blocks, keyed by field name.
	 * @param array<string, true>              $offered Layouts offered on the post.
	 * @return array{rows: array<int, array<string, mixed>>, errors: array<int, array{path: string, message: string}>}
	 */
	public static function prepare( Zone $zone, array $blocks, array $offered ): array {
		$builder = new self();
		$rows    = $builder->to_blocks( $zone->layouts(), $blocks, Zone::NAME, Zone::NAME, $offered );

		// The classic edit screen filters HTML the same way.
		if ( ! acf_allow_unfiltered_html() ) {
			$rows = wp_kses_post_deep( $rows );
		}

		$inputs = array(
			Zone::NAME => array(
				'field' => $zone->field,
				'value' => $rows,
			),
		);

		return array(
			'rows'   => array_values( $rows ),
			'errors' => array_merge( $builder->errors, $builder->validate( $inputs, Zone::NAME ) ),
		);
	}

	/**
	 * Returns the values of the fixed sections stored on a post, keyed by
	 * field name.
	 *
	 * @param Sections $sections Sections.
	 * @param int      $acf_id   Post the values are stored against.
	 * @return array<string, mixed>
	 */
	public static function read_fields( Sections $sections, int $acf_id ): array {
		return self::from_row( $sections->fields(), $sections->read( $acf_id ) );
	}

	/**
	 * Builds the row of the fixed sections' values, and validates it.
	 *
	 * @param Sections             $sections Sections.
	 * @param array<string, mixed> $values   Values, keyed by field name.
	 * @return array{row: array<string, mixed>, errors: array<int, array{path: string, message: string}>}
	 */
	public static function prepare_fields( Sections $sections, array $values ): array {
		$builder = new self();
		$row     = $builder->to_row( $sections->fields(), $values, 'acf', Sections::PATH );

		if ( ! acf_allow_unfiltered_html() ) {
			$row = wp_kses_post_deep( $row );
		}

		$inputs = array();

		foreach ( $sections->fields() as $field ) {
			$key = (string) $field['key'];

			$inputs[ sprintf( 'acf[%s]', $key ) ] = array(
				'field' => $field,
				'value' => $row[ $key ] ?? '',
			);
		}

		return array(
			'row'    => $row,
			'errors' => array_merge( $builder->errors, $builder->validate( $inputs, Sections::PATH ) ),
		);
	}

	/**
	 * Runs ACF's validation over some values.
	 *
	 * @param array<string, array{field: array<string, mixed>, value: mixed}> $inputs   Values and their field, keyed by input name.
	 * @param string                                                          $fallback Editor path of an error on an input not built here.
	 * @return array<int, array{path: string, message: string}>
	 */
	private function validate( array $inputs, string $fallback ): array {
		acf_reset_validation_errors();

		foreach ( $inputs as $input => $checked ) {
			acf_validate_value( $checked['value'], $checked['field'], $input );
		}

		// False, not an empty list, when every value is valid.
		$found  = acf_get_validation_errors();
		$errors = array();

		foreach ( is_array( $found ) ? $found : array() as $error ) {
			$input    = (string) ( $error['input'] ?? '' );
			$errors[] = array(
				'path'    => $this->paths[ $input ] ?? $fallback,
				'message' => wp_strip_all_tags( (string) ( $error['message'] ?? '' ) ),
			);
		}

		acf_reset_validation_errors();

		return $errors;
	}

	/**
	 * Builds the rows of a flexible content field.
	 *
	 * Rows keep the index of their block, so that ACF's input names point at
	 * the right block even when one before was left out.
	 *
	 * @param array<string, array<string, mixed>> $layouts Layouts, keyed by name.
	 * @param mixed                               $blocks  Blocks, keyed by field name.
	 * @param string                              $input   Input name of the field.
	 * @param string                              $path    Editor path of the field.
	 * @param array<string, true>|null            $offered Layouts offered, null for all.
	 * @return array<int, array<string, mixed>>
	 */
	private function to_blocks( array $layouts, $blocks, string $input, string $path, ?array $offered = null ): array {
		$rows = array();

		foreach ( array_values( is_array( $blocks ) ? $blocks : array() ) as $index => $block ) {
			$block_path = sprintf( '%s[%d]', $path, $index );
			$name       = is_array( $block ) ? (string) ( $block['acf_fc_layout'] ?? '' ) : '';

			if ( ! isset( $layouts[ $name ] ) ) {
				$this->errors[] = array(
					'path'    => $block_path,
					/* translators: %s: Block type. */
					'message' => sprintf( __( 'The theme has no “%s” block: delete this block.', 'cinq-wp-editor' ), $name ),
				);
				continue;
			}

			if ( null !== $offered && ! isset( $offered[ $name ] ) ) {
				$this->errors[] = array(
					'path'    => $block_path,
					'message' => __( 'This block is no longer offered on this content: delete it to publish.', 'cinq-wp-editor' ),
				);
			}

			$block_input = sprintf( '%s[%d]', $input, $index );

			$this->paths[ $block_input ] = $block_path;

			$rows[ $index ] = array( 'acf_fc_layout' => $name ) + $this->to_row( $layouts[ $name ]['sub_fields'] ?? array(), $block, $block_input, $block_path );
		}

		return $rows;
	}

	/**
	 * Builds a row keyed by field key out of values keyed by field name.
	 *
	 * Every field gets a value, empty when the editor sent none, as an empty
	 * input of the edit screen posts it: ACF only validates the inputs it is
	 * given. Defaults are the editor's to fill, when it adds a block.
	 *
	 * @param array<int, array<string, mixed>> $fields Fields of the row.
	 * @param array<string, mixed>             $values Values, keyed by field name.
	 * @param string                           $input  Input name of the row.
	 * @param string                           $path   Editor path of the row.
	 * @return array<string, mixed>
	 */
	private function to_row( array $fields, array $values, string $input, string $path ): array {
		$row = array();

		foreach ( $fields as $field ) {
			$name = (string) ( $field['name'] ?? '' );
			$key  = (string) ( $field['key'] ?? '' );

			if ( '' === $name || '' === $key ) {
				continue;
			}

			$field_input = sprintf( '%s[%s]', $input, $key );
			$field_path  = sprintf( '%s.%s', $path, $name );
			$value       = array_key_exists( $name, $values ) ? $values[ $name ] : '';

			$this->paths[ $field_input ] = $field_path;

			$row[ $key ] = $this->to_value( $field, $value, $field_input, $field_path );
		}

		return $row;
	}

	/**
	 * Builds the value of one field.
	 *
	 * @param array<string, mixed> $field Field.
	 * @param mixed                $value Value sent by the editor.
	 * @param string               $input Input name of the field.
	 * @param string               $path  Editor path of the field.
	 * @return mixed
	 */
	private function to_value( array $field, $value, string $input, string $path ) {
		switch ( $field['type'] ?? '' ) {
			case 'group':
			case 'clone':
				return $this->to_row( $field['sub_fields'] ?? array(), is_array( $value ) ? $value : array(), $input, $path );

			case 'repeater':
				$rows = array();

				foreach ( array_values( is_array( $value ) ? $value : array() ) as $index => $row ) {
					$rows[] = $this->to_row(
						$field['sub_fields'] ?? array(),
						is_array( $row ) ? $row : array(),
						sprintf( '%s[%d]', $input, $index ),
						sprintf( '%s[%d]', $path, $index )
					);
				}

				return $rows;

			case 'flexible_content':
				return array_values( $this->to_blocks( Zone::index_layouts( $field ), $value, $input, $path ) );

			case 'true_false':
				// The toggle sends a boolean; ACF stores "1" or "0".
				return is_scalar( $value ) && '1' === (string) $value ? 1 : 0;

			default:
				return $value ?? '';
		}
	}

	/**
	 * Turns the rows of a flexible content field into blocks keyed by name.
	 *
	 * @param array<string, array<string, mixed>> $layouts Layouts, keyed by name.
	 * @param mixed                               $rows    Rows, keyed by field key.
	 * @return array<int, mixed>
	 */
	private static function from_blocks( array $layouts, $rows ): array {
		$blocks = array();

		foreach ( array_values( is_array( $rows ) ? $rows : array() ) as $row ) {
			$name = is_array( $row ) ? (string) ( $row['acf_fc_layout'] ?? '' ) : '';

			// A block the theme no longer has comes back as stored.
			$blocks[] = isset( $layouts[ $name ] )
				? array( 'acf_fc_layout' => $name ) + self::from_row( $layouts[ $name ]['sub_fields'] ?? array(), $row )
				: $row;
		}

		return $blocks;
	}

	/**
	 * Turns a row keyed by field key into values keyed by field name.
	 *
	 * @param array<int, array<string, mixed>> $fields Fields of the row.
	 * @param array<string, mixed>             $row    Row, keyed by field key.
	 * @return array<string, mixed>
	 */
	private static function from_row( array $fields, array $row ): array {
		$values = array();

		foreach ( $fields as $field ) {
			$name = (string) ( $field['name'] ?? '' );
			$key  = (string) ( $field['key'] ?? '' );

			if ( '' === $name || ! array_key_exists( $key, $row ) ) {
				continue;
			}

			$values[ $name ] = self::from_value( $field, $row[ $key ] );
		}

		return $values;
	}

	/**
	 * Turns the value of one field into the editor's.
	 *
	 * @param array<string, mixed> $field Field.
	 * @param mixed                $value Value, as ACF loads it unformatted.
	 * @return mixed
	 */
	private static function from_value( array $field, $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}

		switch ( $field['type'] ?? '' ) {
			case 'group':
			case 'clone':
				return self::from_row( $field['sub_fields'] ?? array(), $value );

			case 'repeater':
				return array_map(
					static fn( $row ) => is_array( $row ) ? self::from_row( $field['sub_fields'] ?? array(), $row ) : $row,
					array_values( $value )
				);

			case 'flexible_content':
				return self::from_blocks( Zone::index_layouts( $field ), $value );

			default:
				return $value;
		}
	}
}
