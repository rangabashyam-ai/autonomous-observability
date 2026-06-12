import { getBezierPath, EdgeLabelRenderer, type EdgeProps } from 'reactflow';

export default function BlastRadiusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data = {},
  label,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  const hasSeqBadge = data && typeof data.seqNumber === 'number';

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      
      {(label || hasSeqBadge) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
              zIndex: 50,
              opacity: 1,
            }}
            className="nodrag nopan"
          >
            {hasSeqBadge ? (
              <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                <div 
                  className="w-[18px] h-[18px] flex items-center justify-center rounded-full bg-white border-[1.5px] border-red-600 dark:border-red-500 text-red-600 dark:text-red-400 font-bold text-[11px] leading-none z-50 shadow-[0_0_4px_2px_rgba(255,255,255,0.9),_0_1px_3px_rgba(0,0,0,0.15)]"
                >
                  {data.seqNumber}
                </div>
                {label && (
                  <span 
                    className="text-[9px] font-bold text-red-600 dark:text-red-400 bg-slate-50/90 dark:bg-slate-900/90 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-800/50 shadow-sm"
                  >
                    {label}
                  </span>
                )}
              </div>
            ) : (
              // Non-red/standard edge labels
              <span 
                className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-800/50 shadow-sm bg-slate-50/90 dark:bg-slate-900/90"
                style={{
                  color: style.stroke,
                }}
              >
                {label}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
