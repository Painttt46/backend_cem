/**
 * Success response helper
 * @param {any} data - Response data
 * @param {string} message - Success message
 * @param {Object} meta - Additional metadata
 * @returns {Object} Standardized success response
 */
export const successResponse = (data, message = 'Success', meta = {}) => {
  return {
    success: true,
    message,
    data,
    ...meta,
    timestamp: new Date().toISOString()
  }
}

/**
 * Error response helper
 * @param {string|Error} error - Error message or Error object
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Standardized error response
 */
export const errorResponse = (error, statusCode = 500) => {
  const message = error instanceof Error ? error.message : error
  
  return {
    success: false,
    error: message,
    statusCode,
    timestamp: new Date().toISOString()
  }
}

/**
 * Paginated response helper
 * @param {Array} data - Response data
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 * @returns {Object} Standardized paginated response
 */
export const paginatedResponse = (data, page, limit, total) => {
  const totalPages = Math.ceil(total / limit)
  
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * Validation error response helper
 * @param {Object} errors - Validation errors object
 * @returns {Object} Standardized validation error response
 */
export const validationErrorResponse = (errors) => {
  return {
    success: false,
    error: 'Validation failed',
    errors,
    statusCode: 422,
    timestamp: new Date().toISOString()
  }
}
