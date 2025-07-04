<?php

$room = $_POST['room'] ?? '';
$user = $_POST['user'] ?? '';
$type = $_POST['type'] ?? '';
$target = $_POST['target'] ?? '';
$data = $_POST['data'] ?? '';

$dir = "rooms";
if (!is_dir($dir)) mkdir($dir);

$users_file = "$dir/$room-users.txt";
$signals_file = "$dir/$room-signals.txt";
$chat_file = "$dir/$room-chat.txt";

// -- Manage users: join, leave, list --
if ($type === 'join') {
    $users = file_exists($users_file) ? explode("\n", trim(file_get_contents($users_file))) : [];
    if (!in_array($user, $users)) {
        $users[] = $user;
        file_put_contents($users_file, implode("\n", $users));
    }
    echo json_encode($users);
    exit;
}
if ($type === 'get_users') {
    $users = file_exists($users_file) ? explode("\n", trim(file_get_contents($users_file))) : [];
    echo json_encode($users);
    exit;
}

// -- Send or get signaling messages --
if ($type === 'signal') {
    // Save: from|to|signaltype|data
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
    // Remove delivered signals
    file_put_contents($signals_file, implode("\n", $lines));
    echo json_encode($out);
    exit;
}

// -- Chat feature: append and read chat messages --
if ($type === 'chat_send') {
    $timestamp = time();
    // Save: timestamp|user|message
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