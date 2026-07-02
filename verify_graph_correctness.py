import argparse
import pyarrow.parquet as pq
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

def main():
    parser = argparse.ArgumentParser(description="Query ground-truth edges directly from Parquet for verification.")
    parser.add_argument("--start", type=int, default=1614787199, help="Start epoch timestamp in seconds")
    parser.add_argument("--end", type=int, default=1614800000, help="End epoch timestamp in seconds")
    args = parser.parse_args()

    parquet_path = Path("openRCA_Bank/parquet/trace_span.parquet")
    if not parquet_path.exists():
        print(f"Error: Parquet file not found at {parquet_path.resolve()}")
        return

    print(f"Querying traces in window: {args.start} to {args.end}")
    print(f"Start: {datetime.fromtimestamp(args.start)}")
    print(f"End:   {datetime.fromtimestamp(args.end)}\n")

    # Load traces using predicate pushdown
    pf = pq.ParquetFile(parquet_path)
    all_edges = set()
    total_spans_in_window = 0
    
    # We must scan row groups because timestamps inside the file have mixed units
    for i in range(pf.num_row_groups):
        # Scan trace timestamp column first for speed
        meta = pf.read_row_group(i, columns=["timestamp_ms"]).to_pandas()
        ts_ms = meta["timestamp_ms"].astype(float)
        is_ms = ts_ms > 1_000_000_000_000
        ts_s = ts_ms.copy()
        ts_s[is_ms] = ts_s[is_ms] / 1000.0
        
        # Check if row group overlaps with window
        if ts_s.min() <= args.end and ts_s.max() >= args.start:
            df = pf.read_row_group(i, columns=["trace_id", "parent_id", "span_id", "cmdb_id", "timestamp_ms"]).to_pandas()
            ts_ms_full = df["timestamp_ms"].astype(float)
            is_ms_full = ts_ms_full > 1_000_000_000_000
            ts_s_full = ts_ms_full.copy()
            ts_s_full[is_ms_full] = ts_s_full[is_ms_full] / 1000.0
            
            df["ts_s"] = ts_s_full.astype(np.int64)
            
            # Count spans in window
            total_spans_in_window += len(df[(df["ts_s"] >= args.start) & (df["ts_s"] <= args.end)])
            
            # Find parent-child links within the entire row group first
            children = df[df["parent_id"].notna() & (df["parent_id"] != "")]
            merged = children.merge(
                df[["trace_id", "span_id", "cmdb_id"]],
                left_on=["trace_id", "parent_id"],
                right_on=["trace_id", "span_id"],
                suffixes=("", "_parent")
            )
            # Filter self loops
            merged = merged[merged["cmdb_id"] != merged["cmdb_id_parent"]]
            
            # Filter rows inside window (using child span timestamp)
            merged = merged[(merged["ts_s"] >= args.start) & (merged["ts_s"] <= args.end)]
            
            unique_group_edges = merged[["cmdb_id_parent", "cmdb_id"]].drop_duplicates()
            for r in unique_group_edges.itertuples(index=False):
                all_edges.add((r[0], r[1]))

    print(f"Total trace spans found inside window: {total_spans_in_window}")

    if not all_edges:
        print("No calling connections found in this time window.")
        return

    sorted_edges = sorted(list(all_edges))
    print(f"\n--- Ground Truth Edges ({len(sorted_edges)} unique connections) ---")
    for parent, child in sorted_edges:
        print(f"  {parent}  --->  {child}")

if __name__ == "__main__":
    main()
