require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const childrenRoutes = require('./routes/children');
const storiesRoutes = require('./routes/stories');
const { router: stripeRoutes, handleWebhook } = require('./routes/stripe');
const { startScheduler } = require('./services/scheduler');

const app = express();

app.use(cors());

// IMPORTANT: the Stripe webhook needs the raw request body to verify the
// signature, so it must be mounted BEFORE express.json(). If you add
// express.json() first, webhook signature verification will fail.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/children', childrenRoutes);
app.use('/api/children', storiesRoutes); // mounts GET /api/children/:childId/stories
app.use('/api/stripe', stripeRoutes);

// Serve the marketing site + dashboard/login pages as static files.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`StarryTales API running on port ${PORT}`);
  if (process.env.ENABLE_SCHEDULER !== 'false') {
    startScheduler();
  }
});
