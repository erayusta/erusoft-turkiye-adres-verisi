'use strict';

const $ = id => document.getElementById(id);
let tabId = null;
let ilSayisi = 81;
let onayBekliyor = null;      // confirm() yerine iki adımlı onay

const yaz = t => { $('durum').textContent = t; };
const bin = n => Number(n || 0).toLocaleString('tr-TR');

// ---- content script'e mesaj; hata mesajını yutmaz ----
function sendRaw(msg) {
  return new Promise(res => {
    chrome.tabs.sendMessage(tabId, msg, r => {
      if (chrome.runtime.lastError) {
        res({ __yok: true, hata: chrome.runtime.lastError.message });
      } else if (r === undefined) {
        res({ __yok: true, hata: 'content script yanıt vermedi' });
      } else {
        res(r);
      }
    });
  });
}

// content script yoksa elle enjekte et (eklenti kurulmadan önce açılmış sekmeler için)
async function enjekteEt() {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (e) {
    yaz('Enjeksiyon başarısız: ' + (e && e.message) +
        '\nSekmeyi bir kez yenileyip tekrar dene.');
    return false;
  }
}

async function gonder(msg) {
  if (tabId == null) return { __yok: true, hata: 'sekme yok' };
  let r = await sendRaw(msg);
  if (r.__yok) {
    if (!(await enjekteEt())) return r;
    await new Promise(s => setTimeout(s, 300));
    r = await sendRaw(msg);
  }
  return r;
}

// ---------------- tahmin ----------------
const TAHMIN = {
  1: { istek: 81,      satir: 973 },
  2: { istek: 1054,    satir: 55000 },
  3: { istek: 56000,   satir: 1100000 },
  4: { istek: 1150000, satir: 12000000 },
};

function tahminGoster() {
  const t = TAHMIN[+$('derinlik').value];
  const sec = [...$('iller').selectedOptions].length || ilSayisi;
  const oran = sec / 81;
  const istek = Math.round(t.istek * oran);
  const n = Math.max(1, +$('es').value || 5);
  const hiz = n / ((Math.max(0, +$('bekle').value || 0) + 150) / 1000);
  const sn = istek / hiz;
  const sure = sn < 90 ? Math.round(sn) + ' sn'
             : sn < 5400 ? Math.round(sn / 60) + ' dk'
             : sn < 172800 ? (sn / 3600).toFixed(1) + ' saat'
             : (sn / 86400).toFixed(1) + ' gün';
  $('tahmin').textContent =
    '≈ ' + bin(istek) + ' istek · ~' + sure + ' · ≈ ' + bin(Math.round(t.satir * oran)) + ' satır';
}
['derinlik', 'iller', 'es', 'bekle'].forEach(id => {
  $(id).addEventListener('change', tahminGoster);
  $(id).addEventListener('input', tahminGoster);
});

// ---------------- açılış ----------------
(async () => {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t) { yaz('Aktif sekme okunamadı.'); return; }
  if (!/^https:\/\/www\.turkiye\.gov\.tr\//.test(t.url || '')) {
    yaz('Bu sekme turkiye.gov.tr değil.\nAdres Değişikliği Bildirimi → 2. aşamayı aç,\nsonra eklentiye tıkla.');
    ['basla', 'devam', 'guncelle'].forEach(id => $(id).disabled = true);
    return;
  }
  tabId = t.id;

  const s = await gonder({ tip: 'sayfaDurumu' });
  if (s.__yok) { yaz('Sayfaya bağlanılamadı: ' + s.hata); return; }

  if (!s.formVar) {
    yaz('Bu sayfada adres seçim formu yok.\n"Adres Bildirimi" (2. aşama) ekranına gel,\nil/ilçe kutuları görünsün.');
    ['basla', 'devam', 'guncelle'].forEach(id => $(id).disabled = true);
  } else {
    ilSayisi = s.iller.length;
    for (const il of s.iller) {
      const o = document.createElement('option');
      o.value = il.id; o.textContent = il.ad;
      $('iller').appendChild(o);
    }
    yaz('Hazır — ' + ilSayisi + ' il bulundu.' + (s.api && s.api.ok ? '\nAPI bağlantısı tamam.' : '\nAPI HATASI: ' + ((s.api && (s.api.error || s.api.hata)) || 'bilinmiyor')));
  }
  tahminGoster();
  tik();
})();

// ---------------- başlat ----------------
$('basla').onclick = async () => {
  const cfg = {
    derinlik: 3,
    eszamanli: Math.max(1, +$('es').value || 5),
    bekle: Math.max(0, +$('bekle').value || 0),
    tekrar: 4,
    dilim: 10,
  };
  const iller = []; // Sunucu cursor'ı tüm Türkiye'nin sabit sırasına aittir.
  const imza = JSON.stringify([cfg, iller]);

  // confirm() eklenti popup'ında güvenilir değil → iki adımlı onay
  let uyari = !iller.length
    ? 'Tüm Türkiye sokak/cadde seviyesi taranacak. Veriler doğrudan adres.test veritabanına yazılacak.'
    : null;

  if (uyari && onayBekliyor !== imza) {
    onayBekliyor = imza;
    yaz('⚠ ' + uyari + '\n\nDevam etmek için Başlat\'a tekrar bas.');
    return;
  }
  onayBekliyor = null;

  const r = await gonder({ tip: 'basla', cfg, iller });
  if (r.__yok)      yaz('Başlatılamadı — sayfaya bağlanılamadı: ' + r.hata);
  else if (!r.ok)   yaz('Başlatılamadı — ' + (r.hata || 'bilinmeyen hata'));
  else              yaz('Başladı — ' + r.il + ' il kuyrukta.');
};

$('devam').onclick = async () => {
  const r = await gonder({ tip: 'devam' });
  if (r.__yok)     yaz('Devam edilemedi — sayfaya bağlanılamadı: ' + r.hata);
  else if (!r.ok)  yaz('Devam edilemedi — ' + (r.hata || 'bilinmeyen hata'));
  else             yaz('Devam ediliyor — kaldığı yerden sürüyor.');
};

$('dur').onclick = async () => {
  const r = await gonder({ tip: 'dur' });
  if (r.__yok) yaz('Durdurulamadı: ' + r.hata);
};

$('guncelle').onclick = async () => {
  yaz('Güncelleme taraması başlatılıyor…\nTüm il/ilçe yeniden taranıp yalnız YENİ mahalleler kuyruğa eklenecek.');
  const r = await gonder({ tip: 'guncelle' });
  if (r.__yok)     yaz('Başlatılamadı — sayfaya bağlanılamadı: ' + r.hata);
  else if (!r.ok)  yaz('Güncelleme başlatılamadı — ' + (r.hata || 'bilinmeyen hata'));
  else             yaz('Güncelleme taraması başladı. Yeni mahalle bulunursa otomatik çekilecek.');
};

$('test').onclick = async () => {
  yaz('API test ediliyor…');
  const r = await gonder({ tip: 'apiTest' });
  if (r.__yok) yaz('Content script bağlantısı yok: ' + r.hata);
  else if (!r.ok) yaz('API HATASI: ' + (r.hata || 'bilinmiyor'));
  else yaz('API bağlantısı tamam. GET + POST testi başarılı; veritabanına test kaydı yazılmadı.');
};

// ---------------- ilerleme ----------------
async function tik() {
  const { durum } = await chrome.storage.local.get('durum');
  if (durum && durum.hal && !onayBekliyor) {
    const hal = { calisiyor: '⏳ çalışıyor', duraklatildi: '⏸ duraklatıldı', bitti: '✅ bitti' }[durum.hal];
    let yuzde = 0, ilerleme = '';
    if (durum.neden === 'guncelleme' && durum.faz === 1) {
      ilerleme = 'güncelleme — il/ilçe yeniden taranıyor, yeni mahalle aranıyor';
    } else if (durum.faz === 1 && !durum.toplamIs) {
      ilerleme = 'faz 1/2 — mahalle listesi çıkarılıyor';
    } else if (durum.toplamIs) {
      yuzde = Math.round(100 * (durum.indeks || 0) / durum.toplamIs);
      ilerleme = 'faz 2/2 — mahalle ' + bin(durum.indeks) + '/' + bin(durum.toplamIs) + '  (%' + yuzde + ')';
    }
    if (durum.hal === 'bitti') yuzde = 100;
    $('bar').style.width = yuzde + '%';
    yaz(
      hal + (durum.neden ? ' (' + durum.neden + ')' : '') + '\n' + ilerleme + '\n' +
      'satır: ' + bin(durum.satir) + '   istek: ' + bin(durum.istek) + '   hata: ' + bin(durum.hata) +
      (durum.suAnki ? '\n' + durum.suAnki : '') +
      (durum.neden === 'token' ? '\n→ sekmeyi yenile, kaldığı yerden devam eder' : '') +
      (durum.neden === 'oturum' ? '\n⚠ e-Devlet oturumu kapandı — tekrar giriş yapıp adres formuna gel, kaldığı yerden devam eder' : '') +
      (durum.neden === 'guncelleme' && typeof durum.yeniMahalle === 'number'
        ? '\n🔎 güncelleme: ' + (durum.yeniMahalle > 0 ? bin(durum.yeniMahalle) + ' yeni mahalle bulundu ve çekiliyor' : 'yeni mahalle yok — veri güncel') : '')
    );
  }
  setTimeout(tik, 1000);
}
