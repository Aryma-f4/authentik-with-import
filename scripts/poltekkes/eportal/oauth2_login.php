<?php
/** Starts the Authentik authorization-code flow for SIA Portal. */

session_start();

require_once dirname(__FILE__) . '/oauth.config.php';
require_once dirname(__FILE__) . '/sso_common.php';

$stateBytes = sso_random_bytes(32);
$verifierBytes = sso_random_bytes(48);
if ($stateBytes === false || $verifierBytes === false) {
    error_log('SIA Portal OAuth2: secure random source unavailable');
    header('HTTP/1.1 500 Internal Server Error');
    exit;
}

$_SESSION['oauth_state'] = bin2hex($stateBytes);
$_SESSION['oauth_pkce_verifier'] = sso_base64url_encode($verifierBytes);
$challenge = sso_base64url_encode(hash('sha256', $_SESSION['oauth_pkce_verifier'], true));

$params = array(
    'client_id' => OAUTH_CLIENT_ID,
    'redirect_uri' => OAUTH_REDIRECT_URI,
    'response_type' => 'code',
    'scope' => 'openid profile email',
    'state' => $_SESSION['oauth_state'],
    'code_challenge' => $challenge,
    'code_challenge_method' => 'S256',
);

header('Location: ' . OAUTH_AUTHORIZE_URL . '?' . http_build_query($params, '', '&'));
exit;
