# Engine MongoDB Migration Plan

This document describes the migration of the Playarr Engine from file-based storage to MongoDB, including architecture changes, implementation details, and incremental update strategies.

## Table of Contents

1. [Overview](#overview)
2. [Current Architecture](#current-architecture)
3. [New MongoDB Architecture](#new-mongodb-architecture)
4. [Key Changes](#key-changes)
5. [Implementation Plan](#implementation-plan)
6. [Incremental Updates](#incremental-updates)
7. [Performance Optimizations](#performance-optimizations)
8. [Migration Steps](#migration-steps)

---

## Overview

The engine currently uses file-based storage (`StorageManager`) to read/write JSON files. This migration will replace file operations with MongoDB collection-based queries, enabling:

- **Incremental updates**: Only process titles changed since last execution
- **Better performance**: Efficient queries with indexes instead of loading entire files
- **Scalability**: Handle large datasets without memory issues
- **Data consistency**: Atomic operations and transactions support

---

## Current Architecture

### File-Based Storage

**Storage Manager:**
- `engine/managers/StorageManager.js` - Handles file I/O operations
- Reads/writes JSON files from `data/` directory
- Uses file paths like: `data/titles/main.json`, `data/titles/{providerId}.titles.json`

**Data Flow:**
```
Provider → StorageManager.get() → Read JSON file → Return data
Provider → StorageManager.set() → Write JSON file → Save data
```

**Current Limitations:**
- Must load entire files into memory
- No incremental updates (processes all titles every time)
- File I/O overhead
- No efficient querying (must filter in-memory)

---

## New MongoDB Architecture

### MongoDB Data Service

**New Service:**
- `engine/services/MongoDataService.js` - MongoDB collection-based operations
- Provides efficient queries with indexes
- Supports incremental updates via timestamps

**Data Flow:**
```
Provider → MongoDataService.getProviderTitles() → MongoDB Query → Return data
Provider → MongoDataService.saveProviderTitles() → Bulk Write → Save data
```

**Key Collections:**
- `titles` - Main titles (replaces `data/titles/main.json`)
- `provider_titles` - Provider-specific titles (replaces `data/titles/{providerId}.titles.json`)
- `title_streams` - Stream details (replaces `data/titles/main-titles-streams.json`)
- `provider_categories` - Provider categories (replaces `data/categories/{providerId}.categories.json`)
- `iptv_providers` - Provider configurations (replaces `data/settings/iptv-providers.json`)
- `job_history` - Job execution tracking (NEW - enables incremental updates)

---

## Key Changes

### 1. Storage Abstraction

**Before:**
```javascript
// File-based
const titles = this.data.get('titles', `${providerId}.titles.json`);
this.data.set(titles, 'titles', `${providerId}.titles.json`);
```

**After:**
```javascript
// MongoDB-based
const titles = await this.mongoData.getProviderTitles(providerId, { since: lastExecution });
await this.mongoData.saveProviderTitles(providerId, titles);
```

### 2. Provider Title Loading

**Before:**
```javascript
// BaseIPTVProvider.js
loadAllTitles() {
  const allTitles = this.data.get('titles', `${this.providerId}.titles.json`);
  this._titlesCache = allTitles;
  return allTitles;
}
```

**After:**
```javascript
// BaseIPTVProvider.js
async loadProviderTitles(since = null) {
  const titles = await this.mongoData.getProviderTitles(this.providerId, {
    since: since,
    ignored: false
  });
  this._titlesCache = titles;
  return titles;
}
```

### 3. Main Title Loading

**Before:**
```javascript
// TMDBProvider.js
loadMainTitles() {
  const allMainTitles = this.data.get('titles', 'main.json') || [];
  this._mainTitlesCache = allMainTitles;
  return allMainTitles;
}
```

**After:**
```javascript
// TMDBProvider.js
async loadMainTitles(since = null) {
  const query = since ? { lastUpdated: { $gt: since } } : {};
  const titles = await this.mongoData.getMainTitles(query);
  this._mainTitlesCache = titles;
  return titles;
}
```

### 4. Provider Configuration Loading

**Before:**
```javascript
// BaseProvider.js
static async loadProviders() {
  const providersFile = path.join(__dirname, '../../data/settings/iptv-providers.json');
  const providersData = await fs.readJson(providersFile);
  return providers.filter(p => p.enabled !== false);
}
```

**After:**
```javascript
// BaseProvider.js
static async loadProviders(mongoData) {
  const providers = await mongoData.getIPTVProviders();
  return providers.filter(p => p.enabled !== false);
}
```

---

## Implementation Plan

### Phase 1: MongoDB Connection Setup

**Files to Create:**
- `engine/services/MongoDataService.js` - Main MongoDB data service
- `engine/utils/mongo-client.js` - MongoDB connection utility

**Configuration:**
- Add `MONGODB_URI` and `MONGODB_DB_NAME` environment variables
- Initialize MongoDB client in `JobInitializer`

### Phase 2: Create MongoDB Data Service

**MongoDataService Methods:**

```javascript
// Provider Titles
async getProviderTitles(providerId, options = {})
async saveProviderTitles(providerId, titles)

// Main Titles
async getMainTitles(query = {})
async getMainTitlesByKeys(titleKeys)
async saveMainTitles(titles)

// Title Streams
async getTitleStreams(titleKey)
async saveTitleStreams(streams)

// Provider Categories
async getProviderCategories(providerId, type = null)
async saveProviderCategories(providerId, categories)

// IPTV Providers
async getIPTVProviders()

// Job History
async getJobHistory(jobName, providerId = null)
async updateJobHistory(jobName, result, providerId = null)
```

### Phase 3: Update Base Classes

**BaseProvider.js:**
- Update `loadProviders()` to use MongoDB
- Pass `mongoData` instance to providers

**BaseIPTVProvider.js:**
- Replace `loadAllTitles()` with `loadProviderTitles(since)`
- Update `saveTitles()` to use MongoDB
- Add `mongoData` to constructor

**TMDBProvider.js:**
- Replace `loadMainTitles()` with MongoDB version
- Update `_saveMainTitles()` to use MongoDB
- Update stream saving to use MongoDB

### Phase 4: Update Jobs

**ProcessProvidersTitlesJob.js:**
- Get last execution time from `job_history`
- Only fetch new titles from providers
- Update job history after execution

**ProcessMainTitlesJob.js:**
- Get last execution time from `job_history`
- Only load changed provider titles
- Extract affected main titles
- Only process affected titles
- Update job history after execution

### Phase 5: Update Job Initializer

**JobInitializer.js:**
- Initialize MongoDB client
- Create `MongoDataService` instance
- Pass to providers and jobs

---

## Incremental Updates

### Job History Collection

**Schema:**
```javascript
{
  _id: ObjectId,
  job_name: String,              // "ProcessProvidersTitlesJob" | "ProcessMainTitlesJob"
  provider_id: String,            // Optional, for provider-specific jobs
  last_execution: ISODate,        // Last successful execution timestamp
  execution_count: Number,        // Total successful executions
  last_duration_ms: Number,       // Duration of last execution
  last_result: Object,            // Last execution result
  last_error: String,             // Last error (if failed)
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

### Incremental Provider Title Processing

**ProcessProvidersTitlesJob:**
```javascript
async execute() {
  for (const [providerId, providerInstance] of this.providers) {
    // Get last execution time
    const jobHistory = await this.mongoData.getJobHistory(
      'ProcessProvidersTitlesJob',
      providerId
    );
    const lastExecution = jobHistory?.last_execution || null;
    
    // Only fetch new/updated titles
    await providerInstance.fetchMetadata('movies', lastExecution);
    await providerInstance.fetchMetadata('tvshows', lastExecution);
    
    // Update job history
    await this.mongoData.updateJobHistory(
      'ProcessProvidersTitlesJob',
      result,
      providerId
    );
  }
}
```

### Incremental Main Title Processing

**ProcessMainTitlesJob:**
```javascript
async execute() {
  // Get last execution time
  const jobHistory = await this.mongoData.getJobHistory('ProcessMainTitlesJob');
  const lastExecution = jobHistory?.last_execution || null;
  
  // Get only changed provider titles
  const changedProviderTitles = new Map();
  for (const [providerId, providerInstance] of this.providers) {
    const titles = await this.mongoData.getProviderTitles(providerId, {
      since: lastExecution
    });
    if (titles.length > 0) {
      changedProviderTitles.set(providerId, titles);
    }
  }
  
  // Extract affected main title keys
  const affectedTitleKeys = new Set();
  for (const titles of changedProviderTitles.values()) {
    for (const title of titles) {
      if (title.title_key) {
        affectedTitleKeys.add(title.title_key);
      }
    }
  }
  
  // Get only affected main titles
  const affectedMainTitles = await this.mongoData.getMainTitlesByKeys(
    Array.from(affectedTitleKeys)
  );
  
  // Process only affected titles
  const result = await this.tmdbProvider.processMainTitles(
    changedProviderTitles,
    affectedMainTitles
  );
  
  // Update job history
  await this.mongoData.updateJobHistory('ProcessMainTitlesJob', result);
}
```

---

## Performance Optimizations

### 1. Bulk Operations with Batching

**Save Pattern:**
- Periodic saves: Every 30 seconds or at end of process
- Internal batching: Operations split into chunks of 1000 records
- Reduces database load while maintaining efficiency

**Example:**
```javascript
async saveProviderTitles(providerId, titles) {
  // 1. Check existence in batches
  const existingKeys = await this._checkExistenceBatch(...);
  
  // 2. Separate inserts from updates
  const toInsert = [];
  const toUpdate = [];
  
  // 3. Bulk insert in batches of 1000
  for (let i = 0; i < toInsert.length; i += 1000) {
    const batch = toInsert.slice(i, i + 1000);
    await collection.insertMany(batch, { ordered: false });
  }
  
  // 4. Bulk update in batches of 1000
  for (let i = 0; i < toUpdate.length; i += 1000) {
    const batch = toUpdate.slice(i, i + 1000);
    await collection.bulkWrite(batch, { ordered: false });
  }
}
```

### 2. Batch Existence Checks

**Efficient Query Pattern:**
```javascript
async _checkExistenceBatch(collection, queries, keyBuilder) {
  // Batch queries into chunks of 1000 (MongoDB $or limit)
  for (let i = 0; i < queries.length; i += 1000) {
    const batch = queries.slice(i, i + 1000);
    const existing = await collection.find({ $or: batch }).toArray();
    // Build set of existing keys
  }
}
```

### 3. Index Usage

**Leverages Existing Indexes:**
- `provider_titles`: `{ provider_id: 1, lastUpdated: 1 }` - Fast incremental queries
- `titles`: `{ title_key: 1 }` - Fast lookups by key
- `title_streams`: `{ title_key: 1, stream_id: 1 }` - Fast stream queries

---

## Migration Steps

### Step 1: Create MongoDB Data Service

1. Create `engine/services/MongoDataService.js`
2. Implement all collection methods
3. Add batch existence check utility
4. Add bulk operation batching

### Step 2: Update Job Initializer

1. Add MongoDB connection initialization
2. Create `MongoDataService` instance
3. Pass to providers and jobs

### Step 3: Update Base Classes

1. Update `BaseProvider.loadProviders()` to use MongoDB
2. Update `BaseIPTVProvider` to use MongoDB
3. Update `TMDBProvider` to use MongoDB

### Step 4: Update Jobs

1. Update `ProcessProvidersTitlesJob` for incremental updates
2. Update `ProcessMainTitlesJob` for incremental updates
3. Add job history tracking

### Step 5: Testing

1. Test with small dataset
2. Verify incremental updates work
3. Verify periodic saves work
4. Performance testing with large datasets

### Step 6: Deployment

1. Ensure MongoDB is running and accessible
2. Verify indexes are created (via migration scripts)
3. Deploy updated engine
4. Monitor job execution and performance

---

## Benefits

1. **Incremental Processing**: Only process changed titles, dramatically reducing execution time
2. **Better Performance**: Indexed queries instead of full file loads
3. **Scalability**: Handle millions of titles efficiently
4. **Data Consistency**: Atomic operations prevent data corruption
5. **Progress Tracking**: Job history enables monitoring and debugging
6. **Reduced Memory**: Query only what's needed instead of loading everything

---

## Notes

- Cache directory (`cache/`) remains file-based (temporary API responses)
- Only data directory (`data/`) is migrated to MongoDB
- Periodic save pattern (every 30 seconds) is maintained
- Bulk operations are batched internally to reduce database load
- Backward compatibility: Can run in file mode if MongoDB unavailable (with feature flag)

