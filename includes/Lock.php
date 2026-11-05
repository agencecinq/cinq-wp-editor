<?php
/**
 * Post lock.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use WP_Post;
use WP_User;

defined( 'ABSPATH' ) || exit;

/**
 * Locks a post while it is open in the editor, with WordPress's own lock.
 *
 * The lock is the `_edit_lock` the classic edit screen and the block editor
 * set: whoever opens the post in one of them sees who holds it in another.
 * The editor's script keeps it with the same heartbeat, `wp-refresh-post-lock`,
 * and gives it back on leaving with the same `wp-remove-post-lock` action.
 */
final class Lock {

	/**
	 * Query argument taking the lock over, as on the classic edit screen.
	 */
	public const TAKE_OVER = 'get-post-lock';

	/**
	 * Takes the lock over when the screen is opened from « Prendre le contrôle ».
	 *
	 * @param WP_Post $post Post.
	 * @return void
	 */
	public static function take_over( WP_Post $post ): void {
		if ( empty( $_GET[ self::TAKE_OVER ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Verified right below.
			return;
		}

		check_admin_referer( 'lock-post_' . $post->ID );
		wp_set_post_lock( $post->ID );
		wp_safe_redirect( Admin::url( $post->ID ) );
		exit;
	}

	/**
	 * Locks the post for the current user, or tells who holds it.
	 *
	 * @param WP_Post $post Post.
	 * @return array<string, mixed> What the editor's script needs.
	 */
	public static function open( WP_Post $post ): array {
		$state = array(
			'value'   => '',
			'holder'  => null,
			'nonce'   => wp_create_nonce( 'update-post_' . $post->ID ),
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
		);

		$holder = self::holder( $post );

		if ( null !== $holder ) {
			$state['holder'] = array(
				'text'        => sprintf( '%1$s modifie actuellement « %2$s ». Si vous prenez le contrôle, un message préviendra %1$s, et ses modifications ne pourront plus être publiées.', $holder->display_name, get_the_title( $post ) ),
				'avatar'      => get_option( 'show_avatars' ) ? get_avatar_url( $holder->ID, array( 'size' => 128 ) ) : '',
				/** This filter is documented in wp-admin/includes/post.php */
				'canTakeOver' => (bool) apply_filters( 'override_post_lock', true, $post, $holder ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter, applied as the edit screen applies it.
				// Not wp_nonce_url(): it escapes the URL for HTML, and this one goes to the script.
				'takeOverUrl' => add_query_arg(
					array(
						self::TAKE_OVER => '1',
						'_wpnonce'      => wp_create_nonce( 'lock-post_' . $post->ID ),
					),
					Admin::url( $post->ID )
				),
			);

			return $state;
		}

		$lock = wp_set_post_lock( $post->ID );

		if ( is_array( $lock ) ) {
			$state['value'] = implode( ':', $lock );
		}

		return $state;
	}

	/**
	 * Returns who else holds the lock of a post, when the theme or a plugin
	 * has not turned the lock dialog off.
	 *
	 * @param WP_Post $post Post.
	 * @return WP_User|null
	 */
	public static function holder( WP_Post $post ): ?WP_User {
		// REST requests do not load the admin's post functions.
		require_once ABSPATH . 'wp-admin/includes/post.php';

		$user_id = wp_check_post_lock( $post->ID );
		$user    = $user_id ? get_userdata( $user_id ) : false;

		if ( ! $user instanceof WP_User ) {
			return null;
		}

		/** This filter is documented in wp-admin/includes/post.php */
		return apply_filters( 'show_post_locked_dialog', true, $post, $user ) ? $user : null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter, applied as the edit screen applies it.
	}
}
