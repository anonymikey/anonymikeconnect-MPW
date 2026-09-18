const { sendTextSms } = require('./textsms');

const LEASE_MS = 5 * 60 * 1000;
const BACKOFF_MS = [30_000, 120_000, 300_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

function isAmbiguous(error) {
  return error?.name === 'AbortError' || /timeout|timed out|network|fetch failed|socket|connection/i.test(String(error?.message || ''));
}

function isRetryable(error) {
  return /HTTP 5\d\d/.test(String(error?.message || ''));
}

function retryDelay(attempt) {
  return BACKOFF_MS[Math.min(Math.max(attempt - 1, 0), BACKOFF_MS.length - 1)];
}

async function recoverStaleFreeAccessJobs(db) {
  await db.query(`update sms_messages
    set status = 'QUEUED', locked_at = null, last_error = coalesce(last_error, 'Worker lease expired')
    where message_type = 'FREE_ACCESS' and status = 'SENDING'
      and locked_at < now() - ($1::int * interval '1 millisecond')`, [LEASE_MS]);
}

async function claimNextFreeAccessJob(db) {
  const result = await db.query(`with candidate as (
      select id from sms_messages
      where message_type = 'FREE_ACCESS' and status = 'QUEUED' and next_attempt_at <= now()
      order by next_attempt_at asc, created_at asc
      for update skip locked limit 1
    )
    update sms_messages m
    set status = 'SENDING', locked_at = now(), last_attempt_at = now(),
        attempt_count = m.attempt_count + 1
    from candidate where m.id = candidate.id
    returning m.id, m.recipient, m.message, m.attempt_count`);
  return result.rows[0] || null;
}

async function processFreeAccessJob(db, job) {
  try {
    const result = await sendTextSms({ phone: job.recipient, message: job.message });
    await db.query(`update sms_messages
      set status = 'SENT', sent_at = now(), provider_message_id = $2,
          locked_at = null, last_error = null, error_code = null, error_message = null
      where id = $1 and status = 'SENDING'`, [job.id, result.messageId || null]);
    return 'SENT';
  } catch (error) {
    const message = String(error?.message || 'TextSMS delivery failed').slice(0, 1000);
    if (isAmbiguous(error)) {
      await db.query(`update sms_messages set status = 'UNKNOWN', locked_at = null,
        last_error = $2, error_message = $2 where id = $1 and status = 'SENDING'`, [job.id, message]);
      return 'UNKNOWN';
    }
    if (isRetryable(error) && job.attempt_count < MAX_ATTEMPTS) {
      await db.query(`update sms_messages set status = 'QUEUED', locked_at = null,
        next_attempt_at = now() + ($2::int * interval '1 millisecond'), last_error = $3,
        error_message = $3 where id = $1 and status = 'SENDING'`, [job.id, retryDelay(job.attempt_count), message]);
      return 'QUEUED';
    }
    await db.query(`update sms_messages set status = 'FAILED', locked_at = null,
      last_error = $2, error_message = $2 where id = $1 and status = 'SENDING'`, [job.id, message]);
    return 'FAILED';
  }
}

async function runFreeAccessSmsWorker(db, { once = false } = {}) {
  try {
    await recoverStaleFreeAccessJobs(db);
    let processed = 0;
    while (true) {
      const job = await claimNextFreeAccessJob(db);
      if (!job) break;
      await processFreeAccessJob(db, job);
      processed += 1;
      if (once) break;
    }
    return processed;
  } catch (error) {
    console.error('[FREE_ACCESS SMS WORKER]', error.message);
    return 0;
  }
}

function startFreeAccessSmsWorker(db) {
  const intervalMs = Math.max(Number(process.env.FREE_ACCESS_WORKER_INTERVAL_MS || 10_000), 5_000);
  const tick = () => runFreeAccessSmsWorker(db).catch((error) => console.error('[FREE_ACCESS SMS WORKER]', error.message));
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return timer;
}

module.exports = { runFreeAccessSmsWorker, startFreeAccessSmsWorker, claimNextFreeAccessJob, processFreeAccessJob, recoverStaleFreeAccessJobs };
