import React, { useState, useEffect } from 'react';
import { Box, TextField, Button, CircularProgress, InputAdornment, IconButton, Tooltip, FormControlLabel, Checkbox } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

const SettingsGeneral = () => {
    const [tmdbApiKey, setTmdbApiKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showApiKey, setShowApiKey] = useState(false);
    
    // Add state for log unmanaged endpoints
    const [logUnmanagedEndpoints, setLogUnmanagedEndpoints] = useState(false);
    const [isSavingLogSetting, setIsSavingLogSetting] = useState(false);

    // Fetch all settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                // Fetch TMDB API key
                const tmdbResponse = await axiosInstance.get(API_ENDPOINTS.settings.tmdbToken);
                setTmdbApiKey(tmdbResponse.data.value || '');
                
                // Fetch log unmanaged endpoints setting
                const logResponse = await axiosInstance.get('/api/settings/log_unmanaged_endpoints');
                setLogUnmanagedEndpoints(logResponse.data.value === true);
            } catch (error) {
                // handle error if needed
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSaveTmdbApiKey = async () => {
        setIsSaving(true);
        try {
            await axiosInstance.post(API_ENDPOINTS.settings.tmdbToken, { value: tmdbApiKey });
        } catch (error) {
            // handle error if needed
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveLogSetting = async () => {
        setIsSavingLogSetting(true);
        try {
            await axiosInstance.post('/api/settings/log_unmanaged_endpoints', { 
                value: logUnmanagedEndpoints 
            });
        } catch (error) {
            // handle error if needed
        } finally {
            setIsSavingLogSetting(false);
        }
    };

    if (isLoading) {
        return <CircularProgress />;
    }

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 4 }}>
                <TextField
                    label="TMDB API Key"
                    value={tmdbApiKey}
                    onChange={(e) => setTmdbApiKey(e.target.value)}
                    fullWidth
                    type={showApiKey ? 'text' : 'password'}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <Tooltip title={showApiKey ? 'Hide API key' : 'Show API key'}>
                                    <IconButton
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        edge="end"
                                        aria-label="toggle api key visibility"
                                    >
                                        {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                    </IconButton>
                                </Tooltip>
                            </InputAdornment>
                        )
                    }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSaveTmdbApiKey}
                    disabled={isSaving}
                    sx={{
                        minWidth: '48px',
                        width: '48px',
                        height: '56px',
                        p: 0
                    }}
                >
                    {isSaving ? <CircularProgress size={24} /> : <SaveIcon />}
                </Button>
            </Box>
            
            {/* Add checkbox for log unmanaged endpoints */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={logUnmanagedEndpoints}
                            onChange={(e) => {
                                setLogUnmanagedEndpoints(e.target.checked);
                                // Auto-save on change
                                setTimeout(() => {
                                    handleSaveLogSetting();
                                }, 0);
                            }}
                            disabled={isSavingLogSetting}
                        />
                    }
                    label="Log unmanaged endpoints"
                />
                {isSavingLogSetting && <CircularProgress size={20} />}
            </Box>
        </Box>
    );
};

export default SettingsGeneral;
