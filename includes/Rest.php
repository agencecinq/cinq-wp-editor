<?php
/**
 * REST routes of the editor.
 *
 * @package CinqWpEditor
 */

declare( strict_types = 1 );

namespace CinqWpEditor;

use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Four routes: read the editor's state, save a draft, drop it, publish it.
 */
final class Rest {

	/**
	 * Route namespace.
	 */
	public const NAMESPACE = 'cinq-wp-editor/v1';

	/**
	 * Registers the routes.
	 *
	 * @return void
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Declares the routes.
	 *
	 * @return void
	 */
	public static function routes(): void {
		$id = array(
			'id' => array(
				'type'     => 'integer',
				'required' => true,
			),
		);

		$blocks = $id + array(
			'blocks' => array(
				'type'     => 'array',
				'required' => true,
				'items'    => array( 'type' => 'object' ),
			),
			'fields' => array(
				'type'     => 'object',
				'required' => true,
			),
		);

		register_rest_route(
			self::NAMESPACE,
			'/posts/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'state' ),
				'permission_callback' => array( self::class, 'can_edit' ),
				'args'                => $id,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/posts/(?P<id>\d+)/draft',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( self::class, 'save_draft' ),
					'permission_callback' => array( self::class, 'can_edit' ),
					'args'                => $blocks + array(
						'render' => array(
							'type'    => 'array',
							'items'   => array(
								'type'    => 'integer',
								'minimum' => 0,
							),
							'default' => array(),
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( self::class, 'discard_draft' ),
					'permission_callback' => array( self::class, 'can_edit' ),
					'args'                => $id,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/posts/(?P<id>\d+)/users',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'users' ),
				'permission_callback' => array( self::class, 'can_edit' ),
				'args'                => $id + array(
					'field'   => array(
						'type'     => 'string',
						'required' => true,
					),
					'search'  => array(
						'type'    => 'string',
						'default' => '',
					),
					'include' => array(
						'type'    => 'array',
						'items'   => array( 'type' => 'integer' ),
						'default' => array(),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/posts/(?P<id>\d+)/publish',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'publish' ),
				'permission_callback' => array( self::class, 'can_edit' ),
				'args'                => $blocks,
			)
		);
	}

	/**
	 * Whether the current user may edit the post.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool
	 */
	public static function can_edit( WP_REST_Request $request ): bool {
		return current_user_can( 'edit_post', (int) $request['id'] );
	}

	/**
	 * Returns everything the editor needs to open a post.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function state( WP_REST_Request $request ) {
		$post = self::post( $request );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$zone = Model::zone( $post );

		if ( is_wp_error( $zone ) ) {
			return $zone;
		}

		$sections     = Model::sections( $zone, $post );
		$published    = Model::read( $zone, $sections, $post->ID );
		$draft_id     = Drafts::find( $post->ID, get_current_user_id() );
		$draft_blocks = 0 === $draft_id ? null : Drafts::blocks( $draft_id );
		$draft        = null;

		// A draft that holds no fields left the published ones as they were.
		if ( null !== $draft_blocks ) {
			$draft = array(
				'blocks' => $draft_blocks,
				'fields' => Drafts::fields( $draft_id ) ?? $published['fields'],
			);
		}

		return new WP_REST_Response(
			array(
				'post'      => array(
					'id'         => $post->ID,
					'title'      => get_the_title( $post ),
					'type'       => $post->post_type,
					'typeLabel'  => (string) ( get_post_type_object( $post->post_type )->labels->singular_name ?? $post->post_type ),
					'status'     => $post->post_status,
					'editUrl'    => (string) get_edit_post_link( $post, 'raw' ),
					'listUrl'    => admin_url( 'page' === $post->post_type ? 'edit.php?post_type=page' : 'edit.php?post_type=' . $post->post_type ),
					'viewUrl'    => (string) get_permalink( $post ),
					'previewUrl' => Preview::url( $post ),
				),
				'zone'      => $zone->name(),
				'layouts'   => Model::layouts( $zone, $post ),
				'sections'  => Model::groups( $sections ),
				'published' => self::content( $published ),
				'draft'     => null === $draft ? null : self::content( $draft ),
				'draftDate' => 0 === $draft_id ? null : get_post_modified_time( 'c', true, $draft_id ),
			)
		);
	}

	/**
	 * Saves the editor's blocks and fields as the user's draft, and renders the
	 * changed blocks.
	 *
	 * Blocks ACF could not take are left out of what the preview shows,
	 * and reported; the blocks themselves are kept whole in the draft. The
	 * blocks listed in `render` come back as HTML, so the preview swaps them in
	 * without fetching the page: one round trip per change.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function save_draft( WP_REST_Request $request ) {
		$post = self::post( $request );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$zone = Model::zone( $post );

		if ( is_wp_error( $zone ) ) {
			return $zone;
		}

		$sections = Model::sections( $zone, $post );
		$sent     = self::sent( $request );
		$mapped   = Model::map( $zone, $sections, $post, $sent );
		$draft_id = Drafts::save( $zone, $sections, $post, get_current_user_id(), $sent, $mapped );

		if ( 0 === $draft_id ) {
			return new WP_Error( 'cinq_wp_editor_draft_failed', __( 'The draft could not be saved.', 'cinq-wp-editor' ), array( 'status' => 500 ) );
		}

		$render = array_values( array_unique( array_map( 'intval', (array) $request->get_param( 'render' ) ) ) );

		return new WP_REST_Response(
			array(
				'saved'  => true,
				'errors' => $mapped['errors'],
				'html'   => (object) Renderer::blocks( $post, $zone, $sections, $draft_id, $render ),
			)
		);
	}

	/**
	 * Drops the user's draft.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function discard_draft( WP_REST_Request $request ) {
		$post = self::post( $request );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		Drafts::discard( $post->ID, get_current_user_id() );

		return new WP_REST_Response( array( 'discarded' => true ) );
	}

	/**
	 * Writes the editor's blocks and fields onto the post, then drops the draft.
	 *
	 * Refused as a whole when one value does not validate: half a page is never
	 * published.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function publish( WP_REST_Request $request ) {
		$post = self::post( $request );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$zone = Model::zone( $post );

		if ( is_wp_error( $zone ) ) {
			return $zone;
		}

		$holder = Lock::holder( $post );

		// Someone took the page over: their changes are the ones to publish.
		if ( null !== $holder ) {
			return new WP_Error(
				'cinq_wp_editor_locked',
				/* translators: %s: Name of the user holding the lock. */
				sprintf( __( '%s is editing this content: nothing was published. Your changes stay in your draft.', 'cinq-wp-editor' ), $holder->display_name ),
				array( 'status' => 409 )
			);
		}

		$sections = Model::sections( $zone, $post );
		$mapped   = Model::map( $zone, $sections, $post, self::sent( $request ) );

		if ( ! empty( $mapped['errors'] ) ) {
			return new WP_Error(
				'cinq_wp_editor_invalid',
				__( 'Some fields are not valid: nothing was published.', 'cinq-wp-editor' ),
				array(
					'status' => 422,
					'errors' => $mapped['errors'],
				)
			);
		}

		$written = Model::publish( $zone, $sections, $post, $mapped );

		if ( is_wp_error( $written ) ) {
			return $written;
		}

		Drafts::discard( $post->ID, get_current_user_id() );

		return new WP_REST_Response(
			array(
				'published' => self::content( Model::read( $zone, $sections, $post->ID ) ),
			)
		);
	}

	/**
	 * Finds users for a user field of the post's zone or sections, as ACF's own search
	 * does on the edit screen: among the roles the field allows, by name or
	 * login, and by e-mail for whoever may edit users.
	 *
	 * The core route only lists authors of published posts to whoever cannot
	 * `list_users`, and does not filter them by role for them: an editor could
	 * not pick a user there that ACF lets them pick.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function users( WP_REST_Request $request ) {
		$post = self::post( $request );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$zone = Model::zone( $post );

		if ( is_wp_error( $zone ) ) {
			return $zone;
		}

		// Only a user field the editor shows on this post: its roles always
		// bound the search, as they do in the editor.
		$key   = (string) $request['field'];
		$field = $zone->field( $key ) ?? Model::sections( $zone, $post )->field( $key );

		if ( null === $field || 'user' !== ( $field['type'] ?? '' ) ) {
			return new WP_Error( 'cinq_wp_editor_not_user_field', __( 'This field is not a user field.', 'cinq-wp-editor' ), array( 'status' => 400 ) );
		}

		$include = array_filter( array_map( 'absint', (array) $request['include'] ) );
		$search  = trim( (string) $request['search'] );
		$args    = array(
			'fields'  => array( 'ID', 'display_name' ),
			'number'  => 20,
			'orderby' => 'display_name',
		);

		if ( ! empty( $field['role'] ) ) {
			$args['role__in'] = (array) $field['role'];
		}

		if ( ! empty( $include ) ) {
			$args['include'] = $include;
		} elseif ( '' !== $search ) {
			$args['search'] = '*' . $search . '*';

			// E-mail addresses are searched only by whoever may see them, as ACF
			// and the core users route do: otherwise a search for « a@ », then
			// « ad@ »… would spell anyone's address out.
			$args['search_columns'] = current_user_can( 'edit_users' )
				? array( 'user_login', 'user_nicename', 'user_email', 'display_name' )
				: array( 'user_login', 'user_nicename', 'display_name' );
		}

		$users = array_map(
			static fn( $user ): array => array(
				'id'    => (int) $user->ID,
				'title' => (string) $user->display_name,
			),
			get_users( $args )
		);

		return new WP_REST_Response( $users );
	}

	/**
	 * Returns the post a request targets.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_Post|WP_Error
	 */
	private static function post( WP_REST_Request $request ) {
		$post = get_post( (int) $request['id'] );

		if ( ! $post instanceof WP_Post || Drafts::POST_TYPE === $post->post_type ) {
			return new WP_Error( 'cinq_wp_editor_not_found', 'Contenu introuvable.', array( 'status' => 404 ) );
		}

		return $post;
	}

	/**
	 * Returns the blocks and the fields of a request: a list of objects, and
	 * an object.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array{blocks: array<int, array<string, mixed>>, fields: array<string, mixed>}
	 */
	private static function sent( WP_REST_Request $request ): array {
		$blocks = $request->get_param( 'blocks' );
		$fields = $request->get_param( 'fields' );

		return array(
			'blocks' => is_array( $blocks ) ? array_values( array_filter( $blocks, 'is_array' ) ) : array(),
			'fields' => is_array( $fields ) ? $fields : array(),
		);
	}

	/**
	 * Shapes blocks and fields for the client: fields stay an object, even
	 * with none, so that the client sends them back as one.
	 *
	 * @param array{blocks: array<int, array<string, mixed>>, fields: array<string, mixed>} $content Blocks and fields.
	 * @return array{blocks: array<int, array<string, mixed>>, fields: object}
	 */
	private static function content( array $content ): array {
		return array(
			'blocks' => $content['blocks'],
			'fields' => (object) $content['fields'],
		);
	}
}
