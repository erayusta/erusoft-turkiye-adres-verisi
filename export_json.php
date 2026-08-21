<?php

/**
 * DB'deki adres ağacını iç içe JSON olarak dışa aktarır.
 * Kullanım:
 *   php export_json.php                 # data/adres.json yazar
 *   php export_json.php cikti.json      # verilen yola yazar
 *
 * Ayarlar config.php'den (yoksa ADRES_* ortam değişkenlerinden) okunur.
 */

declare(strict_types=1);

$config = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$cfg = static fn (string $k, string $env, string $def): string
    => (string) ($config[$k] ?? (getenv($env) !== false ? getenv($env) : $def));

$host = $cfg('DB_HOST', 'ADRES_DB_HOST', '127.0.0.1');
$port = (int) $cfg('DB_PORT', 'ADRES_DB_PORT', '3306');
$name = $cfg('DB_NAME', 'ADRES_DB_NAME', 'adres');
$user = $cfg('DB_USER', 'ADRES_DB_USER', 'root');
$pass = $cfg('DB_PASSWORD', 'ADRES_DB_PASSWORD', '');

$out = $argv[1] ?? (__DIR__ . '/data/adres.json');
@mkdir(dirname($out), 0777, true);

$db = new PDO("mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4", $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

// Sığ tablolar (iç içe deep-write O(n²) belleği patlatıyor; bunun yerine
// her seviyeyi ayrı map'te tutup en sonda bottom-up birleştiriyoruz).
$prov = [];          // pid  => meta
$distByProv = [];    // pid  => [did => meta]
$nbhByDist = [];     // did  => [nid => meta]
$streetsByNbh = [];  // nid  => [street, ...]

$stmt = $db->query(
    'SELECT p.id p_id, p.external_id p_ext, p.name p_name,
            d.id d_id, d.external_id d_ext, d.name d_name,
            n.id n_id, n.external_id n_ext, n.name n_name,
            s.id s_id, s.external_id s_ext, s.name s_name, s.type s_type
     FROM provinces p
     JOIN districts d      ON d.province_id = p.id
     JOIN neighborhoods n  ON n.district_id = d.id
     JOIN streets s        ON s.neighborhood_id = n.id
     ORDER BY p.name, d.name, n.name, s.name'
);
while ($r = $stmt->fetch()) {
    $prov[$r['p_id']] ??= ['id' => (int) $r['p_id'], 'external_id' => $r['p_ext'], 'name' => $r['p_name']];
    $distByProv[$r['p_id']][$r['d_id']] ??= ['id' => (int) $r['d_id'], 'external_id' => $r['d_ext'], 'name' => $r['d_name']];
    $nbhByDist[$r['d_id']][$r['n_id']] ??= ['id' => (int) $r['n_id'], 'external_id' => $r['n_ext'], 'name' => $r['n_name']];
    $streetsByNbh[$r['n_id']][] = ['id' => (int) $r['s_id'], 'external_id' => $r['s_ext'], 'name' => $r['s_name'], 'type' => $r['s_type']];
}

$provinces = [];
foreach ($prov as $pid => $p) {
    $p['districts'] = [];
    foreach ($distByProv[$pid] ?? [] as $did => $d) {
        $d['neighborhoods'] = [];
        foreach ($nbhByDist[$did] ?? [] as $nid => $n) {
            $n['streets'] = array_values($streetsByNbh[$nid] ?? []);
            $d['neighborhoods'][] = $n;
        }
        $p['districts'][] = $d;
    }
    $provinces[] = $p;
}
unset($prov, $distByProv, $nbhByDist, $streetsByNbh);

$counts = [];
foreach (['provinces', 'districts', 'neighborhoods', 'streets'] as $t) {
    $counts[$t] = (int) $db->query("SELECT COUNT(*) FROM {$t}")->fetchColumn();
}

$payload = [
    'generated_at' => date('c'),
    'leaf'         => 'street',
    'note'         => 'Kamuya açık idari adres verisi (il/ilçe/mahalle/cadde-sokak). Kapı/bina no içermez.',
    'counts'       => $counts,
    'provinces'    => $provinces,
];

file_put_contents($out, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
printf("Yazıldı: %s\n%d il, %d ilçe, %d mahalle, %d sokak\n",
    $out, $counts['provinces'], $counts['districts'], $counts['neighborhoods'], $counts['streets']);
