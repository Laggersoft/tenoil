import { Hono } from 'hono'

type Bindings = { DB: D1Database }

interface User {
  id: number
  username: string
  email: string
  role: string
  full_name: string
  is_blocked: number
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getAuthUser(db: D1Database, authHeader: string | undefined): Promise<User | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = await db.prepare(
    'SELECT s.expires_at, u.id, u.username, u.email, u.role, u.full_name, u.is_blocked FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number; username: string; email: string; role: string; full_name: string; is_blocked: number }>()
  if (!session || new Date(session.expires_at) < new Date()) return null
  return {
    id: session.id,
    username: session.username,
    email: session.email,
    role: session.role,
    full_name: session.full_name,
    is_blocked: session.is_blocked
  }
}

const app = new Hono<{ Bindings: Bindings }>()

// GET /api/users - список всех пользователей (только admin)
app.get('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (user.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const users = await c.env.DB.prepare(
    'SELECT id, username, email, role, full_name, is_blocked, phone, position, created_at FROM users ORDER BY created_at DESC'
  ).all()

  return c.json({ users: users.results })
})

// POST /api/users - создать пользователя (только admin)
app.post('/', async (c) => {
  const admin = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Не авторизован' }, 401)
  if (admin.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const { username, email, password, role, full_name } = await c.req.json()

  if (!username || !email || !password || !role || !full_name) {
    return c.json({ error: 'Все поля обязательны' }, 400)
  }

  if (!['applicant', 'supplier'].includes(role)) {
    return c.json({ error: 'Недопустимая роль (допустимы: applicant, supplier)' }, 400)
  }

  if (password.length < 6) {
    return c.json({ error: 'Пароль должен быть не менее 6 символов' }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).bind(username, email).first()

  if (existing) {
    return c.json({ error: 'Пользователь с таким логином или email уже существует' }, 409)
  }

  const passwordHash = await hashPassword(password)

  const result = await c.env.DB.prepare(
    'INSERT INTO users (username, email, password_hash, role, full_name, is_blocked) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(username, email, passwordHash, role, full_name).run()

  return c.json({ message: 'Пользователь создан', userId: result.meta.last_row_id }, 201)
})

// PUT /api/users/:id - редактировать пользователя (только admin)
app.put('/:id', async (c) => {
  const admin = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Не авторизован' }, 401)
  if (admin.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const id = c.req.param('id')
  const { email, role, full_name, password } = await c.req.json()

  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first<{ id: number; role: string }>()
  if (!target) return c.json({ error: 'Пользователь не найден' }, 404)
  if (target.role === 'admin') return c.json({ error: 'Нельзя изменить учётную запись администратора' }, 403)

  if (role && !['applicant', 'supplier'].includes(role)) {
    return c.json({ error: 'Недопустимая роль' }, 400)
  }

  let query = 'UPDATE users SET'
  const params: (string | number)[] = []
  const parts: string[] = []

  if (full_name) { parts.push(' full_name = ?'); params.push(full_name) }
  if (email) { parts.push(' email = ?'); params.push(email) }
  if (role) { parts.push(' role = ?'); params.push(role) }
  if (password) {
    if (password.length < 6) return c.json({ error: 'Пароль должен быть не менее 6 символов' }, 400)
    const hash = await hashPassword(password)
    parts.push(' password_hash = ?')
    params.push(hash)
  }

  if (!parts.length) return c.json({ error: 'Нет данных для обновления' }, 400)

  query += parts.join(',') + ' WHERE id = ?'
  params.push(parseInt(id))

  await c.env.DB.prepare(query).bind(...params).run()

  return c.json({ message: 'Пользователь обновлён' })
})

// PATCH /api/users/:id/block - блокировка/разблокировка (только admin)
app.patch('/:id/block', async (c) => {
  const admin = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Не авторизован' }, 401)
  if (admin.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const id = c.req.param('id')
  if (parseInt(id) === admin.id) return c.json({ error: 'Нельзя заблокировать себя' }, 400)

  const target = await c.env.DB.prepare('SELECT id, role, is_blocked FROM users WHERE id = ?').bind(id).first<{ id: number; role: string; is_blocked: number }>()
  if (!target) return c.json({ error: 'Пользователь не найден' }, 404)
  if (target.role === 'admin') return c.json({ error: 'Нельзя заблокировать администратора' }, 403)

  const newBlocked = target.is_blocked ? 0 : 1
  await c.env.DB.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').bind(newBlocked, id).run()

  // Invalidate sessions if blocking
  if (newBlocked) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  }

  return c.json({ message: newBlocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован', is_blocked: newBlocked })
})

// DELETE /api/users/:id - удалить пользователя (только admin)
app.delete('/:id', async (c) => {
  const admin = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Не авторизован' }, 401)
  if (admin.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const id = c.req.param('id')
  if (parseInt(id) === admin.id) return c.json({ error: 'Нельзя удалить себя' }, 400)

  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first<{ id: number; role: string }>()
  if (!target) return c.json({ error: 'Пользователь не найден' }, 404)
  if (target.role === 'admin') return c.json({ error: 'Нельзя удалить администратора' }, 403)

  // Delete sessions
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  // Delete user
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()

  return c.json({ message: 'Пользователь удалён' })
})

// GET /api/users/suppliers - список снабженцев
app.get('/suppliers', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Не авторизован' }, 401)
  const token = authHeader.slice(7)
  const session = await c.env.DB.prepare(
    'SELECT s.expires_at, u.id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number }>()
  if (!session || new Date(session.expires_at) < new Date()) return c.json({ error: 'Не авторизован' }, 401)

  const suppliers = await c.env.DB.prepare(
    'SELECT id, username, full_name FROM users WHERE role = ? AND is_blocked = 0'
  ).bind('supplier').all()

  return c.json({ suppliers: suppliers.results })
})

export default app
