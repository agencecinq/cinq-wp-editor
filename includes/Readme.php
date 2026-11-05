<?php
/**
 * Plugin readme, as the sections of the "View details" modal.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Turns a readme.txt into the HTML sections of the plugin information, as
 * WordPress.org does.
 *
 * Handles what the readme uses: "== Section ==", "= Heading =", paragraphs,
 * nested bulleted and numbered lists, fenced code, **bold**, `code` and
 * [links](https://…).
 */
final class Readme {

	/**
	 * Section keys of the plugin information by readme section name.
	 */
	private const SECTIONS = array(
		'Description'                => 'description',
		'Installation'               => 'installation',
		'Frequently Asked Questions' => 'faq',
		'Changelog'                  => 'changelog',
	);

	/**
	 * Pattern of a list item: its indent, its marker and its text.
	 */
	private const LIST_ITEM = '/^( *)(\*|\d+\.) +(.*)$/';

	/**
	 * Pattern of fenced code, its content captured.
	 */
	private const FENCE = '/^```[^\n]*\n(.*?)^```[ \t]*$/ms';

	/**
	 * Returns the HTML sections of a readme, keyed as the plugin information expects them.
	 *
	 * @param string $readme Readme content.
	 * @return array<string, string>
	 */
	public static function sections( string $readme ): array {
		$parts    = preg_split( '/^==\s*([^=].*?)\s*==\s*$/m', str_replace( "\r\n", "\n", $readme ), -1, PREG_SPLIT_DELIM_CAPTURE );
		$sections = array();

		// The text before the first section holds the headers.
		foreach ( array_chunk( array_slice( $parts, 1 ), 2 ) as list( $name, $text ) ) {
			$key = self::SECTIONS[ $name ] ?? null;

			if ( $key ) {
				$sections[ $key ] = self::html( $text );
			}
		}

		return $sections;
	}

	/**
	 * Returns the value of a readme header, e.g. "Tested up to".
	 *
	 * @param string $readme Readme content.
	 * @param string $name   Header name.
	 * @return string
	 */
	public static function header( string $readme, string $name ): string {
		return preg_match( '/^' . preg_quote( $name, '/' ) . ':\s*(.+?)\s*$/mi', $readme, $match ) ? $match[1] : '';
	}

	/**
	 * Returns the HTML of a section: its fenced code as is, the text around it
	 * in blocks.
	 *
	 * @param string $text Section text.
	 * @return string
	 */
	private static function html( string $text ): string {
		$html = '';

		// Odd parts are the content of fenced code, which may hold blank lines.
		foreach ( preg_split( self::FENCE, trim( $text ), -1, PREG_SPLIT_DELIM_CAPTURE ) as $index => $part ) {
			$html .= 1 === $index % 2 ? '<pre><code>' . esc_html( rtrim( $part ) ) . '</code></pre>' : self::blocks( $part );
		}

		return $html;
	}

	/**
	 * Returns the HTML of text: headings, lists and paragraphs, split by blank lines.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	private static function blocks( string $text ): string {
		$html = '';

		foreach ( preg_split( '/\n\s*\n/', trim( $text ), -1, PREG_SPLIT_NO_EMPTY ) as $block ) {
			$lines = explode( "\n", $block );

			if ( preg_match( '/^=\s*(.+?)\s*=$/', $lines[0], $match ) ) {
				$html .= '<h4>' . self::inline( $match[1] ) . '</h4>';
				array_shift( $lines );
			}

			if ( ! $lines ) {
				continue;
			}

			$html .= preg_match( self::LIST_ITEM, $lines[0] ) ? self::list_html( $lines ) : '<p>' . self::inline( implode( ' ', $lines ) ) . '</p>';
		}

		return $html;
	}

	/**
	 * Returns the HTML of list lines, a deeper indent opening a list in the item above.
	 *
	 * @param array<int, string> $lines List lines.
	 * @return string
	 */
	private static function list_html( array $lines ): string {
		$html  = '';
		$lists = array();

		foreach ( $lines as $line ) {
			if ( ! preg_match( self::LIST_ITEM, $line, $match ) ) {
				$html .= ' ' . self::inline( trim( $line ) );
				continue;
			}

			$indent = strlen( $match[1] );
			$tag    = '*' === $match[2] ? 'ul' : 'ol';

			while ( $lists && $indent < end( $lists )['indent'] ) {
				$html .= '</li></' . array_pop( $lists )['tag'] . '>';
			}

			if ( $lists && end( $lists )['indent'] === $indent ) {
				$html .= '</li>';
			} else {
				$html   .= "<$tag>";
				$lists[] = array(
					'indent' => $indent,
					'tag'    => $tag,
				);
			}

			$html .= '<li>' . self::inline( $match[3] );
		}

		while ( $lists ) {
			$html .= '</li></' . array_pop( $lists )['tag'] . '>';
		}

		return $html;
	}

	/**
	 * Returns the HTML of a line of text, escaped, with its code, bold and links.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	private static function inline( string $text ): string {
		$html = esc_html( $text );
		$html = (string) preg_replace( '/`([^`]+)`/', '<code>$1</code>', $html );
		$html = (string) preg_replace( '/\*\*(.+?)\*\*/', '<strong>$1</strong>', $html );

		return (string) preg_replace_callback(
			'/\[([^\]]+)\]\(([^)\s]+)\)/',
			fn( array $link ) => '<a href="' . esc_url( html_entity_decode( $link[2] ) ) . '">' . $link[1] . '</a>',
			$html
		);
	}
}
