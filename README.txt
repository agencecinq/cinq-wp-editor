=== CINQ Éditeur ===

Tested up to: 7.1
License: MIT
License URI: https://opensource.org/licenses/MIT

Edits the ACF blocks of a page on one screen: the blocks, a live preview of the real site, and the settings of the selected block.

== Description ==

CINQ Éditeur opens a page in a full-screen editor: the list of its blocks on the left, the real page in the middle, the fields of the selected block on the right. A change shows in the preview as it is typed, saved as a draft of one's own until **Publier**.

Repository: [agencecinq/cinq-wp-editor](https://github.com/agencecinq/cinq-wp-editor). Its README explains how the editor works.

= Requirements =

* WordPress 6.9 or later, PHP 8.4 or later
* ACF Pro
* A Timber theme rendering its blocks through `views/blocks/blocks.html.twig`, the convention of CINQ themes
* Optional: a `mcp.json` at the theme root, whose `blocks` entries describe the blocks in the catalogue

The editor checks them on every request. Missing one, it stays off and says why in the admin.

= What it reads =

* The block zone of a post: the `blocks` flexible content field of the field groups ACF applies to the post, location rules included.
* The blocks offered: the layouts of that field, as the theme prepares them for the edit screen (`acf/prepare_field`), less those marked `hidden` in `mcp.json`.
* Validation and storage: ACF's own, as on the edit screen.

The blocks stay ACF rows on the post. Switching back to the edit screen is always possible, and deactivating the plugin breaks nothing.

== Installation ==

1. Download `cinq-wp-editor.zip` from the [latest release](https://github.com/agencecinq/cinq-wp-editor/releases/latest).
2. Upload it under **Plugins > Add New > Upload Plugin**, or unzip it to `wp-content/plugins/cinq-wp-editor`.
3. Activate **CINQ Éditeur** in the **Plugins** screen.

Pages with blocks then show **Éditeur visuel** in the list of pages, **Ouvrir l’éditeur visuel** on their edit screen, and **Éditer en visuel** in the admin bar of the site.

= Updates =

The plugin updates from the latest release of [agencecinq/cinq-wp-editor](https://github.com/agencecinq/cinq-wp-editor/releases), like any other plugin in **Dashboard > Updates**. Auto-updates are off by default: **Enable auto-updates** in the Plugins screen turns them on for the site. The `Update URI` header routes the check to GitHub instead of WordPress.org.

The check reads the `update.json` attached to the latest release, a plain download GitHub does not rate-limit. The release is cached twelve hours; **Check again** on the Updates screen reads it again.

To publish a release:

1. Bump `Version` in `cinq-wp-editor.php`, and add the version to the changelog below.
2. Commit, push, then push a tag: `git tag v0.3.0 && git push origin v0.3.0`. An annotated tag names the release after its message: `git tag -a v0.3.0 -m Name` publishes "v0.3.0 · Name".

The release workflow checks that the tag matches the version and has a changelog entry, builds `cinq-wp-editor.zip` with `git archive` (`.gitattributes` leaves the development files out) and attaches it to the release with `update.json`. An image at `.github/releases/v0.3.0.png` heads its notes, when there is one. The changelog entry becomes the release notes, and the plugin details show this file as it is in the release.

No update is offered when the plugin folder is a Git working copy, since updating replaces the whole folder.

= Development =

Run `composer install`, then `composer lint` (phpcs) or `composer lint:fix` (phpcbf). Use `./vendor/bin/phpcs`, not the global `phpcs` binary: the global install does not register the WordPress standards. `composer lint` also checks the code against PHP 8.4 and later with PHPCompatibilityWP.

`bash bin/sandbox.sh` starts a throwaway WordPress with the agencecinq theme and a page filled with real blocks: see the README of the repository.

== Changelog ==

= 0.2.0 =
* Breaking: CINQ WP MCP and MCP Adapter are no longer needed: the editor runs on ACF Pro and the theme alone, and requires PHP 8.4. The main file is renamed after the repository, `cinq-wp-editor/cinq-wp-editor.php`, and every identifier with it: the `CinqWpEditor` namespace, the REST routes under `cinq-wp-editor/v1`, the screen at `admin.php?page=cinq-wp-editor`, the drafts as `cinq_wp_editor_draft` posts. Drafts started with 0.1.0 are not carried over. Migration: install the release zip in place of the clone, then activate **CINQ Éditeur** again. CINQ WP MCP can stay for Claude, or go.
* The block zone of a post comes from the field groups ACF applies to it: a page whose template the theme leaves out, such as a styleguide, no longer opens in the editor.
* Fields are validated by ACF, with the rules and the messages of the edit screen. A block the theme no longer has, or no longer offers on the post, is reported on the block.
* Backslashes typed in a field are kept. HTML is filtered as ACF filters it for users without `unfiltered_html`.
* The editor stays off, and says why in the admin, when ACF Pro, Timber or `views/blocks/blocks.html.twig` is missing.
* When the template of a page does not render its blocks, the editor says so above the preview, with a link to the classic edit screen.
* Rich text fields use TinyMCE, with ACF's toolbars, tabs and media button, instead of a field of raw HTML.
* The editor and the preview follow the admin color scheme.
* Removing a block and discarding the draft ask for confirmation in a dialog, as the block editor does.
* Notices go through WordPress's notices store, as in the block editor: a snackbar for a publication or a discarded draft, a banner for an error, which a new one replaces. A refused publication links to the first block to fix.
* Date, time and colour fields open WordPress's pickers, and show dates in the field's display format.
* User, icon, Google Map and page link fields are edited in the editor too. Users are found as ACF finds them, among the roles the field allows; page links offer the archives the field allows; a place is an address and its coordinates, as ACF stores it, with or without a Google Maps key.
* Blocks and repeater rows have an **Options** menu (duplicate, move up, move down, delete) instead of a row of buttons.
* The editor screen is titled after the post. The admin header no longer warns that `strip_tags()` was passed null.
* The plugin updates from its GitHub releases, like any other plugin.

= 0.1.0 =
* Prototype: the blocks, the live preview and the settings of the selected block, on top of CINQ WP MCP.
