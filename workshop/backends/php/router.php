<?php
// MetalMart inventory-service — workshop PHP variant (canned data, built-in server).
//
// You STEAL the in-cluster inventory-service (Node) and run THIS PHP copy on your laptop.
// Edit the marked line and refresh your browser.
//
// Run:  mirrord exec -f ../mirrord-core.json -- php -S 0.0.0.0:8080 router.php

header('X-Served-By: ' . gethostname()); // flips the UI banner to your laptop

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/health') {
    echo 'ok';
    return true;
}

if (strpos($path, '/products') === 0) {
    header('Content-Type: application/json');
    $products = [
        ['id' => 1, 'name' => 'MetalBear Hoodie',      'description' => 'Cozy heavyweight hoodie with the MetalBear mascot.',       'price_cents' => 5900, 'stock' => 42,  'is_new' => true],
        ['id' => 2, 'name' => 'Steal the Show Tee',     'description' => 'Soft cotton tee. Run your laptop as if it were a pod.',    'price_cents' => 2900, 'stock' => 80,  'is_new' => true],
        ['id' => 3, 'name' => 'mirrord Mug',            'description' => 'Ceramic mug for your morning cluster session.',           'price_cents' => 1500, 'stock' => 120, 'is_new' => false],
        ['id' => 4, 'name' => 'Cluster Cap',            'description' => 'Embroidered cap. Outgoing traffic, incoming compliments.', 'price_cents' => 2400, 'stock' => 65,  'is_new' => false],
        ['id' => 5, 'name' => 'Bear Claw Sticker Pack', 'description' => 'Six die-cut vinyl stickers.',                            'price_cents' => 800,  'stock' => 300, 'is_new' => false],
        ['id' => 6, 'name' => 'Plush mirrord Bear',     'description' => 'Huggable plush. Mirrors your affection bidirectionally.',  'price_cents' => 3200, 'stock' => 33,  'is_new' => false],
        ['id' => 7, 'name' => 'Enamel Pin Set',         'description' => 'Three hard-enamel pins.',                                'price_cents' => 1800, 'stock' => 90,  'is_new' => false],
        ['id' => 8, 'name' => 'DevOps Beanie',          'description' => 'Keep your head warm while the operator does the work.',    'price_cents' => 2200, 'stock' => 54,  'is_new' => false],
    ];
    // 👇 EDIT ME — set $prefix to "🔥 " (or "SALE! "), save, and refresh your browser.
    $prefix = "";
    $out = array_map(function ($p) use ($prefix) {
        $p['name'] = $prefix . $p['name'];
        return $p;
    }, $products);
    echo json_encode($out);
    return true;
}

http_response_code(404);
return true;
