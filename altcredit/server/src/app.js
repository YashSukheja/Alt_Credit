const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { clientOrigins } = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const lenderRoutes = require('./routes/lender');

const app = express();

// helmet: sets safe HTTP headers (no MIME sniffing, no clickjacking, hides "X-Powered-By: Express")
app.use(helmet());

// CORS: browsers block calls from another origin (React on :5173 -> API on :5000) unless we allow it.
// Only the frontend URL(s) from .env are allowed, not "*".
app.use(cors({
  origin: clientOrigins,
  exposedHeaders: ['Content-Disposition'], // lets the frontend read the PDF file name
}));

app.use(requestLogger);                   // log every request
app.use(express.json({ limit: '1mb' }));  // parse JSON bodies

app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/users', userRoutes);
app.use('/lender', lenderRoutes);

app.use(notFound);      // must come after all routes
app.use(errorHandler);  // must be the very last middleware

module.exports = app;