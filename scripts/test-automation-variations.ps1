# Automation Feature - End-to-End Variation Runner
# Creates automations with every meaningful SETTING combination, triggers them,
# waits for each to reach a terminal state, and verifies the OUTCOME.
#
# Because the shared test workflow fails quickly (no harness), every
# execution terminates within ~2s. That's fine for validating the
# automation LAYER (iterations, retry, cancel, idempotency, etc.).

param(
    [string]$BaseUrl = "http://localhost:3100"
)

$ErrorActionPreference = 'Continue'
$script:passed = 0
$script:failed = 0
$script:failures = @()

function Assert($name, $cond, $detail = '') {
    if ($cond) {
        Write-Host "  [PASS] $name" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  [FAIL] $name  $detail" -ForegroundColor Red
        $script:failed++
        $script:failures += ("{0} :: {1}" -f $name, $detail)
    }
}

function Section($title) {
    Write-Host ""
    Write-Host "-- $title --" -ForegroundColor Cyan
}

function InvokeApi {
    param([string]$Method, [string]$Path, [object]$Body = $null, [hashtable]$Headers = @{}, [switch]$SwallowErrors)
    $params = @{ Uri = "$BaseUrl$Path"; Method = $Method; UseBasicParsing = $true; TimeoutSec = 15 }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress); $params.ContentType = 'application/json' }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }
    try {
        $r = Invoke-WebRequest @params
        return @{ StatusCode = $r.StatusCode; Body = if ($r.Content) { $r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue } else { $null }; RawBody = $r.Content; Headers = $r.Headers }
    } catch {
        $sc = 0; $rawBody = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $rawBody = $_.ErrorDetails.Message }
        if ($_.Exception.Response) { try { $sc = [int]$_.Exception.Response.StatusCode } catch {} }
        if (-not $SwallowErrors) { Write-Host "  [ERR] $Method $Path status=$sc body=$rawBody" -ForegroundColor DarkYellow }
        return @{ StatusCode = $sc; Body = $null; RawBody = $rawBody; Headers = @{} }
    }
}

# Wait until an execution reaches a terminal status or timeout.
function WaitForExecutionTerminal($automationId, $executionId, $timeoutSec = 30) {
    $terminal = @('completed', 'failed', 'cancelled')
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $r = InvokeApi -Method GET -Path "/api/automations/$automationId/executions/$executionId" -SwallowErrors
        if ($r.Body -and $terminal -contains $r.Body.status) { return $r.Body }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

$WFID = "0f2ef410-7181-4e42-9f94-e9f646535352"  # fails quickly, ideal for outcome tests
Write-Host "Using workflow: $WFID" -ForegroundColor DarkGray

# Pre-clean
$existing = (InvokeApi -Method GET -Path "/api/automations").Body
foreach ($a in $existing) {
    if ($a.name -like "e2e-var:*") { InvokeApi -Method DELETE -Path "/api/automations/$($a.id)" -SwallowErrors | Out-Null }
}

$created = @{}

# ═══════════════════════════════════════════════════════════════
Section "V1. Manual + single mode --> triggers and terminates"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v1-manual-single"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
}).Body
$created.v1 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V1-a execution reaches terminal state" ($null -ne $exec) "still running"
Assert "V1-b single mode --> 1 iteration total" ($exec.totalIterations -eq 1) "total=$($exec.totalIterations)"
Assert "V1-c execution runs count = 1" ($exec.runs.Count -eq 1) "runs=$($exec.runs.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V2. Manual + LEGACY loop mode --> N iterations"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v2-legacy-loop"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "loop"
    loopVariable = "item"
    loopItems = @("a", "b", "c")
    onError = "continue"
}).Body
$created.v2 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V2-a legacy loop reached terminal" ($null -ne $exec)
Assert "V2-b loop yields 3 iterations" ($exec.totalIterations -eq 3) "total=$($exec.totalIterations)"
Assert "V2-c 3 execution runs recorded" ($exec.runs.Count -eq 3) "runs=$($exec.runs.Count)"
# Verify each iteration received its loop variable
$iterVars = @($exec.runs | Sort-Object iterationIndex | ForEach-Object { $_.iterationVariables.item })
Assert "V2-d loop variable propagated (a,b,c)" ($iterVars -join ',' -eq 'a,b,c') "got=$($iterVars -join ',')"

# ═══════════════════════════════════════════════════════════════
Section "V3. Schema-driven + each_row"
# ═══════════════════════════════════════════════════════════════
$schema = @{
    version = 1
    format = "json_array"
    fields = @(
        @{ name = "ticketId"; type = "string"; required = $true }
        @{ name = "priority"; type = "string"; required = $false; enum = @("high","low") }
    )
    primaryKey = "ticketId"
}
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v3-schema-each-row"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
}).Body
$created.v3 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger" -Body @{
    dataset = @{
        format = "json_array"
        data = (@(@{ ticketId = "T1"; priority = "high" }, @{ ticketId = "T2"; priority = "low" }, @{ ticketId = "T3"; priority = "high" }) | ConvertTo-Json -Compress)
    }
    saveAsDefault = $true
}
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V3-a schema each_row terminal" ($null -ne $exec)
Assert "V3-b 3 iterations from 3 rows" ($exec.totalIterations -eq 3) "total=$($exec.totalIterations)"
Assert "V3-c iteration labels reflect primaryKey" (($exec.runs | Sort-Object iterationIndex | Select-Object -First 1).iterationLabel -eq 'ticketId=T1')
# Verify defaultDataset persisted
$aAfter = (InvokeApi -Method GET -Path "/api/automations/$($a.id)").Body
Assert "V3-d defaultDataset saved via saveAsDefault" ($null -ne $aAfter.defaultDataset -and $aAfter.defaultDataset.data -like "*T1*")

# ═══════════════════════════════════════════════════════════════
Section "V4. Schema-driven + group_by"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v4-schema-group-by"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "group_by"; fields = @("priority"); groupVariable = "tickets" }
}).Body
$created.v4 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger" -Body @{
    dataset = @{
        format = "json_array"
        data = (@(@{ ticketId = "T1"; priority = "high" }, @{ ticketId = "T2"; priority = "low" }, @{ ticketId = "T3"; priority = "high" }) | ConvertTo-Json -Compress)
    }
}
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V4-a group_by terminal" ($null -ne $exec)
Assert "V4-b group_by produces 2 iterations (high, low)" ($exec.totalIterations -eq 2) "total=$($exec.totalIterations)"
$firstGroup = ($exec.runs | Sort-Object iterationIndex | Select-Object -First 1).iterationVariables
Assert "V4-c first group has 'tickets' array populated" ($firstGroup.tickets.Count -ge 1) "tickets.Count=$($firstGroup.tickets.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V5. Schema-driven + single (batched)"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v5-schema-single"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "single"; datasetVariable = "batch" }
}).Body
$created.v5 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger" -Body @{
    dataset = @{
        format = "json_array"
        data = (@(@{ ticketId = "T1" }, @{ ticketId = "T2" }, @{ ticketId = "T3" }) | ConvertTo-Json -Compress)
    }
}
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V5-a single mode terminal" ($null -ne $exec)
Assert "V5-b single mode --> 1 iteration" ($exec.totalIterations -eq 1) "total=$($exec.totalIterations)"
$vars = ($exec.runs | Select-Object -First 1).iterationVariables
Assert "V5-c batch variable contains all 3 rows" ($vars.batch.Count -eq 3) "batch.Count=$($vars.batch.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V6. Retry policy --> 3 attempts on failure"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v6-retry"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    retryPolicy = @{
        maxAttempts = 3
        initialBackoffMs = 200
        backoffMultiplier = 2
        maxBackoffMs = 2000
        retryOn = @("workflow_failed", "timeout")
    }
}).Body
$created.v6 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 45
Assert "V6-a retry terminal" ($null -ne $exec)
# Since underlying workflow fails, retry runs 3 times --> 3 execution-run rows for the single iteration
Assert "V6-b 3 attempts recorded" ($exec.runs.Count -eq 3) "runs=$($exec.runs.Count)"
$attemptCounts = @($exec.runs | ForEach-Object { $_.attemptCount } | Sort-Object)
Assert "V6-c attemptCount sequence 1,2,3" ($attemptCounts -join ',' -eq '1,2,3') "got=$($attemptCounts -join ',')"

# ═══════════════════════════════════════════════════════════════
Section "V7. Idempotency --> single execution on replay"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v7-idem"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
}).Body
$created.v7 = $a.id
$key = "k-$(Get-Random -Maximum 9999999)"
$r1 = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger" -Headers @{ 'Idempotency-Key' = $key }
Start-Sleep -Milliseconds 200
$r2 = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger" -Headers @{ 'Idempotency-Key' = $key }
$id1 = if ($r1.Body.id) { $r1.Body.id } else { $r1.Body.executionId }
$id2 = if ($r2.Body.id) { $r2.Body.id } else { $r2.Body.executionId }
Assert "V7-a replay yields same execution id" ($id1 -eq $id2)
Assert "V7-b replay header present" ($r2.Headers['X-Idempotent-Replay'] -contains 'true')
$listAfter = (InvokeApi -Method GET -Path "/api/automations/$($a.id)/executions").Body
Assert "V7-c only ONE execution row exists" ($listAfter.Count -eq 1) "count=$($listAfter.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V8. Cancellation mid-run"
# ═══════════════════════════════════════════════════════════════
# Use a workflow that runs longer so we can catch it running.
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v8-cancel"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "loop"
    loopVariable = "n"
    loopItems = @(1..10)
    maxConcurrency = 1
}).Body
$created.v8 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
Start-Sleep -Milliseconds 200
$rC = InvokeApi -Method POST -Path "/api/automations/$($a.id)/executions/$($tr.Body.id)/cancel" -SwallowErrors
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 15
Assert "V8-a cancelled execution reaches terminal" ($null -ne $exec)
Assert "V8-b terminal status is 'cancelled'" ($exec.status -eq 'cancelled') "status=$($exec.status)"
Assert "V8-c not all iterations completed (cancel took effect)" ($exec.completedIterations + $exec.failedIterations -lt 10) "completed=$($exec.completedIterations) failed=$($exec.failedIterations)"

# ═══════════════════════════════════════════════════════════════
Section "V9. onError=stop halts after first failure"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v9-onerror-stop"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "loop"
    loopVariable = "n"
    loopItems = @(1..5)
    onError = "stop"
    maxConcurrency = 1
}).Body
$created.v9 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V9-a onError=stop terminal" ($null -ne $exec)
# With stop, we expect fewer than the total (5) iterations to have been dispatched
Assert "V9-b onError=stop halted before all 5 iterations" ($exec.runs.Count -lt 5) "runs=$($exec.runs.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V10. Multiple workflows per iteration (workflowIds >1)"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v10-multi-wf"
    triggerType = "manual"
    workflowIds = @($WFID, $WFID)
    inputMode = "single"
    onError = "continue"
}).Body
$created.v10 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 30
Assert "V10-a multi-wf terminal" ($null -ne $exec)
Assert "V10-b totalIterations counts iterations*workflows = 1*2 = 2" ($exec.totalIterations -eq 2) "total=$($exec.totalIterations)"
Assert "V10-c 2 execution run rows created" ($exec.runs.Count -eq 2) "runs=$($exec.runs.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V11. Webhook trigger --> schema-driven"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v11-webhook-schema"
    triggerType = "webhook"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
}).Body
$created.v11 = $a.id
$token = $a.webhookToken
$hookRes = InvokeApi -Method POST -Path "/api/automations/webhooks/$token" -Body @(@{ ticketId = "W-1"; priority = "high" }, @{ ticketId = "W-2"; priority = "low" })
Assert "V11-a webhook accepted with schema payload" ($hookRes.StatusCode -eq 202) "status=$($hookRes.StatusCode)"
$exec = WaitForExecutionTerminal $a.id $hookRes.Body.executionId 30
Assert "V11-b webhook execution terminal" ($null -ne $exec)
Assert "V11-c webhook payload produced 2 iterations" ($exec.totalIterations -eq 2) "total=$($exec.totalIterations)"

# ═══════════════════════════════════════════════════════════════
Section "V12. Concurrency=3 with 5 iterations"
# ═══════════════════════════════════════════════════════════════
$a = (InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v12-concurrency"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "loop"
    loopVariable = "n"
    loopItems = @(1..5)
    maxConcurrency = 3
    onError = "continue"
}).Body
$created.v12 = $a.id
$tr = InvokeApi -Method POST -Path "/api/automations/$($a.id)/trigger"
$exec = WaitForExecutionTerminal $a.id $tr.Body.id 45
Assert "V12-a concurrency terminal" ($null -ne $exec)
Assert "V12-b all 5 iterations executed" ($exec.runs.Count -eq 5) "runs=$($exec.runs.Count)"

# ═══════════════════════════════════════════════════════════════
Section "V13. Webhook triggerType schedule --> requires defaultDataset"
# ═══════════════════════════════════════════════════════════════
$badRes = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v13-schedule-noDefault"
    triggerType = "schedule"
    cronExpression = "0 9 * * *"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
} -SwallowErrors
Assert "V13-a schedule+schema without default rejected 400" ($badRes.StatusCode -eq 400)

$okRes = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-var:v13-schedule-withDefault"
    triggerType = "schedule"
    cronExpression = "0 9 * * *"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
    defaultDataset = @{ format = "json_array"; data = '[{"ticketId":"S-1"}]' }
}
Assert "V13-b schedule+schema with default accepted 201" ($okRes.StatusCode -eq 201)
if ($okRes.Body.id) { $created.v13 = $okRes.Body.id }

# ═══════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════
Section "Cleanup"
foreach ($id in $created.Values) { InvokeApi -Method DELETE -Path "/api/automations/$id" -SwallowErrors | Out-Null }
Write-Host "  Deleted $($created.Count) test automations"

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host " Results: $script:passed passed, $script:failed failed" -ForegroundColor $(if ($script:failed -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "===================================================================" -ForegroundColor Cyan
if ($script:failed -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $script:failures) { Write-Host "  * $f" }
}
