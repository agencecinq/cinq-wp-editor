<?php
/**
 * Draft storage.
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Keeps the unpublished blocks of each editor, one hidden post per post and per user.
 *
 * The rows are written with ACF onto that hidden post, exactly as they would be
 * on the page. The preview then reads them back through ACF, which formats
 * them the way the theme expects: images, links, clones and all. Nothing about
 * ACF's storage is reimplemented here.
 *
 * The blocks as the editor sent them are kept next to the rows, so that a block
 * ACF refused (a required field still empty) is not lost on reload.
 */
final class Drafts {

	/**
	 * Hidden post type holding the drafts.
	 */
	public const POST_TYPE = 'cinq_editor_draft';

	/**
	 * Meta key of the editor state.
	 */
	private const STATE_META = '_cinq_editor_blocks';

	/**
	 * Registers the post type.
	 *
	 * @return void
	 */
	public static function register(): void {
		add_action(
			'init',
			static function (): void {
				register_post_type(
					self::POST_TYPE,
					array(
						'label'               => 'Brouillons de l’éditeur',
						'public'              => false,
						'show_ui'             => false,
						'show_in_rest'        => false,
						'exclude_from_search' => true,
						'supports'            => array( 'author' ),
						'rewrite'             => false,
						'query_var'           => false,
					)
				);
			}
		);

		// A post deleted for good takes its drafts with it.
		add_action(
			'before_delete_post',
			static function ( int $post_id ): void {
				foreach ( self::all_for( $post_id ) as $draft_id ) {
					wp_delete_post( $draft_id, true );
				}
			}
		);
	}

	/**
	 * Returns the draft of a user on a post, if any.
	 *
	 * @param int $post_id Post being edited.
	 * @param int $user_id User.
	 * @return int Draft post ID, or 0.
	 */
	public static function find( int $post_id, int $user_id ): int {
		$ids = get_posts(
			array(
				'post_type'        => self::POST_TYPE,
				'post_status'      => 'any',
				'post_parent'      => $post_id,
				'author'           => $user_id,
				'fields'           => 'ids',
				'posts_per_page'   => 1,
				'no_found_rows'    => true,
				'suppress_filters' => true,
			)
		);

		return empty( $ids ) ? 0 : (int) $ids[0];
	}

	/**
	 * Saves a draft, creating its hidden post on first save.
	 *
	 * @param Zone                             $zone   Zone.
	 * @param WP_Post                          $post   Post being edited.
	 * @param int                              $user_id User.
	 * @param array<int, array<string, mixed>> $blocks Blocks as the editor sent them.
	 * @param array<int, array<string, mixed>> $rows   The same blocks, as ACF rows.
	 * @return int Draft post ID, or 0 on failure.
	 */
	public static function save( Zone $zone, WP_Post $post, int $user_id, array $blocks, array $rows ): int {
		$draft_id = self::find( $post->ID, $user_id );

		if ( 0 === $draft_id ) {
			$draft_id = wp_insert_post(
				array(
					'post_type'   => self::POST_TYPE,
					'post_status' => 'draft',
					'post_parent' => $post->ID,
					'post_author' => $user_id,
					'post_title'  => sprintf( 'Brouillon de « %s »', $post->post_title ),
				)
			);

			if ( ! is_int( $draft_id ) || 0 === $draft_id ) {
				return 0;
			}
		}

		if ( is_wp_error( $zone->write( $draft_id, $rows ) ) ) {
			return 0;
		}

		update_post_meta( $draft_id, self::STATE_META, wp_slash( (string) wp_json_encode( $blocks ) ) );

		// Touches the draft so its modified date tells when it was last edited.
		wp_update_post(
			array(
				'ID'          => $draft_id,
				'post_status' => 'draft',
			)
		);

		return $draft_id;
	}

	/**
	 * Returns the blocks of a draft as the editor sent them.
	 *
	 * @param int $draft_id Draft post ID.
	 * @return array<int, array<string, mixed>>|null Null when the state is unreadable.
	 */
	public static function blocks( int $draft_id ): ?array {
		$json    = (string) get_post_meta( $draft_id, self::STATE_META, true );
		$decoded = '' === $json ? null : json_decode( $json, true );

		return is_array( $decoded ) ? array_values( $decoded ) : null;
	}

	/**
	 * Deletes the draft of a user on a post.
	 *
	 * @param int $post_id Post being edited.
	 * @param int $user_id User.
	 * @return void
	 */
	public static function discard( int $post_id, int $user_id ): void {
		$draft_id = self::find( $post_id, $user_id );

		if ( 0 !== $draft_id ) {
			wp_delete_post( $draft_id, true );
		}
	}

	/**
	 * Returns every draft of a post, whoever owns it.
	 *
	 * @param int $post_id Post.
	 * @return array<int, int>
	 */
	private static function all_for( int $post_id ): array {
		if ( self::POST_TYPE === get_post_type( $post_id ) ) {
			return array();
		}

		return array_map(
			'intval',
			get_posts(
				array(
					'post_type'        => self::POST_TYPE,
					'post_status'      => 'any',
					'post_parent'      => $post_id,
					'fields'           => 'ids',
					'posts_per_page'   => -1,
					'no_found_rows'    => true,
					'suppress_filters' => true,
				)
			)
		);
	}
}
