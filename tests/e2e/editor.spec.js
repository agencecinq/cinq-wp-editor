/**
 * The editor, end to end, on the test block of bin/mu-plugins/test-block.php.
 */
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'CINQ WP Editor', () => {
	let pageId;

	test.beforeEach( async ( { requestUtils } ) => {
		const created = await requestUtils.createPage( {
			title: 'E2E: CINQ WP Editor',
			status: 'draft',
		} );

		pageId = created.id;
	} );

	test.afterEach( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/pages/${ pageId }`,
			params: { force: true },
		} );
	} );

	/**
	 * Opens the editor on the page, adds the test block and fills its
	 * required fields.
	 *
	 * @param {Object} fixtures       Test fixtures.
	 * @param {Object} fixtures.admin Admin utils.
	 * @param {Object} fixtures.page  Page.
	 * @param {string} text           Text of the block.
	 */
	async function addValidBlock( { admin, page }, text ) {
		await admin.visitAdminPage(
			'admin.php',
			`page=cinq-wp-editor&post=${ pageId }`
		);
		await page
			.getByRole( 'region', { name: 'Blocks of the page' } )
			.getByRole( 'button', { name: 'Add a block' } )
			.click();
		await page
			.getByRole( 'dialog', { name: 'Add a block' } )
			.getByRole( 'button', { name: /Test de l’éditeur/ } )
			.click();

		const settings = page.getByRole( 'region', {
			name: /Settings of the .* block/,
		} );

		await settings
			.getByRole( 'textbox', { name: /Texte \(requis/ } )
			.fill( text );
		await settings
			.getByRole( 'textbox', { name: /Titre du groupe/ } )
			.fill( 'Un groupe' );
		await settings.getByRole( 'button', { name: /^01/ } ).click();
		await settings
			.getByRole( 'textbox', { name: /Texte de la ligne/ } )
			.fill( 'Une ligne' );

		return settings;
	}

	test( 'publishes with ⌘S, then discards a draft back to the published page', async ( {
		admin,
		page,
	} ) => {
		const editor = page.locator( '#cinq-wp-editor' );
		const settings = await addValidBlock(
			{ admin, page },
			'Version publiée'
		);

		await expect( editor.getByText( 'Draft saved' ) ).toBeVisible();
		await page.keyboard.press( 'ControlOrMeta+s' );
		await expect( editor.getByText( 'Page saved.' ) ).toBeVisible();
		await expect( editor.getByText( 'Up to date' ) ).toBeVisible();

		const text = settings.getByRole( 'textbox', {
			name: /Texte \(requis/,
		} );

		await text.fill( 'Version brouillon' );
		await expect( editor.getByText( 'Draft saved' ) ).toBeVisible();

		await page
			.getByRole( 'button', { name: 'Discard', exact: true } )
			.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Discard the draft?',
		} );

		await dialog.getByRole( 'button', { name: 'Discard' } ).click();
		await expect( editor.getByText( /Draft discarded/ ) ).toBeVisible();

		// The block is selected again from the list: its fields show the page's.
		await page
			.getByRole( 'region', { name: 'Blocks of the page' } )
			.getByRole( 'button', { name: /Test de l’éditeur/ } )
			.click();
		await expect(
			settings.getByRole( 'textbox', { name: /Texte \(requis/ } )
		).toHaveValue( 'Version publiée' );
	} );

	test( 'adds a block, shows it in the preview, and saves the page once ACF accepts it', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await admin.visitAdminPage(
			'admin.php',
			`page=cinq-wp-editor&post=${ pageId }`
		);

		// Notices are also read out, in WordPress's live regions: look for
		// them in the editor.
		const editor = page.locator( '#cinq-wp-editor' );
		const preview = page.frameLocator( 'iframe[title="Page preview"]' );

		// The theme marks its stack, even with no block yet.
		await expect( preview.locator( '[data-cinq-blocks]' ) ).toBeAttached();

		await page
			.getByRole( 'region', { name: 'Blocks of the page' } )
			.getByRole( 'button', { name: 'Add a block' } )
			.click();

		const picker = page.getByRole( 'dialog', { name: 'Add a block' } );

		await picker.getByRole( 'searchbox' ).fill( 'Test de' );
		await picker
			.getByRole( 'button', { name: /Test de l’éditeur/ } )
			.click();

		await expect(
			preview.locator( '[data-cinq-block="0"]' )
		).toBeAttached();

		const settings = page.getByRole( 'region', {
			name: /Settings of the .* block/,
		} );

		await settings
			.getByRole( 'textbox', { name: /Texte \(requis/ } )
			.fill( 'Hello from Playwright' );

		await expect(
			preview.getByRole( 'heading', {
				name: 'Test de l’éditeur : Hello from Playwright',
			} )
		).toBeVisible();
		await expect( editor.getByText( 'Draft saved' ) ).toBeVisible();

		// The group title and the repeater's row are required and empty.
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect(
			editor.getByText(
				/Some fields are not valid: nothing was published/
			)
		).toBeVisible();
		await expect( page.locator( '#a11y-speak-assertive' ) ).toHaveText(
			/Some fields are not valid/
		);

		// Panels with a field in error open by themselves.
		await settings
			.getByRole( 'textbox', { name: /Titre du groupe/ } )
			.fill( 'Un groupe' );
		await settings.getByRole( 'button', { name: /^01/ } ).click();
		await settings
			.getByRole( 'textbox', { name: /Texte de la ligne/ } )
			.fill( 'Une ligne' );
		await expect( editor.getByText( 'Draft saved' ) ).toBeVisible();

		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect( editor.getByText( 'Page saved.' ) ).toBeVisible();

		const state = await requestUtils.rest( {
			path: `/cinq-wp-editor/v1/posts/${ pageId }`,
		} );

		expect( state.draft ).toBeNull();
		expect( state.published[ 0 ] ).toMatchObject( {
			acf_fc_layout: 'cinq_test',
			text: 'Hello from Playwright',
			group: { title: 'Un groupe' },
			repeater: [ { text: 'Une ligne' } ],
		} );
	} );
} );
