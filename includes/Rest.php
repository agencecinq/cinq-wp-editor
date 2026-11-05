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

		$draft_id     = Drafts::find( $post->ID, get_current_user_id() );
		$draft_blocks = 0 === $draft_id ? null : Drafts::blocks( $draft_id );

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
				'published' => Model::read_blocks( $zone, $post->ID ),
				'draft'     => $draft_blocks,
				'draftDate' => 0 === $draft_id ? null : get_post_modified_time( 'c', true, $draft_id ),
			)
		);
	}

	/**
	 * Saves the editor's blocks as the user's draft, and renders the changed ones.
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

		$blocks   = self::blocks( $request );
		$mapped   = Model::map( $zone, $post, $blocks );
		$draft_id = Drafts::save( $zone, $post, get_current_user_id(), $blocks, $mapped['rows'] );

		if ( 0 === $draft_id ) {
			return new WP_Error( 'cinq_wp_editor_draft_failed', 'Le brouillon n’a pas pu être enregistré.', array( 'status' => 500 ) );
		}

		$render = array_values( array_unique( array_map( 'intval', (array) $request->get_param( 'render' ) ) ) );

		return new WP_REST_Response(
			array(
				'saved'  => true,
				'errors' => $mapped['errors'],
				'html'   => (object) Renderer::blocks( $post, $zone, $draft_id, $render ),
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
	 * Writes the editor's blocks onto the post, then drops the draft.
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

		$mapped = Model::map( $zone, $post, self::blocks( $request ) );

		if ( ! empty( $mapped['errors'] ) ) {
			return new WP_Error(
				'cinq_wp_editor_invalid',
				'Certains champs ne sont pas valides : rien n’a été publié.',
				array(
					'status' => 422,
					'errors' => $mapped['errors'],
				)
			);
		}

		$written = Model::publish( $zone, $post, $mapped['rows'] );

		if ( is_wp_error( $written ) ) {
			return $written;
		}

		Drafts::discard( $post->ID, get_current_user_id() );

		return new WP_REST_Response(
			array(
				'published' => true,
				'blocks'    => Model::read_blocks( $zone, $post->ID ),
			)
		);
	}

	/**
	 * Finds users for a user field, as ACF's own search does on the edit
	 * screen: among the roles the field allows, by name, login or e-mail.
	 *
	 * The core route only lists authors of published posts to whoever cannot
	 * `list_users`, and does not filter them by role for them: an editor could
	 * not pick a user there that ACF lets them pick.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function users( WP_REST_Request $request ) {
		$field = acf_get_field( (string) $request['field'] );

		if ( ! is_array( $field ) || 'user' !== ( $field['type'] ?? '' ) ) {
			return new WP_Error( 'cinq_wp_editor_not_user_field', 'Ce champ n’est pas un champ utilisateur.', array( 'status' => 400 ) );
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
			$args['search']         = '*' . $search . '*';
			$args['search_columns'] = array( 'user_login', 'user_nicename', 'user_email', 'display_name' );
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
	 * Returns the blocks of a request as a list of objects.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array<int, array<string, mixed>>
	 */
	private static function blocks( WP_REST_Request $request ): array {
		$blocks = $request->get_param( 'blocks' );

		return is_array( $blocks ) ? array_values( array_filter( $blocks, 'is_array' ) ) : array();
	}
}
