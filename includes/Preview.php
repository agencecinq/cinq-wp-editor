<?php
/**
 * Live preview.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Turns a front-end request into the editor's preview.
 *
 * The preview is the real page, rendered by the theme, with three changes:
 * the blocks are read from the editor's draft instead of the post, each block
 * is wrapped in a marker so the editor can find it, and a small script lets
 * the visitor select a block instead of following its links.
 *
 * The markers are the theme's: its `blocks/blocks.html.twig` and
 * `blocks/block.html.twig` put them in when the `cinq_wp_editor` Twig global
 * says the page is the editor's preview. A theme with those two templates is
 * one the editor works with; the public page stays as it was.
 */
final class Preview {

	/**
	 * Query argument carrying the ID of the post being previewed.
	 */
	public const QUERY_ARG = 'cinq-wp-editor';

	/**
	 * Theme template every block goes through, in its preview marker when
	 * the editor asks for it: what makes a theme one the editor works with.
	 */
	public const TEMPLATE = 'views/blocks/block.html.twig';

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
			add_filter( 'acf/pre_load_reference', array( self::class, 'reference' ), 10, 3 );
			add_filter( 'timber/twig', array( self::class, 'twig' ) );
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

		$is_zone = ( $field['key'] ?? '' ) === self::$zone->key() || ( $field['name'] ?? '' ) === self::$zone->name();

		if ( ! $is_zone ) {
			return $value;
		}

		// ACF reads the draft as it would the post: same field, other ID.
		return acf_get_value( self::$draft_id, $field );
	}

	/**
	 * Names the zone's field for the post being previewed.
	 *
	 * ACF finds a field from its name through the post's `_blocks` meta, which
	 * it writes on the first save. A post never saved yet has none, and ACF
	 * falls back on the first field of that name it knows, maybe another
	 * zone's: the draft's rows would then be read with the wrong layouts.
	 *
	 * @param string|null $reference  Field key found so far.
	 * @param string      $field_name Field name.
	 * @param int|string  $post_id    ACF post ID.
	 * @return string|null
	 */
	public static function reference( $reference, $field_name, $post_id ) {
		if ( null !== $reference || null === self::$zone || $field_name !== self::$zone->name() ) {
			return $reference;
		}

		return is_numeric( $post_id ) && (int) $post_id === self::$post_id ? self::$zone->key() : $reference;
	}

	/**
	 * Tells the theme's templates they render the editor's preview.
	 *
	 * A global rather than a context variable: an include made without the
	 * context still sees it.
	 *
	 * @param \Twig\Environment $twig Twig environment.
	 * @return \Twig\Environment
	 */
	public static function twig( $twig ) {
		$twig->addGlobal( 'cinq_wp_editor', true );

		return $twig;
	}

	/**
	 * Loads the script and the styles of the preview frame.
	 *
	 * @return void
	 */
	public static function enqueue(): void {
		wp_enqueue_style( 'cinq-wp-editor-preview', CINQ_WP_EDITOR_URL . 'assets/preview.css', array(), Plugin::asset_version( 'assets/preview.css' ) );
		wp_enqueue_script( 'cinq-wp-editor-preview', CINQ_WP_EDITOR_URL . 'assets/preview.js', array( 'wp-i18n' ), Plugin::asset_version( 'assets/preview.js' ), true );
		wp_set_script_translations( 'cinq-wp-editor-preview', 'cinq-wp-editor', CINQ_WP_EDITOR_PATH . 'languages' );
	}
}
