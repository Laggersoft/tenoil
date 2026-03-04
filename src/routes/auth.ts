import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function generateSessionId(): Promise<string> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

interface SessionUser {
  id: number
  username: string
  email: string
  role: string
  full_name: string
  is_blocked: number
  phone: string | null
  avatar: string | null
  position: string | null
}

async function getAuthUser(db: D1Database, authHeader: string | undefined): Promise<SessionUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = await db.prepare(
    `SELECT s.expires_at, u.id, u.username, u.email, u.role, u.full_name, u.is_blocked,
            u.phone, u.avatar, u.position
     FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?`
  ).bind(token).first<{ expires_at: string } & SessionUser>()
  if (!session || new Date(session.expires_at) < new Date()) return null
  return {
    id: session.id,
    username: session.username,
    email: session.email,
    role: session.role,
    full_name: session.full_name,
    is_blocked: session.is_blocked,
    phone: session.phone,
    avatar: session.avatar,
    position: session.position,
  }
}

const app = new Hono<{ Bindings: Bindings }>()

// POST /api/auth/login
app.post('/login', async (c) => {
  const { username, password } = await c.req.json()
  if (!username || !password) return c.json({ error: 'Введите логин и пароль' }, 400)

  const passwordHash = await hashPassword(password)
  const user = await c.env.DB.prepare(
    `SELECT id, username, email, role, full_name, is_blocked, phone, avatar, position
     FROM users WHERE username = ? AND password_hash = ?`
  ).bind(username, passwordHash).first<SessionUser>()

  if (!user) return c.json({ error: 'Неверный логин или пароль' }, 401)
  if (user.is_blocked) return c.json({ error: 'Ваш аккаунт заблокирован' }, 403)

  const sessionId = await generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run()

  return c.json({
    token: sessionId,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
      phone: user.phone,
      avatar: user.avatar,
      position: user.position,
    }
  })
})

// POST /api/auth/logout
app.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run()
  }
  return c.json({ message: 'Вышли из системы' })
})

// GET /api/auth/me
app.get('/me', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  return c.json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    phone: user.phone,
    avatar: user.avatar,
    position: user.position,
  })
})

// GET /api/auth/profile — получить свой профиль
app.get('/profile', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  return c.json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    phone: user.phone,
    avatar: user.avatar,
    position: user.position,
  })
})

// PUT /api/auth/profile — обновить свой профиль
app.put('/profile', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const body = await c.req.json()
  const { full_name, email, phone, position, avatar, current_password, new_password } = body

  const parts: string[] = []
  const params: (string | number | null)[] = []

  if (full_name !== undefined) {
    if (!full_name.trim()) return c.json({ error: 'ФИО не может быть пустым' }, 400)
    parts.push('full_name = ?'); params.push(full_name.trim())
  }

  if (email !== undefined) {
    if (!email.trim()) return c.json({ error: 'Email не может быть пустым' }, 400)
    // Check uniqueness
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND id != ?'
    ).bind(email.trim(), user.id).first()
    if (existing) return c.json({ error: 'Email уже занят' }, 409)
    parts.push('email = ?'); params.push(email.trim())
  }

  if (phone !== undefined) {
    parts.push('phone = ?'); params.push(phone ? phone.trim() : null)
  }

  if (position !== undefined) {
    parts.push('position = ?'); params.push(position ? position.trim() : null)
  }

  // Avatar: base64 string (max ~500KB)
  if (avatar !== undefined) {
    if (avatar && avatar.length > 700000) {
      return c.json({ error: 'Размер аватара не должен превышать 500KB' }, 400)
    }
    parts.push('avatar = ?'); params.push(avatar || null)
  }

  // Password change
  if (new_password) {
    if (!current_password) return c.json({ error: 'Введите текущий пароль' }, 400)
    if (new_password.length < 6) return c.json({ error: 'Новый пароль должен быть не менее 6 символов' }, 400)

    const currentHash = await hashPassword(current_password)
    const check = await c.env.DB.prepare(
      'SELECT id FROM users WHERE id = ? AND password_hash = ?'
    ).bind(user.id, currentHash).first()
    if (!check) return c.json({ error: 'Неверный текущий пароль' }, 400)

    const newHash = await hashPassword(new_password)
    parts.push('password_hash = ?'); params.push(newHash)
  }

  if (!parts.length) return c.json({ error: 'Нет данных для обновления' }, 400)

  params.push(user.id)
  await c.env.DB.prepare(
    `UPDATE users SET ${parts.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  // Return updated profile
  const updated = await c.env.DB.prepare(
    'SELECT id, username, email, role, full_name, phone, avatar, position FROM users WHERE id = ?'
  ).bind(user.id).first()

  return c.json({ message: 'Профиль обновлён', user: updated })
})

export default app
