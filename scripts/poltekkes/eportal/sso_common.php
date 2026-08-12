<?php
/** Shared PHP 5.4-compatible OAuth2/OIDC helpers for the SIA Portal. */

function sso_constant_time_equals($known, $user) {
    if (function_exists('hash_equals')) {
        return hash_equals($known, $user);
    }
    if (!is_string($known) || !is_string($user) || strlen($known) !== strlen($user)) {
        return false;
    }
    $difference = 0;
    for ($index = 0; $index < strlen($known); $index++) {
        $difference |= ord($known[$index]) ^ ord($user[$index]);
    }
    return $difference === 0;
}

function sso_random_bytes($length) {
    $strong = false;
    $bytes = openssl_random_pseudo_bytes($length, $strong);
    if ($bytes === false || $strong !== true) {
        return false;
    }
    return $bytes;
}

function sso_base64url_encode($value) {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function sso_consume_callback_state(&$session, $query) {
    $expectedState = isset($session['oauth_state']) ? $session['oauth_state'] : null;
    $verifier = isset($session['oauth_pkce_verifier']) ? $session['oauth_pkce_verifier'] : null;
    unset($session['oauth_state']);
    unset($session['oauth_pkce_verifier']);

    if (empty($query['code']) || empty($query['state']) || empty($expectedState) || empty($verifier)) {
        return false;
    }
    if (!sso_constant_time_equals($expectedState, $query['state'])) {
        return false;
    }
    return $verifier;
}

function sso_http_json($url, $postFields, $bearer) {
    $ch = curl_init($url);
    if ($ch === false) {
        return array();
    }
    $headers = array('Accept: application/json');
    $options = array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => $headers,
    );
    if ($postFields !== null) {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = http_build_query($postFields, '', '&');
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    }
    if ($bearer !== null) {
        $headers[] = 'Authorization: Bearer ' . $bearer;
    }
    $options[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $options);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $status < 200 || $status >= 300) {
        return array();
    }
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : array();
}
