<?php
/**
 * Guards the legacy Portal extension: the SSO entrypoint may build a PHP
 * session, but it must never execute the legacy-login database writes.
 */

$sourceFile = dirname(__FILE__) . '/gatekeeper.class.php';
$source = file_get_contents($sourceFile);

function fail_sso_readonly_test($message) {
    fwrite(STDERR, $message . "\n");
    exit(1);
}

if ($source === false) {
    fail_sso_readonly_test('unable to read staged GateKeeper source');
}

if (strpos($source, 'function AuthenticateSso($username)') === false) {
    fail_sso_readonly_test('AuthenticateSso is missing');
}

if (strpos($source, 'return $this->AuthenticateUser($username, null, true);') === false) {
    fail_sso_readonly_test('AuthenticateSso must enter only the trusted SSO path');
}

if (strpos($source, 'return $this->AuthenticateUser($username, $password, false);') === false) {
    fail_sso_readonly_test('native password login must retain its original path');
}

if (strpos($source, 'if (!$trustedSso) {') === false) {
    fail_sso_readonly_test('legacy database writes are not guarded from SSO');
}

if (strpos($source, "\$_SESSION['role_base_portal'] = \$userRole->FetchRole();\n               \$this->SetProperty(\"GateKeeperErrorMessage\", \"\");\n               \$this->Disconnect();\n               return true;") === false) {
    fail_sso_readonly_test('trusted SSO session setup must report success to the callback');
}

fwrite(STDOUT, "sso readonly gatekeeper checks passed\n");
