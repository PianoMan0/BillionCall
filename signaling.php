<?php

$room = $_POST['room'] ?? '';
$type = $_POST['type'] ?? '';
$data = $_POST['data'] ?? '';

$file = "room_$room.txt";

if ($type === 'offer' || $type === 'answer' || $type === 'candidate') {
    // Append signaling data
    file_put_contents($file, "$type|$data\n", FILE_APPEND);
    echo "OK";
} else if ($type === 'get') {
    // Return and clear all signaling data
    if (file_exists($file)) {
        echo file_get_contents($file);
        file_put_contents($file, '');
    } else {
        echo '';
    }
} else {
    echo 'Invalid';
}
?>