<?php
/**
 * OAuth2 SSO callback — handles the redirect back from authentik.
 *
 * Exchanges the authorization code for a token, reads the user's identity from
 * the userinfo endpoint, maps it to an eAkademik `s_user` by username, then
 * builds exactly the session that login.php builds on a successful password
 * login. The built-in login is left untouched.
 */
session_start();

require_once dirname(__FILE__) . '/conf/config.php';
require_once SIA_ROOT_PATH . '/conf/oauth.config.php';
require_once SIA_ROOT_PATH . '/classes/QueryWrapper.class.php';
require_once SIA_ROOT_PATH . '/classes/Datalink.class.php';
require_once SIA_ROOT_PATH . '/classes/UserSession.class.php';
require_once SIA_ROOT_PATH . '/classes/Page.class.php';
require_once SIA_ROOT_PATH . '/lib/template/template.php';
require_once SIA_ROOT_PATH . '/sql/sql_login.php';
require_once SIA_ROOT_PATH . '/includes/sql/mysql/sql_registrasi_setting_func.php';

function oauth_http_json($url, $postFields = null, $bearer = null) {
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20];
    if ($postFields !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = http_build_query($postFields);
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    }
    if ($bearer) {
        $headers[] = 'Authorization: Bearer ' . $bearer;
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    curl_close($ch);
    $decoded = json_decode((string) $body, true);
    return is_array($decoded) ? $decoded : [];
}

function oauth_fail($msg) {
    error_log('eAkademik OAuth2 callback error: ' . $msg);
    header('Location: index.php?err=sso');
    exit;
}

function oauth_constant_time_equals($known, $user) {
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

// --- CSRF state check ---
if (empty($_GET['code']) || empty($_GET['state'])
    || empty($_SESSION['oauth_state']) || empty($_SESSION['oauth_pkce_verifier'])
    || !oauth_constant_time_equals($_SESSION['oauth_state'], $_GET['state'])) {
    oauth_fail('state mismatch');
}
unset($_SESSION['oauth_state']);
$oauthPkceVerifier = $_SESSION['oauth_pkce_verifier'];
unset($_SESSION['oauth_pkce_verifier']);

// --- exchange code for an access token ---
$token = oauth_http_json(OAUTH_TOKEN_URL, [
    'grant_type' => 'authorization_code',
    'code' => $_GET['code'],
    'redirect_uri' => OAUTH_REDIRECT_URI,
    'client_id' => OAUTH_CLIENT_ID,
    'client_secret' => OAUTH_CLIENT_SECRET,
    'code_verifier' => $oauthPkceVerifier,
]);
if (empty($token['access_token'])) {
    oauth_fail('token endpoint error: ' . json_encode($token));
}

// --- identity from userinfo ---
$user = oauth_http_json(OAUTH_USERINFO_URL, null, $token['access_token']);
$ssoUsername = isset($user['preferred_username']) ? $user['preferred_username'] : null;
if (!$ssoUsername) {
    oauth_fail('no username in userinfo: ' . json_encode($user));
}

// --- map the SSO identity to an app user (by username) ---
$dl = new DataLink();
$conn = $dl->getDatalink();
$dummyTmpl = null;
$qw = new QueryWrapper($conn, $dummyTmpl, '');

$ssoUserSql = "SELECT susrNama AS NAMA_LOGIN, susrProfil AS NAMA_LENGKAP, " .
    "susrSgroupNama AS NAMA_GROUP, " .
    "GROUP_CONCAT(DISTINCT(prodiIsDalamSatuanAdministrasi) SEPARATOR ',') AS PRODI_AKSES " .
    "FROM s_user LEFT JOIN s_user_group_prodi ON susrSgroupNama = sgroupprodiSgroupNama " .
    "LEFT JOIN program_studi ON sgroupprodiProdiKode = prodiKode " .
    "WHERE susrNama = '%s' GROUP BY susrNama";
$rows = $qw->SQLExecute($ssoUserSql, array($ssoUsername), true);
if (empty($rows) || empty($rows[0]['NAMA_LOGIN'])) {
    oauth_fail('no app user for "' . $ssoUsername . '"');
}
$userInfo = $rows[0];

// --- build the session (mirrors login.php after a successful login) ---
$_SESSION['usrNama']        = $userInfo['NAMA_LOGIN'];
$_SESSION['usrNamaLengkap'] = $userInfo['NAMA_LENGKAP'];
$_SESSION['grpNama']        = $userInfo['NAMA_GROUP'];
$_SESSION['prodiAkses']     = $userInfo['PRODI_AKSES'];

if (isset($sql['akses_modul'])) {
    $akses = $qw->SQLExecute($sql['akses_modul'], array($userInfo['NAMA_GROUP']), true);
    if ($akses) {
        foreach ($akses as $d) {
            $_SESSION['menuut_' . $d['AKSES_MODUL']] = '1';
        }
    }
}

if (isset($sql['setting_sia'])) {
    $setting = $qw->SQLExecute($sql['setting_sia'], true);
    if ($setting) {
        $_SESSION['namaPTDikti']         = $setting[0]['PT_DIKTI'];
        $_SESSION['namaPT']              = $setting[0]['PT_NAMA'];
        $_SESSION['namaLogo']            = $setting[0]['PT_LOGO'];
        $_SESSION['namaAlamat']          = $setting[0]['PT_ALAMAT'];
        $_SESSION['namaAlamatSingkat']   = $setting[0]['PT_ALAMAT2'];
        $_SESSION['namaAlamatSingkat2']  = $setting[0]['PT_ALAMAT2'];
        $_SESSION['namaKota']            = $setting[0]['PT_KOTA'];
        $_SESSION['namaKodePos']         = $setting[0]['PT_KODE_POS'];
        $_SESSION['namaTelp']            = $setting[0]['PT_TELP'];
        $_SESSION['namaFax']             = $setting[0]['PT_FAX'];
        $_SESSION['namaEmail']           = $setting[0]['PT_EMAIL'];
        $_SESSION['namaWeb']             = $setting[0]['PT_WEB'];
    }
}

$_SESSION['isLoggedIn'] = '1';

if (isset($sql['semesteraktif_name'])) {
    $semesterParams = isset($param['semesteraktif_name']) ? $param['semesteraktif_name'] : array('');
    $s = $qw->SQLExecute($sql['semesteraktif_name'], $semesterParams, true);
    $_SESSION['semester_aktif'] = isset($s[0]['SEMESTER_AKTIF']) ? $s[0]['SEMESTER_AKTIF'] : '';
}

if (isset($sql['data_prodi'])) {
    $_SESSION['data_prodi'] = $qw->SQLExecute($sql['data_prodi'], true);
}

// Optional per-setting toggles; safe defaults if a query is absent.
$_SESSION['view_status_bayar'] = true;
if (isset($sql['setting_registrasi'])) {
    $s = $qw->SQLExecute($sql['setting_registrasi'], true);
    if (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 1) {
        $_SESSION['view_status_bayar'] = false;
    }
}

$_SESSION['prodi_konsentrasi_setting'] = false;
if (isset($sql['setting_prodi_konsentrasi'])) {
    $s = $qw->SQLExecute($sql['setting_prodi_konsentrasi'], true);
    if (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 1) {
        $_SESSION['prodi_konsentrasi_setting'] = true;
    }
}

$_SESSION['create_password_massal'] = 'byrand';
if (isset($sql['setting_create_password_massal'])) {
    $s = $qw->SQLExecute($sql['setting_create_password_massal'], true);
    $_SESSION['create_password_massal'] = (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 0)
        ? 'byrand' : 'bynim';
}

$_SESSION['periode_krs_per_prodi'] = false;
if (isset($sql['setting_periode_krs_per_prodi'])) {
    $s = $qw->SQLExecute($sql['setting_periode_krs_per_prodi'], true);
    if (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 1) {
        $_SESSION['periode_krs_per_prodi'] = true;
    }
}

$_SESSION['fitur_import_mata_kuliah'] = false;
if (isset($sql['setting_fitur_import_mata_kuliah'])) {
    $s = $qw->SQLExecute($sql['setting_fitur_import_mata_kuliah'], true);
    if (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 1) {
        $_SESSION['fitur_import_mata_kuliah'] = true;
    }
}

$_SESSION['fitur_foto_mahasiswa'] = false;
if (isset($sql['setting_fitur_foto_mahasiswa_pada_cetakan'])) {
    $s = $qw->SQLExecute($sql['setting_fitur_foto_mahasiswa_pada_cetakan'], true);
    if (isset($s[0]['SET_KODE']) && $s[0]['SET_KODE'] == 1) {
        $_SESSION['fitur_foto_mahasiswa'] = true;
    }
}

$_SESSION['kodeClientCetak'] = 'general';
if (isset($sql['setting_client_name_cetak'])) {
    $s = $qw->SQLExecute($sql['setting_client_name_cetak'], true);
    if (!empty($s[0]['VALUE'])) {
        $_SESSION['kodeClientCetak'] = $s[0]['VALUE'];
    }
}

$_SESSION['fitur_jadwal_harian'] = false;
if (isset($sql['setting_fitur_jadwal_harian'])) {
    $s = $qw->SQLExecute($sql['setting_fitur_jadwal_harian'], true);
    if (!empty($s[0]['VALUE'])) {
        $_SESSION['fitur_jadwal_harian'] = $s[0]['VALUE'];
    }
}

$_SESSION['skinAktif'] = 'versi_3.0';

// --- redirect exactly like the native login does ---
if ($userInfo['NAMA_GROUP'] == 'root') {
    header('Location: user_admin/');
} else {
    header('Location: ./');
}
exit;
