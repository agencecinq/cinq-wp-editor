<?php
/**
 * Removes everything the plugin stored.
 *
 * Runs when the plugin is deleted from the Plugins screen. Deactivating it,
 * which comes first, already forgot the cached release. The blocks were
 * always the post's own ACF rows: they stay.
 *
 * @package CinqWpEditor
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Unpublished drafts, one hidden post per post and per user.
$cinq_wp_editor_drafts = get_posts(
	array(
		'post_type'        => 'cinq_wp_editor_draft',
		'post_status'      => 'any',
		'fields'           => 'ids',
		'posts_per_page'   => -1,
		'no_found_rows'    => true,
		'suppress_filters' => true,
	)
);

foreach ( $cinq_wp_editor_drafts as $cinq_wp_editor_draft ) {
	wp_delete_post( (int) $cinq_wp_editor_draft, true );
}
