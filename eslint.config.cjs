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
			// Experimental APIs on their way into WordPress, as its own
			// screens use them.
			'@wordpress/no-unsafe-wp-apis': [
				'error',
				{
					'@wordpress/components': [
						'__experimentalToggleGroupControl',
						'__experimentalToggleGroupControlOption',
						'__experimentalToggleGroupControlOptionIcon',
					],
					'@wordpress/core-data': [
						'__experimentalFetchLinkSuggestions',
					],
				},
			],
		},
	},
];
