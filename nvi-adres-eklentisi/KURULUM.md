# NVİ Adres Verisi Çekici — kurulum ve notlar

## Kurulum

1. Zip'i kalıcı bir klasöre çıkart (klasörü silme, eklenti oradan çalışır).
2. Chrome → `chrome://extensions` → sağ üstte **Geliştirici modu** açık.
3. **Paketlenmemiş öğe yükle** → klasörü seç.

## Kullanım

1. `turkiye.gov.tr` → **Adres Değişikliği Bildirimi** → **2. aşama (Adres Bildirimi)**;
   il/ilçe/mahalle kutularının göründüğü ekran.
2. Form açılınca eklenti otomatik başlar. Popup yalnızca durum takibi ve durdur/devam içindir.
3. Popup'ı kapatabilirsin, motor sayfada çalışmaya devam eder. **Sekmeyi açık bırak.**
4. Veriler dosyaya değil doğrudan `https://adres.test` üzerindeki MySQL API'ye yazılır.

Her mahalle tamamlandığında o mahallenin bütün **cadde/sokak** kayıtları tek batch
halinde API'ye gönderilir (kapı/bina no toplanmaz). API batch'i tamamen kaydetmeden
checkpoint ilerlemez.

## Nasıl çalışıyor

Sayfanın kendi kullandığı uca doğrudan istek atar:

```
POST /common-ajax-operations?getData&submit
  pn=/adres-degisikligi-bildirimi & ajax=1
  token=<sayfadaki hidden input>
  islemTipi=adres
  metod=Ilce | Mahalle | Csbm   (Csbm = cadde/sokak; Bina/Daire kullanılmıyor)
  parent_id=<üst kaydın id'si>
```

İki fazlı:

- **Faz 1** — il → ilçe → mahalle. Ucuz, tüm Türkiye için ~1.050 istek.
- **Faz 2** — her mahalle için cadde/sokak (leaf burası; bina/kapı toplanmaz).
  Checkpoint **mahalle bazında** ve MySQL'dedir: token düşerse, sekme yenilenirse veya
  eklenti storage'ı temizlenirse sunucudan kaldığı yeri okuyarak devam eder.

`token` oturuma bağlı ve zamanla düşer. Düştüğünde eklenti duraklatıp
"sekmeyi yenile" der; yenileyince **kaldığı mahalleden** kendi devam eder.
Formdaki kendi adres seçimine hiç dokunmaz.

## API çıktısı

```json
GET https://adres.test/api/export
X-API-Key: local-adres-key
```

## Gerçekçi ölçek (kabaca)

Leaf **cadde/sokak** (derinlik 3). Kapı/bina toplanmadığı için tüm Türkiye
makul sürede tamamlanır:

| Derinlik | İstek | Süre (5 eşzamanlı, 120 ms) | Satır |
|---|---|---|---|
| 1 — il+ilçe | 81 | ~20 sn | 973 |
| 2 — +mahalle | ~1.050 | ~5 dk | ~55.000 |
| **3 — +cadde/sokak (aktif)** | **~56.000** | **~2,5 saat** | **~1,1 milyon** |

Kapı/bina (eski derinlik 4-5) artık **toplanmıyor**: e-ticaret adres seçicisinde
bina/kapı/daire kullanıcı tarafından serbest metin girilir.

`Bekleme`yi 120 ms altına indirme, `Eşzamanlı`yı 6'nın üstüne çıkarma —
hata sayacı fırlarsa yavaşlat.
