# CINQ WP Editor

A WordPress plugin that edits the ACF blocks of a page **on one screen**: the list of blocks on
the left, the real page in the middle, the settings of the selected block on the right. Change a
title and the page updates before your eyes.

> Status: 0.2.0, in production on [agencecinq.com](https://www.agencecinq.com) since November 2026.
> It runs end to end on the Agence CINQ and Eigrene themes.

## Built for CINQ's way of making WordPress sites

This plugin depends entirely on how [CINQ](https://agencecinq.com) builds WordPress sites. It is
not a general-purpose page editor. It expects:

- the page's blocks in an ACF Pro flexible content field named `blocks`;
- a Timber theme that renders each block through `views/blocks/block.html.twig`, marked for the
  editor as described in [Theme convention](#theme-convention);
- the latest releases of WordPress, ACF Pro and Timber, with no compatibility code for older ones;
- optionally, the conventions of CINQ themes: a `mcp.json` describing the blocks, and the
  `cinq_schemes()` and `cinq_palette()` helpers for colour swatches.

Anyone may use it, under the MIT licence. Keep in mind that it follows CINQ's stack and its
choices, and changes with them: a site built another way will need its own adaptations, and
these are not something the plugin sets out to support.

## The idea

Our sites are made of ACF blocks (a `blocks` flexible content field). In the classic admin, the
client edits a stack of collapsed forms without seeing the result, then clicks « Preview » in
another tab. Here, you see the page, click a block, and set it up alongside.

This plugin adds that layer **without changing anything in ACF or the theme**:

- **The same data.** Blocks remain ACF rows, written in the same place. The classic edit screen
  stays available at any time, and deactivating the plugin breaks nothing.
- **The real rendering.** The preview in the middle is the real page served by the theme
  (Timber, Twig, the site's CSS and JS), not an imitation.
- **One draft per person.** Until **Publish** is clicked, visitors see the previous page.
  **Discard** goes back to the published version.
- **Nothing to configure.** Blocks, their fields and their constraints are read from ACF. The
  descriptions and guidance of `mcp.json` (the ones Claude reads) also feed the block catalogue.
  A layout added to the theme shows up in the editor without touching the plugin.

It depends on ACF Pro and the theme alone. On start, it checks that the theme has the right
architecture: ACF Pro active, Timber, and a `views/blocks/block.html.twig` template. Otherwise it
stays off and says so in the admin. For each post, it asks ACF which field groups apply to it
(post type, page template…) and looks there for the `blocks` flexible content: a page without a
block zone has no link to the editor.

| What the editor does | With what |
|---|---|
| Find the block zone of a post | `acf_get_field_groups()`, which applies the theme's location rules |
| Know which blocks to offer | `acf_prepare_field()`, as the edit screen does, less the blocks marked `hidden` in `mcp.json` |
| Validate | `acf_validate_value()`: the same rules and the same messages as the edit screen |
| Save | `acf_update_value()`, with ACF's HTML filtering for users without `unfiltered_html` |
| Describe the blocks | the `blocks` of `mcp.json`, read from the parent theme then the child theme |

[CINQ WP MCP](https://github.com/agencecinq/cinq-wp-mcp) reads the same ACF fields and the same
`mcp.json`: Claude and the editor offer the same blocks without sharing code.

## What the person editing sees

| Column | Content |
|---|---|
| Left | The blocks of the page, in order. Drag and drop or arrows to move, duplicate, delete; **Add a block** opens the catalogue (name, description, theme guidance). |
| Middle | The live page, in desktop or mobile view. Hovering a block outlines it, clicking it selects it. Links lead nowhere, so as not to leave the editor. |
| Right | The fields of the selected block: text, rich text (TinyMCE, with ACF's toolbars), images and galleries (WordPress media library), links (the block editor's LinkControl), related content and page links with their archives (search), users (search among the roles the field allows), icons (Dashicons, media library or URL), places (address and coordinates), dates and colours (WordPress's pickers), repeaters, checkboxes, lists. A field refused by validation (required and empty, value out of the list…) is flagged under the field. |
| Top | Buttons to close the list of blocks and the settings, the **Preview** menu (desktop, tablet, mobile), draft status (« Saving the draft… », « Draft saved », « Up to date »), **Discard**, **Publish** (**Save** for a page not yet published, ⌘S / Ctrl+S). The command palette (⌘K) offers the same actions. |

It opens from the list of pages (**Visual editor** when hovering a row), from the edit screen
of a page (**Open the visual editor**) or from the admin bar on the site (**Edit visually**).

The interface is drawn with WordPress's own pieces: `wp.components`, the media library,
TinyMCE through the classic editor API, the admin color scheme, `Modal` for confirmations, the
`core/notices` store with snackbars and banners, toggle groups for button groups (the theme's
schemes and colours as swatches, from `cinq_schemes()` and `cinq_palette()`), WordPress's date and
colour pickers, and an
**Options** menu on each block and repeater row.

## How it works

| Step | What happens |
|---|---|
| Opening | `GET /cinq-wp-editor/v1/posts/{id}` returns the layouts offered, the published blocks and the draft, if any. |
| Editing | After 300 ms without typing, a single `PUT …/draft` call validates the blocks with ACF, writes them with ACF onto a hidden `cinq_wp_editor_draft` post (one per page and per user) and returns the HTML of the changed or added blocks only, rendered alone rather than with the whole page. |
| Preview | The iframe shows the real page with `?cinq-wp-editor={id}`. When the page's template does not render its blocks, the editor says so and points to the classic edit screen. The `acf/pre_load_value` filter serves the draft's rows in place of the page's: ACF formats them as usual, and the theme renders them without knowing. The theme wraps each block in a `data-cinq-block` marker, as long as the `cinq_wp_editor` Twig global is set: see the theme convention below. |
| Update | The returned block replaces the old one in the preview. Moving or deleting a block happens directly in the preview, without waiting for the server; an added block shows « Loading the block… » until it is rendered. If a block cannot be rendered alone, the preview reloads the whole page. |
| Lock | Opening the editor sets WordPress's post lock (`_edit_lock`), renewed by the edit screen's heartbeat (`wp-refresh-post-lock`) every ten seconds and given back on leaving (`wp-remove-post-lock`). The classic edit screen, the block editor and this one see each other's lock. |
| Publishing | `POST …/publish` refuses while someone else holds the lock, validates everything, refuses as a whole if one field is invalid (never half a page), writes with ACF, then deletes the draft. |

The interface is built as WordPress builds its own screens, with
[`@wordpress/scripts`](https://www.npmjs.com/package/@wordpress/scripts): `src/editor.js` imports
the `@wordpress/*` packages, which the build leaves to WordPress's scripts (`wp-components`,
`wp-block-editor`…) and lists in `build/editor.asset.php`, the dependencies the plugin enqueues.
Only `@wordpress/icons`, which WordPress does not ship as a script, is bundled. The preview script
and the styles in `assets/` are served as they are.

```
cinq-wp-editor.php       plugin header, class loading
uninstall.php            deletes the drafts when the plugin is deleted
README.txt               WordPress readme: "View details" modal and changelog
includes/
  Admin.php              full-screen screen, entry links, scripts
  Rest.php               the four routes (state, draft, discard, publish)
  Model.php              what the editor knows about a post: zone, blocks offered, fields
  Zone.php               the flexible content of a post, read and written with ACF
  Blocks.php             editor blocks ↔ ACF rows, validated by ACF
  Annotations.php        block descriptions, read from the theme's mcp.json
  Drafts.php             drafts (one hidden post per page and per user)
  Preview.php            the real page, served with the draft and the markers
  Renderer.php           rendering of a single block for the quick update
  PluginUpdater.php      updates from GitHub releases
  Readme.php             README.txt as sections for the details modal
src/editor.js            the editor's interface, built into build/ (not in Git)
assets/                  editor styles (editor.css) and preview script (preview.js/css)
bin/sandbox.sh           throwaway test WordPress
.github/workflows/       release on tag: zip and update.json
```

## Theme convention

The theme renders each block through `views/blocks/block.html.twig`, the only place that knows
how a layout is included. The stack of `views/blocks/blocks.html.twig` goes through it, and so
does the editor when it renders a block alone: the editor carries no copy of the theme's
templates. In the editor's preview, and there only, the `cinq_wp_editor` Twig global is set:

```twig
{# views/blocks/block.html.twig #}
{%- set html -%}
	{{- include( 'blocks/' ~ ( block.acf_fc_layout | lower | replace( { '_': '-' } ) ) ~ '.html.twig', { block: block, loop: loop }, ignore_missing: true ) -}}
{%- endset -%}

{%- if cinq_wp_editor | default( false ) -%}
	<div data-cinq-block="{{ loop }}" style="display: contents">{{- html -}}</div>
{%- else -%}
	{{- html -}}
{%- endif -%}
```

`views/blocks/blocks.html.twig` includes it for each block with `loop: loop.index0`, renders its
stack even with no block when `cinq_wp_editor` is set, so a first one can be added, and puts
`data-cinq-blocks` on the stack's container (a `display: contents` one if it has none). The
public page is unchanged.

## Requirements

- WordPress 7.1+, the latest release only, PHP 8.4+
- ACF Pro 6.8+ and Timber 2.5+, their latest releases
- A Timber theme rendering each block through `views/blocks/block.html.twig` (the convention of CINQ themes, see below)
- Optional: a `mcp.json` at the theme root, for the catalogue descriptions

To install it on a site: upload `cinq-wp-editor.zip` from the
[latest release](https://github.com/agencecinq/cinq-wp-editor/releases/latest), then activate
**CINQ Editor**. The plugin then updates from its GitHub releases, like the other plugins of the
CINQ suite; a Git clone is never updated, so as not to overwrite the repository.

## Publishing a version

As for [CINQ Theme Updates](https://github.com/agencecinq/cinq-wp-theme-updates):

1. Bump `Version` in `cinq-wp-editor.php` and add the version to the changelog of `README.txt`.
2. Commit, push, then push a tag: `git tag v0.3.0 && git push origin v0.3.0`. An annotated tag
   names the release: `git tag -a v0.3.0 -m Name` publishes "v0.3.0 · Name".

The `release.yml` workflow checks that the tag matches the version and the changelog, runs
`composer lint`, builds the scripts (`pnpm build`), builds the zip with `git archive`
(`.gitattributes` leaves the development files out, this README and `src/` included) plus `build/`,
and attaches it to the release with `update.json`.

## Development

`pnpm install`, then `pnpm build`, or `pnpm start` to rebuild on every change. `pnpm lint:js` checks
the script against WordPress's JavaScript standards, and `pnpm format` formats it. A clone without
`build/` stays off and says so in the admin. The release workflow builds it for the zip: nothing
built is committed.

`composer install`, then `composer lint` (phpcs, WordPress standards and PHP 8.4 compatibility)
or `composer lint:fix`.

`pnpm test:e2e` runs the end-to-end tests of `tests/e2e/` in Chromium, with Playwright and
`@wordpress/e2e-test-utils-playwright`, as Gutenberg tests its editor. They run against a site that
is already up, with ACF Pro, a CINQ theme and `bin/mu-plugins/test-block.php` linked into its
mu-plugins; each test creates its own draft page and deletes it. Name the site and an
administrator in a `.env.e2e` file, kept out of Git:

```
WP_BASE_URL=https://eigrene.local
WP_USERNAME=cinq-e2e
WP_PASSWORD=…
NODE_EXTRA_CA_CERTS=/Users/…/Local/run/router/nginx/certs/eigrene.local.crt
```

`NODE_EXTRA_CA_CERTS` makes Node trust a Local site's self-signed certificate. On a theme that
keeps its blocks to one page template, name it with `E2E_PAGE_TEMPLATE`, such as
`page-templates/blocks-page.php` on Agence CINQ. Give the
administrator the `en_US` locale: the tests read the interface in its source language.

The interface is in English, translated into French in `languages/`: `__()` in PHP,
`@wordpress/i18n` in the scripts. After changing a string, run `composer i18n` (WP-CLI 2.7 or
later): it extracts the strings to the POT file and merges them into the PO file. Translate the
new or changed ones in the PO file, then run `composer i18n` again: it compiles the MO file for
PHP and the JSON files WordPress gives the scripts, `build/editor.js` and `assets/preview.js`.

## Trying it locally

```bash
bash bin/sandbox.sh
```

Starts a throwaway WordPress ([WP Playground](https://github.com/WordPress/wordpress-playground),
PHP 8.4, SQLite) on http://127.0.0.1:9400, already logged in as admin, with:

- the agencecinq theme as on GitHub (`origin/main`, built);
- Secure Custom Fields, in place of ACF Pro, which needs a licence;
- this plugin mounted live: a change shows on reload;
- a **Test éditeur visuel** page filled with real blocks (`bin/mu-plugins/seed.json`).

The sandbox also loads `bin/mu-plugins/test-block.php`: a « Test de l’éditeur (tous les champs) »
block with every ACF Pro field type, added to the theme's `blocks` field without touching the
theme, and rendered as ACF formats each value. To try it on a local site, link it into
`wp-content/mu-plugins/` and add the block to a draft page.

The script expects the `wp-cinq` repository next to this one, and needs Node, Composer and pnpm.
The database lives in memory: it starts from scratch on each run. The editor is at
http://127.0.0.1:9400/wp-admin/admin.php?page=cinq-wp-editor&post=4.

## Limits of the V0

- Responsiveness: in the test WordPress, the changed block shows about 1.5 s after the last
  keystroke, 1.2 s of which is WordPress booting on each request. Not yet measured on a real
  server.
- Only the main zone (`blocks`) of a post type is edited: not options pages or terms.
- Flexible content nested in a block is still edited in the classic edit screen.
- ACF conditional logic is only evaluated between sibling fields.
- A theme JS component missing at load time (a block of a type never seen on the page) may not
  initialise before the preview is reloaded.
- No step-by-step undo: **Discard** goes back to the published version.
- Two people on the same page: WordPress's post lock keeps it to one at a time, as on the classic
  edit screen. The one who takes over does not see the other's draft, which stays theirs.
- The preview hides the theme's cookie banner (`cinq-consent`): to be generalised to other themes.
- Drag and drop in the list could not be tested automatically (the arrows, which make the same
  move, were).

Spotted along the way, on the theme side: `footer.html.twig` fails (error 500) when no menu is
assigned to the footer. The sandbox creates those menus to work around it.

## Next steps

1. Undo / redo.
2. Options pages (header, footer) in the same screen.
3. Measure and optimise on a real server.
