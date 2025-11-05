// Get the API URL from environment variables
// Defaults to relative /api for production (when UI is served from API server)
// For development with separate servers, set REACT_APP_API_URL=http://localhost:3000/api
export const API_URL = process.env.REACT_APP_API_URL || '/api';

// Add other configuration constants as needed
