import { withSupabase } from 'npm:@supabase/server@^1'

type UserInput = {
  id?: string
  email: string
  password?: string
  fullName: string
  specialty?: string
  phone?: string
  hourlyRate?: number
  operatorAccess: boolean
  managerAccess: boolean
  isAdmin: boolean
  visiblePages?: string[]
  deletePermissions?: Record<string, boolean>
}

const reply = (message: string, status = 400) => Response.json({ error: message }, { status })
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return reply('Yalnızca POST kullanılabilir.', 405)
    const callerId = ctx.userClaims?.id
    if (!callerId) return reply('Oturum bulunamadı.', 401)
    const { data: caller, error: callerError } = await ctx.supabase
      .from('profiles').select('id,is_admin,manager_access,active').eq('id', callerId).single()
    if (callerError || !caller?.active || !caller.manager_access || !caller.is_admin) {
      return reply('Bu işlem için Admin Yönetici yetkisi gerekir.', 403)
    }

    let body: { action?: string; user?: UserInput; id?: string }
    try { body = await req.json() } catch { return reply('Geçerli bir JSON gönderin.') }
    const admin = ctx.supabaseAdmin
    if (body.action === 'disable') {
      const id = String(body.id || '')
      if (!id || id === callerId) return reply('Kendi hesabınızı silemezsiniz.')
      const { data: target, error } = await admin.from('profiles')
        .select('id,is_admin,active').eq('id', id).single()
      if (error || !target) return reply('Kullanıcı bulunamadı.', 404)
      if (target.is_admin && target.active) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
          .eq('is_admin', true).eq('active', true)
        if ((count || 0) < 2) return reply('Son Admin Yönetici kaldırılamaz.')
      }
      const { error: profileError } = await admin.from('profiles').update({ active: false })
        .eq('id', id)
      if (profileError) return reply(profileError.message, 500)
      const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
      if (banError) return reply(banError.message, 500)
      return Response.json({ ok: true, id })
    }

    if (body.action !== 'upsert' || !body.user) return reply('Geçersiz işlem.')
    const user = body.user
    const email = String(user.email || '').trim().toLowerCase()
    const fullName = String(user.fullName || '').trim()
    if (!emailPattern.test(email) || !fullName) return reply('Ad soyad ve geçerli e-posta zorunludur.')
    if (!user.operatorAccess && !user.managerAccess) return reply('En az bir giriş türü seçin.')
    if (user.isAdmin && !user.managerAccess) return reply('Admin Yönetici için yönetici girişi gereklidir.')
    if (user.password && user.password.length < 8) return reply('Şifre en az 8 karakter olmalıdır.')
    if (!user.id && !user.password) return reply('Yeni kullanıcı için şifre zorunludur.')

    let id = user.id || ''
    let previous: Record<string, unknown> | null = null
    if (id) {
      const { data, error } = await admin.from('profiles').select('*').eq('id', id).single()
      if (error || !data) return reply('Kullanıcı bulunamadı.', 404)
      previous = data
      if (id === callerId && !user.isAdmin) return reply('Kendi Admin Yönetici yetkinizi kaldıramazsınız.')
      if (previous.is_admin && !user.isAdmin && previous.active) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
          .eq('is_admin', true).eq('active', true)
        if ((count || 0) < 2) return reply('Son Admin Yönetici yetkisi kaldırılamaz.')
      }
      const authChanges: Record<string, string> = {}
      if (email !== previous.email) authChanges.email = email
      if (user.password) authChanges.password = user.password
      if (!previous.active) authChanges.ban_duration = 'none'
      if (Object.keys(authChanges).length) {
        const { error } = await admin.auth.admin.updateUserById(id, authChanges)
        if (error) return reply(error.message, 400)
      }
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: user.password, email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error || !data.user) return reply(error?.message || 'Kullanıcı oluşturulamadı.', 400)
      id = data.user.id
    }

    const technicianId = user.operatorAccess
      ? String(previous?.technician_id || `T-${id.slice(0,8)}`) : null
    const profile = {
      id, email, full_name: fullName,
      role: user.managerAccess ? 'manager' : 'operator',
      manager_access: !!user.managerAccess, operator_access: !!user.operatorAccess,
      is_admin: !!user.isAdmin, active: true, technician_id: technicianId,
      specialty: String(user.specialty || '').trim(), phone: String(user.phone || '').trim(),
      hourly_rate: Number(user.hourlyRate || 0),
      visible_pages: user.isAdmin ? [] : (user.visiblePages || []),
      delete_permissions: user.deletePermissions || {}, updated_at: new Date().toISOString(),
    }
    const { error: profileError } = await admin.from('profiles').upsert(profile)
    if (profileError) {
      if (!previous) await admin.auth.admin.deleteUser(id)
      return reply(profileError.message, 500)
    }
    return Response.json({ ok: true, id, technicianId })
  }),
}
