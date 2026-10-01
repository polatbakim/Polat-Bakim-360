# Polat Bakım 360 — boş Supabase yayını

Bu klasör, eski `P:` uygulamasından ayrı bir yayın paketidir. Yeni yayında tezgâh, personel, stok, iş emri, bakım, geçmiş ve kullanıcı verisi hazır gelmez. Eski `P:` klasörü ve mevcut tarayıcı kayıtları değiştirilmez. `bakim-data.js`, `bakim-analytics-data.js` ve `tezgah-master-data.js` bilerek bu pakete alınmadı.

## 1. Supabase projesi

1. Yeni, boş bir Supabase projesi açın. Mevcut/veri içeren projede bu kurulumun boş başlangıç sağlayacağını varsaymayın.
2. SQL Editor'de [`supabase/schema.sql`](supabase/schema.sql) dosyasının tamamını çalıştırın. Bu, tabloları, RLS politikalarını, iş emri fonksiyonlarını, Realtime olayını ve özel Storage bucket'ını oluşturur.
3. Authentication > Users bölümünde ilk Admin Yönetici için e-posta ve güçlü şifreyle bir kullanıcı oluşturun. Bu, program dışından yapılacak tek başlangıç kullanıcı işlemidir.
4. SQL Editor'de aşağıdaki sorguda e-posta adresini değiştirip çalıştırın. `updated` satır sayısının **1** olduğunu kontrol edin:

```sql
with updated as (
  update public.profiles
     set email = 'ADMIN_EPOSTA_ADRESI',
         full_name = 'Hasan Can Özcan',
         role = 'manager',
         manager_access = true,
         operator_access = false,
         is_admin = true,
         active = true,
         updated_at = now()
   where id = (select id from auth.users where email = 'ADMIN_EPOSTA_ADRESI')
   returning id
)
select count(*) as updated from updated;
```

5. Supabase CLI ile bu klasörde oturum açın, projeyi bağlayın ve `supabase functions deploy manage-user` komutunu çalıştırın. Edge Function'ın **JWT doğrulaması açık** olmalı; Auth yönetimi yalnızca Admin Yönetici oturumuyla bu fonksiyondan yapılır. Programdaki **Giriş Yetkileri** ekranı daha sonraki kullanıcıları oluşturur, düzenler ve devre dışı bırakır.
6. `Project URL` ve **publishable key** (eski projelerde `anon` key) değerlerini not edin. **Secret/service_role anahtarını GitHub'a veya tarayıcı koduna koymayın.**

## 2. GitHub Pages

1. Bu klasörün içeriğini yeni bir GitHub deposunun köküne yükleyin. `main` dalını kullanın. Eski veri dosyalarını eklemeyin.
2. Depo Settings > Secrets and variables > Actions > **Variables** altında `SUPABASE_URL` ve `SUPABASE_PUBLISHABLE_KEY` değişkenlerini oluşturun. Bunlar tarayıcıda görülebilen genel bağlantı değerleridir, şifre değildir.
3. Settings > Pages > Build and deployment bölümünde kaynağı **GitHub Actions** seçin.
4. Actions > **Publish Polat Bakım 360** çalışmasını izleyin. İş akışı yalnızca izin verilen statik dosyaları yayımlar; `supabase/schema.sql` ve Edge Function kaynakları Pages çıktısına girmez.
5. Yayın URL'sini Supabase Authentication > URL Configuration bölümünde **Site URL** ve gerekirse **Redirect URLs** listesine ekleyin.
6. İlk Admin Yönetici e-postası/şifresi ile giriş yapın. Açılan veri ekranlarının boş olduğunu doğrulayın, ardından kullanıcıları **Giriş Yetkileri** bölümünden oluşturun.

## İlk girişte kişisel şifre belirleme (mevcut projeyi güncelleme)

Yeni kullanıcıya Admin Yönetici geçici bir şifre verir. Kullanıcı bu şifreyle ilk kez giriş yaptığında uygulama yalnızca **kişisel şifre belirleme** ekranını açar. Yeni şifre en az 8 karakter ve geçici şifreden farklı olmalıdır. Değişimden sonra kullanıcı yeni şifresiyle tekrar giriş yapar. Admin Yönetici mevcut bir kullanıcının şifresini sıfırlarsa aynı zorunluluk yeniden başlar. İlk kurulumdaki Admin Yönetici hesabı otomatik olarak işaretlenmez.

Mevcut Supabase projesinde geçiş sırası:

1. Supabase **SQL Editor** içinde [`supabase/first-login-password-migration.sql`](supabase/first-login-password-migration.sql) dosyasının etkin sorgularını çalıştırın. Bu adım mevcut kullanıcıları henüz zorlamaz; veri silmez.
2. Supabase **Edge Functions > manage-user > Code** bölümündeki kodu [`supabase/functions/manage-user/index.ts`](supabase/functions/manage-user/index.ts) ile değiştirip fonksiyonu **yeniden Deploy** edin. Fonksiyon adı tam olarak `manage-user`, JWT doğrulaması açık olmalı. GitHub'a kod yüklemek Edge Function'ı kendiliğinden dağıtmaz.
3. GitHub deposunun kökündeki `index.html`, `app.js`, `styles.css`, `supabase-cloud.js`, `sw.js` dosyalarını bu paketteki sürümleriyle güncelleyin. `supabase` klasöründeki yeni/yenilenen SQL ve TypeScript kaynaklarını da depoda tutun. **Publish Polat Bakım 360** iş akışının başarıyla bittiğini kontrol edin; mevcut GitHub değişkenlerini yeniden girmeniz gerekmez.
4. Daha önce geçici şifre verdiğiniz **mevcut** Admin olmayan kullanıcıların da ilk girişte şifre değiştirmesini istiyorsanız, yayın doğrulandıktan sonra migration dosyasının sonundaki yorumlu `UPDATE` sorgusunu SQL Editor'de ayrıca çalıştırın. Bu sorguyu yalnızca bir kez ve giriş yapmış diğer kullanıcıları bilgilendirerek çalıştırın.

Geçişi kısa bir bakım aralığında yapın. Yeni kullanıcı oluşturma ve şifre sıfırlama işlemleri migration ve Edge Function güncellenmeden yapılmamalıdır. Geçici şifreyi GitHub'a, SQL dosyasına veya tarayıcı koduna yazmayın.

## Önemli sınırlar

### Planlı bakımın otomatik açılması

Bakım kartında periyodu (günlük, haftalık, aylık, 3/6 aylık, yıllık veya özel ay sayısı), ilk bakım tarihini ve **Periyot geldiğinde iş emri otomatik oluştur** seçeneğini belirleyin. Yeni planlı iş emri formundan oluşturulan bakım planlarında bu seçenek açıktır. Önceden var olan kartlar kendiliğinden otomatiğe geçmez; isteniyorsa kart düzenleme ekranından açılmalıdır. Oluşan iş emirleri başlangıçta **Bekliyor** durumundadır ve personel sonradan atanır. Aynı kart sonraki periyotlarda yeni iş emirleri üretir.

Bu işlem tarayıcı kapalıyken de çalışsın diye, ana şema kurulduktan sonra Supabase SQL Editor'de [`supabase/planned-maintenance-cron.sql`](supabase/planned-maintenance-cron.sql) dosyasını ayrıca çalıştırın. Projede Supabase Cron (`pg_cron`) etkin olmalıdır. Dosya, İstanbul saatine göre her saat başından 5 dakika sonra vadesi gelmiş kartları kontrol eder; gecikmiş bir kart için bir telafi iş emri oluşturur ve sonraki tarihi geleceğe taşır. **GitHub'a dosyayı yüklemek veya Pages'i yayımlamak bu SQL işini kendiliğinden kurmaz.** Canlıya almadan önce bir test kartıyla Supabase'de ve iki tarayıcıda doğrulayın.

### Makine kartı JSON yedeğini canlıya aktarma

`Makine Bakım Kartları > JSON İçe Aktar` düğmesi yalnızca Admin Yönetici oturumunda çalışır. Polat Bakım 360'ın `Yedek Al` düğmesiyle oluşturulan sürüm 3 JSON dosyasını seçin; önizlemede yeni, güncellenecek, değişmeyecek ve atlanacak kart sayılarını kontrol edip **Supabase'e Aktar** düğmesine basın. Kartlar normalize edilmiş PT/SAP koduyla eşleştirilir. Mevcut kartlar silinmez; eşleşen kartların kimliği, tezgâh puanı, canlı durumu, olay geçmişi ve ilişkili kayıtları korunur. Dosyada boş olan alanlar mevcut kartı boşaltmaz. Dosyanın `logs` ve `contracts` alanları aktarılmaz.

Aktarımdan önce `machine-import.js`, güncel `index.html`, `styles.css`, `supabase-cloud.js`, `sw.js` ve `.github/workflows/deploy.yml` dosyalarını GitHub'a yükleyip Pages yayınının başarılı bitmesini bekleyin. JSON dosyasını GitHub'a veya SQL Editor'a yüklemeyin; canlı sitedeki düğmeyle yerel dosyayı seçin. Sunucuda bu sırada başka bir kayıt değişirse sürüm çakışmasında aktarım durur; yeniden önizleyip deneyin. İlk kullanımda başka yöneticiler kayıt düzenlemezken aktarın ve sonrasında kart sayısını kontrol edin.

- GitHub Pages statik dosyaları genellikle herkes tarafından görülebilir. Güvenlik Supabase Auth, RLS ve sunucu fonksiyonlarıyla sağlanır; publishable key gizli değildir.
- Bu sürüm, eski uygulamanın büyük JSON `app_snapshots` modelini kullanır. Bu nedenle **eşzamanlı yönetici düzenlemelerinde sürüm çakışması** mümkündür. Çakışma hatası görülürse sayfayı yenileyip son bulut durumunu alın. Çok kullanıcılı yoğun operasyon için kayıtları ayrı tablolara taşıyan ikinci aşama gerekir.
- Sayfa görünürlüğü ve ayrıntılı silme izinleri halen arayüz seviyesindedir; monolitik snapshot'a yazma yetkisi olan yönetici teknik olarak tüm veriyi değiştirebilir. Hassas üretim kullanımından önce bunlar ayrı tablolarda sunucu tarafında da zorlanmalıdır.
- Supabase bağlantısı/ilk admin kurulumu yapılmadan bu paket giriş ekranını açar ama kayıt işlemlerine izin vermez. `supabase-config.js` yerel şablondur; GitHub Actions yayın sırasında onu repository değişkenleriyle üretir.
- Herhangi bir gerçek Supabase projesine bağlantı ve uçtan uca Auth/Storage testi bu pakette yapılmamıştır. Canlıya geçmeden önce test projesinde kullanıcı oluşturma, giriş, iki tarayıcıda veri eşitleme, stok ve dosya yükleme/silme işlemlerini doğrulayın.
