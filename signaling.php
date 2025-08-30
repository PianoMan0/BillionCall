<?php
// --- Security Headers ---
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// --- Helper: Sanitize input ---
function clean($str) {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $str);
}
$room = clean($_POST['room'] ?? '');
$user = clean($_POST['user'] ?? '');
$type = clean($_POST['type'] ?? '');
$target = clean($_POST['target'] ?? '');
$data = $_POST['data'] ?? '';
$admin_password = $_POST['admin_password'] ?? '';
$admin_token = $_POST['admin_token'] ?? '';
$action = clean($_POST['action'] ?? '');

// --- Validate room/user ---
if (!$room || !$user && !in_array($type, ['admin_login','get_users','get_signals','chat_get'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing or invalid room/user']);
    exit;
}

// --- Prevent directory traversal ---
if (strpos($room, '..') !== false || strpos($user, '..') !== false) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid room/user']);
    exit;
}

$dir = "rooms";
if (!is_dir($dir)) mkdir($dir, 0700, true);

$users_file = "$dir/$room-users.json";
$signals_file = "$dir/$room-signals.txt";
$chat_file = "$dir/$room-chat.txt";
$admin_file = "$dir/$room-admin.json";

$ROOM_ADMIN_PASSWORD = getenv('ROOM_ADMIN_PASSWORD') ?: "GoDodgers!";

// --- File helpers with locking ---
function get_users($users_file) {
    if (!file_exists($users_file)) return [];
    $fp = fopen($users_file, 'r');
    if (flock($fp, LOCK_SH)) {
        $users = json_decode(fread($fp, filesize($users_file)), true);
        flock($fp, LOCK_UN);
    } else {
        $users = [];
    }
    fclose($fp);
    if (!is_array($users)) $users = [];
    return $users;
}
function save_users($users_file, $users) {
    $fp = fopen($users_file, 'w');
    if (flock($fp, LOCK_EX)) {
        fwrite($fp, json_encode($users));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

// --- ADMIN LOGIN ---
if ($type === 'admin_login') {
    if (hash_equals($ROOM_ADMIN_PASSWORD, $admin_password)) {
        $token = bin2hex(random_bytes(16));
        file_put_contents($admin_file, json_encode(['token' => $token, 'time' => time()]));
        echo json_encode(['success' => true, 'token' => $token]);
    } else {
        echo json_encode(['success' => false]);
    }
    exit;
}
function verify_admin($admin_file, $token) {
    if (!file_exists($admin_file)) return false;
    $admin = json_decode(file_get_contents($admin_file), true);
    if (!$admin || !isset($admin['token'])) return false;
    if (hash_equals($admin['token'], $token) && time() - $admin['time'] < 7200) return true;
    return false;
}

// --- ADMIN ACTIONS: kick, mute, end_meeting ---
if ($type === 'admin_action') {
    if (!verify_admin($admin_file, $admin_token)) { http_response_code(401); exit; }
    if ($action === 'kick' && $target) {
        file_put_contents($signals_file, "ADMIN|$target|".json_encode(['type'=>'admin_kick','target'=>$target])."\n", FILE_APPEND | LOCK_EX);
    }
    if ($action === 'mute' && $target) {
        file_put_contents($signals_file, "ADMIN|$target|".json_encode(['type'=>'admin_mute','target'=>$target])."\n", FILE_APPEND | LOCK_EX);
    }
    if ($action === 'end_meeting') {
        file_put_contents($signals_file, "ADMIN|all|".json_encode(['type'=>'admin_end_meeting'])."\n", FILE_APPEND | LOCK_EX);
    }
    echo json_encode(['success'=>true]);
    exit;
}

// -- Heartbeat --
if ($type === 'heartbeat') {
    $users = get_users($users_file);
    $users[$user] = time();
    save_users($users_file, $users);
    echo json_encode(['success'=>true]);
    exit;
}

// -- Join (prevent duplicate) --
if ($type === 'join') {
    $users = get_users($users_file);
    // Remove duplicates and old users
    $now = time();
    $timeout = 120;
    foreach ($users as $u => $t) {
        if ($now - $t > $timeout) unset($users[$u]);
    }
    if (isset($users[$user])) {
        echo json_encode(['error'=>'duplicate']);
        exit;
    }
    $users[$user] = $now;
    save_users($users_file, $users);
    echo json_encode(array_keys($users));
    exit;
}

// -- Leave --
if ($type === 'leave') {
    $users = get_users($users_file);
    unset($users[$user]);
    save_users($users_file, $users);
    echo json_encode(['success'=>true]);
    exit;
}

// -- Get users: active in last 120s --
if ($type === 'get_users') {
    $users = get_users($users_file);
    $now = time();
    $timeout = 120;
    $active = [];
    foreach ($users as $u => $t) {
        if ($now - $t <= $timeout) {
            $active[$u] = $t;
        }
    }
    save_users($users_file, $active);
    echo json_encode(array_keys($active));
    exit;
}

// -- Signaling (audio/video) --
if ($type === 'signal') {
    // Optionally, validate $data as JSON for audio/video signaling
    if (empty($data)) {
        echo json_encode(['error'=>'No data']);
        exit;
    }
    file_put_contents($signals_file, "$user|$target|$data\n", FILE_APPEND | LOCK_EX);
    echo json_encode(['success'=>true]);
    exit;
}
if ($type === 'get_signals') {
    $lines = file_exists($signals_file) ? explode("\n", trim(file_get_contents($signals_file))) : [];
    $out = [];
    foreach ($lines as $i => $line) {
        if (!$line) continue;
        list($from, $to, $rest) = explode("|", $line, 3);
        if ($to === $user || $to === "all") {
            $out[] = [$from, $rest];
            unset($lines[$i]);
        }
    }
    file_put_contents($signals_file, implode("\n", $lines), LOCK_EX);
    echo json_encode($out);
    exit;
}

// -- Chat --
if ($type === 'chat_send') {
    $timestamp = time();
    file_put_contents($chat_file, "$timestamp|$user|".str_replace("\n"," ",$data)."\n", FILE_APPEND | LOCK_EX);
    echo json_encode(['success'=>true]);
    exit;
}
if ($type === 'chat_get') {
    $since = intval($_POST['since'] ?? 0);
    $lines = file_exists($chat_file) ? explode("\n", trim(file_get_contents($chat_file))) : [];
    $out = [];
    foreach ($lines as $line) {
        if (!$line) continue;
        list($ts, $usr, $msg) = explode("|", $line, 3);
        if ($ts > $since) {
            $out[] = ["timestamp" => $ts, "user" => $usr, "message" => $msg];
        }
    }
    echo json_encode($out);
    exit;
}
if ($type === 'call_offer') {
    echo json_encode(['success'=>true, 'data'=>$data]);
    exit;
}

echo json_encode(['error'=>'Invalid']);