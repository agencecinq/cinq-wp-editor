<?php
/**
 * Admin screen and entry points.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

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
	public const PAGE = 'cinq-wp-editor';

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
			__( 'Visual editor', 'cinq-wp-editor' ),
			__( 'Visual editor', 'cinq-wp-editor' ),
			'edit_pages',
			self::PAGE,
			array( self::class, 'render' )
		);

		add_action( 'load-' . self::$hook, array( self::class, 'load' ) );
	}

	/**
	 * Prepares the screen: takes the lock over when asked, then names it.
	 *
	 * @return void
	 */
	public static function load(): void {
		$post = self::current_post();

		if ( $post instanceof WP_Post ) {
			Lock::take_over( $post );
		}

		self::title();
	}

	/**
	 * Names the screen, as the block editor names its own after the post.
	 *
	 * A screen out of the menu gets no title from WordPress, and the admin
	 * header would pass null to `strip_tags()`.
	 *
	 * @return void
	 */
	private static function title(): void {
		global $title;

		$post  = self::current_post();
		$title = $post instanceof WP_Post // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The admin header reads the screen title from it.
			/* translators: %s: Post title. */
			? sprintf( __( 'Visual editor: “%s”', 'cinq-wp-editor' ), get_the_title( $post ) )
			: __( 'Visual editor', 'cinq-wp-editor' );
	}

	/**
	 * Prints the root the script mounts into.
	 *
	 * @return void
	 */
	public static function render(): void {
		$post = self::current_post();

		if ( ! $post instanceof WP_Post ) {
			echo '<div class="wrap"><h1>' . esc_html__( 'Visual editor', 'cinq-wp-editor' ) . '</h1><p>' . esc_html__( 'Open the editor from the list of pages.', 'cinq-wp-editor' ) . '</p></div>';
			return;
		}

		echo '<div id="cinq-wp-editor" class="cinq-wp-editor"></div>';
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
		wp_enqueue_editor();
		wp_enqueue_style( 'cinq-wp-editor', CINQ_WP_EDITOR_URL . 'assets/editor.css', array( 'wp-components', 'wp-block-editor' ), Plugin::asset_version( 'assets/editor.css' ) );
		// The build lists the @wordpress packages the script imports.
		$asset = require CINQ_WP_EDITOR_PATH . Plugin::SCRIPT_ASSET;

		wp_enqueue_script(
			'cinq-wp-editor',
			CINQ_WP_EDITOR_URL . 'build/editor.js',
			// WordPress scripts that are no packages: the media library and the heartbeat.
			array_merge( $asset['dependencies'], array( 'media-editor', 'heartbeat' ) ),
			$asset['version'],
			true
		);
		wp_set_script_translations( 'cinq-wp-editor', 'cinq-wp-editor', CINQ_WP_EDITOR_PATH . 'languages' );
		wp_add_inline_script(
			'cinq-wp-editor',
			'window.cinqWpEditor = ' . wp_json_encode(
				array(
					'postId'    => $post->ID,
					'namespace' => Rest::NAMESPACE,
					'toolbars'  => self::toolbars(),
					'swatches'  => self::swatches(),
					'dashicons' => self::dashicons(),
					'lock'      => Lock::open( $post ),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Returns ACF's WYSIWYG toolbars, keyed as a field's `toolbar` setting
	 * names them: rows of comma-separated TinyMCE buttons.
	 *
	 * The theme's `acf/fields/wysiwyg/toolbars` filter applies, as in ACF.
	 *
	 * @return array<string, array<int, string>>
	 */
	private static function toolbars(): array {
		$type     = acf_get_field_type( 'wysiwyg' );
		$toolbars = array();

		if ( ! $type || ! method_exists( $type, 'get_toolbars' ) ) {
			return $toolbars;
		}

		foreach ( (array) $type->get_toolbars() as $label => $rows ) {
			// The key ACF gives each toolbar in its own script.
			$key = str_replace( '-', '_', sanitize_title( (string) $label ) );

			foreach ( (array) $rows as $index => $buttons ) {
				$toolbars[ $key ][ $index ] = implode( ',', (array) $buttons );
			}
		}

		return $toolbars;
	}

	/**
	 * Returns the colours the theme draws its scheme and colour choices with,
	 * from the helpers of CINQ themes: `cinq_schemes()` and `cinq_palette()`,
	 * the ones its admin styles use too.
	 *
	 * @return array{schemes: array<string, array{background: string, foreground: string}>, palette: array<string, array{background: string}>}
	 */
	private static function swatches(): array {
		$swatches = array(
			'schemes' => array(),
			'palette' => array(),
		);

		if ( function_exists( 'cinq_schemes' ) && function_exists( 'cinq_scheme_color' ) ) {
			foreach ( array_keys( cinq_schemes() ) as $slug ) {
				$swatches['schemes'][ (string) $slug ] = array(
					'background' => cinq_scheme_color( (string) $slug, 'background' ),
					'foreground' => cinq_scheme_color( (string) $slug, 'foreground' ),
				);
			}
		}

		if ( function_exists( 'cinq_palette' ) ) {
			foreach ( cinq_palette() as $slug => $color ) {
				$swatches['palette'][ (string) $slug ] = array( 'background' => (string) ( $color['value'] ?? '' ) );
			}
		}

		return $swatches;
	}

	/**
	 * Returns the Dashicons ACF's icon picker offers, with its labels.
	 *
	 * @return array<string, string> Labels keyed by class, such as `dashicons-admin-home`.
	 */
	private static function dashicons(): array {
		$type = acf_get_field_type( 'icon_picker' );

		return $type && method_exists( $type, 'get_dashicons' ) ? (array) $type->get_dashicons() : array();
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
			$classes .= ' cinq-wp-editor-screen';
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

		$actions['cinq_wp_editor'] = sprintf(
			'<a href="%s">%s</a>',
			esc_url( self::url( $post->ID ) ),
			esc_html__( 'Visual editor', 'cinq-wp-editor' )
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
			esc_html__( 'Open the visual editor', 'cinq-wp-editor' )
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
				'id'    => 'cinq-wp-editor',
				'title' => esc_html__( 'Edit visually', 'cinq-wp-editor' ),
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
