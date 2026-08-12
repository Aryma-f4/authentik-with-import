<?php

require_once dirname(__FILE__) . '/sso_common.php';

function sso_assert($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, $message . "\n");
        exit(1);
    }
}

sso_assert(sso_constant_time_equals('state', 'state'), 'equal state was rejected');
sso_assert(!sso_constant_time_equals('state', 'other'), 'different state was accepted');

$session = array('oauth_state' => 'state', 'oauth_pkce_verifier' => 'verifier');
$verifier = sso_consume_callback_state($session, array('state' => 'state', 'code' => 'code'));
sso_assert($verifier === 'verifier', 'valid state did not return verifier');
sso_assert(empty($session), 'state and verifier were not consumed');

$session = array('oauth_state' => 'state', 'oauth_pkce_verifier' => 'verifier');
sso_assert(sso_consume_callback_state($session, array('state' => 'other', 'code' => 'code')) === false, 'invalid state was accepted');
sso_assert(empty($session), 'failed state check did not clear state');

fwrite(STDOUT, "sso common checks passed\n");
