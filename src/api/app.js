const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const ApiResponse = require('./utils/response');

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check
app.get('/health', (req, res) => {
  return ApiResponse.success(res, { status: 'OK', timestamp: new Date() });
});

// API Routes
app.use('/api/v1', require('./routes'));

// 404 Handler
app.use((req, res) => {
  return ApiResponse.error(res, 'Resource not found', 404);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Error]', err);
  return ApiResponse.error(res, err.message || 'Internal Server Error', err.status || 500);
});

module.exports = app;
