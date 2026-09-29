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

## Önemli sınırlar

- GitHub Pages statik dosyaları genellikle herkes tarafından görülebilir. Güvenlik Supabase Auth, RLS ve sunucu fonksiyonlarıyla sağlanır; publishable key gizli değildir.
- Bu sürüm, eski uygulamanın büyük JSON `app_snapshots` modelini kullanır. Bu nedenle **eşzamanlı yönetici düzenlemelerinde sürüm çakışması** mümkündür. Çakışma hatası görülürse sayfayı yenileyip son bulut durumunu alın. Çok kullanıcılı yoğun operasyon için kayıtları ayrı tablolara taşıyan ikinci aşama gerekir.
- Sayfa görünürlüğü ve ayrıntılı silme izinleri halen arayüz seviyesindedir; monolitik snapshot'a yazma yetkisi olan yönetici teknik olarak tüm veriyi değiştirebilir. Hassas üretim kullanımından önce bunlar ayrı tablolarda sunucu tarafında da zorlanmalıdır.
- Supabase bağlantısı/ilk admin kurulumu yapılmadan bu paket giriş ekranını açar ama kayıt işlemlerine izin vermez. `supabase-config.js` yerel şablondur; GitHub Actions yayın sırasında onu repository değişkenleriyle üretir.
- Herhangi bir gerçek Supabase projesine bağlantı ve uçtan uca Auth/Storage testi bu pakette yapılmamıştır. Canlıya geçmeden önce test projesinde kullanıcı oluşturma, giriş, iki tarayıcıda veri eşitleme, stok ve dosya yükleme/silme işlemlerini doğrulayın.
