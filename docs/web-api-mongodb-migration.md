# Web API MongoDB Migration Plan

This document describes the migration of the Playarr Web API from file-based storage to MongoDB, including architecture changes, implementation details, and API compatibility.

## Table of Contents

1. [Overview](#overview)
2. [Current Architecture](#current-architecture)
3. [New MongoDB Architecture](#new-mongodb-architecture)
4. [Key Changes](#key-changes)
5. [Implementation Plan](#implementation-plan)
6. [API Compatibility](#api-compatibility)
7. [Performance Considerations](#performance-considerations)
8. [Migration Steps](#migration-steps)

---

## Overview

The web API currently uses `FileStorageService` and `DatabaseService` to read/write JSON files. This migration will replace file operations with MongoDB collection-based queries, enabling:

- **Efficient queries**: Use MongoDB indexes for fast lookups
- **Better scalability**: Handle large datasets without loading entire files
- **Real-time updates**: Changes from engine are immediately available
- **Consistent data**: Same MongoDB database as engine

---

## Current Architecture

### File-Based Storage

**Services:**
- `web-api/src/services/storage.js` - `FileStorageService` handles file I/O
- `web-api/src/services/database.js` - `DatabaseService` provides MongoDB-like interface over files
- Uses file paths like: `data/titles/main.json`, `data/titles/main-titles-streams.json`

**Data Flow:**
```
API Route → DatabaseService.getDataList() → FileStorageService.readJsonFile() → Return data
API Route → DatabaseService.insertData() → FileStorageService.writeJsonFile() → Save data
```

**Current Limitations:**
- Must load entire files into memory
- File I/O overhead for every request
- No efficient querying (must filter in-memory)
- Caching at file level (entire file cached)

---

## New MongoDB Architecture

### MongoDB Database Service

**New Service:**
- `web-api/src/services/mongodb-database.js` - MongoDB collection-based operations
- Replaces `FileStorageService` and `DatabaseService`
- Provides efficient queries with indexes
- Maintains same interface for API compatibility

**Data Flow:**
```
API Route → MongoDatabaseService.getTitles() → MongoDB Query → Return data
API Route → MongoDatabaseService.insertTitle() → MongoDB Insert → Save data
```

**Key Collections:**
- `titles` - Main titles (replaces `data/titles/main.json`)
- `title_streams` - Stream details (replaces `data/titles/main-titles-streams.json`)
- `provider_titles` - Provider-specific titles (for stream URL resolution)
- `iptv_providers` - Provider configurations
- `users` - User accounts
- `settings` - Application settings
- `cache_policy` - Cache policies
- `stats` - Statistics

---

## Key Changes

### 1. Database Service Replacement

**Before:**
```javascript
// FileStorageService + DatabaseService
class DatabaseService {
  constructor(fileStorage) {
    this._fileStorage = fileStorage;
  }
  
  async getDataList(collectionName, query = {}) {
    const filePath = this._getCollectionPath(collectionName);
    let items = await this._fileStorage.readJsonFile(filePath, collectionName);
    // Filter in-memory
    return items.filter(item => this._matchesQuery(item, query));
  }
}
```

**After:**
```javascript
// MongoDatabaseService
class MongoDatabaseService {
  constructor(mongoClient, dbName, cacheService) {
    this.client = mongoClient;
    this.db = mongoClient.db(dbName);
    this._cache = cacheService;
  }
  
  async getTitles(query = {}, projection = null, sort = null) {
    let cursor = this.db.collection('titles').find(query);
    if (projection) cursor = cursor.project(projection);
    if (sort) cursor = cursor.sort(sort);
    return await cursor.toArray();
  }
}
```

### 2. Titles Manager

**Before:**
```javascript
// TitlesManager.js
async getTitlesData() {
  const titlesData = await this._database.getDataList(this._titlesCollection);
  // Returns Map (from file storage mapping)
  return titlesData instanceof Map ? titlesData : new Map();
}
```

**After:**
```javascript
// TitlesManager.js
async getTitlesData() {
  const titles = await this._database.getTitles({});
  // Convert array to Map for compatibility
  const titlesMap = new Map();
  for (const title of titles) {
    titlesMap.set(title.title_key, title);
  }
  return titlesMap;
}
```

### 3. Stream Manager

**Before:**
```javascript
// StreamManager.js
async _getSources(titleId, mediaType, seasonNumber, episodeNumber) {
  const streamsData = await this._database.getDataObject('titles-streams') || {};
  // Search in object keys
  const streamPrefix = `${titlePrefix}${streamIdSuffix}-`;
  for (const [streamKey, streamEntry] of Object.entries(streamsData)) {
    if (streamKey.startsWith(streamPrefix)) {
      // Process stream
    }
  }
}
```

**After:**
```javascript
// StreamManager.js
async _getSources(titleId, mediaType, seasonNumber, episodeNumber) {
  const titleKey = `${mediaType}-${titleId}`;
  const streamId = mediaType === 'tvshows' 
    ? `S${seasonNumber}-E${episodeNumber}` 
    : 'main';
  
  // Direct MongoDB query
  const streams = await this._database.getTitleStreams(titleKey, streamId);
  // Process streams
}
```

### 4. Settings and Cache Policy

**Before:**
```javascript
// Settings stored as single JSON object
const settings = await this._database.getDataObject('settings');
const tmdbToken = settings.tmdb_token;
```

**After:**
```javascript
// Settings stored as individual documents
const setting = await this._database.getSetting('tmdb_token');
const tmdbToken = setting?.value;
```

---

## Implementation Plan

### Phase 1: MongoDB Connection Setup

**Files to Create:**
- `web-api/src/services/mongodb-database.js` - Main MongoDB database service
- `web-api/src/utils/mongo-client.js` - MongoDB connection utility

**Configuration:**
- Add `MONGODB_URI` and `MONGODB_DB_NAME` environment variables
- Initialize MongoDB client in API startup

### Phase 2: Create MongoDB Database Service

**MongoDatabaseService Methods:**

```javascript
// Titles
async getTitles(query = {}, projection = null, sort = null)
async getTitleByKey(titleKey)
async searchTitles(searchQuery, type = null, limit = 50)

// Title Streams
async getTitleStreams(titleKey, streamId = null)
async getStreamsByProvider(providerId)

// Provider Titles
async getProviderTitles(providerId, query = {})
async getProviderTitleByKey(providerId, titleKey)

// IPTV Providers
async getIPTVProviders()
async getIPTVProvider(providerId)

// Users
async getUser(username)
async getUsers(query = {})
async createUser(userData)
async updateUser(username, userData)
async deleteUser(username)

// Settings
async getSetting(key)
async getSettings()
async setSetting(key, value)

// Cache Policy
async getCachePolicy(path)
async getCachePolicies()
async setCachePolicy(path, ttlHours)

// Stats
async getStats()
async updateStats(stats)
```

### Phase 3: Update Managers

**TitlesManager.js:**
- Update `getTitlesData()` to use MongoDB
- Update `getTitlesForAPI()` to use MongoDB
- Update stream transformation to use MongoDB queries

**StreamManager.js:**
- Update `_getSources()` to use MongoDB `title_streams` collection
- Query by `title_key` and `stream_id` directly

**UserManager.js:**
- Update user operations to use MongoDB
- Use `users` collection directly

**SettingsManager.js:**
- Update to use individual setting documents
- Query by `_id` (setting key)

**CategoriesManager.js:**
- Update to use `provider_categories` collection
- Query by `provider_id` and `type`

### Phase 4: Update API Routes

**Routes remain the same:**
- Route handlers don't need changes (they use managers)
- Managers abstract the data access layer
- API responses remain compatible

**Example:**
```javascript
// routes/titles.js - No changes needed
router.get('/titles', async (req, res) => {
  const titles = await titlesManager.getTitlesForAPI();
  res.json(Array.from(titles.values()));
});
```

### Phase 5: Update Service Initialization

**index.js (API startup):**
- Initialize MongoDB client
- Create `MongoDatabaseService` instance
- Pass to managers instead of `FileStorageService` + `DatabaseService`

---

## API Compatibility

### Maintained Interfaces

**TitlesManager:**
- `getTitlesData()` - Still returns `Map<titleKey, MainTitle>`
- `getTitlesForAPI()` - Still returns transformed titles with provider URLs
- API response format unchanged

**StreamManager:**
- `getBestSource()` - Same interface, different implementation
- Returns same stream URL format

**UserManager:**
- All user operations maintain same interface
- Authentication flow unchanged

### Response Format

**API responses remain identical:**
- Same JSON structure
- Same field names
- Same data types
- Backward compatible

---

## Performance Considerations

### 1. Caching Strategy

**Current:**
- File-level caching (entire file cached)
- Cache invalidated on file write

**New:**
- Query result caching (optional)
- Cache by query key
- Invalidate on collection updates

**Implementation:**
```javascript
async getTitles(query = {}) {
  // Check cache first
  const cacheKey = `titles:${JSON.stringify(query)}`;
  const cached = this._cache.get(cacheKey);
  if (cached) return cached;
  
  // Query MongoDB
  const titles = await this.db.collection('titles').find(query).toArray();
  
  // Cache result
  this._cache.set(cacheKey, titles, 300); // 5 minutes TTL
  return titles;
}
```

### 2. Index Usage

**Leverages Existing Indexes:**
- `titles.title_key` - Fast title lookups
- `titles.type` - Fast filtering by type
- `title_streams.title_key + stream_id` - Fast stream lookups
- `provider_titles.provider_id` - Fast provider title queries

### 3. Query Optimization

**Efficient Queries:**
```javascript
// Instead of loading all and filtering
const allTitles = await getTitles({});
const movies = allTitles.filter(t => t.type === 'movies');

// Query with filter
const movies = await getTitles({ type: 'movies' });
```

**Projection for Large Documents:**
```javascript
// Only fetch needed fields
const titles = await getTitles(
  { type: 'movies' },
  { title: 1, title_key: 1, poster_path: 1 } // projection
);
```

### 4. Pagination

**Add Pagination Support:**
```javascript
async getTitles(query = {}, options = {}) {
  const {
    limit = 50,
    skip = 0,
    sort = null,
    projection = null
  } = options;
  
  let cursor = this.db.collection('titles').find(query);
  if (projection) cursor = cursor.project(projection);
  if (sort) cursor = cursor.sort(sort);
  cursor = cursor.skip(skip).limit(limit);
  
  return await cursor.toArray();
}
```

---

## Migration Steps

### Step 1: Create MongoDB Database Service

1. Create `web-api/src/services/mongodb-database.js`
2. Implement all collection methods
3. Add caching support
4. Add query optimization helpers

### Step 2: Update Service Initialization

1. Update `web-api/src/index.js`
2. Initialize MongoDB client
3. Create `MongoDatabaseService` instance
4. Replace `FileStorageService` + `DatabaseService`

### Step 3: Update Managers

1. Update `TitlesManager` to use MongoDB
2. Update `StreamManager` to use MongoDB
3. Update `UserManager` to use MongoDB
4. Update `SettingsManager` to use MongoDB
5. Update `CategoriesManager` to use MongoDB

### Step 4: Testing

1. Test all API endpoints
2. Verify response formats
3. Performance testing
4. Load testing

### Step 5: Deployment

1. Ensure MongoDB is running and accessible
2. Verify indexes are created
3. Deploy updated API
4. Monitor API performance

---

## Benefits

1. **Better Performance**: Indexed queries instead of file I/O
2. **Real-time Updates**: Changes from engine immediately available
3. **Scalability**: Handle large datasets efficiently
4. **Consistent Data**: Same database as engine
5. **Efficient Queries**: Only fetch what's needed
6. **Pagination Support**: Handle large result sets

---

## Notes

- API routes remain unchanged (backward compatible)
- Response formats remain identical
- Managers abstract data access (easy to switch)
- Caching can be added for frequently accessed data
- Can run in file mode if MongoDB unavailable (with feature flag)

---

## Collection Mapping

| File Path | MongoDB Collection | Query Pattern |
|-----------|-------------------|---------------|
| `data/titles/main.json` | `titles` | `db.titles.find({})` |
| `data/titles/main-titles-streams.json` | `title_streams` | `db.title_streams.find({ title_key: ... })` |
| `data/titles/{providerId}.titles.json` | `provider_titles` | `db.provider_titles.find({ provider_id: ... })` |
| `data/categories/{providerId}.categories.json` | `provider_categories` | `db.provider_categories.find({ provider_id: ... })` |
| `data/settings/iptv-providers.json` | `iptv_providers` | `db.iptv_providers.find({ enabled: true })` |
| `data/settings/settings.json` | `settings` | `db.settings.findOne({ _id: key })` |
| `data/settings/cache-policy.json` | `cache_policy` | `db.cache_policy.findOne({ _id: path })` |
| `data/settings/users.json` | `users` | `db.users.findOne({ username: ... })` |
| `data/stats.json` | `stats` | `db.stats.findOne({})` |

