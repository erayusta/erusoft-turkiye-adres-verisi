<?php

// Bu dosyayı config.php olarak KOPYALA ve kendi bilgilerinle doldur.
//   cp config.example.php config.php
// config.php git'e girmez (.gitignore). Alternatif olarak ADRES_* ortam
// değişkenleriyle de ayarlayabilirsin (bkz. index.php).

declare(strict_types=1);

return [
    // Extension'daki API_KEY ile birebir aynı olmalı (nvi-adres-eklentisi/content.js).
    'API_KEY'     => 'buraya-guclu-bir-anahtar-yaz',
    'DB_HOST'     => '127.0.0.1',
    'DB_PORT'     => '3306',
    'DB_NAME'     => 'adres',
    'DB_USER'     => 'root',
    'DB_PASSWORD' => '',
];
