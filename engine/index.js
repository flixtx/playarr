import dotenv from 'dotenv';
import { FetchProvidersMetadataJob } from './jobs/FetchProvidersMetadataJob.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '../cache');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const logger = createLogger('Main');

/**
 * Main application entry point
 * Initializes the fetch engine and starts fetching metadata from all providers
 */
async function main() {
  const engine = new FetchProvidersMetadataJob(CACHE_DIR, DATA_DIR);
  
  try {
    // Initialize engine (loads all providers and creates instances)
    await engine.initialize();
    
    // Automatically fetch from all providers
    const results = await engine.startFetch();
    
    logger.info('=== Fetch Results ===');
    results.forEach(result => {
      if (result.error) {
        logger.error(`${result.providerName}: ${result.error}`);
      } else {
        logger.info(`${result.providerName}: ${result.movies} movies, ${result.tvShows} TV shows`);
      }
    });
    
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();

