param([string]$Action = 'create')

$Api = 'http://localhost:3100/api'

if ($Action -eq 'create') {
  $body = @{
    name             = 'CU VSCode - monitored run'
    model            = 'claude-opus-4.5'
    harnessConfig    = @{ availableTools = @('*'); streaming = $true }
    browserConfig    = @{ enabled = $false }
    tags             = @()
    defaultAgentMode = 'auto'
  } | ConvertTo-Json -Depth 5
  $c = Invoke-RestMethod -Method Post -Uri "$Api/chats" -ContentType 'application/json' -Body $body -TimeoutSec 300
  $c | Select-Object id, name, workspaceId, sessionId, permissionMode, model | Format-List
  $c.id | Set-Content "$PSScriptRoot/tmp-cu-chatid.txt"
  $c.workspaceId | Set-Content "$PSScriptRoot/tmp-cu-wsid.txt"
}
