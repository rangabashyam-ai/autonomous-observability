$body = @{
    context = @{
        page_type = "executive"
        selected_entity = "Executive Command Center"
        user_question = "Can you explain the root cause of these active incidents?"
        related_incidents = @(
            @{
                incident_id = "INC-1009"
                title = "Payment Authorization degradation - Cache Invalidation Bug"
                severity = "P1"
                service = "Payment Authorization"
                root_cause = "Cache Invalidation Bug"
                state = "Open"
            },
            @{
                incident_id = "INC-1020"
                title = "Payment Authorization degradation - DB Index Regression"
                severity = "P1"
                service = "Payment Authorization"
                root_cause = "DB Index Regression"
                state = "Open"
            },
            @{
                incident_id = "INC-1032"
                title = "API Gateway Services degradation - Network Congestion"
                severity = "P2"
                service = "API Gateway Services"
                root_cause = "Network Congestion"
                state = "Open"
            },
            @{
                incident_id = "INC-1021"
                title = "Settlement Processing degradation - Bad Deployment"
                severity = "P2"
                service = "Settlement Processing"
                root_cause = "Bad Deployment"
                state = "Open"
            },
            @{
                incident_id = "INC-1053"
                title = "Fraud Detection degradation - Memory Leak"
                severity = "P2"
                service = "Fraud Detection"
                root_cause = "Memory Leak"
                state = "Open"
            }
        )
    }
    messages = @(
        @{
            role = "user"
            content = "Can you explain the root cause of these active incidents?"
        }
    )
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Uri 'http://localhost:8000/api/copilot/chat' -Method Post -ContentType 'application/json' -Body $body
$response | ConvertTo-Json -Depth 5
