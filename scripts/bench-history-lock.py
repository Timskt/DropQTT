#!/usr/bin/env python3
"""Measure whether an unbounded history read stalls the history write path.

Why this exists: `history.rs` serves writes and reads from one
`Mutex<Connection>`, and `series()` (the trend chart) aggregates the whole
window with no row cap while `query()` clamps to 2000. That shape reads like a
throughput bug -- "a 100k-row chart query holds the lock and压住写入侧" -- and a
proposal said so. AGENTS.md forbids acting on that without a number, so this
harness produces one.

Verdict on 2026-10-09 (Apple Silicon, `cargo test --release`, a full 100,000-row
store, which is the row cap):

    series(all)            12.3 ms      series(%text%)   29.2 ms
    append, no reader      mean 1.8 ms, worst 69.3 ms
    append, 3 s chart poll mean 2.1 ms, worst 70.3 ms

A chart read holds the mutex 12-29 ms out of every 3000 ms, and the worst-case
append is ~69 ms *with no reader at all* -- that is the periodic trim, not the
chart. So the read/write split is not warranted at the shipped cap. The third
"looks like a bottleneck, measured, was not" (§1.6, §1.12, and now this).

How it works: it injects one `#[ignore]`d test into `src/history.rs`'s test
module, runs it, and restores the file byte-for-byte. It refuses to start on a
dirty `src/history.rs` so it can never overwrite unsaved work, and it verifies
the restore.

Usage: python3 scripts/bench-history-lock.py [debug|release]
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY = os.path.join(ROOT, "src-tauri", "src", "history.rs")
ANCHOR = "    fn temp_store(name: &str) -> (HistoryStore, std::path::PathBuf) {"

BENCH = r'''    #[test]
    #[ignore = "measurement harness; run with `cargo test --release -- --ignored`"]
    fn zz_bench_series_lock_hold() {
        use std::sync::atomic::AtomicBool;
        use std::time::Instant;

        const N: usize = 100_000;
        const BATCH: usize = 500;
        let (store, path) = temp_store("bench_series");
        let t0 = Instant::now();
        for i in 0..(N / BATCH) {
            let batch: Vec<_> = (0..BATCH)
                .map(|j| {
                    let k = i * BATCH + j;
                    let dev = k % 40;
                    msg_at(
                        &format!("b{i}-{j}"),
                        &format!("bench/dev{dev}/telemetry"),
                        &format!("{{\"n\":{k},\"v\":{v}}}", v = (k % 97) as f64 / 10.0),
                        "in",
                        1_700_000_000_000 + k as i64 * 100,
                    )
                })
                .collect();
            store.append(&batch);
        }
        println!("filled {N} rows in {:?}", t0.elapsed());
        let stats = store.stats();
        println!("store rows now = {}", stats.rows);

        // 1. How long does one unbounded series() call hold the mutex?
        //    The rows were written at BASE_TS + k*100ms, so the window has to be
        //    that span -- a "now" window would measure an empty range.
        const BASE: i64 = 1_700_000_000_000;
        let from = BASE;
        let to = BASE + (N as i64) * 100 + 1000;
        for w in [7_200_000i64, 86_400_000, 604_800_000] {
            let t = Instant::now();
            let pts = store.series("", "", w / 60, from, from + w).unwrap();
            println!("series(all, {} ms window): {:?} over {} buckets", w, t.elapsed(), pts.len());
        }
        let t = Instant::now();
        let pts = store.series("", "", 60_000, from, to).unwrap();
        println!("series(all, whole {} ms span): {:?} ({} buckets)", to - from, t.elapsed(), pts.len());
        // ... and with a text filter, which is the shape the panel uses when searching.
        let t = Instant::now();
        let pts = store.series("telemetry", "", 60_000, from, to).unwrap();
        println!("series(search=\"telemetry\"): {:?} ({} buckets)", t.elapsed(), pts.len());

        // 2. Does that hold stall the write path? Append latency with and
        //    without a concurrent reader, as the shipped 3 s panel poll does.
        let measure = |label: &str, reader: bool| {
            let stop = std::sync::Arc::new(AtomicBool::new(false));
            let store = &store;
            let stop2 = stop.clone();
            let writer = std::thread::scope(|s| {
                let handle = s.spawn(move || {
                    let mut worst = std::time::Duration::ZERO;
                    let mut total = 0usize;
                    let mut n = 0usize;
                    let t = Instant::now();
                    while !stop2.load(std::sync::atomic::Ordering::SeqCst) {
                        let batch: Vec<_> = (0..20)
                            .map(|j| {
                                n += 1;
                                msg(&format!("live-{label}-{n}-{j}"), "bench/live", "1", "in")
                            })
                            .collect();
                        let t0 = Instant::now();
                        store.append(&batch);
                        let d = t0.elapsed();
                        total += d.as_micros() as usize;
                        if d > worst {
                            worst = d;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    println!(
                        "{label}: {} appends ({} messages), mean {} us, worst {:?}, over {:?}",
                        n / 20, n, total / (n / 20).max(1), worst, t.elapsed()
                    );
                });
                if reader {
                    let store2 = store;
                    let stop3 = stop.clone();
                    s.spawn(move || {
                        while !stop3.load(std::sync::atomic::Ordering::SeqCst) {
                            let base: i64 = 1_700_000_000_000;
                            let _ = store2.series("telemetry", "", 60_000, base, base + 100_000 * 100 + 1000);
                            std::thread::sleep(std::time::Duration::from_millis(3_000));
                        }
                    });
                }
                std::thread::sleep(std::time::Duration::from_secs(9));
                stop.store(true, std::sync::atomic::Ordering::SeqCst);
                handle.join().unwrap();
            });
            let _ = writer;
        };
        measure("baseline-no-reader", false);
        measure("with-3s-series-reader", true);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }'''


def git(args):
    return subprocess.run(["git", "-C", ROOT] + args, capture_output=True, text=True)


def main(argv):
    profile = argv[0] if argv else "release"
    if profile not in ("debug", "release"):
        print(__doc__.strip().splitlines()[-1])
        return 2

    original = open(HISTORY, encoding="utf-8").read()
    if ANCHOR not in original:
        print(f"ABORT: {HISTORY} no longer contains the anchor this harness injects beside.")
        print("It must be updated to match, never run blind.")
        return 1
    dirty = git(["diff", "--quiet", "--", "src-tauri/src/history.rs"]).returncode
    if dirty != 0:
        print("ABORT: src-tauri/src/history.rs has uncommitted changes; refusing to rewrite it.")
        return 1

    flag = ["--release"] if profile == "release" else []
    try:
        open(HISTORY, "w", encoding="utf-8").write(
            original.replace(ANCHOR, BENCH + ANCHOR, 1)
        )
        p = subprocess.run(
            ["cargo", "+stable", "test", "--lib", *flag, "zz_bench_series_lock_hold",
             "--", "--ignored", "--nocapture", "--test-threads=1"],
            cwd=os.path.join(ROOT, "src-tauri"), capture_output=True, text=True,
        )
        out = p.stdout + p.stderr
        keep = ("filled", "store rows", "series(", "baseline", "with-3s", "error", "panicked")
        for line in out.splitlines():
            if any(k in line for k in keep):
                print(line.strip())
        if p.returncode != 0:
            print(f"measurement FAILED to run (exit {p.returncode}) -- no verdict, not a pass")
        return p.returncode
    finally:
        open(HISTORY, "w", encoding="utf-8").write(original)
        again = open(HISTORY, encoding="utf-8").read()
        if again != original:
            print("RESTORE CHECK FAILED: src-tauri/src/history.rs differs from what was read in.")
            sys.exit(1)
        print("history.rs restored byte-for-byte")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
