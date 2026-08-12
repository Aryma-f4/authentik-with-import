<?php

define('POLTEKKES_EXPORT_LIBRARY', true);
require_once dirname(__FILE__) . '/export_legacy_users.php';

function export_test_assert($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, $message . "\n");
        exit(1);
    }
}

$row = array(
    'tusrNama' => 'portal-user',
    'tusrProfil' => 'Portal User',
    'tusrEmail' => 'portal@example.invalid',
    'tusrPassword' => '5f4dcc3b5aa765d61d8327deb882cf99',
);
$exported = export_legacy_user_row($row);

export_test_assert($exported['source'] === 'ePortal', 'source must be ePortal');
export_test_assert($exported['username'] === 'portal-user', 'username must be preserved');
export_test_assert($exported['name'] === 'Portal User', 'name must be preserved');
export_test_assert($exported['email'] === 'portal@example.invalid', 'email must be preserved');
export_test_assert(
    $exported['password_hash'] === '5f4dcc3b5aa765d61d8327deb882cf99',
    'valid MD5 digest must be preserved'
);
export_test_assert(
    export_legacy_user_row(array('tusrNama' => 'bad', 'tusrPassword' => 'invalid')) === false,
    'invalid MD5 digest must be rejected'
);

echo "export helper tests passed\n";
