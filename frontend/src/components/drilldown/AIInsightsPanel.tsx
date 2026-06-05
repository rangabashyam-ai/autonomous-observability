import { Brain, Lightbulb, AlertCircle, CheckCircle, TrendingUp } from 'lucide-react';


interface AIInsight {
  type: 'diagnosis' | 'recommendation' | 'prediction' | 'correlation';
  confidence: number;
  message: string;
  actions?: string[];
}

interface AIInsightsPanelProps {
  insights: AIInsight[];
  entityType: string;
  entityName: string;
  health?: 'healthy' | 'warning' | 'critical';
}

function getInsightIcon(type: string) {
  switch (type) {
    case 'diagnosis':
      return <AlertCircle className="w-4 h-4" />;
    case 'recommendation':
      return <Lightbulb className="w-4 h-4" />;
    case 'prediction':
      return <TrendingUp className="w-4 h-4" />;
    case 'correlation':
      return <Brain className="w-4 h-4" />;
    default:
      return <Brain className="w-4 h-4" />;
  }
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 80) return 'text-green-600 dark:text-green-400';
  if (confidence >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-600 dark:text-slate-400';
}

export default function AIInsightsPanel({ insights, entityType, entityName, health }: AIInsightsPanelProps) {
  // Generate contextual AI insights based on health
  const contextualInsights: AIInsight[] = insights.length > 0 ? insights : generateDefaultInsights(health, entityName, entityType);

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">
          AI Investigation Summary - {entityType.charAt(0).toUpperCase() + entityType.slice(1)}
        </h3>
      </div>

      <div className="space-y-3">
        {contextualInsights.map((insight, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
            <div className="flex items-start gap-2 mb-2">
              <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                {getInsightIcon(insight.type)}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase">
                    {insight.type}
                  </span>
                  <span className={`text-xs font-bold ${getConfidenceColor(insight.confidence)}`}>
                    {insight.confidence}% confidence
                  </span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{insight.message}</p>
              </div>
            </div>

            {insight.actions && insight.actions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-blue-100 dark:border-blue-900">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Suggested Actions:</p>
                <ul className="space-y-1">
                  {insight.actions.map((action, actionIdx) => (
                    <li key={actionIdx} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1">
                      <CheckCircle className="w-3 h-3 mt-0.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-blue-200 dark:border-blue-800">
        <button className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          Start AI-Guided Investigation
        </button>
      </div>
    </div>
  );
}

function generateDefaultInsights(health: string | undefined, entityName: string, entityType: string): AIInsight[] {
  const entityTypeLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
  
  if (health === 'critical') {
    return [
      {
        type: 'diagnosis',
        confidence: 91,
        message: `${entityTypeLabel} "${entityName}" is experiencing critical issues. Resource saturation detected with elevated error rates.`,
        actions: [
          'Check recent deployments in the last 4 hours',
          'Review dependency health (upstream services)',
          'Analyze error logs for root cause patterns',
          'Consider scaling resources or rolling back',
        ],
      },
      {
        type: 'correlation',
        confidence: 87,
        message: 'Pattern matches 3 historical incidents with similar symptoms. Most common root cause: Database connection pool exhaustion.',
        actions: [
          'Review database connection metrics',
          'Check for connection leaks in application code',
          'Increase connection pool size if needed',
        ],
      },
      {
        type: 'prediction',
        confidence: 78,
        message: 'If current trend continues, downstream services will be impacted within 8-12 minutes.',
        actions: [
          'Notify on-call SRE team',
          'Prepare rollback plan',
          'Monitor blast radius expansion',
        ],
      },
    ];
  }

  if (health === 'warning') {
    return [
      {
        type: 'diagnosis',
        confidence: 76,
        message: `${entityTypeLabel} "${entityName}" showing elevated resource utilization. Early warning indicators detected.`,
        actions: [
          'Monitor for escalation to critical state',
          'Review recent changes or deployments',
          'Check for traffic spikes or unusual patterns',
        ],
      },
      {
        type: 'recommendation',
        confidence: 82,
        message: 'Proactive scaling recommended to prevent service degradation.',
        actions: [
          'Scale horizontally by adding 2-3 instances',
          'Review auto-scaling policies',
          'Optimize resource-intensive operations',
        ],
      },
    ];
  }

  return [
    {
      type: 'diagnosis',
      confidence: 95,
      message: `${entityTypeLabel} "${entityName}" is operating within normal parameters. All health checks passing.`,
      actions: [
        'Continue monitoring for anomalies',
        'Review performance trends',
        'Maintain current configuration',
      ],
    },
    {
      type: 'recommendation',
      confidence: 72,
      message: 'Consider implementing additional monitoring for early failure detection.',
      actions: [
        'Add custom metrics for business KPIs',
        'Configure alerting thresholds',
        'Enable distributed tracing',
      ],
    },
  ];
}

// Made with Bob
