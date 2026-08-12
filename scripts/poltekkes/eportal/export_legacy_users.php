<?php
/**
 * CLI-only, read-only exporter for SIA portal credentials.
 *
 * Deploy this file below the ePortal document root only long enough to run it
 * from the CLI. Its output is intentionally the importer CSV and must be
 * redirected to a protected file outside the document root.
 */

function export_legacy_user_row($row) {
    $username = isset($row['tusrNama']) ? trim($row['tusrNama']) : '';
    $passwordHash = isset($row['tusrPassword']) ? strtolower(trim($row['tusrPassword'])) : '';
    if ($username === '' || !preg_match('/^[a-f0-9]{32}$/', $passwordHash)) {
        return false;
    }

    return array(
        'source' => 'ePortal',
        'username' => $username,
        'name' => isset($row['tusrProfil']) ? trim($row['tusrProfil']) : '',
        'email' => isset($row['tusrEmail']) ? trim($row['tusrEmail']) : '',
        'password_hash' => $passwordHash,
    );
}

function export_legacy_users_main($argv) {
    if (php_sapi_name() !== 'cli') {
        fwrite(STDERR, "CLI only\n");
        return 2;
    }
    if (!function_exists('mysql_connect')) {
        fwrite(STDERR, "Legacy MySQL extension is unavailable\n");
        return 2;
    }

    $mode = isset($argv[1]) ? $argv[1] : '';
    $username = isset($argv[2]) ? trim($argv[2]) : '';
    if ($mode !== '--all' && !($mode === '--username' && $username !== '')) {
        fwrite(STDERR, "Usage: export_legacy_users.php --all | --username <username>\n");
        return 2;
    }

    require dirname(__FILE__) . '/../config/base.conf.php';
    $connection = mysql_connect($cfg['db_host'], $cfg['db_user'], $cfg['db_pass']);
    if (!$connection || !mysql_select_db($cfg['db_name'], $connection)) {
        fwrite(STDERR, "Unable to connect to portal database\n");
        return 2;
    }

    $query = 'SELECT tusrNama, tusrProfil, tusrEmail, tusrPassword FROM t_user';
    if ($mode === '--username') {
        $query .= " WHERE tusrNama = '" . mysql_real_escape_string($username, $connection) . "'";
    }
    $result = mysql_query($query, $connection);
    if (!$result) {
        fwrite(STDERR, "Unable to read portal users\n");
        return 2;
    }

    fputcsv(STDOUT, array('source', 'username', 'name', 'email', 'password_hash'));
    $invalid = 0;
    while ($row = mysql_fetch_assoc($result)) {
        $exported = export_legacy_user_row($row);
        if ($exported === false) {
            $invalid++;
            continue;
        }
        fputcsv(STDOUT, $exported);
    }
    mysql_free_result($result);
    if ($invalid > 0) {
        fwrite(STDERR, "Invalid legacy credential rows: " . $invalid . "\n");
        return 1;
    }
    return 0;
}

if (!defined('POLTEKKES_EXPORT_LIBRARY')) {
    exit(export_legacy_users_main($argv));
}
