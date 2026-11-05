<?php
/**
 * Live preview.
 *
 * @package CinqEditor
 */

declare( strict_types = 1 );

namespace CinqEditor;

use CinqWpMcp\Acf\Zone;

defined( 'ABSPATH' ) || exit;

/**
 * Turns a front-end request into the editor's preview.
 *
 * The preview is the real page, rendered by the theme, with three changes:
 * the blocks are read from the editor's draft instead of the post, each block
 * is wrapped in a marker so the editor can find it, and a small script lets
 * the visitor select a block instead of following its links.
 *
 * The marker comes from a copy of the theme's `blocks/blocks.html.twig` put in
 * front of the theme's views. Every CINQ theme renders its blocks through that
 * template, so no theme has to change for the editor to work.
 */
final class Preview {

	/**
	 * Query argument carrying the ID of the post being previewed.
	 */
	public const QUERY_ARG = 'cinq-editor';

	/**
	 * Post being previewed, once the request is known to be a preview.
	 *
	 * @var int
	 */
	private static int $post_id = 0;

	/**
	 * Zone the draft replaces.
	 *
	 * @var Zone|null
	 */
	private static ?Zone $zone = null;

	/**
	 * Draft read in place of the post's blocks.
	 *
	 * @var int
	 */
	private static int $draft_id = 0;

	/**
	 * Registers the hooks.
	 *
	 * @return void
	 */
	public static function register(): void {
		// After `init`: the current user is only known from then on.
		add_action( 'wp_loaded', array( self::class, 'boot' ) );
	}

	/**
	 * Returns the URL of the preview of a post.
	 *
	 * @param \WP_Post $post Post.
	 * @return string
	 */
	public static function url( \WP_Post $post ): string {
		$url = 'publish' === $post->post_status ? get_permalink( $post ) : get_preview_post_link( $post );

		return add_query_arg( self::QUERY_ARG, $post->ID, (string) $url );
	}

	/**
	 * Switches the request to preview mode when it asks for it and may.
	 *
	 * @return void
	 */
	public static function boot(): void {
		if ( is_admin() || wp_doing_ajax() || ! isset( $_GET[ self::QUERY_ARG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only preview, gated on edit_post below.
			return;
		}

		$post_id = absint( wp_unslash( $_GET[ self::QUERY_ARG ] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- See above.
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		if ( ! $post instanceof \WP_Post || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$zone = Model::zone( $post );

		if ( is_wp_error( $zone ) ) {
			return;
		}

		self::activate( $post_id, $zone, Drafts::find( $post_id, get_current_user_id() ) );

		add_filter( 'show_admin_bar', '__return_false' );
		add_filter( 'wp_robots', 'wp_robots_no_robots' );
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_action( 'send_headers', 'nocache_headers' );
	}

	/**
	 * Reads the draft in place of the post's blocks, and marks each block.
	 *
	 * Called by the preview page, and by the REST route that renders single
	 * blocks: both must see exactly the same blocks.
	 *
	 * @param int  $post_id  Post being previewed.
	 * @param Zone $zone     Zone the draft replaces.
	 * @param int  $draft_id Draft, or 0 to show the post's own blocks.
	 * @return void
	 */
	public static function activate( int $post_id, Zone $zone, int $draft_id ): void {
		self::$post_id  = $post_id;
		self::$zone     = $zone;
		self::$draft_id = $draft_id;

		if ( ! has_filter( 'acf/pre_load_value', array( self::class, 'load_draft' ) ) ) {
			add_filter( 'acf/pre_load_value', array( self::class, 'load_draft' ), 10, 3 );
			add_filter( 'timber/locations', array( self::class, 'locations' ) );
		}
	}

	/**
	 * Serves the draft's rows in place of the post's.
	 *
	 * @param mixed                $value   Value short-circuiting the load, null to carry on.
	 * @param int|string           $post_id ACF post ID being read.
	 * @param array<string, mixed> $field   Field being read.
	 * @return mixed
	 */
	public static function load_draft( $value, $post_id, $field ) {
		if ( null !== $value || 0 === self::$draft_id || null === self::$zone ) {
			return $value;
		}

		if ( ! is_numeric( $post_id ) || (int) $post_id !== self::$post_id ) {
			return $value;
		}

		$is_zone = ( $field['key'] ?? '' ) === self::$zone->key() || ( $field['name'] ?? '' ) === self::$zone->meta_name();

		if ( ! $is_zone ) {
			return $value;
		}

		// ACF reads the draft as it would the post: same field, other ID.
		return acf_get_value( self::$draft_id, $field );
	}

	/**
	 * Puts the editor's views in front of the theme's.
	 *
	 * @param array<int|string, mixed> $locations Twig locations, keyed by namespace.
	 * @return array<int|string, mixed>
	 */
	public static function locations( array $locations ): array {
		$views = CINQ_EDITOR_PATH . 'views/';

		if ( isset( $locations['__main__'] ) && is_array( $locations['__main__'] ) ) {
			array_unshift( $locations['__main__'], $views );
			return $locations;
		}

		array_unshift( $locations, $views );

		return $locations;
	}

	/**
	 * Loads the script and the styles of the preview frame.
	 *
	 * @return void
	 */
	public static function enqueue(): void {
		wp_enqueue_style( 'cinq-editor-preview', CINQ_EDITOR_URL . 'assets/preview.css', array(), Plugin::asset_version( 'assets/preview.css' ) );
		wp_enqueue_script( 'cinq-editor-preview', CINQ_EDITOR_URL . 'assets/preview.js', array(), Plugin::asset_version( 'assets/preview.js' ), true );
	}
}
