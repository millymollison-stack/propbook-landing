<?php
header('Content-Type: application/json');

// Support both form-urlencoded POST and JSON body
$secret = '';
$slug = '';
$files = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';

    if (strpos($contentType, 'application/json') !== false) {
        // JSON body — read raw input
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        $secret = $data['secret'] ?? '';
        $slug = $data['slug'] ?? '';
        $files = $data['files'] ?? [];
    } else {
        // Form POST
        $secret = $_POST['secret'] ?? '';
        $slug = $_POST['slug'] ?? '';
        $files = $_POST['files'] ?? [];
    }
}

if ($secret !== 'propbook-deploy-2026') {
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$baseDir = '/home/u805830916/domains/propbook.pro/public_html/props/' . $slug;
if (!is_dir($baseDir)) mkdir($baseDir, 0755, true);

$written = 0;
foreach ($files as $name => $b64) {
    $path = $baseDir . '/' . $name;
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    if (file_put_contents($path, base64_decode($b64)) !== false) $written++;
}

echo json_encode(['success' => true, 'written' => $written, 'target' => 'props', 'slug' => $slug, 'siteUrl' => "https://www.propbook.pro/props/{$slug}/"]);
?>
