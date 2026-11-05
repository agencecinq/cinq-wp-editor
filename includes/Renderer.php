<?php
/**
 * Single-block rendering.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use Timber\Timber;
use WP_Post;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Renders some blocks of a post, alone, as the page would render them.
 *
 * Rendering the whole page to keep one block is what made the preview slow:
 * header, footer, menus and every other block, for one changed title. Here the
 * request is set up as the page's own (main query, global post, Timber
 * context) and only the asked blocks go through their template, as Shopify's
 * Section Rendering API does.
 *
 * Whatever cannot be rendered this way comes back as null, and the editor
 * falls back to fetching the whole page.
 */
final class Renderer {

	/**
	 * Returns the HTML of some blocks of the draft, each in its preview marker.
	 *
	 * @param WP_Post         $post     Post being edited.
	 * @param Zone            $zone     Zone.
	 * @param int             $draft_id Draft holding the blocks.
	 * @param array<int, int> $indexes  Indexes of the blocks to render.
	 * @return array<int, string|null> HTML keyed by index.
	 */
	public static function blocks( WP_Post $post, Zone $zone, int $draft_id, array $indexes ): array {
		$html = array_fill_keys( $indexes, null );

		if ( empty( $indexes ) || ! class_exists( Timber::class ) ) {
			return $html;
		}

		Preview::activate( $post->ID, $zone, $draft_id );

		// Blocks may ask for the current page: the breadcrumb, a grid of
		// posts. The request becomes the page's own before they render.
		global $wp_query, $wp_the_query;

		$previous_query = $wp_query;
		$query          = new WP_Query(
			array(
				'p'           => $post->ID,
				'post_type'   => $post->post_type,
				'post_status' => 'any',
			)
		);

		$wp_query     = $query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restored below.
		$wp_the_query = $query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restored below.

		if ( $query->have_posts() ) {
			$query->the_post();
		}

		try {
			$blocks  = get_field( $zone->name(), $post->ID );
			$blocks  = is_array( $blocks ) ? array_values( $blocks ) : array();
			$context = Timber::context();

			foreach ( $indexes as $index ) {
				if ( ! isset( $blocks[ $index ] ) || ! is_array( $blocks[ $index ] ) ) {
					continue;
				}

				$rendered = Timber::compile(
					'cinq-wp-editor/block.html.twig',
					array_merge(
						$context,
						array(
							'block' => $blocks[ $index ],
							'index' => $index,
						)
					)
				);

				$html[ $index ] = is_string( $rendered ) ? $rendered : null;
			}
		} catch ( \Throwable $error ) {
			// The editor fetches the whole page instead.
			unset( $error );
		} finally {
			$wp_query     = $previous_query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restoring.
			$wp_the_query = $previous_query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restoring.
			wp_reset_postdata();
		}

		return $html;
	}
}
