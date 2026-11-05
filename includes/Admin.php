<?php
/**
 * Admin screen and entry points.
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

use WP_Admin_Bar;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * The editor screen, and the links that open it: in the list of pages, on the
 * edit screen, and in the admin bar of the front end.
 */
final class Admin {

	/**
	 * Slug of the editor screen.
	 */
	public const PAGE = 'cinq-editor';

	/**
	 * Hook suffix of the editor screen.
	 *
	 * @var string
	 */
	private static string $hook = '';

	/**
	 * Registers the hooks.
	 *
	 * @return void
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'admin_body_class', array( self::class, 'body_class' ) );
		add_filter( 'page_row_actions', array( self::class, 'row_action' ), 10, 2 );
		add_filter( 'post_row_actions', array( self::class, 'row_action' ), 10, 2 );
		add_action( 'post_submitbox_misc_actions', array( self::class, 'submitbox_link' ) );
		add_action( 'admin_bar_menu', array( self::class, 'admin_bar' ), 81 );
	}

	/**
	 * Returns the URL of the editor for a post.
	 *
	 * @param int $post_id Post.
	 * @return string
	 */
	public static function url( int $post_id ): string {
		return add_query_arg(
			array(
				'page' => self::PAGE,
				'post' => $post_id,
			),
			admin_url( 'admin.php' )
		);
	}

	/**
	 * Registers the screen, out of the menu.
	 *
	 * @return void
	 */
	public static function menu(): void {
		self::$hook = (string) add_submenu_page(
			'',
			'Éditeur visuel',
			'Éditeur visuel',
			'edit_pages',
			self::PAGE,
			array( self::class, 'render' )
		);
	}

	/**
	 * Prints the root the script mounts into.
	 *
	 * @return void
	 */
	public static function render(): void {
		$post = self::current_post();

		if ( ! $post instanceof WP_Post ) {
			echo '<div class="wrap"><h1>Éditeur visuel</h1><p>Ouvrez l’éditeur depuis la liste des pages.</p></div>';
			return;
		}

		echo '<div id="cinq-editor" class="cinq-editor"></div>';
	}

	/**
	 * Loads the editor on its screen.
	 *
	 * @param string $hook Current admin screen.
	 * @return void
	 */
	public static function enqueue( string $hook ): void {
		if ( '' === self::$hook || $hook !== self::$hook ) {
			return;
		}

		$post = self::current_post();

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		wp_enqueue_media();
		wp_enqueue_style( 'cinq-editor', CINQ_EDITOR_URL . 'assets/editor.css', array( 'wp-components' ), Plugin::asset_version( 'assets/editor.css' ) );
		wp_enqueue_script(
			'cinq-editor',
			CINQ_EDITOR_URL . 'assets/editor.js',
			array( 'wp-element', 'wp-components', 'wp-api-fetch', 'wp-url', 'media-editor' ),
			Plugin::asset_version( 'assets/editor.js' ),
			true
		);
		wp_add_inline_script(
			'cinq-editor',
			'window.cinqEditor = ' . wp_json_encode(
				array(
					'postId'    => $post->ID,
					'namespace' => Rest::NAMESPACE,
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Marks the editor screen so its styles can take the whole window.
	 *
	 * @param string $classes Body classes.
	 * @return string
	 */
	public static function body_class( string $classes ): string {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( null !== $screen && '' !== self::$hook && $screen->id === self::$hook ) {
			$classes .= ' cinq-editor-screen';
		}

		return $classes;
	}

	/**
	 * Adds “Éditeur visuel” to the row actions of a post that has blocks.
	 *
	 * @param array<string, string> $actions Row actions.
	 * @param WP_Post               $post    Post.
	 * @return array<string, string>
	 */
	public static function row_action( array $actions, WP_Post $post ): array {
		if ( ! self::can_open( $post ) ) {
			return $actions;
		}

		$actions['cinq_editor'] = sprintf(
			'<a href="%s">%s</a>',
			esc_url( self::url( $post->ID ) ),
			esc_html__( 'Éditeur visuel', 'cinq-editor' )
		);

		return $actions;
	}

	/**
	 * Adds a link to the editor on the post's edit screen.
	 *
	 * @param WP_Post $post Post.
	 * @return void
	 */
	public static function submitbox_link( WP_Post $post ): void {
		if ( ! self::can_open( $post ) ) {
			return;
		}

		printf(
			'<div class="misc-pub-section"><a class="button" href="%s">%s</a></div>',
			esc_url( self::url( $post->ID ) ),
			esc_html__( 'Ouvrir l’éditeur visuel', 'cinq-editor' )
		);
	}

	/**
	 * Adds “Éditer en visuel” to the admin bar of a page that has blocks.
	 *
	 * @param WP_Admin_Bar $bar Admin bar.
	 * @return void
	 */
	public static function admin_bar( WP_Admin_Bar $bar ): void {
		if ( is_admin() || ! is_singular() ) {
			return;
		}

		$post = get_queried_object();

		if ( ! $post instanceof WP_Post || ! self::can_open( $post ) ) {
			return;
		}

		$bar->add_node(
			array(
				'id'    => 'cinq-editor',
				'title' => esc_html__( 'Éditer en visuel', 'cinq-editor' ),
				'href'  => self::url( $post->ID ),
			)
		);
	}

	/**
	 * Whether a post can be opened in the editor by the current user.
	 *
	 * @param WP_Post $post Post.
	 * @return bool
	 */
	private static function can_open( WP_Post $post ): bool {
		return 'trash' !== $post->post_status
			&& current_user_can( 'edit_post', $post->ID )
			&& Model::supports( $post );
	}

	/**
	 * Returns the post the screen was opened on, when it may be edited.
	 *
	 * @return WP_Post|null
	 */
	private static function current_post(): ?WP_Post {
		$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Opens a screen, changes nothing.
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		return $post instanceof WP_Post && self::can_open( $post ) ? $post : null;
	}
}
