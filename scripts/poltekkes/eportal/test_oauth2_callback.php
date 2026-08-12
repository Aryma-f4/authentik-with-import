<?php

$callback = file_get_contents(dirname(__FILE__) . '/oauth2_callback.php');

if ($callback === false) {
    fwrite(STDERR, "unable to read callback\n");
    exit(1);
}
if (strpos($callback, 'AuthenticateSso($ssoUsername)') === false) {
    fwrite(STDERR, "callback does not use the read-only SSO session path\n");
    exit(1);
}
if (strpos($callback, 'LoginCheck(') !== false) {
    fwrite(STDERR, "callback must not invoke password login\n");
    exit(1);
}
if (strpos($callback, 'code_verifier') === false) {
    fwrite(STDERR, "callback is missing PKCE verification\n");
    exit(1);
}
if (strpos($callback, 'if (!$cfg->Load(') !== false) {
    fwrite(STDERR, "callback treats the legacy configuration loader as boolean\n");
    exit(1);
}
if (strpos($callback, 'empty($cfg->GetValue(') !== false) {
    fwrite(STDERR, "callback uses a PHP 5.5-only empty() expression\n");
    exit(1);
}

fwrite(STDOUT, "oauth2 callback checks passed\n");
