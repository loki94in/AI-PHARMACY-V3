import { fileURLToPath } from 'url';

class ActivityTracker {
  private lastActivity: number = 0;
  private idleThresholdMs: number = 30000; // 30 seconds

  public recordActivity(): void {
    this.lastActivity = Date.now();
  }

  public getLastActivity(): number {
    return this.lastActivity;
  }

  public isAppInUse(): boolean {
    return (Date.now() - this.lastActivity) < this.idleThresholdMs;
  }

  public isIdle(thresholdMs: number = 30 * 60 * 1000): boolean {
    return (Date.now() - this.lastActivity) > thresholdMs;
  }

  private manuallyPaused: boolean = false;

  public setManuallyPaused(paused: boolean): void {
    this.manuallyPaused = paused;
    console.log(`[ActivityTracker] Background worker manual pause set to: ${paused}`);
  }

  public isManuallyPaused(): boolean {
    return this.manuallyPaused;
  }

  /**
   * Blocks execution by sleeping in intervals if the app is currently in use or manually paused by human.
   * Resumes automatically once the user has been idle for the threshold duration and unpaused.
   */
  public async waitUntilIdle(checkIntervalMs: number = 2000): Promise<void> {
    if (this.isAppInUse() || this.manuallyPaused) {
      console.log(`[ActivityTracker] Background process paused (${this.manuallyPaused ? 'manually paused by human operator' : `app active: ${Math.round((Date.now() - this.lastActivity)/1000)}s ago`})...`);
    }
    while (this.isAppInUse() || this.manuallyPaused) {
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }
}

export const activityTracker = new ActivityTracker();
export default activityTracker;
