const logger = require('./logger');

/**
 * In-memory retry queue for failed Circle member creation attempts.
 * Each item: { id, contactId, email, payload, attempts, lastAttempt, error }
 */
class RetryQueue {
  constructor() {
    this.queue = new Map();
    this.idCounter = 0;
  }

  /**
   * Add a failed job to the retry queue.
   * @param {Object} job - { contactId, email, payload, error }
   * @returns {string} The retry job ID
   */
  add(job) {
    this.idCounter += 1;
    const id = `retry-${this.idCounter}`;
    this.queue.set(id, {
      id,
      contactId: job.contactId,
      email: job.email,
      payload: job.payload,
      attempts: 0,
      maxAttempts: job.maxAttempts || 3,
      lastAttempt: null,
      error: job.error,
      createdAt: new Date().toISOString(),
    });
    logger.info('Job added to retry queue', { id, email: job.email, contactId: job.contactId });
    return id;
  }

  /**
   * Get a specific job by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    return this.queue.get(id) || null;
  }

  /**
   * Get all pending jobs (not yet exhausted retries).
   * @returns {Object[]}
   */
  getPending() {
    return Array.from(this.queue.values()).filter(
      (job) => job.attempts < job.maxAttempts
    );
  }

  /**
   * Mark a job attempt — increments counter and records timestamp.
   * @param {string} id
   */
  markAttempt(id) {
    const job = this.queue.get(id);
    if (job) {
      job.attempts += 1;
      job.lastAttempt = new Date().toISOString();
    }
  }

  /**
   * Remove a job from the queue (on success).
   * @param {string} id
   */
  remove(id) {
    this.queue.delete(id);
    logger.info('Job removed from retry queue', { id });
  }

  /**
   * Get queue stats.
   * @returns {{ total: number, pending: number, exhausted: number }}
   */
  getStats() {
    const all = Array.from(this.queue.values());
    const pending = all.filter((j) => j.attempts < j.maxAttempts);
    return {
      total: all.length,
      pending: pending.length,
      exhausted: all.length - pending.length,
    };
  }
}

// Singleton instance
const retryQueue = new RetryQueue();

module.exports = retryQueue;
