# TODO List

## Web UI Issues

### Title Details

1. **Download URL Missing API Key**
   - Download URL of show episode or movie are being opened without the API key of the user

2. **Episode Details API Integration**
   - Episode details added to the main title, now we can add them to the API
   - Data available: name, air date, overview, and still path

3. **Watchlist State Refresh**
   - Refresh after clicking on add/remove from watchlist is not changing the state up until refresh

### Title List

1. **Watchlist State Refresh**
   - Refresh after clicking on add/remove from watchlist is not changing the state up until refresh

### Profile - Playlist Tab

1. **IPTV Syncer URL Update**
   - Adjust URLs of the repo once we will have new URL for the IPTV Syncer Deployment

2. **TV Shows Type Correction**
   - URL of playlist for TV shows changed, the type is not "shows" but "tvshows"

### Settings

1. **Remove Stats Tab**
   - Remove stats tab from settings

2. **TMDB Key Display Issue**
   - TMDB Key returns empty although it is available in the data

3. **IPTV Providers - Remove Priority Support**
   - No need to support priority and changing the priority in the UI and API
   - We can ignore that property when saving

4. **IPTV Providers - Grid View**
   - Instead of list of IPTV providers showing the menu, clicking on them opens the editor
   - Change to grid view of up to 4 cards in line
   - First card is "add new"
   - Clicking on add/edit will open the form above the grid
   - It will allow to cancel (close) or save if changed

5. **IPTV Provider - Ignored Titles Tab**
   - Add tab of Ignored titles listing the name of the title and the issue identified
   - In the future we will be able to remove it from the list

6. **IPTV Provider - Categories Search Filter**
   - Add UI only search for filter categories to be more focused
   - It will have also clear button to clean it
   - It should work in terms of responsiveness like the search of titles

## Web API Issues

1. **Playlist Endpoint Empty Response**
   - Playlist endpoint returns empty response

2. **Data Endpoint Empty Response**
   - Data endpoint returns empty response

