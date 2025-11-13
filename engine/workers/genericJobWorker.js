import { ApplicationContext } from '../context/ApplicationContext.js';
import jobsConfig from '../jobs.json' with { type: 'json' };
import { createLogger } from '../utils/logger.js';

/**
 * Generic Bree.js worker file for all jobs
 * Dynamically loads and executes the appropriate Job class based on job configuration
 * Runs in main thread (worker: false) to access shared ApplicationContext
 * 
 * @param {Object} [params={}] - Optional parameters (workerData equivalent)
 * @param {string} params.jobName - Job name (required, passed from scheduler)
 * @returns {Promise<any>} Job execution results
 */
export default async function(params = {}) {
  // Create logger inside function so it's available when Bree.js evaluates the function
  const logger = createLogger('genericJobWorker');
  
  try {
    logger.debug('Worker function called');
    
    // Get job name from params (required)
    const jobName = params.jobName;
    if (!jobName) {
      throw new Error('Job name is required. Provide jobName in params.');
    }

    logger.debug(`Looking up job configuration for: ${jobName}`);
    
    // Find job configuration
    const jobConfig = jobsConfig.jobs.find(j => j.name === jobName);
    if (!jobConfig) {
      throw new Error(`Job configuration not found for: ${jobName}`);
    }

    // Get job class name from jobHistoryName (maps to Job class name)
    const jobClassName = jobConfig.jobHistoryName;
    if (!jobClassName) {
      throw new Error(`Job history name not found in configuration for: ${jobName}`);
    }

    logger.debug(`Getting dependencies from context`);
    const context = ApplicationContext.getInstance();
    
    // Get initialized dependencies from context
    const mongoData = context.getMongoData();
    const providers = context.getProviders();
    const tmdbProvider = context.getTMDBProvider();

    logger.debug(`Dynamically importing Job class: ${jobClassName}`);
    
    // Dynamically import the Job class based on jobHistoryName
    const jobModule = await import(`../jobs/${jobClassName}.js`);
    const JobClass = jobModule[jobClassName];

    if (!JobClass) {
      throw new Error(`Job class ${jobClassName} not found in ${jobClassName}.js`);
    }

    logger.debug(`Creating job instance: ${jobClassName}`);
    
    // Instantiate the job with dependencies
    const job = new JobClass(mongoData, providers, tmdbProvider);
    
    logger.debug(`Executing job: ${jobName}...`);
    
    // Execute the job
    const results = await job.execute();
    
    logger.debug(`Job completed, returning results`);
    return results;
  } catch (error) {
    logger.error(`Error in worker: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
}

