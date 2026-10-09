import { withSupabase } from 'npm:@supabase/server@^1'
import webpush from 'npm:web-push@3.6.7'

const allowedPushHosts = new Set(['fcm.googleapis.com'])

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'POST gerekli.' }, { status: 405 })
    // Veritabanı webhook'u yalnızca bu işleve özgü, düşük yetkili bir sır gönderir.
    // Supabase service/secret API anahtarı pg_net isteğine asla eklenmez.
    const expectedToken = Deno.env.get('WEB_PUSH_HOOK_TOKEN') || ''
    if (!expectedToken) return Response.json({ error: 'Webhook sırrı ayarlanmamış.' }, { status: 503 })
    const suppliedToken = req.headers.get('x-polat-push-token') || ''
    if (!suppliedToken) return Response.json({ error: 'Yetkisiz çağrı.' }, { status: 401 })
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
    const expectedDigest = await digest(expectedToken)
    const suppliedDigest = await digest(suppliedToken)
    let difference = 0
    for (let i = 0; i < expectedDigest.length; i++) difference |= expectedDigest[i] ^ suppliedDigest[i]
    if (difference !== 0) return Response.json({ error: 'Yetkisiz çağrı.' }, { status: 401 })
    let hook: any
    try { hook = await req.json() } catch { return Response.json({ error: 'Geçersiz JSON.' }, { status: 400 }) }
    if (hook?.type !== 'INSERT' || hook?.schema !== 'public' || hook?.table !== 'push_events' || !hook?.record?.id) {
      return Response.json({ error: 'Geçersiz veritabanı olayı.' }, { status: 400 })
    }

    const publicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY') || ''
    const privateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY') || ''
    if (!publicKey || !privateKey) return Response.json({ error: 'VAPID anahtarları ayarlanmamış.' }, { status: 503 })
    webpush.setVapidDetails('https://polatbakim.github.io/Polat-Bakim-360/', publicKey, privateKey)

    // Pending -> sending geçişi atomiktir; aynı webhook tekrar gelirse ikinci kez gönderilmez.
    const { data: event, error: claimError } = await ctx.supabaseAdmin.from('push_events')
      .update({ status: 'sending', attempts: Number(hook.record.attempts || 0) + 1 })
      .eq('id', hook.record.id).eq('status', 'pending')
      .select('id,recipient_id,kind,title,body,target_url').maybeSingle()
    if (claimError) return Response.json({ error: 'Bildirim alınamadı.' }, { status: 500 })
    if (!event) return Response.json({ ok: true, skipped: true })

    const fail = async (reason: string) => {
      await ctx.supabaseAdmin.from('push_events').update({ status: 'failed', last_error: reason }).eq('id', event.id)
      return Response.json({ ok: false, error: reason }, { status: 500 })
    }
    const { data: recipient, error: recipientError } = await ctx.supabaseAdmin.from('profiles')
      .select('id,active,must_change_password').eq('id', event.recipient_id).maybeSingle()
    if (recipientError || !recipient?.active || recipient.must_change_password) return fail('Alıcı hesabı aktif değil.')

    const { data: subscriptions, error: subscriptionError } = await ctx.supabaseAdmin.from('push_subscriptions')
      .select('endpoint,subscription').eq('user_id', event.recipient_id)
    if (subscriptionError) return fail('Telefon abonelikleri okunamadı.')
    if (!subscriptions?.length) return fail('Alıcının kayıtlı telefonu yok.')

    const payload = JSON.stringify({
      title: event.title,
      body: event.body,
      tag: `${event.kind}-${event.id}`,
      url: event.target_url,
    })
    let delivered = 0
    let failed = 0
    for (const item of subscriptions) {
      try {
        const url = new URL(item.endpoint)
        if (url.protocol !== 'https:' || !allowedPushHosts.has(url.hostname) || item.subscription?.endpoint !== item.endpoint) {
          failed++
          continue
        }
        await webpush.sendNotification(item.subscription, payload, { TTL: 60 * 60, urgency: 'high' })
        delivered++
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
        if (statusCode === 404 || statusCode === 410) {
          await ctx.supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', item.endpoint)
        } else {
          console.error('Web Push gönderimi başarısız:', statusCode || 'network error')
        }
        failed++
      }
    }
    await ctx.supabaseAdmin.from('push_events').update({
      status: delivered ? 'sent' : 'failed',
      sent_at: delivered ? new Date().toISOString() : null,
      last_error: failed ? `${failed} cihazda gönderim başarısız.` : '',
    }).eq('id', event.id)
    return Response.json({ ok: delivered > 0, delivered, failed })
  }),
}
