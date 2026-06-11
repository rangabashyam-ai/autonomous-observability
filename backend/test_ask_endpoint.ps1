$body = @{
    question = "Can you explain the root cause of these active incidents?"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'http://localhost:8000/api/copilot/ask' -Method Post -ContentType 'application/json' -Body $body
$response | ConvertTo-Json -Depth 5
