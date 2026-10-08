const express = require('express');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');  

const app = express();

app.use(requestLogger);                   // first, so every request is logged
app.use(express.json({ limit: '1mb' }));

app.use('/health', healthRoutes);
app.use('/health', healthRoutes);
app.use('/admin', adminRoutes);
// more routes get added here in later steps

app.use(notFound);      // must come after all routes
app.use(errorHandler);  // must be the very last middleware

module.exports = app;