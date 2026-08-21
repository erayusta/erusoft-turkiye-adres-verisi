<div align="center">

# 🇹🇷 Türkiye Adres Verisi

### İl · İlçe · Mahalle · Cadde-Sokak — hazır dosyalar + toplayıcı araç

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-brightgreen.svg)](LICENSE)
[![Sürüm](https://img.shields.io/github/v/release/erayusta/erusoft-turkiye-adres-verisi?label=s%C3%BCr%C3%BCm&color=blue)](https://github.com/erayusta/erusoft-turkiye-adres-verisi/releases/latest)
[![İndirme](https://img.shields.io/github/downloads/erayusta/erusoft-turkiye-adres-verisi/total?label=indirme&color=orange)](https://github.com/erayusta/erusoft-turkiye-adres-verisi/releases)
[![Veri](https://img.shields.io/badge/kapsam-81_il_·_1.27M_sokak-informational)](data/)
[![PHP](https://img.shields.io/badge/PHP-8%2B-777bb4.svg)](https://www.php.net/)
[![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479a1.svg)](https://www.mysql.com/)

**[⬇️ Hazır veriyi indir](#hazır-veri-indir-ve-kullan--kod-bilmeye-gerek-yok)** ·
**[📦 Sürümler](https://github.com/erayusta/erusoft-turkiye-adres-verisi/releases/latest)** ·
**[🚀 Kurulum](#kurulum)**

</div>

---

Türkiye'nin **il → ilçe → mahalle → cadde/sokak** idari adres ağacını e-Devlet'in
kendi adres formundan toplayan bir Chrome eklentisi + yerel PHP/MySQL API'si.
Amaç: e-ticaret / form uygulamalarında **adres seçici (dropdown)** doldurmak için
kamuya açık idari adres verisini yerel bir veritabanında tutmak.

> **Kapı/bina numarası toplanmaz.** Adres seçicide bina/kapı/daire kullanıcı
> tarafından serbest metin olarak girilir; kapı seviyesi hem gereksiz büyük
> (~20 kat istek/satır) hem de en oynak katmandır. Leaf bilinçli olarak **sokak/cadde**.

---

## Hazır veri (indir ve kullan) — kod bilmeye gerek yok

Veriyi kendin toplamana gerek yok; hazır dosyalar [`data/`](data/) klasöründe:

- 📊 **Excel için:** [`data/csv/`](data/csv/) — kendi ilinin `.csv` dosyasını indir,
  çift tıkla aç (UTF-8, `;` ayraç). Örn. `data/csv/istanbul.csv`.
- 🧑‍💻 **Geliştirici için:** [`data/json/`](data/json/) — il bazlı iç içe
  (ilçe→mahalle→sokak) JSON. Web/mobil adres seçicide doğrudan kullan.
- 🗄️ **Veritabanı için:** [turkiye-adres-sql.zip ⬇️](https://github.com/erayusta/erusoft-turkiye-adres-verisi/releases/latest/download/turkiye-adres-sql.zip)
  — tüm tabloların MySQL dökümü (aç → `mysql` ile içeri al).
- 📦 **Tek parça tümü:** [turkiye-adres-json.zip ⬇️](https://github.com/erayusta/erusoft-turkiye-adres-verisi/releases/latest/download/turkiye-adres-json.zip)
  — tüm Türkiye'nin iç içe JSON'u (açılınca ~100 MB).
- 📋 Tüm illerin listesi ve sayıları: [`data/README.md`](data/README.md).

**Kapsam:** 81 il · 973 ilçe · ~73 bin mahalle · ~1,27 milyon cadde/sokak. Kapı/bina no yoktur.

---

## İçindekiler

- [Hazır veri](#hazır-veri-indir-ve-kullan--kod-bilmeye-gerek-yok)
- [Nasıl çalışır](#nasıl-çalışır)
- [Veri kapsamı](#veri-kapsamı)
- [Kurulum](#kurulum)
- [Kullanım](#kullanım)
- [API uçları](#api-uçları)
- [JSON dışa aktarma](#json-dışa-aktarma)
- [Veri formatı](#veri-formatı)
- [Dayanıklılık / kaldığı yerden devam](#dayanıklılık--kaldığı-yerden-devam)
- [Sorumluluk reddi](#sorumluluk-reddi)
- [Lisans](#lisans)

---

## Nasıl çalışır

```
┌──────────────────────────┐        ┌─────────────────────────┐
│  Chrome Eklentisi        │  POST  │  Yerel API (index.php)  │
│  (turkiye.gov.tr sekmesi)│ ─────► │  PHP 8 + PDO MySQL      │
│                          │  JSON  │                         │
│  e-Devlet adres formunun │        │  provinces / districts  │
│  kendi AJAX ucundan      │        │  neighborhoods / streets│
│  il/ilçe/mahalle/sokak   │        │  + progress (cursor)    │
│  çeker                   │ ◄───── │                         │
└──────────────────────────┘ cursor └─────────────────────────┘
```

Eklenti, sayfanın kullandığı `common-ajax-operations` ucuna oturum çerezinle
istek atıp listeleri okur ve toplu olarak yerel API'ye yazar. İlerleme **mahalle
bazında** MySQL'deki `progress` tablosunda tutulur; sekme yenilense, token düşse
veya eklenti storage'ı temizlense bile kaldığı yerden devam eder.

İki faz:

- **Faz 1** — il → ilçe → mahalle listesi (tüm Türkiye ~1.050 istek, birkaç dakika).
  Bir kez çıkarılır, kalıcı olarak mühürlenir; sonraki her yenilemede tekrar çalışmaz.
- **Faz 2** — her mahalle için cadde/sokak (leaf). Checkpoint her mahallede ilerler.

## Veri kapsamı

| Seviye | Tablo | Örnek |
|---|---|---|
| İl | `provinces` | ADANA |
| İlçe | `districts` | SEYHAN |
| Mahalle | `neighborhoods` | GÜLPINAR |
| Cadde/Sokak | `streets` | ATATÜRK CADDESİ |

Her kayıtta NVİ'nin `external_id`'si (UAVT kodu) de saklanır. Tüm tablolarda
`(üst_id, name)` ve `(üst_id, external_id)` üzerinde **UNIQUE** kısıt vardır;
tekrar gelen kayıt çoğaltılmaz (idempotent import).

## Kurulum

**Gereksinimler:** PHP 8+, MySQL 8+, bir web sunucusu (ör. `adres.test` sanal
host'u), Chrome.

1. **Veritabanı** — `adres` adında bir MySQL veritabanı oluştur. Tablolar ilk
   API isteğinde otomatik kurulur (`CREATE TABLE IF NOT EXISTS`).

2. **Ayarlar** — örnek config'i kopyalayıp doldur:
   ```bash
   cp config.example.php config.php
   ```
   `config.php` git'e girmez (`.gitignore`). Alternatif olarak `ADRES_*`
   ortam değişkenleriyle de ayarlayabilirsin (bkz. `index.php`).

3. **Sunucu** — `index.php`'yi `https://adres.test` altında yayınla. Eklenti
   HTTPS bekler. `/api/*` route'ları kapalıysa `index.php?action=import` gibi
   fallback uçları da çalışır.

4. **Eklenti** — `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe
   yükle** → `nvi-adres-eklentisi/` klasörünü seç. `content.js` içindeki
   `API_KEY` ile `config.php` içindeki `API_KEY` **aynı** olmalı.

## Kullanım

1. `turkiye.gov.tr` → **Adres Değişikliği Bildirimi** → **2. aşama (Adres
   Bildirimi)** ekranını aç (il/ilçe kutuları görünsün).
2. Eklenti simgesine tıkla → **Devam et** (veya ilk kez **Baştan başla**).
3. Popup'ı kapatabilirsin; motor sekmede çalışır. **Sekmeyi açık bırak.**
4. Bittikten sonra **Güncelleme kontrolü** ile yeni il/ilçe/mahalle taranıp
   yalnızca yeni kayıtlar eklenir.

## API uçları

Her istekte `X-API-Key: <config'teki anahtar>` header'ı gönderilir.

| Uç | Açıklama |
|---|---|
| `POST /api/import` | Toplu kayıt + cursor ilerlet |
| `GET /api/progress?source=<kaynak>` | Kaldığın yeri sorgula |
| `GET /api/export` | Tüm veriyi düz satır olarak al |
| `GET /api/health` | Sağlık kontrolü |

Örnek import gövdesi:

```json
{
  "source": "nvi-turkiye-bina-v1",
  "cursor": "534",
  "context": { "province": "ADANA", "district": "SEYHAN" },
  "rows": [
    {
      "province": "ADANA",
      "district": "SEYHAN",
      "neighborhood": "GÜLPINAR MAHALLESİ",
      "street": "ATATÜRK CADDESİ",
      "street_type": "cadde"
    }
  ]
}
```

Zorunlu alanlar: `province`, `district`, `neighborhood`, `street`. Bir batch
tamamen kaydedilmeden cursor ilerlemez.

## JSON dışa aktarma

Veritabanındaki ağacı iç içe JSON olarak dışa aktar:

```bash
php -d memory_limit=3G export_json.php            # data/adres.json
php -d memory_limit=3G export_json.php cikti.json # verilen yola
```

Tam çıktı büyük olduğundan (~100 MB) repoya **girmez** (`.gitignore`); yerel
kullanım veya GitHub Release eki olarak dağıtılır.

Repoya basılan **il bazlı** CSV / JSON dosyalarını ve `data/README.md` indeksini
üretmek için:

```bash
php -d memory_limit=1G export_data.php   # data/csv/, data/json/, data/README.md
```

Tek parça tam arşivler [`data/tam/`](data/tam/) altındadır: `turkiye-adres-json.zip`
(iç içe tüm Türkiye JSON'u) ve `turkiye-adres-sql.zip` (`mysqldump` çıktısı).

## Veri formatı

```json
{
  "generated_at": "2026-08-21T12:18:46+00:00",
  "leaf": "street",
  "counts": { "provinces": 81, "districts": 973, "neighborhoods": 73292, "streets": 1272144 },
  "provinces": [
    {
      "id": 5, "external_id": "1", "name": "ADANA",
      "districts": [
        {
          "id": 42275, "external_id": "1757", "name": "ALADAĞ",
          "neighborhoods": [
            {
              "id": 42275, "external_id": "...", "name": "AKÖREN",
              "streets": [
                { "id": 814805, "external_id": "903620540", "name": "15 TEMMUZ SOKAK", "type": "sokak" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Dayanıklılık / kaldığı yerden devam

- İlerleme MySQL'deki cursor'da; **eklenti reload ≠ sayfa reload** — düzeltmeler
  ancak turkiye.gov.tr sekmesi F5'lenince aktif olur.
- Sekme 10 dakikada bir otomatik yenilenir, oturum düşmediyse kaldığı yerden sürer.
- e-Devlet oturumu kapanırsa eklenti durup "tekrar giriş yap" uyarısı verir
  (giriş 2FA olduğundan otomatikleştirilmez).

## Sorumluluk reddi

Bu yazılım **eğitim ve kişisel kullanım** amacıyla, kamuya açık **idari adres
verisini** (il/ilçe/mahalle/cadde-sokak) toplamak için paylaşılmıştır. Kişisel
veri (kimlik, kişiye bağlı adres vb.) toplamaz, saklamaz veya işlemez.

- Yazılımı kullanmak **tamamen kullanıcının sorumluluğundadır.** Kullandığın
  yer ve yöntemin **e-Devlet / turkiye.gov.tr kullanım şartlarına**, **KVKK**'ya
  ve yürürlükteki mevzuata uygunluğundan **yalnızca sen sorumlusun.**
- Yalnızca **kendi hesabınla** ve makul hızda (rate limit'lere saygılı) kullan;
  sistemlere aşırı yük bindirecek şekilde kullanma.
- Yazar(lar), bu yazılımın kullanımından doğabilecek **hiçbir doğrudan veya
  dolaylı zarardan sorumlu değildir** (bkz. MIT lisansındaki garanti reddi).
- Bu depo Nüfus ve Vatandaşlık İşleri (NVİ), e-Devlet veya herhangi bir resmî
  kurumla **ilişkili, onlar tarafından onaylanmış veya desteklenmiş değildir.**
- Verinin doğruluğu/güncelliği garanti edilmez; resmî işlemler için yetkili
  kaynakları (NVİ/KPS) esas al.

## Lisans

Kod [MIT lisansı](LICENSE) ile sunulur. Lisans **koda** uygulanır; toplanan
verinin kullanımına dair sorumluluk yukarıdaki [Sorumluluk reddi](#sorumluluk-reddi)
bölümündedir.
