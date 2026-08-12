<?php
/**
 * OAuth2/OIDC SSO configuration for eAkademik (authentik IdP).
 *
 * Production values are deployed outside version control.
 */

// Base URL of the authentik instance (issuer).
define('OAUTH_ISSUER', 'https://sso-polkesma.dploy.id');

// OAuth2 endpoints (standard authentik layout).
define('OAUTH_AUTHORIZE_URL', OAUTH_ISSUER . '/application/o/authorize/');
define('OAUTH_TOKEN_URL', OAUTH_ISSUER . '/application/o/token/');
define('OAUTH_USERINFO_URL', OAUTH_ISSUER . '/application/o/userinfo/');

// Registered client (authentik provider "eAkademik - Local dev").
define('OAUTH_CLIENT_ID', 'poltekkes-eakademik');
define('OAUTH_CLIENT_SECRET', 'REPLACE_AT_DEPLOYMENT');

// Redirect URI registered on the provider (must match exactly).
define('OAUTH_REDIRECT_URI', 'https://adminsia.poltekkes-malang.ac.id/oauth2_callback.php');
