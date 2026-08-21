<?php

/**
 * Adres verisini İL BAZINDA hazır dosyalara döker:
 *   data/csv/<il>.csv    — Excel'de çift tıkla açılır (UTF-8 BOM, ; ayraç)
 *   data/json/<il>.json  — iç içe (ilçe→mahalle→sokak) ağaç
 *   data/README.md       — il listesi + sayılar + linkler
 *
 * Yazılım bilmeyen kullanıcı: kendi ilinin .csv'sini indirip Excel'de açar.
 * Geliştirici: kendi ilinin .json'unu doğrudan uygulamasında kullanır.
 *
 * Kullanım:  php -d memory_limit=1G export_data.php
 */

declare(strict_types=1);

$config = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$cfg = static fn (string $k, string $env, string $def): string
    => (string) ($config[$k] ?? (getenv($env) !== false ? getenv($env) : $def));

$db = new PDO(
    'mysql:host=' . $cfg('DB_HOST', 'ADRES_DB_HOST', '127.0.0.1')
    . ';port=' . $cfg('DB_PORT', 'ADRES_DB_PORT', '3306')
    . ';dbname=' . $cfg('DB_NAME', 'ADRES_DB_NAME', 'adres') . ';charset=utf8mb4',
    $cfg('DB_USER', 'ADRES_DB_USER', 'root'),
    $cfg('DB_PASSWORD', 'ADRES_DB_PASSWORD', ''),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$base = __DIR__ . '/data';
@mkdir("{$base}/csv", 0777, true);
@mkdir("{$base}/json", 0777, true);

// Türkçe -> ascii slug (dosya adı için)
function slug(string $s): string
{
    $tr = ['İ' => 'i', 'I' => 'i', 'ı' => 'i', 'Ş' => 's', 'ş' => 's', 'Ğ' => 'g', 'ğ' => 'g',
           'Ü' => 'u', 'ü' => 'u', 'Ö' => 'o', 'ö' => 'o', 'Ç' => 'c', 'ç' => 'c'];
    $s = mb_strtolower(strtr($s, $tr), 'UTF-8');
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return trim((string) $s, '-');
}

// CSV alanı (; ayraç; gerekiyorsa tırnakla)
function csvCell(string $v): string
{
    return preg_match('/[;"\r\n]/', $v) ? '"' . str_replace('"', '""', $v) . '"' : $v;
}

$stmt = $db->query(
    'SELECT p.id p_id, p.external_id p_ext, p.name p_name,
            d.id d_id, d.external_id d_ext, d.name d_name,
            n.id n_id, n.external_id n_ext, n.name n_name,
            s.external_id s_ext, s.name s_name, s.type s_type
     FROM provinces p
     JOIN districts d      ON d.province_id = p.id
     JOIN neighborhoods n  ON n.district_id = d.id
     JOIN streets s        ON s.neighborhood_id = n.id
     ORDER BY p.name, d.name, n.name, s.name'
);

$index = [];               // il özet listesi
$cur = null;               // işlenen il adı
$csv = null; $json = null; // il tampon
$slug = '';

$flush = function () use (&$cur, &$csv, &$json, &$slug, &$index, $base) {
    if ($cur === null) {
        return;
    }
    // CSV: BOM + başlık + satırlar
    $lines = "\xEF\xBB\xBF" . "il;ilce;mahalle;cadde_sokak;tip;uavt_kodu\r\n" . implode('', $csv['rows']);
    file_put_contents("{$base}/csv/{$slug}.csv", $lines);

    // JSON: iç içe tek il
    $province = [
        'id' => $json['id'], 'external_id' => $json['ext'], 'name' => $cur,
        'districts' => array_values(array_map(static function (array $d): array {
            $d['neighborhoods'] = array_values($d['neighborhoods']);
            return $d;
        }, $json['districts'])),
    ];
    file_put_contents(
        "{$base}/json/{$slug}.json",
        json_encode($province, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );

    $index[] = ['il' => $cur, 'slug' => $slug, 'ilce' => $csv['ilce'], 'mahalle' => $csv['mahalle'], 'sokak' => $csv['sokak']];
};

while ($r = $stmt->fetch()) {
    if ($r['p_name'] !== $cur) {
        $flush();
        $cur = $r['p_name'];
        $slug = slug($cur);
        $csv = ['rows' => [], 'ilce' => [], 'mahalle' => [], 'sokak' => 0];
        $json = ['id' => (int) $r['p_id'], 'ext' => $r['p_ext'], 'districts' => []];
    }

    // CSV satırı
    $csv['rows'][] = implode(';', array_map('csvCell', [
        $r['p_name'], $r['d_name'], $r['n_name'], $r['s_name'], (string) $r['s_type'], (string) $r['s_ext'],
    ])) . "\r\n";
    $csv['ilce'][$r['d_id']] = true;
    $csv['mahalle'][$r['n_id']] = true;
    $csv['sokak']++;

    // JSON ağacı
    $json['districts'][$r['d_id']] ??= ['id' => (int) $r['d_id'], 'external_id' => $r['d_ext'], 'name' => $r['d_name'], 'neighborhoods' => []];
    $json['districts'][$r['d_id']]['neighborhoods'][$r['n_id']] ??= ['id' => (int) $r['n_id'], 'external_id' => $r['n_ext'], 'name' => $r['n_name'], 'streets' => []];
    $json['districts'][$r['d_id']]['neighborhoods'][$r['n_id']]['streets'][] =
        ['external_id' => $r['s_ext'], 'name' => $r['s_name'], 'type' => $r['s_type']];
}
$flush();

// Özet: sayılar düzelt (ilce/mahalle benzersiz sayıları)
foreach ($index as &$i) {
    $i['ilce'] = is_array($i['ilce']) ? count($i['ilce']) : $i['ilce'];
    $i['mahalle'] = is_array($i['mahalle']) ? count($i['mahalle']) : $i['mahalle'];
}
unset($i);

// data/README.md — il indeksi
$toplam = ['il' => count($index), 'ilce' => 0, 'mahalle' => 0, 'sokak' => 0];
$rows = '';
foreach ($index as $i) {
    $toplam['ilce'] += $i['ilce'];
    $toplam['mahalle'] += $i['mahalle'];
    $toplam['sokak'] += $i['sokak'];
    $rows .= sprintf(
        "| %s | %s | %s | %s | [CSV](csv/%s.csv) · [JSON](json/%s.json) |\n",
        $i['il'], number_format($i['ilce'], 0, ',', '.'), number_format($i['mahalle'], 0, ',', '.'),
        number_format($i['sokak'], 0, ',', '.'), $i['slug'], $i['slug']
    );
}
$md = "# Türkiye Adres Verisi (il / ilçe / mahalle / cadde-sokak)\n\n"
    . "Kamuya açık idari adres verisi. Kapı/bina no **yoktur**. Kaynak: e-Devlet adres formu (NVİ).\n\n"
    . "- **Excel için:** kendi ilinin `.csv` dosyasını indir, çift tıkla aç (UTF-8, `;` ayraç).\n"
    . "- **Geliştirici için:** `.json` dosyaları iç içe (ilçe→mahalle→sokak) ağaçtır.\n\n"
    . sprintf(
        "**Toplam:** %s il · %s ilçe · %s mahalle · %s cadde/sokak\n\n",
        number_format($toplam['il'], 0, ',', '.'), number_format($toplam['ilce'], 0, ',', '.'),
        number_format($toplam['mahalle'], 0, ',', '.'), number_format($toplam['sokak'], 0, ',', '.')
    )
    . "| İl | İlçe | Mahalle | Cadde/Sokak | İndir |\n|---|---:|---:|---:|---|\n" . $rows;
file_put_contents("{$base}/README.md", $md);

printf("Bitti: %d il yazıldı → data/csv, data/json, data/README.md\n", count($index));
