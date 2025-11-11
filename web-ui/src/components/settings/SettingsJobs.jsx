import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Chip,
    Alert,
    IconButton,
    Tooltip,
    Grid
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

/**
 * Format date for display
 */
const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    try {
        const date = new Date(dateString);
        return date.toLocaleString();
    } catch (error) {
        return 'Invalid date';
    }
};

/**
 * Get status color for chip
 */
const getStatusColor = (status) => {
    switch (status) {
        case 'running':
            return 'info';
        case 'completed':
            return 'success';
        case 'failed':
            return 'error';
        case 'cancelled':
            return 'warning';
        default:
            return 'default';
    }
};

/**
 * Format job result for display
 */
const formatJobResult = (jobName, lastResult) => {
    if (!lastResult) return null;

    if (jobName === 'syncIPTVProviderTitles' && Array.isArray(lastResult.results)) {
        const totalMovies = lastResult.results.reduce((sum, r) => sum + (r.movies || 0), 0);
        const totalTvShows = lastResult.results.reduce((sum, r) => sum + (r.tvShows || 0), 0);
        return `Processed ${lastResult.providers_processed || 0} provider(s): ${totalMovies} movies, ${totalTvShows} TV shows`;
    }

    return JSON.stringify(lastResult);
};

/**
 * Job card component
 */
const JobCard = ({ job }) => {
    return (
        <Paper
            elevation={2}
            sx={{
                p: 3,
                mb: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" gutterBottom>
                        {job.name} ({job.schedule})
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        {job.description}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip
                        label={job.status || 'unknown'}
                        color={getStatusColor(job.status)}
                        size="small"
                    />
                </Box>
            </Box>

            <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="text.secondary">
                        Last Execution:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {formatDate(job.lastExecution)}
                    </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="text.secondary">
                        Last Update:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {formatDate(job.lastUpdated)}
                    </Typography>
                </Grid>
                {job.lastResult && (
                    <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">
                            Last Result:
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {formatJobResult(job.name, job.lastResult)}
                        </Typography>
                    </Grid>
                )}
                {job.lastError && (
                    <Grid item xs={12}>
                        <Alert severity="error" sx={{ mt: 1 }}>
                            <Typography variant="body2">
                                <strong>Error:</strong> {job.lastError}
                            </Typography>
                        </Alert>
                    </Grid>
                )}
            </Grid>
        </Paper>
    );
};

/**
 * SettingsJobs component
 * Displays list of engine jobs with details (job triggering removed)
 */
const SettingsJobs = () => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [engineReachable, setEngineReachable] = useState(true);

    /**
     * Fetch jobs from API
     */
    const fetchJobs = async () => {
        try {
            setError(null);
            // Add cache-busting parameter to ensure fresh request
            const response = await axiosInstance.get(API_ENDPOINTS.jobs, {
                params: { _t: Date.now() }
            });
            setJobs(response.data.jobs || []);
            
            // Check if engine is not reachable (even if status is 200, check the data)
            if (response.data.engineReachable === false) {
                setEngineReachable(false);
                setError(null); // Don't show error, only show warning
            } else {
                setEngineReachable(true);
            }
        } catch (err) {
            console.error('Error fetching jobs:', err);
            
            // Check if error is specifically about engine not being reachable
            // This happens when web-api returns 503 with engineReachable: false
            const responseData = err.response?.data;
            const statusCode = err.response?.status;
            const errorMessage = responseData?.error || err.message;
            
            // Check for engine unreachable conditions:
            // 1. Response explicitly says engineReachable: false
            // 2. Error message mentions engine not reachable
            // 3. Status code is 503 (Service Unavailable) - engine unreachable
            // 4. Status code is 404 (Not found) - might indicate engine/server issue
            // 5. Network errors (ECONNREFUSED, ETIMEDOUT) when trying to reach engine
            const isEngineUnreachable = 
                responseData?.engineReachable === false || 
                errorMessage === 'Engine API is not reachable' ||
                errorMessage?.includes('Engine API') ||
                statusCode === 503 ||
                (statusCode === 404 && errorMessage === 'Not found') ||
                err.code === 'ECONNREFUSED' ||
                err.code === 'ETIMEDOUT';
            
            if (isEngineUnreachable) {
                // Don't show error for engine unreachable - only show warning
                setEngineReachable(false);
                setError(null); // Explicitly clear error
                setJobs(responseData?.jobs || []); // Still show jobs from history if available
            } else {
                // Show error for other failures (but not for engine unreachable)
                setEngineReachable(true); // Assume engine is reachable for other errors
                setError(errorMessage || 'Failed to fetch jobs');
            }
        } finally {
            setLoading(false);
        }
    };

    /**
     * Manual refresh
     */
    const handleRefresh = () => {
        setLoading(true);
        fetchJobs();
    };

    // Clear error when engine becomes unreachable
    useEffect(() => {
        if (!engineReachable) {
            setError(null);
        }
    }, [engineReachable]);

    // Initial fetch and auto-refresh setup
    useEffect(() => {
        fetchJobs();

        // Auto-refresh every 10 seconds
        const interval = setInterval(() => {
            fetchJobs();
        }, 10000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    if (loading && jobs.length === 0) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    Engine Jobs
                </Typography>
                <Tooltip title="Refresh">
                    <span>
                        <IconButton 
                            onClick={handleRefresh} 
                            color="primary"
                            disabled={loading}
                        >
                            {loading ? (
                                <CircularProgress size={20} />
                            ) : (
                                <RefreshIcon />
                            )}
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>

            {!engineReachable && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    Engine API is not reachable. You can view job history.
                </Alert>
            )}

            {error && engineReachable && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {jobs.length === 0 && engineReachable ? (
                <Typography variant="body2" color="text.secondary">
                    No jobs found.
                </Typography>
            ) : jobs.length > 0 ? (
                <Grid container spacing={2}>
                    {jobs.map((job) => (
                        <Grid item xs={12} md={4} key={job.name}>
                            <JobCard job={job} />
                        </Grid>
                    ))}
                </Grid>
            ) : null}
        </Box>
    );
};

export default SettingsJobs;

