<?php
/**
 * Completes SIA Portal's Authentik OAuth2/OIDC login.  The legacy username /
 * password endpoint is deliberately not called: Authentik is the authority
 * for this request and GateKeeper's dedicated SSO path is read-only.
 */

session_start();

require_once dirname(__FILE__) . '/oauth.config.php';
require_once dirname(__FILE__) . '/sso_common.php';

function portal_sso_fail($message) {
    error_log('SIA Portal OAuth2 callback: ' . $message);
    header('Location: /index.php?err=sso');
    exit;
}

function portal_sso_bootstrap() {
    $root = dirname(__FILE__) . '/..';
    chdir($root);

    require_once $root . '/config/configuration.class.php';
    $cfg = new Configuration();
    $cfg->Load('base.conf.php');
    $docroot = $cfg->GetValue('docroot');
    if (empty($docroot)) {
        return false;
    }

    require_once $cfg->GetValue('app_lib') . 'adodb/adodb.inc.php';
    require_once $cfg->GetValue('app_lib') . 'nusoap/nusoap.php';
    require_once $cfg->GetValue('app_lib') . 'function/additional.php';
    require_once $cfg->GetValue('app_data') . 'user_identity.class.php';
    require_once $cfg->GetValue('app_data') . 'role.class.php';
    require_once $cfg->GetValue('app_data') . 'database_connected.class.php';
    require_once $cfg->GetValue('app_data') . 'Cryptlink.class.php';
    require_once $cfg->GetValue('app_service') . 'client/base_client.service.class.php';
    require_once $cfg->GetValue('app_service') . 'client/sia/sia_setting_client.service.class.php';
    require_once $cfg->GetValue('app_module') . 'user/communication/user_client.service.class.php';
    require_once $cfg->GetValue('app_module') . 'login/business/gatekeeper.class.php';

    return $cfg;
}

$verifier = sso_consume_callback_state($_SESSION, $_GET);
if ($verifier === false) {
    portal_sso_fail('invalid callback state');
}

$token = sso_http_json(OAUTH_TOKEN_URL, array(
    'grant_type' => 'authorization_code',
    'code' => $_GET['code'],
    'redirect_uri' => OAUTH_REDIRECT_URI,
    'client_id' => OAUTH_CLIENT_ID,
    'client_secret' => OAUTH_CLIENT_SECRET,
    'code_verifier' => $verifier,
), null);
if (empty($token['access_token'])) {
    portal_sso_fail('token exchange failed');
}

$identity = sso_http_json(OAUTH_USERINFO_URL, null, $token['access_token']);
$ssoUsername = isset($identity['preferred_username']) ? $identity['preferred_username'] : '';
if (!is_string($ssoUsername) || !preg_match('/^[A-Za-z0-9._@-]{1,255}$/', $ssoUsername)) {
    portal_sso_fail('invalid userinfo identity');
}

$cfg = portal_sso_bootstrap();
if ($cfg === false) {
    portal_sso_fail('application bootstrap failed');
}

$gateKeeper = new GateKeeper($cfg);
if ($gateKeeper->AuthenticateSso($ssoUsername) !== true) {
    portal_sso_fail('no active Portal user for SSO identity');
}

$_SESSION['time'] = time() + 1800;
$userIdentity = $_SESSION['user_identity_portal'];
if ($userIdentity->GetProperty('Role') == 1 || $userIdentity->GetProperty('Role') == 2) {
    if ($userIdentity->GetProperty('UserIsAgree') == 1) {
        if ($cfg->GetValue('enable_kuisioner')) {
            header('Location: ' . $cfg->GetURL('kuisioner', 'kuisioner', 'view'));
        } else {
            header('Location: ' . $cfg->GetURL('home', 'home', 'view'));
        }
    } else {
        header('Location: ' . $cfg->GetURL('user', 'user', 'process'));
    }
    exit;
}
if ($userIdentity->GetProperty('Role') == 8 || $userIdentity->GetProperty('Role') == 9) {
    if ($userIdentity->GetProperty('UserIsAgree') == 1) {
        if ($cfg->GetValue('enable_kuisioner')) {
            header('Location: ' . $cfg->GetURL('kuisioner', 'kuisioner', 'view'));
        } else {
            header('Location: ' . $cfg->GetURL('kbk_home', 'home', 'view'));
        }
    } else {
        header('Location: ' . $cfg->GetURL('kbk_user', 'user', 'process'));
    }
    exit;
}
if ($cfg->GetValue('enable_kuisioner') && $userIdentity->GetProperty('Role') != 3) {
    header('Location: ' . $cfg->GetURL('kuisioner', 'kuisioner', 'view'));
    exit;
}
header('Location: ' . $cfg->GetURL('home', 'home', 'view'));
exit;
