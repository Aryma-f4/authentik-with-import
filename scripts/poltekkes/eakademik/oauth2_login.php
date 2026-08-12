<?php
/**
 * OAuth2 SSO entrypoint — starts the authorization-code flow against authentik.
 *
 * Generates a CSRF state, stashes it in the session, then redirects the browser
 * to the IdP login. After the user authenticates, authentik redirects back to
 * oauth2_callback.php.
 */
session_start();

require_once dirname(__FILE__) . '/conf/oauth.config.php';

function oauth_random_bytes($length) {
    $strong = false;
    $bytes = openssl_random_pseudo_bytes($length, $strong);
    if ($bytes === false || $strong !== true) {
        header('HTTP/1.1 500 Internal Server Error');
        exit;
    }
    return $bytes;
}

$_SESSION['oauth_state'] = bin2hex(oauth_random_bytes(32));
$_SESSION['oauth_pkce_verifier'] = rtrim(strtr(base64_encode(oauth_random_bytes(48)), '+/', '-_'), '=');
$oauthPkceChallenge = rtrim(strtr(base64_encode(hash('sha256', $_SESSION['oauth_pkce_verifier'], true)), '+/', '-_'), '=');

$params = http_build_query([
    'client_id' => OAUTH_CLIENT_ID,
    'redirect_uri' => OAUTH_REDIRECT_URI,
    'response_type' => 'code',
    'scope' => 'openid profile email',
    'state' => $_SESSION['oauth_state'],
    'code_challenge' => $oauthPkceChallenge,
    'code_challenge_method' => 'S256',
]);

header('Location: ' . OAUTH_AUTHORIZE_URL . '?' . $params);
exit;
