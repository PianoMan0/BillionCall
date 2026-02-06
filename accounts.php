<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

$users_file = __DIR__ . '/users.json';

// Helper to load users
function load_users($users_file) {
    if (!file_exists($users_file)) return [];
    $data = file_get_contents($users_file);
    $users = json_decode($data, true);
    if (!is_array($users)) $users = [];
    return $users;
}

// Helper to save users
function save_users($users_file, $users) {
    file_put_contents($users_file, json_encode($users, JSON_PRETTY_PRINT));
}

// Sanitize username
function clean($str) {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $str);
}

$action = $_POST['action'] ?? '';
$username = clean($_POST['username'] ?? '');
$password = $_POST['password'] ?? '';

if ($action === 'signup') {
    if (!$username || !$password) {
        echo json_encode(['success'=>false, 'error'=>'Username and password required']);
        exit;
    }
    $users = load_users($users_file);
    if (isset($users[$username])) {
        echo json_encode(['success'=>false, 'error'=>'Username already exists']);
        exit;
    }
    $users[$username] = password_hash($password, PASSWORD_DEFAULT);
    save_users($users_file, $users);
    echo json_encode(['success'=>true]);
    exit;
}

if ($action === 'login') {
    if (!$username || !$password) {
        echo json_encode(['success'=>false, 'error'=>'Username and password required']);
        exit;
    }
    $users = load_users($users_file);
    if (!isset($users[$username])) {
        echo json_encode(['success'=>false, 'error'=>'Invalid username or password']);
        exit;
    }
    if (!password_verify($password, $users[$username])) {
        echo json_encode(['success'=>false, 'error'=>'Invalid username or password']);
        exit;
    }
    echo json_encode(['success'=>true]);
    exit;
}

echo json_encode(['success'=>false, 'error'=>'Invalid action']);