import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function getAuthUser(db: D1Database, authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = await db.prepare(
    'SELECT s.expires_at, u.id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number; role: string }>()
  if (!session || new Date(session.expires_at) < new Date()) return null
  return session
}

const app = new Hono<{ Bindings: Bindings }>()

// GET /api/projects
app.get('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const projects = await c.env.DB.prepare(
    'SELECT * FROM projects ORDER BY name ASC'
  ).all()

  return c.json({ projects: projects.results })
})

// POST /api/projects (admin only)
app.post('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (user.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const { name, description } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'Название проекта обязательно' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO projects (name, description) VALUES (?, ?)'
  ).bind(name.trim(), description || null).run()

  return c.json({ message: 'Проект создан', id: result.meta.last_row_id }, 201)
})

// DELETE /api/projects/:id (admin only)
app.delete('/:id', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (user.role !== 'admin') return c.json({ error: 'Доступ запрещён' }, 403)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  return c.json({ message: 'Проект удалён' })
})

export default app
