# CINQ WP Editor

A WordPress plugin that edits the ACF blocks of a page **on one screen**: the list of blocks on
the left, the real page in the middle, the settings of the selected block on the right. Change a
title and the page updates before your eyes.

> Status: 0.2.0, in production on [agencecinq.com](https://www.agencecinq.com) since November 2026.
> It runs end to end on the Agence CINQ theme.

Our sites are made of ACF blocks: a `blocks` flexible content field. In the classic admin, the
client edits a stack of collapsed forms without seeing the result, then clicks « Preview » in
another tab. Here, you see the page, click a block, and set it up alongside, without anything
changing in ACF, in the theme's data or in the way the site is rendered:

- **The same data.** Blocks remain ACF rows, written in the same place. The classic edit screen
  stays available at any time, and deactivating the plugin breaks nothing.
- **The real page.** The preview in the middle is the page the theme serves (Timber, Twig, the
  site's CSS and JS), not an imitation.
- **One draft per person.** Until **Publish** is clicked, visitors see the previous page.
  **Discard** goes back to the published version.
- **Nothing to configure.** Blocks, their fields and their constraints are read from ACF. A
  layout added to the theme shows up in the editor without touching the plugin.

## Built for CINQ's way of making WordPress sites

This plugin depends entirely on how [CINQ](https://agencecinq.com) builds WordPress sites. It is
not a general-purpose page editor. It requires:

- WordPress 7.1, ACF Pro 6.8, Timber 2.5 and PHP 8.4: the latest releases only, with no
  compatibility code for older ones;
- the page's blocks in an ACF Pro flexible content field named `blocks`;
- a Timber theme that renders each block through `views/blocks/block.html.twig`, marked for the
  editor as described in [Theme convention](#theme-convention).

It also reads, when the theme has them, two conventions of CINQ themes: a `mcp.json` describing
the blocks, for the catalogue, and the `cinq_schemes()` and `cinq_palette()` helpers, for colour
swatches. On start, it checks what it requires; missing one, it stays off and says why in the
admin.

Anyone may use it, under the MIT licence. Keep in mind that it follows CINQ's stack and its
choices, and changes with them: a site built another way will need its own adaptations, and
these are not something the plugin sets out to support.

## Close to the platform

We use WordPress, ACF and Timber as far as they go, and try never to stray from them. Before
writing code, we look for what the platform already does; when it does, the editor uses it, the
way WordPress's own screens use it. The result looks, behaves and is built like WordPress.

| The editor needs to… | It uses |
|---|---|
| find the block zone of a post | `acf_get_field_groups()`, which applies the theme's location rules |
| know which blocks to offer | `acf_prepare_field()`, as the edit screen does |
| validate and save | `acf_validate_value()` and `acf_update_value()`: the rules, the messages and the HTML filtering of the edit screen |
| preview a draft | ACF's `acf/pre_load_value` and `acf/pre_load_reference` filters, Timber's `timber/twig` |
| talk to the server | the REST API, through `@wordpress/api-fetch` and its nonce |
| draw the interface | `@wordpress/components`, `@wordpress/icons`, the admin colour scheme |
| edit fields | the block editor's `LinkControl`, the media library's `MediaUpload`, the classic editor's TinyMCE with ACF's toolbars, WordPress's date and colour pickers |
| tell what happened | the `core/notices` store: snackbars and banners, read out to screen readers |
| remember choices | the `core/preferences` store, kept per user |
| offer shortcuts | `@wordpress/keyboard-shortcuts` (⌘S), the command palette (⌘K), `navigateRegions` |
| keep two people apart | WordPress's post lock and the edit screen's heartbeat |
| speak French | `__()` and `@wordpress/i18n`, compiled with WP-CLI |
| be built, linted and tested | `@wordpress/scripts`, `@wordpress/eslint-plugin`, `@wordpress/e2e-test-utils-playwright` |
| update | the `Update URI` header and the GitHub releases, as the other plugins of the CINQ suite |

Where WordPress has no answer yet, we follow its conventions rather than invent our own. An
experimental API on its way into WordPress is welcome, as WordPress's own screens use them; the
few the editor relies on are listed once, in `eslint.config.cjs`.

## Why not the block editor

We tried, more than once: the last time, on the Agence CINQ theme, with its layouts as ACF Blocks
in the block editor and without touching the theme. It does not fit how we build sites. Our way
is opinionated, and we know it:

- **Where the data lives.** Our blocks are ACF flexible content rows in the post's meta, which the
  classic edit screen, our Timber templates and CINQ WP MCP all read. The block editor keeps blocks
  in `post_content`, as JSON in HTML comments: every page of every site would have to be migrated,
  and the MCP rewritten.
- **One definition per block.** Each layout would need a second definition as an ACF Block.
  Cloning the layout's fields does not do: ACF cannot find a cloned field by its key outside its
  group, so it neither reads nor saves the block's values. The fields would have to be copied, and
  kept in step by hand.
- **Classic Timber themes.** Our templates render `post.meta( 'blocks' )`, full width, section by
  section. Block editor content is `post_content`, which our default page template shows in a
  narrow text column, and our blocks template does not show at all.
- **Tailwind, built by Vite.** Our styles are Tailwind utilities compiled by Vite, served from a
  manifest that our Vite helper only reads on the front end. The editor canvas would need styles of
  its own, and `cinq-wp-classic-editor` removes the block library's styles from our sites anyway.
- **JavaScript modules.** Our components (accordions, modals, drawers…) are `@agencecinq`
  packages that an ES module, enqueued with `wp_enqueue_script_module`, loads on demand on the real
  page. The editor canvas does not load them: what it shows is not what visitors get.
- **Not the real page.** Even with all of the above, the canvas shows the content alone, without
  the header, the footer or the template around it.

So we kept what the block editor does well, its packages, and left its data model: see
[Close to the platform](#close-to-the-platform).

## What the person editing sees

| Area | Content |
|---|---|
| Left | The blocks of the page, in order. Drag and drop to move them; each has an **Options** menu (duplicate, move up, move down, delete). **Add a block** opens the catalogue: name, description and guidance from the theme's `mcp.json`. |
| Middle | The live page, in desktop, tablet or mobile width. Hovering a block outlines it, clicking it selects it. Links lead nowhere, so as not to leave the editor. |
| Right | The fields of the selected block: text, rich text, images and galleries, links, related content and page links with their archives, users, icons, places, dates and colours, button groups (the theme's schemes and colours as swatches), repeaters, checkboxes, lists. A field refused by ACF is flagged under it, and its panel opens. |
| Top | Buttons to close the list of blocks and the settings, the **Preview** menu, the draft's status (« Saving the draft… », « Draft saved », « Up to date »), **Discard**, **Publish** (**Save** for a page not yet published, ⌘S). The command palette (⌘K) offers the same actions. |

It opens from the list of pages (**Visual editor** when hovering a row), from the edit screen of
a page (**Open the visual editor**) or from the admin bar on the site (**Edit visually**).

## How it works

| Step | What happens |
|---|---|
| Opening | The screen sets WordPress's post lock, then `GET /cinq-wp-editor/v1/posts/{id}` returns the layouts offered, the published blocks and the draft, if any. |
| Editing | After 300 ms without typing, a single `PUT …/draft` call validates the blocks with ACF, writes them with ACF onto a hidden `cinq_wp_editor_draft` post (one per page and per user) and returns the HTML of the changed or added blocks only, each rendered alone with the theme's template. |
| Preview | The iframe shows the real page with `?cinq-wp-editor={id}`. ACF serves the draft's rows in place of the page's and formats them as usual; the theme renders them without knowing, and marks each block because the `cinq_wp_editor` Twig global is set. When the page's template does not render its blocks, the editor says so and points to the classic edit screen. |
| Update | The returned block replaces the old one in the preview. Moving or deleting a block happens directly in the preview, without waiting for the server; an added block shows « Loading the block… » until it is rendered. If a block cannot be rendered alone, the preview reloads the whole page. |
| Lock | The edit screen's heartbeat (`wp-refresh-post-lock`) renews the lock every ten seconds, and leaving the page gives it back (`wp-remove-post-lock`). The classic edit screen, the block editor and this one see each other's lock. |
| Publishing | `POST …/publish` refuses while someone else holds the lock, validates everything, refuses as a whole if one field is invalid (never half a page), writes with ACF, then deletes the draft. |

```
cinq-wp-editor.php       plugin header, requirements, class loading
uninstall.php            deletes the drafts when the plugin is deleted
README.txt               WordPress readme: "View details" modal and changelog
includes/
  Admin.php              full-screen screen, entry links, scripts and their config
  Rest.php               the routes: state, draft, discard, publish, users
  Model.php              what the editor knows about a post: zone, blocks offered, fields
  Zone.php               the flexible content of a post, read and written with ACF
  Blocks.php             editor blocks ↔ ACF rows, validated by ACF
  Annotations.php        block descriptions, read from the theme's mcp.json
  Drafts.php             drafts (one hidden post per page and per user)
  Lock.php               WordPress's post lock: open, hold, take over
  Preview.php            the real page, served with the draft and the theme's markers
  Renderer.php           a single block, rendered with the theme's template
  PluginUpdater.php      updates from GitHub releases
  Readme.php             README.txt as sections for the details modal
src/editor.js            the interface, in JSX, built into build/ (not in Git)
assets/                  editor styles, preview script and styles
languages/               the French translation: PO, MO and the scripts' JSON
tests/e2e/               end-to-end tests
bin/                     development only: sandbox, test block, seed
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

## Installing

Upload `cinq-wp-editor.zip` from the
[latest release](https://github.com/agencecinq/cinq-wp-editor/releases/latest), then activate
**CINQ Editor**. The plugin then updates from its GitHub releases, like the other plugins of the
CINQ suite; a Git clone is never updated, so as not to overwrite the repository.

## Development

The interface is built as WordPress builds its own screens: `src/editor.js` imports the
`@wordpress/*` packages, which the build leaves to WordPress's scripts and lists in
`build/editor.asset.php`, the dependencies the plugin enqueues. Only `@wordpress/icons`, which
WordPress does not ship as a script, is bundled.

- `pnpm install`, then `pnpm build`, or `pnpm start` to rebuild on every change. A clone without
  `build/` stays off and says so in the admin; nothing built is committed.
- `pnpm lint:js`, `pnpm lint:css` and `pnpm format`: WordPress's JavaScript and CSS standards.
- `composer install`, then `composer lint` or `composer lint:fix`: WordPress's PHP standards and
  PHP 8.4 compatibility.
- `composer i18n` (WP-CLI 2.7 or later) extracts the strings into the POT file and merges them
  into the PO file. Translate the new ones, then run it again: it compiles the MO file for PHP and
  the JSON files for `build/editor.js` and `assets/preview.js`.

### End-to-end tests

`pnpm test:e2e` runs `tests/e2e/` in Chromium, with Playwright and
`@wordpress/e2e-test-utils-playwright`, as Gutenberg tests its editor. The tests run against a
site that is already up, with ACF Pro, a CINQ theme and `bin/mu-plugins/test-block.php` linked
into its mu-plugins: a block with every ACF Pro field type, added to the theme's `blocks` field
without touching the theme. Each test creates its own draft page and deletes it.

Name the site and an administrator in a `.env.e2e` file, kept out of Git:

```
WP_BASE_URL=https://agencecinq.local
WP_USERNAME=cinq-e2e
WP_PASSWORD=…
NODE_EXTRA_CA_CERTS=/Users/…/Local/run/router/nginx/certs/agencecinq.local.crt
E2E_PAGE_TEMPLATE=page-templates/blocks-page.php
```

`NODE_EXTRA_CA_CERTS` makes Node trust a Local site's self-signed certificate.
`E2E_PAGE_TEMPLATE` names the page template a theme keeps its blocks to, when it does. Give the
administrator the `en_US` locale: the tests read the interface in its source language.

### Publishing a version

As for [CINQ Theme Updates](https://github.com/agencecinq/cinq-wp-theme-updates):

1. Bump `Version` in `cinq-wp-editor.php` and add the version to the changelog of `README.txt`.
2. Commit, push, then push a tag: `git tag v0.3.0 && git push origin v0.3.0`. An annotated tag
   names the release: `git tag -a v0.3.0 -m Name` publishes "v0.3.0 · Name".

The `release.yml` workflow checks that the tag matches the version and the changelog, runs the
PHP, JavaScript and CSS lints, builds the scripts, builds the zip with `git archive`
(`.gitattributes` leaves the development files out, this README included) plus `build/`, and
attaches it to the release with `update.json`.

## Known limits

- Responsiveness: in a test WordPress, the changed block shows about 1.5 s after the last
  keystroke, 1.2 s of which is WordPress booting on each request. Not yet measured in production.
- Only the main zone (`blocks`) of a post type is edited: not options pages or terms.
- Flexible content nested in a block is still edited in the classic edit screen.
- ACF conditional logic is only evaluated between sibling fields.
- A theme JS component missing at load time (a block of a type never seen on the page) may not
  initialise before the preview is reloaded.
- No step-by-step undo: **Discard** goes back to the published version.
- Two people on the same page: the post lock keeps it to one at a time. The one who takes over does
  not see the other's draft, which stays theirs.
- The preview hides the theme's cookie banner (`cinq-consent`): to be generalised to other themes.
- The end-to-end tests do not run in GitHub Actions yet: they need a running WordPress with ACF Pro
  and a CINQ theme.
- `bin/sandbox.sh`, a throwaway WordPress Playground, still expects the theme's repository under
  its former name, `wp-cinq`: to be updated before it runs again.

## Next steps

1. Undo / redo.
2. Options pages (header, footer) in the same screen.
3. Measure and optimise in production.
4. End-to-end tests in GitHub Actions, and a working sandbox.
