/**
 * WordPress's Playwright config, as `@wordpress/scripts` ships it, on a site
 * that already runs: no wp-env, which needs Docker.
 *
 * WP_BASE_URL, WP_USERNAME and WP_PASSWORD name the site and an administrator;
 * `pnpm test:e2e` reads them from .env.e2e, with NODE_EXTRA_CA_CERTS for a
 * local site's self-signed certificate. The site needs ACF Pro, a CINQ theme
 * and bin/mu-plugins/test-block.php.
 */
const wordpress = require( '@wordpress/scripts/config/playwright.config.js' );

module.exports = {
	...wordpress,
	testDir: './tests/e2e',
	webServer: undefined,
	use: {
		...wordpress.use,
		viewport: { width: 1440, height: 900 },
	},
};
