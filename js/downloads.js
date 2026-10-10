// Download manager: a queue of song downloads with pause / resume / cancel.
//
// Public API (used by the in-VR menu and the web page):
//
//   import { downloads } from './downloads.js';
//
//   downloads.subscribe(fn)        // fn() on any change; returns unsubscribe
//   downloads.list()               // array of jobs (active + recently finished), oldest first
//   downloads.get(id)              // job or undefined
//   downloads.pause(id) / resume(id) / cancel(id)
//   downloads.pauseAll(group?) / resumeAll(group?) / cancelAll(group?)
//                                  // group optional: only jobs with that group
//
//   job: { id, label, cover, group,
//          state: 'queued'|'downloading'|'paused'|'done'|'error'|'cancelled',
//          received, total, error }
//     - id: 'bs:<version hash>' for a BeatSaver map (the same as its library key)
//     - received / total: bytes (total is 0 when the server doesn't say)
//     - error: message text when state is 'error', else ''
//     - job objects are live (they update in place); treat them as read-only
//
// Behaviour:
//   - At most MAX_ACTIVE (2) downloads transfer at a time; the rest wait as 'queued'.
//   - Pause stops reading the response (the connection stays open and stalls).
//     Resume continues reading; if the connection broke while paused, the
//     download quietly starts again from 0 (BeatSaver's CDN can't resume from an
//     offset). A paused download doesn't use a slot, so the next queued one starts;
//     a paused queued job doesn't start until resumed.
//   - Cancel aborts the transfer; the job's promise rejects with an Error whose
//     name is 'AbortError' and message '已取消'. Once the bytes have all arrived
//     (the song is being unpacked / saved) cancel does nothing.
//   - Finished jobs ('done' / 'cancelled') leave list() 4 s after finishing,
//     failed ones ('error') after 10 s.
//
// Internal API (library.js):
//   downloads.start({ id, url, label, cover, group, onProgress, then }) -> Promise
//     Starts (or joins, while the same id is still active) a download. onProgress(f)
//     gets 0..1; then(arrayBuffer) runs after the transfer (still part of the job)
//     and the promise resolves with its result.
//   downloads.watchGroup(group) -> { promise, cancelled, dispose() }
//     promise rejects (AbortError) when cancelAll(group) or cancelAll() is called.
import { download } from './beatsaver.js';

const MAX_ACTIVE = 2;
const KEEP_DONE_MS = 4000;
const KEEP_ERROR_MS = 10000;
const MAX_RESTARTS = 3;
const ACTIVE = new Set(['queued', 'downloading', 'paused']);

export function abortError() {
  const e = new Error('已取消');
  e.name = 'AbortError';
  return e;
}

class DownloadManager {
  constructor() {
    this.jobs = new Map(); // id -> job (insertion order = oldest first)
    this.runs = new Map(); // id -> internal state of the job
    this.listeners = new Set();
    this.groupWatchers = new Set();
    this.emitTimer = null;
  }

  // ----- public ----------------------------------------------------------------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list() {
    return [...this.jobs.values()];
  }

  get(id) {
    return this.jobs.get(id);
  }

  pause(id) {
    const job = this.jobs.get(id);
    const run = this.runs.get(id);
    if (!job || !run || !ACTIVE.has(job.state) || job.state === 'paused' || run.finishing) return;
    run.paused = true;
    job.state = 'paused';
    this.emit(true);
    this.pump(); // a paused download frees its slot
  }

  resume(id) {
    const job = this.jobs.get(id);
    const run = this.runs.get(id);
    if (!job || !run || job.state !== 'paused') return;
    run.paused = false;
    job.state = run.started ? 'downloading' : 'queued';
    const wake = run.wake;
    run.wake = null;
    wake?.resolve();
    this.emit(true);
    this.pump();
  }

  cancel(id) {
    const job = this.jobs.get(id);
    const run = this.runs.get(id);
    if (!job || !run || !ACTIVE.has(job.state) || run.finishing) return;
    run.controller.abort();
    const wake = run.wake;
    run.wake = null;
    wake?.reject(abortError());
    if (!run.started) this.finish(job, run, 'cancelled', abortError()); // never started: reject now
    // a started job settles from its own loop (the abort makes the read fail)
  }

  pauseAll(group) {
    this.batch(() => this.matching(group).forEach((j) => this.pause(j.id)));
  }

  resumeAll(group) {
    this.batch(() => this.matching(group).forEach((j) => this.resume(j.id)));
  }

  cancelAll(group) {
    for (const w of [...this.groupWatchers]) if (group === undefined || w.group === group) w.fire();
    this.batch(() => this.matching(group).forEach((j) => this.cancel(j.id)));
  }

  // ----- internal --------------------------------------------------------------
  /** Runs fn without starting queued jobs in between (so pausing / cancelling many doesn't start others). */
  batch(fn) {
    this.held = true;
    try {
      fn();
    } finally {
      this.held = false;
    }
    this.pump();
  }

  matching(group) {
    return this.list().filter((j) => ACTIVE.has(j.state) && (group === undefined || j.group === group));
  }

  start({ id, url, label = '', cover = null, group = null, onProgress = null, then = (buf) => buf }) {
    const old = this.jobs.get(id);
    const oldRun = this.runs.get(id);
    if (old && oldRun && ACTIVE.has(old.state)) {
      if (onProgress) oldRun.progress.add(onProgress);
      return oldRun.promise;
    }
    if (old) this.forget(id);
    const job = { id, label, cover, group, state: 'queued', received: 0, total: 0, error: '' };
    const run = {
      url,
      then,
      controller: new AbortController(),
      progress: new Set(onProgress ? [onProgress] : []),
      paused: false,
      started: false,
      finishing: false,
      wake: null,
      waited: false,
    };
    run.promise = new Promise((resolve, reject) => {
      run.resolve = resolve;
      run.reject = reject;
    });
    this.jobs.set(id, job);
    this.runs.set(id, run);
    this.emit(true);
    this.pump();
    return run.promise;
  }

  /** Rejects when the group's downloads are cancelled (also before any job of it exists). */
  watchGroup(group) {
    const w = { group, cancelled: false };
    w.promise = new Promise((_, reject) => {
      w.fire = () => {
        w.cancelled = true;
        this.groupWatchers.delete(w);
        reject(abortError());
      };
    });
    w.promise.catch(() => {});
    w.dispose = () => this.groupWatchers.delete(w);
    this.groupWatchers.add(w);
    return w;
  }

  pump() {
    if (this.held) return;
    let active = 0;
    for (const job of this.jobs.values()) if (job.state === 'downloading') active++;
    for (const job of this.jobs.values()) {
      if (active >= MAX_ACTIVE) break;
      const run = this.runs.get(job.id);
      if (job.state === 'queued' && run && !run.started) {
        active++;
        this.execute(job, run);
      }
    }
  }

  async execute(job, run) {
    run.started = true;
    job.state = 'downloading';
    this.emit(true);
    const signal = run.controller.signal;
    // waits while paused; remembers that it waited (the connection may have dropped meanwhile)
    const gate = () => {
      if (signal.aborted) return Promise.reject(abortError());
      if (!run.paused) return null;
      run.waited = true;
      return new Promise((resolve, reject) => (run.wake = { resolve, reject }));
    };
    const onBytes = (received, total) => {
      run.waited = false;
      job.received = received;
      job.total = total;
      const f = total ? Math.min(1, received / total) : 0;
      if (total) for (const fn of run.progress) fn(f);
      this.emit();
    };
    try {
      let buffer;
      for (let restarts = 0; ; restarts++) {
        run.waited = false;
        try {
          buffer = await download(run.url, null, { signal, gate, onBytes });
          break;
        } catch (e) {
          if (signal.aborted || e.name === 'AbortError') throw abortError();
          // the connection broke while paused: start again from the beginning
          if (run.waited && restarts < MAX_RESTARTS) {
            job.received = 0;
            this.emit(true);
            if (run.paused) await gate();
            continue;
          }
          throw e;
        }
      }
      run.finishing = true;
      job.received = job.total = Math.max(job.total, buffer.byteLength);
      if (job.state === 'paused') job.state = 'downloading';
      this.emit(true);
      const result = await run.then(buffer);
      this.finish(job, run, 'done', null, result);
    } catch (e) {
      if (e.name === 'AbortError') this.finish(job, run, 'cancelled', abortError());
      else this.finish(job, run, 'error', e);
    }
  }

  finish(job, run, state, error, result) {
    if (!ACTIVE.has(job.state)) return;
    if (this.runs.get(job.id) !== run) return;
    job.state = state;
    job.error = state === 'error' ? error?.message || String(error) : '';
    run.progress.clear();
    if (state === 'done') run.resolve(result);
    else run.reject(error);
    clearTimeout(run.timer);
    run.timer = setTimeout(() => {
      if (this.jobs.get(job.id) === job) {
        this.forget(job.id);
        this.emit(true);
      }
    }, state === 'error' ? KEEP_ERROR_MS : KEEP_DONE_MS);
    this.emit(true);
    this.pump();
  }

  forget(id) {
    clearTimeout(this.runs.get(id)?.timer);
    this.jobs.delete(id);
    this.runs.delete(id);
  }

  /** Notifies listeners: right away for state changes, at most ~10x/s for progress. */
  emit(now = false) {
    if (now) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
      for (const fn of [...this.listeners]) fn();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => this.emit(true), 100);
  }
}

export const downloads = new DownloadManager();
