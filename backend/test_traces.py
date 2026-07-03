import pyarrow.parquet as pq
import pandas as pd
import numpy as np
from pathlib import Path

def main():
    parquet_path = Path("openRCA_Bank/parquet/trace_span.parquet")
    if not parquet_path.exists():
        print(f"Error: Parquet file not found at {parquet_path.resolve()}")
        return

    print("Scanning entire trace_span.parquet for calling connections...")
    pf = pq.ParquetFile(parquet_path)
    all_edges = set()
    total_spans = 0
    
    for i in range(pf.num_row_groups):
        df = pf.read_row_group(i, columns=["trace_id", "parent_id", "span_id", "cmdb_id"]).to_pandas()
        total_spans += len(df)
        
        # Find parent-child links within the row group
        children = df[df["parent_id"].notna() & (df["parent_id"] != "")]
        merged = children.merge(
            df[["trace_id", "span_id", "cmdb_id"]],
            left_on=["trace_id", "parent_id"],
            right_on=["trace_id", "span_id"],
            suffixes=("", "_parent")
        )
        # Filter self loops
        merged = merged[merged["cmdb_id"] != merged["cmdb_id_parent"]]
        
        unique_group_edges = merged[["cmdb_id_parent", "cmdb_id"]].drop_duplicates()
        for r in unique_group_edges.itertuples(index=False):
            all_edges.add((str(r[0]), str(r[1])))

    print(f"Total trace spans: {total_spans}")
    print(f"Unique calling connections found: {len(all_edges)}")
    for parent, child in sorted(list(all_edges)):
        print(f"  {parent}  --->  {child}")

if __name__ == "__main__":
    main()
