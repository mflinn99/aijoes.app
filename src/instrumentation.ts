/**
 * Next.js calls this once per server process. It is where the job worker
 * starts, so queued analysis and execution work is picked up by whichever
 * instance is running — including after a restart.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.METAMSP_DISABLE_WORKER === '1') return;

  const { start } = await import('./lib/jobs/runner');
  start();
}
