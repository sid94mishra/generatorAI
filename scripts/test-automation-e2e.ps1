# Automation Feature - End-to-End Test Harness
# Runs all critical automation scenarios against a live server.
# Prints PASS/FAIL for each scenario.

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
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null,
        [hashtable]$Headers = @{},
        [switch]$SwallowErrors
    )
    $params = @{
        Uri = "$BaseUrl$Path"
        Method = $Method
        UseBasicParsing = $true
        TimeoutSec = 15
    }
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
        $params.ContentType = 'application/json'
    }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }

    try {
        $r = Invoke-WebRequest @params
        return @{
            StatusCode = $r.StatusCode
            Body = if ($r.Content) { $r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue } else { $null }
            RawBody = $r.Content
            Headers = $r.Headers
        }
    } catch {
        $sc = 0
        $rawBody = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $rawBody = $_.ErrorDetails.Message
        }
        if ($_.Exception.Response) {
            try {
                $sc = [int]$_.Exception.Response.StatusCode
            } catch { $sc = 0 }
            # PowerShell 7 exposes Content via HttpResponseMessage; older PS uses GetResponseStream.
            if (-not $rawBody) {
                try {
                    $ct = $_.Exception.Response.Content
                    if ($ct) { $rawBody = $ct.ReadAsStringAsync().GetAwaiter().GetResult() }
                } catch {}
                if (-not $rawBody) {
                    try {
                        $stream = $_.Exception.Response.GetResponseStream()
                        $reader = New-Object System.IO.StreamReader($stream)
                        $rawBody = $reader.ReadToEnd()
                    } catch {}
                }
            }
        }
        if (-not $SwallowErrors) { Write-Host "  [ERR] $Method $Path status=$sc body=$rawBody" -ForegroundColor DarkYellow }
        return @{ StatusCode = $sc; Body = $null; RawBody = $rawBody; Headers = @{} }
    }
}

$WFID = $env:WFID
if (-not $WFID) {
    $wfs = (InvokeApi -Method GET -Path "/api/workflow-definitions").Body
    $WFID = $wfs[0].id
}
Write-Host "Using workflow: $WFID" -ForegroundColor DarkGray

# Cleanup any prior test automations
$existing = (InvokeApi -Method GET -Path "/api/automations").Body
foreach ($a in $existing) {
    if ($a.name -like "e2e-test:*") {
        InvokeApi -Method DELETE -Path "/api/automations/$($a.id)" -SwallowErrors | Out-Null
    }
}

$created = @{}

Section "A. CRUD"

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:a01-manual-single"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
}
Assert "A-01 create minimal manual automation" ($r.StatusCode -eq 201 -and $r.Body.id) $r.RawBody
$created.a01 = $r.Body.id

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:a02-full"
    description = "Full config"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    variables = @{ region = "us-east"; verbose = $true }
    maxConcurrency = 3
    onError = "stop"
}
Assert "A-02 create with full config" ($r.StatusCode -eq 201 -and $r.Body.maxConcurrency -eq 3 -and $r.Body.onError -eq "stop") $r.RawBody
$created.a02 = $r.Body.id

$list = (InvokeApi -Method GET -Path "/api/automations").Body
$found = $list | Where-Object { $_.id -eq $created.a01 }
Assert "A-03 list includes new automation" ($null -ne $found)

$r = InvokeApi -Method GET -Path "/api/automations/$($created.a01)"
Assert "A-04 detail loads with executions array" ($r.StatusCode -eq 200 -and $null -ne $r.Body.executions)

$r1 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/disable"
$r2 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/enable"
Assert "A-05 disable/enable toggles state" ($r1.Body.enabled -eq $false -and $r2.Body.enabled -eq $true)

$rTmp = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:a06-delete"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
}
$rDel = InvokeApi -Method DELETE -Path "/api/automations/$($rTmp.Body.id)"
$rCheck = InvokeApi -Method GET -Path "/api/automations/$($rTmp.Body.id)" -SwallowErrors
Assert "A-06 delete removes automation" ($rDel.StatusCode -eq 204 -and $rCheck.StatusCode -eq 404)

Section "B. Trigger Types"

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:b01-schedule"
    triggerType = "schedule"
    cronExpression = "0 9 * * *"
    workflowIds = @($WFID)
    inputMode = "single"
}
Assert "B-01 schedule with valid cron" ($r.StatusCode -eq 201 -and $r.Body.cronExpression -eq "0 9 * * *")
$created.b01 = $r.Body.id

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:b02-bad-cron"
    triggerType = "schedule"
    cronExpression = "not a cron"
    workflowIds = @($WFID)
    inputMode = "single"
} -SwallowErrors
Assert "B-02 invalid cron rejected (400)" ($r.StatusCode -eq 400)

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:b03-webhook"
    triggerType = "webhook"
    workflowIds = @($WFID)
    inputMode = "single"
}
Assert "B-03 webhook has token" ($r.StatusCode -eq 201 -and $r.Body.webhookToken.Length -eq 64)
$created.b03 = $r.Body.id
$b03Token = $r.Body.webhookToken

$r = InvokeApi -Method POST -Path "/api/automations/$($created.b03)/rotate-webhook-token"
Assert "B-04 rotate webhook token yields new token" ($r.StatusCode -eq 200 -and $r.Body.webhookToken -ne $b03Token)
$b03Token = $r.Body.webhookToken

$r = InvokeApi -Method POST -Path "/api/automations/webhooks/$b03Token" -Body @{ hello = "world" }
Assert "B-05 webhook POST accepts + returns 202" ($r.StatusCode -eq 202 -and $r.Body.executionId)

$r = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger"
Assert "B-06 manual trigger returns 202 + execution id" ($r.StatusCode -eq 202 -and $r.Body.id)

Section "C. Schema-driven data"

$schema = @{
    version = 1
    format = "json_array"
    fields = @(
        @{ name = "ticketId"; type = "string"; required = $true }
        @{ name = "priority"; type = "string"; required = $false; enum = @("high","medium","low") }
    )
    primaryKey = "ticketId"
}
$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:c01-schema"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
}
Assert "C-01 create schema-driven automation" ($r.StatusCode -eq 201 -and $null -ne $r.Body.dataSchema)
$created.c01 = $r.Body.id

$manyRows = @()
for ($i = 1; $i -le 8; $i++) { $manyRows += @{ ticketId = "T$i"; priority = "high" } }
$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
    dataset = @{ format = "json_array"; data = ($manyRows | ConvertTo-Json -Compress) }
}
Assert "C-02 preview returns 5 iterations + totals" ($r.StatusCode -eq 200 -and $r.Body.iterations.Count -eq 5 -and $r.Body.totalIterations -eq 8)

$rowsGrouped = @(
    @{ ticketId = "T1"; priority = "high" }
    @{ ticketId = "T2"; priority = "low" }
    @{ ticketId = "T3"; priority = "high" }
)
$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "group_by"; fields = @("priority") }
    dataset = @{ format = "json_array"; data = ($rowsGrouped | ConvertTo-Json -Compress) }
}
Assert "C-03 group_by produces 2 groups" ($r.StatusCode -eq 200 -and $r.Body.totalIterations -eq 2)

$rowsSingle = @(
    @{ ticketId = "T1" }
    @{ ticketId = "T2" }
)
$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "single"; datasetVariable = "tickets" }
    dataset = @{ format = "json_array"; data = ($rowsSingle | ConvertTo-Json -Compress) }
}
Assert "C-04 single mode yields 1 iteration with 2 rows in variable" ($r.StatusCode -eq 200 -and $r.Body.totalIterations -eq 1 -and $r.Body.iterations[0].variables.tickets.Count -eq 2)

$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
    dataset = @{ format = "json_array"; data = '[{"priority":"high"}]' }
} -SwallowErrors
Assert "C-05 missing required field returns 400" ($r.StatusCode -eq 400 -and $r.RawBody -like "*ticketId*")

$csvSchema = @{
    version = 1
    format = "csv"
    fields = @(
        @{ name = "id"; type = "string"; required = $true }
        @{ name = "estimate"; type = "number"; required = $false }
        @{ name = "active"; type = "boolean"; required = $false }
    )
}
$csvText = "id,estimate,active" + [char]10 + "row1,3,true" + [char]10 + "row2,7.5,false"
$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $csvSchema
    iterationMode = @{ kind = "each_row" }
    dataset = @{ format = "csv"; data = $csvText }
}
Assert "C-06 CSV coercion (number + boolean)" ($r.StatusCode -eq 200 -and $r.Body.iterations[0].variables.estimate -eq 3 -and $r.Body.iterations[0].variables.active -eq $true)

$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
    dataset = @{ format = "json_array"; data = '[{"ticketId":"T1","priority":"critical"}]' }
} -SwallowErrors
Assert "C-07 enum violation returns 400" ($r.StatusCode -eq 400 -and $r.RawBody -like "*must be one of*")

$r = InvokeApi -Method POST -Path "/api/automations/$($created.c01)/trigger" -Body @{
    dataset = @{ format = "json_array"; data = '[{"ticketId":"AA-1","priority":"high"}]' }
    saveAsDefault = $true
}
Assert "C-09 manual trigger with saveAsDefault=true accepted" ($r.StatusCode -eq 202)
Start-Sleep -Milliseconds 500
$rAfter = InvokeApi -Method GET -Path "/api/automations/$($created.c01)"
Assert "C-08 defaultDataset now populated on automation" ($null -ne $rAfter.Body.defaultDataset -and $rAfter.Body.defaultDataset.data -like "*AA-1*")

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:c10-schedule-no-default"
    triggerType = "schedule"
    cronExpression = "0 9 * * *"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
} -SwallowErrors
Assert "C-10 schedule+dataSchema without defaultDataset returns 400" ($r.StatusCode -eq 400)

$rTrig = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger"
Assert "C-11 legacy inputMode=single still triggers" ($rTrig.StatusCode -eq 202)

Section "D. Retry Policy"

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:d01-retry"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    retryPolicy = @{
        maxAttempts = 3
        initialBackoffMs = 1000
        backoffMultiplier = 2
        maxBackoffMs = 60000
        retryOn = @("workflow_failed", "timeout")
    }
}
Assert "D-01 create with retry policy" ($r.StatusCode -eq 201 -and $r.Body.retryPolicy.maxAttempts -eq 3 -and $r.Body.retryPolicy.retryOn.Count -eq 2)
$created.d01 = $r.Body.id

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:d02-retry-1"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    retryPolicy = @{
        maxAttempts = 1
        initialBackoffMs = 1000
        backoffMultiplier = 2
        maxBackoffMs = 60000
        retryOn = @("workflow_failed")
    }
}
Assert "D-02 server accepts maxAttempts=1 (means no retry)" ($r.StatusCode -eq 201)
if ($r.Body.id) { InvokeApi -Method DELETE -Path "/api/automations/$($r.Body.id)" | Out-Null }

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:d03-empty-retryOn"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    retryPolicy = @{
        maxAttempts = 3
        initialBackoffMs = 1000
        backoffMultiplier = 2
        maxBackoffMs = 60000
        retryOn = @()
    }
} -SwallowErrors
Assert "D-03 empty retryOn array rejected (400)" ($r.StatusCode -eq 400)

$r = InvokeApi -Method PATCH -Path "/api/automations/$($created.d01)" -Body @{
    retryPolicy = @{
        maxAttempts = 5
        initialBackoffMs = 500
        backoffMultiplier = 3
        maxBackoffMs = 30000
        retryOn = @("network")
    }
}
Assert "D-04 PATCH updates retry policy" ($r.StatusCode -eq 200 -and $r.Body.retryPolicy.maxAttempts -eq 5 -and $r.Body.retryPolicy.retryOn[0] -eq "network")

Section "E. Idempotency"

$key = "e2e-idem-$(Get-Random -Maximum 999999)"
$r1 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $key }
$r2 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $key }
$firstId = if ($r1.Body.id) { $r1.Body.id } else { $r1.Body.executionId }
$secondId = if ($r2.Body.id) { $r2.Body.id } else { $r2.Body.executionId }
Assert "E-01 same key yields same execution id" ($firstId -eq $secondId -and $r2.Headers['X-Idempotent-Replay'] -contains 'true')

$r1 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = "e2e-diff-A" }
$r2 = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = "e2e-diff-B" }
$idA = if ($r1.Body.id) { $r1.Body.id } else { $r1.Body.executionId }
$idB = if ($r2.Body.id) { $r2.Body.id } else { $r2.Body.executionId }
Assert "E-02 different keys yield different executions" ($idA -ne $idB)

$badKey = "bad" + [char]9 + "key"
$r = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $badKey } -SwallowErrors
Assert "E-03 control-char idempotency key returns 400" ($r.StatusCode -eq 400)

$key = "e2e-hdr-$(Get-Random -Maximum 999999)"
InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $key } | Out-Null
$r = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $key }
Assert "E-04 replay has X-Idempotent-Replay + 202" ($r.StatusCode -eq 202 -and $r.Headers['X-Idempotent-Replay'] -contains 'true')

Section "F. Execution + Cancellation"

$rTrig = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger"
$execId = if ($rTrig.Body.id) { $rTrig.Body.id } else { $rTrig.Body.executionId }
Start-Sleep -Milliseconds 300
$rCancel = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/executions/$execId/cancel" -SwallowErrors
Start-Sleep -Milliseconds 500
$rExec = InvokeApi -Method GET -Path "/api/automations/$($created.a01)/executions/$execId"
Assert "F-03 cancel transitions execution to cancelled" ($rExec.Body.status -eq "cancelled")

Section "H. Edge cases"

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:h01-no-wf"
    triggerType = "schedule"
    cronExpression = "0 9 * * *"
    workflowIds = @()
    inputMode = "single"
} -SwallowErrors
Assert "H-01 no workflow returns 400" ($r.StatusCode -eq 400)

$r = InvokeApi -Method POST -Path "/api/automations/preview-iterations" -Body @{
    dataSchema = $schema
    iterationMode = @{ kind = "each_row" }
    dataset = @{ format = "json_array"; data = "not valid json" }
} -SwallowErrors
Assert "H-02 malformed JSON dataset returns 400" ($r.StatusCode -eq 400)

$r = InvokeApi -Method POST -Path "/api/automations" -Body @{
    name = "e2e-test:h03-reserved"
    triggerType = "manual"
    workflowIds = @($WFID)
    inputMode = "single"
    dataSchema = @{
        version = 1
        format = "json_array"
        fields = @(@{ name = "__proto__"; type = "string"; required = $true })
    }
    iterationMode = @{ kind = "each_row" }
} -SwallowErrors
Assert "H-03 reserved-name schema field rejected" ($r.StatusCode -eq 400)

$longKey = "x" * 300
$r = InvokeApi -Method POST -Path "/api/automations/$($created.a01)/trigger" -Headers @{ 'Idempotency-Key' = $longKey } -SwallowErrors
Assert "H-05 idempotency key over 200 chars returns 400" ($r.StatusCode -eq 400)

# ── Cleanup ──
Section "Cleanup"
foreach ($id in $created.Values) {
    InvokeApi -Method DELETE -Path "/api/automations/$id" -SwallowErrors | Out-Null
}
Write-Host "  Cleaned up $($created.Count) test automations"

# Summary
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host " Results: $script:passed passed, $script:failed failed" -ForegroundColor $(if ($script:failed -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "===================================================================" -ForegroundColor Cyan
if ($script:failed -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $script:failures) { Write-Host "  * $f" }
}
