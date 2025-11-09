import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Tabs, Tab, Typography, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SettingsUsers from './settings/SettingsUsers';
import SettingsGeneral from './settings/SettingsGeneral';
import SettingsIPTVProviders from './settings/SettingsIPTVProviders';
import SettingsJobs from './settings/SettingsJobs';
import { setActiveTab } from '../store/slices/settingsSlice';

function TabPanel({ children, value, index }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
    >
      {value === index && (
        <Box>
          {children}
        </Box>
      )}
    </div>
  );
}

const Settings = ({ open, onClose }) => {
  const dispatch = useDispatch();
  const activeTab = useSelector(state => state.settings.activeTab);

  const handleTabChange = (event, newValue) => {
    dispatch(setActiveTab(newValue));
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" component="span">Settings</Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              aria-label="settings tabs"
            >
              <Tab label="Users" />
              <Tab label="General" />
              <Tab label="IPTV Providers" />
              <Tab label="Jobs" />
            </Tabs>
          </Box>

          <TabPanel value={activeTab} index={0}>
            <SettingsUsers />
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <SettingsGeneral />
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <SettingsIPTVProviders />
          </TabPanel>

          <TabPanel value={activeTab} index={3}>
            <SettingsJobs />
          </TabPanel>

          {/* TMDBWatchlistImport component kept for potential future use */}
          {/* <TabPanel value={activeTab} index={2}>
            <TMDBWatchlistImport />
          </TabPanel> */}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default Settings;
