<?php
/**
 * Plugin updates from GitHub releases.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Offers updates from the latest GitHub release, like any other plugin.
 *
 * The plugin is distributed on GitHub only. Its `Update URI` header points
 * there, which makes WordPress skip WordPress.org and ask the
 * `update_plugins_github.com` filter instead. That filter reads the latest
 * release (cached twelve hours) and hands WordPress the zip the release
 * workflow attaches to it.
 *
 * The release is read from the `update.json` the workflow attaches next to the
 * zip: a plain download, which GitHub does not rate-limit, where its API
 * allows sixty calls an hour per address and shared hosting puts many sites
 * behind one.
 *
 * The manifest carries the README.txt of the release: the "View details" modal
 * shows its sections, as WordPress.org does, and the Updates screen the
 * WordPress version it is tested up to.
 *
 * Auto-updates are WordPress's own: off by default, turned on per site with
 * the link of the Plugins screen.
 */
final class PluginUpdater {

	/**
	 * Repository, `owner/name`.
	 */
	public const REPOSITORY = 'agencecinq/cinq-wp-editor';

	/**
	 * Name of the release manifest attached to each release.
	 */
	public const MANIFEST = 'update.json';

	/**
	 * Transient caching the latest release.
	 */
	private const TRANSIENT = 'cinq_wp_editor_latest_release';

	/**
	 * Constructor.
	 *
	 * @param string $plugin_file Plugin basename, e.g. cinq-wp-editor/cinq-wp-editor.php.
	 */
	public function __construct(
		private string $plugin_file
	) {}

	/**
	 * Register WordPress hooks.
	 *
	 * @return void
	 */
	public function register(): void {
		add_filter( 'update_plugins_github.com', array( $this, 'check' ), 10, 3 );
		add_filter( 'plugins_api', array( $this, 'details' ), 20, 3 );
		add_filter( 'upgrader_source_selection', array( $this, 'keep_folder' ), 10, 4 );
		add_action( 'upgrader_process_complete', array( self::class, 'forget' ) );
		add_action( 'load-update-core.php', array( $this, 'force_check' ), 9 );
	}

	/**
	 * Unpacks an update into the folder the plugin already lives in.
	 *
	 * The zip unpacks into `cinq-wp-editor/`. A copy installed under
	 * another name (a renamed folder) would otherwise come back under that one,
	 * and WordPress would deactivate the plugin it can no longer find.
	 *
	 * @param string|\WP_Error     $source        Unpacked folder.
	 * @param string               $remote_source Folder it was unpacked in.
	 * @param mixed                $upgrader      Upgrader.
	 * @param array<string, mixed> $hook_extra    Context; `plugin` on updates.
	 * @return string|\WP_Error
	 */
	public function keep_folder( $source, $remote_source, $upgrader, $hook_extra = array() ) {
		global $wp_filesystem;

		if ( ! is_string( $source ) || ( $hook_extra['plugin'] ?? '' ) !== $this->plugin_file ) {
			return $source;
		}

		$folder = dirname( $this->plugin_file );
		$target = trailingslashit( $remote_source ) . $folder . '/';

		if ( '.' === $folder || untrailingslashit( $source ) === untrailingslashit( $target ) || ! is_object( $wp_filesystem ) ) {
			return $source;
		}

		return $wp_filesystem->move( $source, $target, true ) ? $target : $source;
	}

	/**
	 * Forgets the cached release, so the next check asks GitHub again.
	 *
	 * @return void
	 */
	public static function forget(): void {
		delete_transient( self::TRANSIENT );
	}

	/**
	 * Checks plugin updates again when "Check again" is clicked on the Updates
	 * screen.
	 *
	 * The link only makes WordPress check its own version again. It checks
	 * plugins on this screen once its last check is a minute old, and the link
	 * is clicked sooner: forgetting its verdict along with the cached release
	 * makes it check, and read GitHub, on the spot.
	 *
	 * Priority 9: core checks for plugin updates on the same hook at 10, and
	 * must find both caches already empty.
	 *
	 * @return void
	 */
	public function force_check(): void {
		if ( isset( $_GET['force-check'] ) && current_user_can( 'update_plugins' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- core's own link; only drops caches.
			self::forget();
			delete_site_transient( 'update_plugins' );
		}
	}

	/**
	 * Answers WordPress's update check for this plugin.
	 *
	 * @param array<string, mixed>|false $update      Update found so far.
	 * @param array<string, mixed>       $plugin_data Plugin headers.
	 * @param string                     $plugin_file Plugin basename.
	 * @return array<string, mixed>|false
	 */
	public function check( $update, $plugin_data, $plugin_file ) {
		if ( $this->plugin_file !== $plugin_file ) {
			return $update;
		}

		// Updating replaces the plugin folder: never offer it over a Git working copy.
		if ( is_dir( CINQ_WP_EDITOR_PATH . '.git' ) ) {
			return $update;
		}

		$release = self::latest();

		if ( null === $release ) {
			return $update;
		}

		return array(
			'id'           => 'github.com/' . self::REPOSITORY,
			'slug'         => dirname( $plugin_file ),
			'plugin'       => $plugin_file,
			'version'      => $release['version'],
			'url'          => $release['url'],
			'package'      => $release['package'],
			'requires'     => $release['requires'],
			'requires_php' => $release['requires_php'],
			'tested'       => self::tested( $release['readme'] ),
			'icons'        => array( 'svg' => plugins_url( 'assets/icon.svg', CINQ_WP_EDITOR_FILE ) ),
		);
	}

	/**
	 * Fills the "View details" modal with the readme of the release.
	 *
	 * @param false|object|array<string, mixed> $result Result so far.
	 * @param string                            $action API action.
	 * @param object                            $args   Request arguments.
	 * @return false|object|array<string, mixed>
	 */
	public function details( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || dirname( $this->plugin_file ) !== ( $args->slug ?? '' ) ) {
			return $result;
		}

		$release = self::latest();

		if ( null === $release ) {
			return $result;
		}

		$headers = get_file_data(
			CINQ_WP_EDITOR_FILE,
			array(
				'name'       => 'Plugin Name',
				'author'     => 'Author',
				'author_uri' => 'Author URI',
				'homepage'   => 'Plugin URI',
			)
		);
		$author  = sprintf( '<a href="%s">%s</a>', esc_url( $headers['author_uri'] ), esc_html( $headers['author'] ) );

		return (object) array(
			'name'          => $headers['name'],
			'slug'          => dirname( $this->plugin_file ),
			'version'       => $release['version'],
			'author'        => $author,
			'homepage'      => $headers['homepage'],
			'download_link' => $release['package'],
			'requires'      => $release['requires'],
			'tested'        => self::tested( $release['readme'] ),
			'requires_php'  => $release['requires_php'],
			'last_updated'  => $release['last_updated'],
			'banners'       => array( 'high' => plugins_url( 'assets/banner.svg', CINQ_WP_EDITOR_FILE ) ),
			'sections'      => Readme::sections( $release['readme'] ),
		);
	}

	/**
	 * WordPress version the release is tested up to.
	 *
	 * As on WordPress.org, "Tested up to: 7.1" covers every 7.1.x release:
	 * WordPress compares full versions, and would warn a 7.1.3 site that the
	 * plugin is not tested with it.
	 *
	 * @param string $readme Readme of the release.
	 */
	private static function tested( string $readme ): string {
		$tested     = Readme::header( $readme, 'Tested up to' );
		$wp_version = get_bloginfo( 'version' );

		return '' !== $tested && str_starts_with( $wp_version . '.', $tested . '.' ) ? $wp_version : $tested;
	}

	/**
	 * Returns the latest release, from cache or from GitHub.
	 *
	 * @return array{version: string, url: string, package: string, readme: string, requires: string, requires_php: string, last_updated: string}|null
	 */
	public static function latest(): ?array {
		$cached = get_transient( self::TRANSIENT );

		if ( is_array( $cached ) ) {
			return empty( $cached['version'] ) ? null : $cached;
		}

		$release = self::parse_manifest( self::fetch( 'https://github.com/' . self::REPOSITORY . '/releases/latest/download/' . self::MANIFEST ) );

		// Remember failures too, for an hour, so a GitHub outage does not slow
		// every admin page down.
		set_transient( self::TRANSIENT, $release ?? array(), null === $release ? HOUR_IN_SECONDS : 12 * HOUR_IN_SECONDS );

		return $release;
	}

	/**
	 * Downloads a URL, following GitHub's redirects to its file storage.
	 *
	 * @param string $url URL.
	 * @return string Body, empty on any failure.
	 */
	private static function fetch( string $url ): string {
		$response = wp_remote_get(
			$url,
			array(
				'timeout' => 10,
				'headers' => array( 'User-Agent' => 'cinq-wp-editor' ),
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return '';
		}

		return (string) wp_remote_retrieve_body( $response );
	}

	/**
	 * Reads the `update.json` attached to a release.
	 *
	 * @param string $body File contents.
	 * @return array{version: string, url: string, package: string, readme: string, requires: string, requires_php: string, last_updated: string}|null
	 */
	public static function parse_manifest( string $body ): ?array {
		$data = json_decode( $body, true );

		if ( ! is_array( $data ) || empty( $data['version'] ) || empty( $data['package'] ) ) {
			return null;
		}

		$package = (string) $data['package'];

		// Only ever install what this repository's releases serve.
		if ( ! str_starts_with( $package, 'https://github.com/' . self::REPOSITORY . '/releases/download/' ) ) {
			return null;
		}

		return array(
			'version'      => (string) $data['version'],
			'url'          => (string) ( $data['url'] ?? '' ),
			'package'      => $package,
			'readme'       => (string) ( $data['readme'] ?? '' ),
			'requires'     => (string) ( $data['requires'] ?? '' ),
			'requires_php' => (string) ( $data['requires_php'] ?? '' ),
			'last_updated' => (string) ( $data['last_updated'] ?? '' ),
		);
	}
}
