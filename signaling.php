<?php
$room = $_POST['room'] ?? '';
$user = $_POST['user'] ?? '';
$type = $_POST['type'] ?? '';
$target = $_POST['target'] ?? '';
$data = $_POST['data'] ?? '';
$admin_password = $_POST['admin_password'] ?? '';
$admin_token = $_POST['admin_token'] ?? '';
$action = $_POST['action'] ?? '';

$dir = "rooms";
if (!is_dir($dir)) mkdir($dir);

$users_file = "$dir/$room-users.json";
$signals_file = "$dir/$room-signals.txt";
$chat_file = "$dir/$room-chat.txt";
$admin_file = "$dir/$room-admin.json";

$ROOM_ADMIN_PASSWORD = "GoDodgers!";

// Get all users from JSON file
function get_users($users_file) {
    if (!file_exists($users_file)) return [];
    $users = json_decode(file_get_contents($users_file), true);
    if (!is_array($users)) $users = [];
    return $users;
}
function save_users($users_file, $users) {
    file_put_contents($users_file, json_encode($users));
}

// --- ADMIN LOGIN ---
if ($type === 'admin_login') {
    global $ROOM_ADMIN_PASSWORD, $admin_file, $admin_password;
    if ($admin_password === $ROOM_ADMIN_PASSWORD) {
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
    // Token expires in 2 hours (note to self, this is just for testing, make it more in the future)
    if ($token === $admin['token'] && time() - $admin['time'] < 7200) return true;
    return false;
}

// --- ADMIN ACTIONS: kick, mute, end_meeting ---
if ($type === 'admin_action') {
    if (!verify_admin($admin_file, $admin_token)) { http_response_code(401); exit; }
    if ($action === 'kick' && $target) {
        file_put_contents($signals_file, "ADMIN|$target|".json_encode(['type'=>'admin_kick','target'=>$target])."\n", FILE_APPEND);
    }
    if ($action === 'mute' && $target) {
        file_put_contents($signals_file, "ADMIN|$target|".json_encode(['type'=>'admin_mute','target'=>$target])."\n", FILE_APPEND);
    }
    if ($action === 'end_meeting') {
        file_put_contents($signals_file, "ADMIN|all|".json_encode(['type'=>'admin_end_meeting'])."\n", FILE_APPEND);
    }
    echo "OK";
    exit;
}

// -- Heartbeat --
if ($type === 'heartbeat') {
    $users = get_users($users_file);
    $users[$user] = time();
    save_users($users_file, $users);
    echo "OK";
    exit;
}

// -- Join --
if ($type === 'join') {
    $users = get_users($users_file);
    $users[$user] = time();
    save_users($users_file, $users);
    echo json_encode(array_keys($users));
    exit;
}

// -- Leave --
if ($type === 'leave') {
    $users = get_users($users_file);
    unset($users[$user]);
    save_users($users_file, $users);
    echo "OK";
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

// -- Signaling --
if ($type === 'signal') {
    file_put_contents($signals_file, "$user|$target|$data\n", FILE_APPEND);
    echo "OK";
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
    file_put_contents($signals_file, implode("\n", $lines));
    echo json_encode($out);
    exit;
}

// -- Chat --
if ($type === 'chat_send') {
    $timestamp = time();
    file_put_contents($chat_file, "$timestamp|$user|$data\n", FILE_APPEND);
    echo "OK";
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

echo 'Invalid';