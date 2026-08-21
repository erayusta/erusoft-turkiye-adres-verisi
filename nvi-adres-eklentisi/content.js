/* =========================================================
   NVİ Adres Verisi Çekici — content script (motor) v2

   Akış:
     Faz 1 (hazırlık): il → ilçe → mahalle   (ucuz, birkaç dk)
     Faz 2 (derin)   : her mahalle için csbm (sokak/cadde) — kapı/bina YOK

   Checkpoint MAHALLE bazında. Token düşerse / sekme yenilenirse
   en fazla 1 mahallelik iş kaybolur, gerisi kaldığı yerden devam eder.
   ========================================================= */
(() => {
'use strict';

// aynı sayfaya iki kez enjekte edilirse ikinciyi yok say
if (window.__NVI_ADRES_YUKLU) return;
window.__NVI_ADRES_YUKLU = true;

const UC    = 'https://www.turkiye.gov.tr/common-ajax-operations?getData&submit';
const PN    = '/adres-degisikligi-bildirimi';
const API   = 'https://adres.test/api';
const API_KEY = 'local-adres-key';
// NOT: progress cursor anahtarı (legacy isim). Kapı/bina artık toplanmıyor ama
// çalışan taramayla sürekliliği korumak için anahtar aynı tutuldu.
const SOURCE = 'nvi-turkiye-bina-v1';

const S    = chrome.storage.local;
const get  = k => new Promise(r => S.get(k, r));
const set  = o => new Promise(r => S.set(o, r));
const sil  = k => new Promise(r => S.remove(k, r));
const uyku = ms => new Promise(r => setTimeout(r, ms));

let iptal = false;
let calisiyor = false;
let periyodikYenileme = null;

const YENILEME_DK = 10;
function periyodikYenilemeBaslat() {
  if (periyodikYenileme) clearTimeout(periyodikYenileme);
  periyodikYenileme = setTimeout(async () => {
    const st = await get('durum');
    // Oturum düştüyse yeniden yükleme login sayfasına düşer; boşuna döngü kurma.
    if (st.durum && st.durum.hal === 'calisiyor' && formVar()) location.reload();
  }, YENILEME_DK * 60 * 1000);
}

// Sayaç = ÜST ÜSTE (ilerleme olmadan) yapılan token yenilemesi.
// İlerleme oldukça sıfırlanır (bkz. ilerlemeVar), böylece cap yalnızca
// gerçekten takıldığında — ör. e-Devlet oturumu düşmüşse — devreye girer.
const TOKEN_YENILEME_LIMITI = 6;
async function tokenSonrasiOtomatikYenile() {
  const st = await get('tokenYenileme');
  const adet = st.tokenYenileme || 0;
  if (adet >= TOKEN_YENILEME_LIMITI) return false;
  await set({ tokenYenileme: adet + 1 });
  await uyku(1500);
  location.reload();
  return true;
}

// Gerçek ilerleme kaydedildiğinde token sayacını sıfırla.
async function ilerlemeVar() {
  await set({ tokenYenileme: 0 });
}

// ---------------- sayfa ----------------
const token = () => {
  const el = document.querySelector('input[type=hidden][name=token]');
  return el ? el.value : null;
};
const illerSayfadan = () => {
  const el = document.querySelector('select[name$="-address-il"]');
  return el ? [...el.options].filter(o => o.value)
                .map(o => ({ id: +o.value, ad: o.text.trim() })) : null;
};
const formVar = () => !!(token() && illerSayfadan());

// ---------------- ajax ----------------
// dizi | 'TOKEN' | null
async function cek(metod, parentId, tekrar) {
  const tok = token();
  if (!tok) return 'TOKEN';
  const body = new URLSearchParams({
    pn: PN, ajax: '1', token: tok,
    islemTipi: 'adres', metod, parent_id: String(parentId),
  }).toString();

  for (let i = 0; i < tekrar; i++) {
    try {
      const r = await fetch(UC, {
        method: 'POST', credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body,
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) return 'TOKEN';
      return j.dataArr || [];
    } catch (e) {
      if (i === tekrar - 1) return null;
      await uyku(700 * (i + 1));
    }
  }
  return null;
}

async function havuz(isler, n, bekle) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < isler.length) {
      const k = i++;
      if (iptal) return;
      await isler[k]();
      if (bekle) await uyku(bekle);
    }
  }));
}

let _durum = {};
async function durumYaz(y, kaydet) {
  _durum = Object.assign({}, _durum, y);
  if (kaydet !== false) await set({ durum: _durum });
}

// ---------------- local API ----------------
async function api(path, options = {}) {
  let sonHata;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API + path, Object.assign({}, options, {
        headers: Object.assign({ 'X-API-Key': API_KEY }, options.headers || {}),
      }));
      const j = await r.json();
      if (!r.ok) {
        const detail = j.error || ('API HTTP ' + r.status);
        console.error('[NVI API import]', detail, j);
        throw new Error(detail);
      }
      return j;
    } catch (e) {
      sonHata = e;
      if (i < 3) await uyku(1000 * (i + 1));
    }
  }
  throw new Error('adres.test bağlantısı kurulamadı: ' + sonHata.message);
}

async function sunucuIndeksi() {
  const j = await api('/progress?source=' + encodeURIComponent(SOURCE));
  return j.progress && j.progress.cursor ? Number(j.progress.cursor) || 0 : 0;
}

// Leaf = sokak/cadde. Her csbm kaydı bir satır. Kapı (bina) toplanmıyor.
function apiSatiri(yol, c) {
  const alan = (obje, alanlar) => {
    for (const alan of alanlar) {
      const deger = obje && obje[alan];
      if (deger !== undefined && deger !== null && String(deger).trim() !== '') return deger;
    }
    return '';
  };
  const sokak = alan(c, ['name', 'ad', 'csbmAdi', 'sokakAdi', 'text', 'label', 'title', 'value']);
  return {
    province: yol.il, province_external_id: yol.ilId,
    district: yol.ilce, district_external_id: yol.ilceId,
    neighborhood: yol.mahalle, neighborhood_external_id: yol.mahalleId,
    street: sokak, street_external_id: alan(c, ['id', 'value']),
    street_type: /cadde/i.test(String(sokak)) ? 'cadde' : 'sokak',
  };
}

async function apiKaydet(rows, sonrakiIndeks, yol) {
  await durumYaz({ suAnki: (yol.il || '') + ' / ' + (yol.ilce || '') + ' / ' + (yol.mahalle || '') + ' — API yazıyor (' + rows.length + ')' }, false);
  const sonuc = await api('/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: SOURCE,
      cursor: String(sonrakiIndeks),
      context: yol,
      rows,
    }),
  });
  await durumYaz({ suAnki: (yol.il || '') + ' / ' + (yol.ilce || '') + ' / ' + (yol.mahalle || '') + ' — API yazdı' }, false);
  return sonuc;
}

// ---------------- FAZ 1: il → ilçe → mahalle ----------------
async function hazirlik(cfg, kuyruk) {
  const eski = await get(['isler', 'prepIl']);
  const isler = eski.isler || []; // {id: mahalleId, yol:{...}}
  const idKumesi = new Set(isler.map(x => x.id)); // append-only: aynı id iki kez girmesin
  const ekle = (kayit) => { if (!idKumesi.has(kayit.id)) { idKumesi.add(kayit.id); isler.push(kayit); } };
  const baslangicIli = eski.prepIl || 0;
  let istek = 0, hata = 0;

  for (let ilNo = baslangicIli; ilNo < kuyruk.length; ilNo++) {
    const il = kuyruk[ilNo];
    if (iptal) return null;
    await durumYaz({ faz: 1, suAnki: il.ad + ' — ilçeler' });

    const ilceler = await cek('Ilce', il.id, cfg.tekrar);
    if (ilceler === 'TOKEN') return 'TOKEN';
    istek++;
    if (!ilceler) { hata++; continue; }

    if (cfg.derinlik === 1) {
      for (const ic of ilceler)
        ekle({ id: ic.id, yol: { il: il.ad, ilId: il.id, ilce: ic.name, ilceId: ic.id } });
      continue;
    }

    let tokenDustu = false;
    await havuz(ilceler.map(ic => async () => {
      if (tokenDustu) return;
      const mh = await cek('Mahalle', ic.id, cfg.tekrar);
      if (mh === 'TOKEN') { tokenDustu = true; return; }
      istek++;
      if (!mh) { hata++; return; }
      for (const m of mh) {
        ekle({ id: m.id, yol: {
          il: il.ad, ilId: il.id, ilce: ic.name, ilceId: ic.id,
          mahalle: m.name, mahalleId: m.id,
        }});
      }
      await durumYaz({ suAnki: il.ad + ' / ' + ic.name + ' — ' + isler.length + ' mahalle' }, false);
    }), cfg.eszamanli, cfg.bekle);

    if (tokenDustu) return 'TOKEN';
    await durumYaz({ istek, hata });
    // Yenileme/kapanma halinde tüm hazırlık baştan başlamasın.
    await set({ isler, prepIl: ilNo + 1 });
    await ilerlemeVar(); // bir il tamamlandı → token sayacını sıfırla
  }
  return { isler, istek, hata };
}

// ---------------- FAZ 2: mahalle → csbm (sokak/cadde) ----------------
async function derin(cfg) {
  while (true) {
    if (iptal) return null;
    const st = await get(['isler', 'indeks']);
    const isler = st.isler || [];
    const bas = Math.max(st.indeks || 0, await sunucuIndeksi());
    if (bas >= isler.length) return 'BITTI';

    const dilim = isler.slice(bas, bas + (cfg.dilim || 10));
    let tokenDustu = false;
    let bitenIs = 0;                       // bu dilimde tamamlanan mahalle sayısı

    for (const is of dilim) {
      if (iptal || tokenDustu) break;

      const csbm = await cek('Csbm', is.id, cfg.tekrar);
      if (csbm === 'TOKEN') { tokenDustu = true; break; }
      _durum.istek = (_durum.istek || 0) + 1;

      if (csbm === null) {                 // ağ hatası: kayıp veri olmasın, dur ve tekrar dene
        _durum.hata = (_durum.hata || 0) + 1;
        throw new Error('NVİ cadde/sokak isteği başarısız; mahalle tekrar denenecek');
      }

      // Leaf sokak: her csbm bir satır, ayrıca Bina isteği YOK (kapı toplanmıyor).
      const mahalleSatirlari = csbm.map(c => apiSatiri(is.yol, c));
      await apiKaydet(mahalleSatirlari, bas + bitenIs + 1, is.yol);
      _durum.satir = (_durum.satir || 0) + mahalleSatirlari.length;
      bitenIs++;
    }

    const yeniIdx = bas + bitenIs;
    await set({ indeks: yeniIdx });
    if (bitenIs > 0) await ilerlemeVar(); // ilerleme oldu → token sayacını sıfırla
    const son = dilim[Math.max(0, bitenIs - 1)];
    await durumYaz({
      faz: 2, indeks: yeniIdx, toplamIs: isler.length,
      suAnki: son ? son.yol.il + ' / ' + son.yol.ilce + ' / ' + (son.yol.mahalle || '') : null,
    });

    if (tokenDustu) return 'TOKEN';
    if (iptal) return null;
    if (bitenIs === 0) {                   // ilerleme yok → sonsuz döngüyü kes
      await durumYaz({ hal: 'duraklatildi', neden: 'ilerleme yok' });
      return 'TOKEN';
    }
  }
}

// ---------------- motor ----------------
async function motor() {
  if (calisiyor) return;
  calisiyor = true; iptal = false;
  periyodikYenilemeBaslat();

  try {
    while (true) {
      const st = await get(['cfg', 'durum', 'kuyruk', 'isler', 'prepIl', 'hazirlikTamam']);
      const cfg = st.cfg;
      _durum = st.durum || {};
      if (!cfg || _durum.hal !== 'calisiyor') break;

      // --- faz 1 gerekiyor mu? (iş listesi bir kez çıkarılır, kalıcıdır) ---
      if (!st.hazirlikTamam) {
        const r = await hazirlik(cfg, st.kuyruk || []);
        if (r === 'TOKEN') {
          await durumYaz({ hal: 'duraklatildi', neden: 'token' });
          await tokenSonrasiOtomatikYenile();
          break;
        }
        if (r === null) break;                       // iptal
        // Yarım kalan bir il tekrar denenince aynı mahalle iki kez girmiş olabilir → tekille.
        const gorulen = new Set();
        const benzersizIsler = r.isler.filter(is => {
          if (gorulen.has(is.id)) return false;
          gorulen.add(is.id); return true;
        });
        const uzakIndeks = await sunucuIndeksi();
        await set({ isler: benzersizIsler, indeks: uzakIndeks, prepIl: null, hazirlikTamam: true });
        // Güncelleme taramasıysa kaç yeni mahalle eklendiğini raporla.
        const guncelleme = _durum.neden === 'guncelleme';
        const yeni = guncelleme ? Math.max(0, benzersizIsler.length - (_durum.oncekiToplam || 0)) : undefined;
        // faz:2 KALICI yazılmalı; yoksa her refresh'te Faz 1 baştan çalışır (eski bug).
        await durumYaz(Object.assign(
          { toplamIs: benzersizIsler.length, istek: r.istek, hata: r.hata, faz: 2 },
          guncelleme ? { yeniMahalle: yeni } : {},
        ));
        continue;
      }

      // --- faz 2 ---
      const d = await derin(cfg);
      if (d === 'TOKEN') {
        await durumYaz({ hal: 'duraklatildi', neden: 'token' });
        await tokenSonrasiOtomatikYenile();
        break;
      }
      if (d === null) break;                          // iptal
      if (d === 'BITTI') {
        await durumYaz({ hal: 'bitti', suAnki: null });
        break;
      }
    }
  } catch (e) {
    await durumYaz({ hal: 'duraklatildi', neden: String((e && e.message) || e) });
  } finally {
    calisiyor = false;
  }
}

// ---------------- mesajlar ----------------
chrome.runtime.onMessage.addListener((msg, _s, yanit) => {
  (async () => {
    try {
      if (msg.tip === 'sayfaDurumu') {
        let apiDurum = null;
        try { apiDurum = await api('/health'); } catch (e) { apiDurum = { ok: false, error: e.message }; }
        yanit({ formVar: formVar(), iller: illerSayfadan(), api: apiDurum });

      } else if (msg.tip === 'apiTest') {
        const j = await api('/health');
        const p = await api('/import?dry_run=1', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'extension-test', rows: [] }),
        });
        yanit({ ok: true, api: j, post: p });

      } else if (msg.tip === 'basla') {
        if (!token()) {
          yanit({ ok: false, hata: 'sayfada token yok — adres formu ekranında değilsin' });
          return;
        }
        const iller = illerSayfadan();
        if (!iller || !iller.length) {
          yanit({ ok: false, hata: 'sayfada il listesi yok — 2. aşamaya (Adres Bildirimi) gel' });
          return;
        }
        const sec = (msg.iller && msg.iller.length)
          ? iller.filter(i => msg.iller.includes(i.id)) : iller;
        if (!sec.length) { yanit({ ok: false, hata: 'seçili il eşleşmedi' }); return; }

        await sil(['isler', 'indeks', 'prepIl', 'hazirlikTamam']);

        await set({ tokenYenileme: 0,
          cfg: msg.cfg,
          kuyruk: sec,
          durum: { hal: 'calisiyor', faz: 1, il: sec.length, indeks: 0,
                   toplamIs: 0, istek: 0, hata: 0, suAnki: null },
        });
        motor();
        yanit({ ok: true, il: sec.length });

      } else if (msg.tip === 'devam') {
        // Silme YOK: isler/indeks/hazirlikTamam korunur, kaldığı yerden sürer.
        const s = await get('durum');
        _durum = s.durum || {};
        await durumYaz({ hal: 'calisiyor', neden: null });
        motor();
        yanit({ ok: true });

      } else if (msg.tip === 'guncelle') {
        // BITTI sonrası: yeni il/ilçe/mahalle var mı diye Faz 1'i tekrar çalıştır.
        // hazirlik id-dedup olduğu için yalnızca YENİ mahalleler iş listesinin
        // sonuna eklenir; Faz 2 cursor'ı bunları otomatik işler.
        if (!token()) { yanit({ ok: false, hata: 'sayfada token yok — adres formuna gel' }); return; }
        const iller = illerSayfadan();
        if (!iller || !iller.length) { yanit({ ok: false, hata: 'sayfada il listesi yok' }); return; }
        const st = await get(['isler', 'cfg']);
        if (!st.isler || !st.isler.length) {
          yanit({ ok: false, hata: 'önce normal taramayı bir kez tamamla' });
          return;
        }
        const cfg = st.cfg || { derinlik: 3, eszamanli: 5, bekle: 120, tekrar: 4, dilim: 10 };
        _durum = Object.assign({}, _durum, {
          hal: 'calisiyor', neden: 'guncelleme', faz: 1,
          oncekiToplam: st.isler.length, yeniMahalle: undefined,
        });
        // hazirlikTamam=false + prepIl=0 → Faz 1 tüm illeri yeniden dolaşır (yalnız yeniyi ekler).
        await set({ hazirlikTamam: false, prepIl: 0, kuyruk: iller, cfg, tokenYenileme: 0, durum: _durum });
        motor();
        yanit({ ok: true });

      } else if (msg.tip === 'dur') {
        iptal = true;
        await durumYaz({ hal: 'duraklatildi', neden: 'kullanıcı' });
        yanit({ ok: true });

      } else {
        yanit({ ok: false });
      }
    } catch (e) {
      yanit({ ok: false, hata: String((e && e.message) || e) });
    }
  })();
  return true;
});

// ---------------- sayfa yenilendiyse otomatik devam ----------------
(async () => {
  // Form yok = ya bu ekranda değiliz ya da oturum düşmüş.
  // Aktif bir tarama varken form kaybolduysa oturum kapanmıştır:
  // sessizce durmak yerine kullanıcıyı "tekrar giriş yap" diye uyar,
  // yeniden yükleme döngüsü kurma (login sayfasını sonsuza dek reload etmeyelim).
  if (!formVar()) {
    const { durum } = await get('durum');
    if (durum && durum.hal === 'calisiyor') {
      await set({ durum: Object.assign({}, durum, { hal: 'duraklatildi', neden: 'oturum' }) });
    }
    return;
  }

  let { durum } = await get('durum');
  if (!durum) {
    const iller = illerSayfadan();
    if (!iller || !iller.length) return;
    const cfg = { derinlik: 3, eszamanli: 5, bekle: 120, tekrar: 4, dilim: 10 };
    durum = { hal: 'calisiyor', faz: 1, il: iller.length, indeks: 0,
              toplamIs: 0, istek: 0, hata: 0, suAnki: null };
    await set({ cfg, kuyruk: iller, durum });
  }
  // Form geri geldiyse (tekrar giriş yapılmış) oturum nedeniyle duran işi de sürdür.
  if (durum.hal === 'calisiyor' ||
     (durum.hal === 'duraklatildi' && (durum.neden === 'token' || durum.neden === 'oturum'))) {
    _durum = durum;
    // Güncelleme taraması reload'a takılırsa modu koru; diğer nedenleri temizle.
    const yeniNeden = durum.neden === 'guncelleme' ? 'guncelleme' : null;
    await durumYaz({ hal: 'calisiyor', neden: yeniNeden });
    await ilerlemeVar(); // form var, çalışan oturum → sayacı temizle
    motor();
  }
})();

})();
