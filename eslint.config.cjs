/**
 * WordPress's own JavaScript standards, as @wordpress/scripts ships them,
 * with the plugin's text domain.
 */
const wordpress = require( '@wordpress/scripts/config/eslint.config.cjs' );

module.exports = [
	...wordpress,
	{
		rules: {
			'@wordpress/i18n-text-domain': [
				'error',
				{ allowedTextDomain: 'cinq-wp-editor' },
			],
		},
	},
];
