import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import requestRoutes from './routes/requests'
import notificationRoutes from './routes/notifications'
import userRoutes from './routes/users'
import projectRoutes from './routes/projects'
import activityRoutes from './routes/activity'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/requests', requestRoutes)
app.route('/api/notifications', notificationRoutes)
app.route('/api/users', userRoutes)
app.route('/api/projects', projectRoutes)
app.route('/api/activity', activityRoutes)

export default app
