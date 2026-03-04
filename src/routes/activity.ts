import { Hono } from 'hono'

type Bindings = { DB: D1Database }

interface User {
  id: number
  username: string
  email: string
  role: string
  full_name: string
}

async function getAuthUser(db: D1Database, authHeader: string | undefined): Promise<User | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const session = await db.prepare(
    'SELECT s.expires_at, u.id, u.username, u.email, u.role, u.full_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number; username: string; email: string; role: string; full_name: string }>()

  if (!session || new Date(session.expires_at) < new Date()) return null

  return {
    id: session.id,
    username: session.username,
    email: session.email,
    role: session.role,
    full_name: session.full_name
  }
}

const app = new Hono<{ Bindings: Bindings }>()

// ============================================================
// GET ACTIVITY LOG (admin + supplier)
// ============================================================
app.get('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (!['admin', 'supplier'].includes(user.role)) return c.json({ error: 'Доступ запрещён' }, 403)

  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const action_filter = c.req.query('action')
  const user_filter = c.req.query('user_id')
  const date_from = c.req.query('date_from')
  const date_to = c.req.query('date_to')

  let query = `
    SELECT 
      h.id, h.request_id, h.action, h.old_value, h.new_value, h.comment, h.created_at,
      u.full_name as actor_name, u.role as actor_role, u.username as actor_username,
      r.product_name, r.model, r.request_number
    FROM request_status_history h
    JOIN users u ON h.changed_by = u.id
    JOIN requests r ON h.request_id = r.id
    WHERE 1=1
  `
  let params: (string | number)[] = []

  if (action_filter && action_filter !== 'all') {
    query += ' AND h.action = ?'
    params.push(action_filter)
  }
  if (user_filter) {
    query += ' AND h.changed_by = ?'
    params.push(parseInt(user_filter))
  }
  if (date_from) {
    query += ' AND h.created_at >= ?'
    params.push(date_from)
  }
  if (date_to) {
    query += ' AND h.created_at <= ?'
    params.push(date_to + 'T23:59:59')
  }

  query += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const results = await c.env.DB.prepare(query).bind(...params).all()

  // Count total
  let countQuery = `
    SELECT COUNT(*) as total
    FROM request_status_history h
    JOIN users u ON h.changed_by = u.id
    JOIN requests r ON h.request_id = r.id
    WHERE 1=1
  `
  let countParams: (string | number)[] = []
  if (action_filter && action_filter !== 'all') { countQuery += ' AND h.action = ?'; countParams.push(action_filter) }
  if (user_filter) { countQuery += ' AND h.changed_by = ?'; countParams.push(parseInt(user_filter)) }
  if (date_from) { countQuery += ' AND h.created_at >= ?'; countParams.push(date_from) }
  if (date_to) { countQuery += ' AND h.created_at <= ?'; countParams.push(date_to + 'T23:59:59') }

  const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()

  return c.json({
    activity: results.results,
    total: countResult?.total || 0,
    limit,
    offset
  })
})

// ============================================================
// GET ACTIVITY STATS
// ============================================================
app.get('/stats', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (!['admin', 'supplier'].includes(user.role)) return c.json({ error: 'Доступ запрещён' }, 403)

  const [created, statusChanged, fileAdded, priorityChanged, total] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM request_status_history WHERE action = 'created'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM request_status_history WHERE action = 'status_changed'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM request_status_history WHERE action = 'file_added'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM request_status_history WHERE action = 'priority_changed'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM request_status_history").first<{ count: number }>(),
  ])

  // Top 5 most active users
  const topUsers = await c.env.DB.prepare(`
    SELECT u.full_name, u.role, COUNT(*) as actions
    FROM request_status_history h
    JOIN users u ON h.changed_by = u.id
    GROUP BY h.changed_by
    ORDER BY actions DESC
    LIMIT 5
  `).all()

  return c.json({
    total: total?.count || 0,
    created: created?.count || 0,
    status_changed: statusChanged?.count || 0,
    file_added: fileAdded?.count || 0,
    priority_changed: priorityChanged?.count || 0,
    top_users: topUsers.results
  })
})

export default app
