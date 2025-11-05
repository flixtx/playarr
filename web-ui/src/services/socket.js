import { io } from 'socket.io-client';
import { API_URL } from '../config/index';

class SocketService {
    constructor() {
        this.socket = null;
        this.apiSocket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;  // Maximum number of reconnection attempts
        this.reconnectDelay = 1000;      // Initial delay in milliseconds
        this.maxReconnectDelay = 30000;  // Maximum delay in milliseconds
    }

    /**
     * Get base URL for Socket.IO connections (without /api path)
     */
    _getBaseUrl() {
        // If API_URL is relative, use current origin
        if (API_URL.startsWith('/')) {
            return window.location.origin;
        }
        // If API_URL is absolute, remove /api suffix if present
        if (API_URL.endsWith('/api')) {
            return API_URL.slice(0, -4);
        }
        // Return API_URL as-is (assuming it's already a base URL)
        return API_URL;
    }

    connect() {
        if (this.socket) return;

        const baseUrl = this._getBaseUrl();
        const socketOptions = {
            path: '/socket.io',
            transports: ['websocket', 'polling'],  // Allow both WebSocket and polling
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: this.maxReconnectDelay,
            randomizationFactor: 0.5,  // Add some randomization to prevent thundering herd
            timeout: 10000,            // Increased timeout to 10 seconds
            forceNew: true,            // Force a new connection
            autoConnect: true,         // Automatically connect
            upgrade: true,             // Allow transport upgrade
            rememberUpgrade: true,     // Remember transport upgrade
            pingTimeout: 60000,        // Match server ping timeout
            pingInterval: 25000,       // Match server ping interval
        };

        // Connect to default namespace
        this.socket = io(baseUrl, socketOptions);

        // Connect to API namespace - append /api to the base URL
        const apiNamespaceUrl = baseUrl.endsWith('/') 
            ? `${baseUrl}api` 
            : `${baseUrl}/api`;
        this.apiSocket = io(apiNamespaceUrl, socketOptions);

        // Default namespace event handlers
        this.socket.on('connect', () => {
            console.log('Connected to default namespace');
            this.reconnectAttempts = 0;
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from default namespace:', reason);
            if (reason !== 'io client disconnect') {
                this.reconnectAttempts++;
                console.log(`Reconnection attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts}`);
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error('Default namespace connection error:', error);
        });

        // API namespace event handlers
        this.apiSocket.on('connect', () => {
            console.log('Connected to API namespace');
        });

        this.apiSocket.on('disconnect', (reason) => {
            console.log('Disconnected from API namespace:', reason);
        });

        this.apiSocket.on('connect_error', (error) => {
            console.error('API namespace connection error:', error);
        });

        // Common error handlers
        const setupErrorHandlers = (socket, namespace) => {
            socket.on('error', (error) => {
                console.error(`${namespace} error:`, error);
            });

            socket.io.on('error', (error) => {
                console.error(`${namespace} transport error:`, error);
            });

            socket.io.on('upgrade', (transport) => {
                console.log(`${namespace} transport upgraded to:`, transport.name);
            });

            socket.io.on('reconnect_attempt', (attemptNumber) => {
                console.log(`${namespace} attempting to reconnect (${attemptNumber}/${this.maxReconnectAttempts})`);
            });

            socket.io.on('reconnect_failed', () => {
                console.error(`${namespace} failed to reconnect after maximum attempts`);
            });
        };

        setupErrorHandlers(this.socket, 'Default namespace');
        setupErrorHandlers(this.apiSocket, 'API namespace');
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        if (this.apiSocket) {
            this.apiSocket.disconnect();
            this.apiSocket = null;
        }
        this.reconnectAttempts = 0;
    }

    // Helper method to check if socket is connected
    isConnected() {
        return (this.socket && this.socket.connected) || (this.apiSocket && this.apiSocket.connected);
    }

    // Helper method to get current connection status
    getConnectionStatus() {
        if (!this.socket && !this.apiSocket) return 'disconnected';
        if ((this.socket && this.socket.connected) || (this.apiSocket && this.apiSocket.connected)) {
            return 'connected';
        }
        return 'connecting';
    }
}

export const socketService = new SocketService();
