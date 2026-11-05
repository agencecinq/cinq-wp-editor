#!/bin/bash
#
# Starts a throwaway WordPress (WP Playground, SQLite) with:
# - the agencecinq theme, as on GitHub (origin/main), built;
# - Secure Custom Fields, downloaded by Playground;
# - this plugin, mounted live: edits show up on reload;
# - bin/mu-plugins: the menus the theme's footer needs (it fails without them),
#   a page filled with real blocks, and fatal errors logged to bin/mu-plugins/fatal.log.
#
# Usage: bash bin/sandbox.sh   then open http://127.0.0.1:9400/wp-admin/
# Nothing is written outside .sandbox/, and the working copy of the
# theme is not touched (git archive of origin/main).

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CINQ="$(cd "$HERE/.." && pwd)"
BOX="$HERE/.sandbox"

mkdir -p "$BOX"

if [ ! -d "$BOX/agencecinq" ]; then
	echo "→ Thème agencecinq (origin/main)"
	git -C "$CINQ/wp-cinq" fetch -q origin
	mkdir -p "$BOX/agencecinq"
	git -C "$CINQ/wp-cinq" archive origin/main | tar -x -C "$BOX/agencecinq"
	(cd "$BOX/agencecinq" && composer install --no-dev --no-interaction -q && pnpm install --frozen-lockfile --silent && pnpm build >/dev/null)
fi

cat > "$BOX/blueprint.json" <<'JSON'
{
	"$schema": "https://playground.wordpress.net/blueprint-schema.json",
	"preferredVersions": { "php": "8.4", "wp": "latest" },
	"login": true,
	"steps": [
		{ "step": "installPlugin", "pluginData": { "resource": "wordpress.org/plugins", "slug": "secure-custom-fields" } },
		{ "step": "activateTheme", "themeFolderName": "agencecinq" },
		{ "step": "activatePlugin", "pluginPath": "cinq-wp-editor/cinq-wp-editor.php" },
		{ "step": "setSiteOptions", "options": { "permalink_structure": "/%postname%/", "blogname": "CINQ (bac à sable)" } },
		{ "step": "wp-cli", "command": "wp post create --post_type=page --post_title='Test éditeur visuel' --post_status=publish --page_template=page-templates/blocks-page.php" }
	]
}
JSON

echo "→ WordPress sur http://127.0.0.1:9400 (Ctrl+C pour arrêter)"
cd "$BOX"
npx -y @wp-playground/cli@latest server \
	--port=9400 \
	--php=8.4 \
	--blueprint="$BOX/blueprint.json" \
	--mount="$BOX/agencecinq:/wordpress/wp-content/themes/agencecinq" \
	--mount="$HERE:/wordpress/wp-content/plugins/cinq-wp-editor" \
	--mount="$HERE/bin/mu-plugins:/wordpress/wp-content/mu-plugins"
