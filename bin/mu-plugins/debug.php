<?php
// Sandbox only: writes the last fatal error of a request to a file on the host.
register_shutdown_function(
	static function (): void {
		$error = error_get_last();
		if ( $error && in_array( $error['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR ), true ) ) {
			file_put_contents( __DIR__ . '/fatal.log', gmdate( 'H:i:s' ) . ' ' . ( $_SERVER['REQUEST_URI'] ?? '' ) . "\n" . print_r( $error, true ) . "\n", FILE_APPEND );
		}
	},
	0
);
