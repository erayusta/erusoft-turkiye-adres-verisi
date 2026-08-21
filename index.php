<?php

declare(strict_types=1);

// Ayarlar config.php'den okunur (git'e girmez). Yoksa ortam değişkenlerine,
// o da yoksa yerel geliştirme varsayılanlarına düşer. config.example.php'yi
// kopyalayıp config.php yaparak kendi bilgilerini gir.
$config = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$cfg = static fn (string $k, string $env, string $def): string
    => (string) ($config[$k] ?? (getenv($env) !== false ? getenv($env) : $def));

define('API_KEY', $cfg('API_KEY', 'ADRES_API_KEY', 'local-adres-key'));
define('DB_HOST', $cfg('DB_HOST', 'ADRES_DB_HOST', '127.0.0.1'));
define('DB_PORT', (int) $cfg('DB_PORT', 'ADRES_DB_PORT', '3306'));
define('DB_NAME', $cfg('DB_NAME', 'ADRES_DB_NAME', 'adres'));
define('DB_USER', $cfg('DB_USER', 'ADRES_DB_USER', 'root'));
define('DB_PASSWORD', $cfg('DB_PASSWORD', 'ADRES_DB_PASSWORD', ''));

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!hash_equals(API_KEY, (string) ($_SERVER['HTTP_X_API_KEY'] ?? ''))) {
    respond(['error' => 'Yetkisiz istek.'], 401);
}

$db = new PDO('mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASSWORD, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
createSchema($db);

$path = rtrim((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'];
$action = (string) ($_GET['action'] ?? '');

try {
    if ($method === 'GET' && ($path === '/api/progress' || $action === 'progress')) {
        progress($db);
    } elseif ($method === 'POST' && ($path === '/api/import' || $action === 'import')) {
        importRows($db);
    } elseif ($method === 'GET' && ($path === '/api/export' || $action === 'export')) {
        exportRows($db);
    } elseif ($method === 'GET' && ($path === '/api/health' || $action === 'health')) {
        respond(['ok' => true]);
    } else {
        respond(['error' => 'Endpoint bulunamadı.'], 404);
    }
} catch (Throwable $e) {
    respond(['error' => $e->getMessage()], 400);
}

function createSchema(PDO $db): void
{
    $db->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS provinces (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            external_id VARCHAR(191) UNIQUE,
            name VARCHAR(191) NOT NULL UNIQUE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
        CREATE TABLE IF NOT EXISTS districts (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            external_id VARCHAR(191),
            province_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(191) NOT NULL,
            UNIQUE(province_id, name),
            UNIQUE(province_id, external_id),
            FOREIGN KEY (province_id) REFERENCES provinces(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
        CREATE TABLE IF NOT EXISTS neighborhoods (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            external_id VARCHAR(191),
            district_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(191) NOT NULL,
            UNIQUE(district_id, name),
            UNIQUE(district_id, external_id),
            FOREIGN KEY (district_id) REFERENCES districts(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
        CREATE TABLE IF NOT EXISTS streets (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            external_id VARCHAR(191),
            neighborhood_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(191) NOT NULL,
            type VARCHAR(50),
            UNIQUE(neighborhood_id, name),
            UNIQUE(neighborhood_id, external_id),
            FOREIGN KEY (neighborhood_id) REFERENCES neighborhoods(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
        CREATE TABLE IF NOT EXISTS progress (
            source VARCHAR(191) PRIMARY KEY,
            cursor_value TEXT,
            context_json JSON,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci;
    SQL);
}

function importRows(PDO $db): void
{
    $body = json_decode((string) file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    $rows = $body['rows'] ?? null;
    $source = trim((string) ($body['source'] ?? 'default'));

    if (!is_array($rows) || $source === '') {
        throw new InvalidArgumentException('source ve rows zorunludur.');
    }
    if (($_GET['dry_run'] ?? '') === '1') {
        respond(['ok' => true, 'dry_run' => true, 'received' => count($rows)]);
    }

    $db->beginTransaction();
    try {
        foreach ($rows as $row) {
            // Leaf artık sokak/cadde. Kapı (bina) seviyesi toplanmıyor.
            foreach (['province', 'district', 'neighborhood', 'street'] as $field) {
                if (!isset($row[$field]) || trim((string) $row[$field]) === '') {
                    throw new InvalidArgumentException("Eksik alan: {$field}");
                }
            }

            $provinceId = upsertNamed($db, 'provinces', null, null, $row['province'], $row['province_external_id'] ?? null);
            $districtId = upsertNamed($db, 'districts', 'province_id', $provinceId, $row['district'], $row['district_external_id'] ?? null);
            $neighborhoodId = upsertNamed($db, 'neighborhoods', 'district_id', $districtId, $row['neighborhood'], $row['neighborhood_external_id'] ?? null);
            upsertNamed($db, 'streets', 'neighborhood_id', $neighborhoodId, $row['street'], $row['street_external_id'] ?? null, $row['street_type'] ?? null);
        }

        $cursor = isset($body['cursor']) ? (string) $body['cursor'] : null;
        $context = isset($body['context']) ? json_encode($body['context'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) : null;
        $statement = $db->prepare('INSERT INTO progress (source, cursor_value, context_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE cursor_value = VALUES(cursor_value), context_json = VALUES(context_json), updated_at = CURRENT_TIMESTAMP');
        $statement->execute([$source, $cursor, $context]);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    respond(['ok' => true, 'received' => count($rows), 'progress' => getProgress($db, $source)]);
}

function upsertNamed(PDO $db, string $table, ?string $parentColumn, ?int $parentId, mixed $name, mixed $externalId, mixed $type = null): int
{
    $name = normalizeSpace($name);
    $externalId = nullable($externalId);
    $columns = $parentColumn ? "external_id, {$parentColumn}, name" : 'external_id, name';
    $values = $parentColumn ? [$externalId, $parentId, $name] : [$externalId, $name];
    $placeholders = implode(', ', array_fill(0, count($values), '?'));

    if ($table === 'streets') {
        $columns .= ', type';
        $placeholders .= ', ?';
        $values[] = nullable($type);
    }

    $statement = $db->prepare("INSERT INTO {$table} ({$columns}) VALUES ({$placeholders}) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), external_id = COALESCE(VALUES(external_id), external_id)");
    $statement->execute($values);
    return (int) $db->lastInsertId();
}

function progress(PDO $db): void
{
    $source = trim((string) ($_GET['source'] ?? 'default'));
    respond(['progress' => getProgress($db, $source), 'counts' => counts($db)]);
}

function getProgress(PDO $db, string $source): ?array
{
    $statement = $db->prepare('SELECT source, cursor_value AS `cursor`, context_json, updated_at FROM progress WHERE source = ?');
    $statement->execute([$source]);
    $row = $statement->fetch();
    if (!$row) {
        return null;
    }
    $row['context'] = $row['context_json'] ? json_decode($row['context_json'], true) : null;
    unset($row['context_json']);
    return $row;
}

function counts(PDO $db): array
{
    $result = [];
    foreach (['provinces', 'districts', 'neighborhoods', 'streets'] as $table) {
        $result[$table] = (int) $db->query("SELECT COUNT(*) FROM {$table}")->fetchColumn();
    }
    return $result;
}

function exportRows(PDO $db): void
{
    $sql = 'SELECT p.name province, d.name district, n.name neighborhood, s.name street, s.type street_type
            FROM streets s
            JOIN neighborhoods n ON n.id = s.neighborhood_id
            JOIN districts d ON d.id = n.district_id
            JOIN provinces p ON p.id = d.province_id
            ORDER BY p.name, d.name, n.name, s.name';
    respond(['rows' => $db->query($sql)->fetchAll(), 'counts' => counts($db)]);
}

function nullable(mixed $value): ?string
{
    $value = normalizeSpace($value);
    return $value === '' ? null : $value;
}

// İç boşluk dizilerini teke indirir, baş/son boşluğu kırpar. Mükerrer koruması için
// aynı adresin farklı boşlukla iki kez girmesini engeller.
function normalizeSpace(mixed $value): string
{
    return trim((string) preg_replace('/\s+/u', ' ', (string) ($value ?? '')));
}

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
