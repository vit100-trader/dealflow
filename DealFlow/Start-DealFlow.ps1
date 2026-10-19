param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $dealFlowConfig = Get-Content -Raw .\appsettings.json | ConvertFrom-Json
    if (-not $env:DEALFLOW_ORACLE_PASSWORD -and -not $dealFlowConfig.Oracle.Password) {
        $dealFlowPassword = Read-Host 'DTCAN_QA read-only password' -AsSecureString
        $env:DEALFLOW_ORACLE_PASSWORD = [System.Net.NetworkCredential]::new('', $dealFlowPassword).Password
    }
    dotnet build .\DealFlow.csproj --configfile .\NuGet.Config --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    if (-not $NoBrowser) { Start-Process 'http://localhost:5110' }
    dotnet run --project .\DealFlow.csproj --no-build --no-launch-profile
} finally {
    Remove-Item Env:DEALFLOW_ORACLE_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
