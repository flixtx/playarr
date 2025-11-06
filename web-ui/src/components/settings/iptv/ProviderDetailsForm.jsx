import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

function ProviderDetailsForm({ provider, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    urls: [],
    username: '',
    password: '',
    type: 'xtream',
    enabled: true,
    cleanup: {}
  });
  const [newUrl, setNewUrl] = useState('');

  const handleSubmit = useCallback((e) => {
    if (e) e.preventDefault();

    // For Xtream: first URL goes to api_url, all URLs go to streams_urls
    // For AGTV: single URL to api_url, streams_urls array limited to 1
    const isXtream = formData.type.toLowerCase() === 'xtream';
    const urls = formData.urls.filter(url => url.trim() !== '');

    const data = {
      id: formData.id,
      streams_urls: isXtream ? urls : (urls.length > 0 ? [urls[0]] : []),
      api_url: urls.length > 0 ? urls[0] : '',
      username: formData.username,
      password: formData.password,
      type: formData.type.toLowerCase(),
      enabled: formData.enabled,
      cleanup: formData.cleanup || {}
    };

    onSave(data);
  }, [formData, onSave]);

  // Expose save handler
  useEffect(() => {
    ProviderDetailsForm.saveHandler = handleSubmit;
    return () => {
      ProviderDetailsForm.saveHandler = null;
    };
  }, [handleSubmit]);

  useEffect(() => {
    if (provider) {
      // Initialize urls from provider.streams_urls only
      const urls = provider.streams_urls || [];

      setFormData({
        id: provider.id || '',
        urls: urls,
        username: provider.username || '',
        password: provider.password || '',
        type: provider.type || 'xtream',
        enabled: provider.enabled ?? true,
        cleanup: provider.cleanup || {}
      });
    } else {
      // New provider - reset form
      setFormData({
        id: '',
        urls: [],
        username: '',
        password: '',
        type: 'xtream',
        enabled: true,
        cleanup: {}
      });
      setNewUrl('');
    }
  }, [provider]);

  const handleChange = (e) => {
    const value = e.target.name === 'type' ? e.target.value.toLowerCase() : e.target.value;
    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  const handleToggleEnabled = (e) => {
    setFormData({
      ...formData,
      enabled: e.target.checked,
    });
  };

  const handleAddUrl = () => {
    if (newUrl.trim()) {
      setFormData({
        ...formData,
        urls: [...formData.urls, newUrl.trim()]
      });
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (index) => {
    const newUrls = formData.urls.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      urls: newUrls
    });
  };

  const isXtream = formData.type?.toLowerCase() === 'xtream';
  const isNewProvider = !provider?.id;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {isNewProvider && (
        <TextField
          name="id"
          label="Provider ID"
          value={formData.id}
          onChange={handleChange}
          fullWidth
          required
          helperText="Unique identifier for this provider (required)"
        />
      )}
      <FormControl fullWidth required>
        <InputLabel>Type</InputLabel>
        <Select
          name="type"
          value={formData.type.toLowerCase()}
          onChange={handleChange}
          label="Type"
          disabled={!isNewProvider}
        >
          <MenuItem value="agtv">AGTV</MenuItem>
          <MenuItem value="xtream">Xtream</MenuItem>
        </Select>
      </FormControl>

      {isXtream ? (
        <>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Server URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              fullWidth
              placeholder="https://example.com:8080"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddUrl();
                }
              }}
            />
            <IconButton
              onClick={handleAddUrl}
              color="primary"
              disabled={!newUrl.trim()}
              sx={{ minWidth: 56 }}
            >
              <AddIcon />
            </IconButton>
          </Box>

          {formData.urls.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1 }}>
              <InputLabel sx={{ ml: 1, mb: 1 }}>Server URLs (first is used for API calls)</InputLabel>
              <List dense>
                {formData.urls.map((url, index) => (
                  <ListItem
                    key={index}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => handleRemoveUrl(index)}
                        color="error"
                        title="Remove"
                      >
                        <DeleteIcon />
                      </IconButton>
                    }
                    sx={{
                      bgcolor: index === 0 ? 'action.selected' : 'transparent',
                      borderRadius: 1,
                      mb: 0.5
                    }}
                  >
                    <ListItemText
                      primary={index === 0 ? `${url} (API)` : url}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: index === 0 ? 'bold' : 'normal'
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}
        </>
      ) : (
        <TextField
          name="url"
          label="URL"
          value={formData.urls[0] || ''}
          onChange={(e) => {
            setFormData({
              ...formData,
              urls: [e.target.value]
            });
          }}
          fullWidth
          required
        />
      )}
      <TextField
        name="username"
        label="Username"
        value={formData.username}
        onChange={handleChange}
        fullWidth
        required
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        value={formData.password}
        onChange={handleChange}
        fullWidth
        required
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={formData.enabled}
            onChange={handleToggleEnabled}
            name="enabled"
          />
        }
        label="Enabled"
      />
    </Box>
  );
}

// Expose save handler via static property
ProviderDetailsForm.saveHandler = null;

export default ProviderDetailsForm;
