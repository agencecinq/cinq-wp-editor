=== CINQ Editor ===

Tested up to: 7.1
License: MIT
License URI: https://opensource.org/licenses/MIT

Edits the ACF blocks of a page on one screen: the blocks and the fields of its template, a live preview of the real site, and the settings of the selected block or section.

== Description ==

CINQ Editor opens a page in a full-screen editor: the list of its blocks on the left, the real page in the middle, the fields of the selected block on the right. A change shows in the preview as it is typed, saved as a draft of one's own until **Publish**.

Repository: [agencecinq/cinq-wp-editor](https://github.com/agencecinq/cinq-wp-editor). Its README explains how the editor works.

= Requirements =

* WordPress 7.1 or later: the editor follows the latest WordPress release only, to use what it brings as soon as it ships
* PHP 8.4 or later
* ACF Pro 6.8 or later, and a theme on Timber 2.5 or later: their latest releases, as for WordPress
* A Timber theme rendering each block through `views/blocks/block.html.twig`, the convention of CINQ themes: in the editor's preview (the `cinq_wp_editor` Twig global), it wraps the block in `<div data-cinq-block="{{ loop }}" style="display: contents">`, and `views/blocks/blocks.html.twig` renders its stack even with no block. Every element rendering a field of the template names it with `data-field`, on the public page too: the stack's container with `data-field="blocks"`, a hero with `data-field="hero"`, an element rendering several fields with their names separated by spaces.
* Optional: a `mcp.json` at the theme root, whose `blocks` entries describe the blocks in the catalogue

The editor checks them on every request. Missing one, it stays off and says why in the admin.

= What it reads =

* The block zone of a post: the `blocks` flexible content field of the field groups ACF applies to the post, location rules included.
* Its fixed sections: the other field groups ACF applies to the post, in the main column.
* The blocks offered: the layouts of that field, as the theme prepares them for the edit screen (`acf/prepare_field`), less those marked `hidden` in `mcp.json`.
* Validation and storage: ACF's own, as on the edit screen.

The blocks stay ACF rows on the post. Switching back to the edit screen is always possible, and deactivating the plugin breaks nothing.

== Installation ==

1. Download `cinq-wp-editor.zip` from the [latest release](https://github.com/agencecinq/cinq-wp-editor/releases/latest).
2. Upload it under **Plugins > Add New > Upload Plugin**, or unzip it to `wp-content/plugins/cinq-wp-editor`.
3. Activate **CINQ Editor** in the **Plugins** screen.

Pages with blocks then show **Visual editor** in the list of pages, **Open the visual editor** on their edit screen, and **Edit visually** in the admin bar of the site.

= Updates =

The plugin updates from the latest release of [agencecinq/cinq-wp-editor](https://github.com/agencecinq/cinq-wp-editor/releases), like any other plugin in **Dashboard > Updates**. Auto-updates are off by default: **Enable auto-updates** in the Plugins screen turns them on for the site. The `Update URI` header routes the check to GitHub instead of WordPress.org.

The check reads the `update.json` attached to the latest release, a plain download GitHub does not rate-limit. The release is cached twelve hours; **Check again** on the Updates screen reads it again.

To publish a release:

1. Bump `Version` in `cinq-wp-editor.php`, and add the version to the changelog below.
2. Commit, push, then push a tag: `git tag v0.3.0 && git push origin v0.3.0`. An annotated tag names the release after its message: `git tag -a v0.3.0 -m Name` publishes "v0.3.0 · Name".

The release workflow checks that the tag matches the version and has a changelog entry, builds the editor's scripts with `pnpm build`, builds `cinq-wp-editor.zip` with `git archive` (`.gitattributes` leaves the development files out) plus the built scripts and attaches it to the release with `update.json`. An image at `.github/releases/v0.3.0.png` heads its notes, when there is one. The changelog entry becomes the release notes, and the plugin details show this file as it is in the release.

No update is offered when the plugin folder is a Git working copy, since updating replaces the whole folder.

= Development =

Run `pnpm install`, then `pnpm build` (or `pnpm start` to rebuild on every change): the interface is built with `@wordpress/scripts`, as WordPress's own screens are, and a working copy without `build/` stays off and says so. The release workflow builds it for the zip.

The interface is in English, translated into French in `languages/`. After changing a string, run `composer i18n` (WP-CLI 2.7 or later): it extracts the strings to the POT file and merges them into the PO file. Translate the new or changed ones in the PO file, then run `composer i18n` again: it compiles the MO file PHP reads and the JSON files the scripts read.

Run `composer install`, then `composer lint` (phpcs) or `composer lint:fix` (phpcbf). Use `./vendor/bin/phpcs`, not the global `phpcs` binary: the global install does not register the WordPress standards. `composer lint` also checks the code against PHP 8.4 and later with PHPCompatibilityWP.

`bash bin/sandbox.sh` starts a throwaway WordPress with the agencecinq theme and a page filled with real blocks: see the README of the repository.

== Changelog ==

= 0.3.3 =
* A fixed section carries a lock in the list, as the block editor's List View marks a block that cannot be moved nor removed.
* The preview script is a script module, as WordPress 7.1 loads them: its data comes as JSON through the `script_module_data_cinq-wp-editor-preview` filter instead of a `window.cinqWpEditorPreview` global, and its translations through `wp_set_script_module_translations()`.

= 0.3.2 =
* A fixed section shown by several elements is outlined element by element in the preview, its name on the first one: what lies between them, such as a photo between an introduction and figures, is no longer outlined. An element inside another one of the section adds no box.
* The preview names a fixed section in the editor's language, as it names blocks: the name comes from the editor, not from the page.

= 0.3.1 =
* `data-field` may name several fields, separated by spaces, as `class` lists classes: an element rendering fields that no group field holds together, such as a page header, names them all, and is outlined and selected as the section of any of them.

= 0.3.0 =
* The fields of the page's template around its blocks, such as a hero, are edited in the editor as fixed sections: listed above the blocks, under the content type's name, never moved, duplicated nor deleted. A section is a field group ACF applies to the post, in the main column, without the block zone; a group in the side column, settings of the post, stays on the classic edit screen. Its fields are validated by ACF, saved in the draft and published with the blocks, as a whole or not at all.
* Breaking: the theme names the fields it renders with a `data-field` attribute, kept on the public page. The container of the block stack is `data-field="blocks"` in place of `data-cinq-blocks`, which the editor no longer reads. A fixed section is outlined, selected and scrolled to in the preview through the elements naming one of its fields, such as `data-field="hero"`. Migration: in `views/blocks/blocks.html.twig`, put `data-field="blocks"` on the stack's container, always, instead of `data-cinq-blocks` in the preview only (a `display: contents` container, when the stack has none, stays the preview's); then put `data-field="{{ name }}"` on the element rendering each field of a template outside the blocks, as Agence CINQ does on its hero.
* Breaking: the REST routes send and return the blocks and the fields together: `published` and `draft` are `{ blocks, fields }`, and saving or publishing takes `fields` next to `blocks`.
* Fixed: a group whose fields are named `0`, `1`…, such as a pair of links, showed empty and lost its values on the first change.

= 0.2.0 =
* Breaking: CINQ WP MCP and MCP Adapter are no longer needed: the editor runs on ACF Pro and the theme alone, and requires the latest releases of WordPress (7.1), ACF Pro (6.8) and Timber (2.5), and PHP 8.4. It carries no code for older ones. The main file is renamed after the repository, `cinq-wp-editor/cinq-wp-editor.php`, and every identifier with it: the `CinqWpEditor` namespace, the REST routes under `cinq-wp-editor/v1`, the screen at `admin.php?page=cinq-wp-editor`, the drafts as `cinq_wp_editor_draft` posts. Drafts started with 0.1.0 are not carried over. Migration: install the release zip in place of the clone, then activate **CINQ Editor** again. CINQ WP MCP can stay for Claude, or go.
* The block zone of a post comes from the field groups ACF applies to it: a page whose template the theme leaves out, such as a styleguide, no longer opens in the editor.
* Fields are validated by ACF, with the rules and the messages of the edit screen. A block the theme no longer has, or no longer offers on the post, is reported on the block.
* Backslashes typed in a field are kept. HTML is filtered as ACF filters it for users without `unfiltered_html`.
* The editor stays off, and says why in the admin, when ACF Pro, Timber or `views/blocks/block.html.twig` is missing.
* Breaking: the preview markers are the theme's. The editor no longer carries a copy of the theme's `blocks/blocks.html.twig`: the theme renders each block through `views/blocks/block.html.twig`, which puts the block in its marker when the `cinq_wp_editor` Twig global is set, and marks the container of its stack. Migration: add `views/blocks/block.html.twig` to the theme and include it from `views/blocks/blocks.html.twig`, as Agence CINQ does.
* When the template of a page does not render its blocks, the editor says so above the preview, with a link to the classic edit screen.
* Rich text fields use TinyMCE, with ACF's toolbars, tabs and media button, instead of a field of raw HTML.
* The editor and the preview follow the admin color scheme.
* Removing a block and discarding the draft ask for confirmation in a dialog, as the block editor does.
* Notices go through WordPress's notices store, as in the block editor: a snackbar for a publication or a discarded draft, a banner for an error, which a new one replaces. A refused publication links to the first block to fix.
* Button groups show as the block editor's toggle groups. The choices of a `color_scheme` or `color` field show as swatches of the theme's colours, taken from `cinq_schemes()` and `cinq_palette()` as the theme's admin styles take them: an « A » in the scheme's text colour on its background, or the colour itself, the label in the tooltip.
* Date, time and colour fields open WordPress's pickers, and show dates in the field's display format.
* Link fields use the block editor's LinkControl, in a popover: search over contents and terms, direct entry, the link text and « Open in new tab », as the block editor links a button. It loads the block editor's scripts, which the browser usually has from the post editor already.
* User, icon, Google Map and page link fields are edited in the editor too. Users are found as ACF finds them, among the roles the field allows, by name or login, and by e-mail only for whoever may edit users; the search only answers for a user field of the post's own blocks; page links offer the archives the field allows; a place is an address and its coordinates, as ACF stores it, with or without a Google Maps key.
* A page open in the editor is locked with WordPress's own lock, the one of the classic edit screen and the block editor: whoever opens it elsewhere sees who is editing it. Opened while someone else holds it, the editor says who, and offers to go back or to take over; taken over, it says so, and the changes stay in the draft. The heartbeat keeps the lock every ten seconds and leaving the page gives it back. A page locked by someone else is never published.
* Titles found by search, the post title and messages from the server show apostrophes and ampersands as they are, instead of HTML entities (`l&rsquo;`, `&#038;`).
* The list of blocks and the settings stay open or closed as each user left them, kept in their WordPress preferences as the block editor keeps its own.
* Ctrl+` and Ctrl+Shift+` move between the top bar, the list of blocks, the preview and the settings, as in the block editor.
* Images, files and galleries open the media library through WordPress's MediaUpload; a gallery opens with its images selected.
* Fixed: on a page never saved before, the preview read the draft with another field named `blocks`, and showed its blocks empty. The editor tells ACF which field the page's zone is.
* Fixed: after a refused publication, the fields to fix could sit in closed panels. A panel opens by itself when one of its fields is in error, unless the user closed it.
* End-to-end tests, with Playwright and WordPress's own test utilities: adding a block, its preview, ACF's validation, publishing with ⌘S, discarding a draft.
* ⌘S / Ctrl+S publishes, from the editor, the preview or a rich text field, as it saves in the block editor. Pressed while the draft is being saved, it publishes once the save is done; the **Publish** button no longer waits for it either.
* The command palette (⌘K / Ctrl+K) adds a block, publishes, discards the draft, changes the preview width, shows or hides the panels, opens the classic edit screen or the page.
* The preview width is chosen in an **Preview** menu, as in the block editor: desktop, tablet or mobile.
* The list of blocks and the settings close from the top bar, and the preview takes their room.
* Blocks and repeater rows have an **Options** menu (duplicate, move up, move down, delete) instead of a row of buttons.
* The editor screen is titled after the post. The admin header no longer warns that `strip_tags()` was passed null.
* The interface is built with `@wordpress/scripts`: it imports the `@wordpress` packages, which WordPress loads as its scripts, and uses `@wordpress/icons`, the icons of the block editor, instead of Dashicons.
* The interface is in English, translated into French: `__()` in PHP, `@wordpress/i18n` in the scripts, as the rest of the CINQ suite. The plugin loads its own translations: WordPress only finds those of plugins hosted on WordPress.org. The plugin is named **CINQ Editor**, « CINQ Éditeur » in French.
* The plugin updates from its GitHub releases, like any other plugin.

= 0.1.0 =
* Prototype: the blocks, the live preview and the settings of the selected block, on top of CINQ WP MCP.
