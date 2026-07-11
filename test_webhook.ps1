$ErrorActionPreference = "Stop"

Write-Host "=== WEBHOOK TEXT FIELD KONTROLU ==="
$testBody = @{
    id = "test_kontrol_77"
    wa_phone = "+905551234567"
    last_input_text = "merhaba"
} | ConvertTo-Json

$bytes = [System.Text.Encoding]::UTF8.GetBytes($testBody)

try {
    $response = Invoke-WebRequest -Uri 'https://musteri-hizmetleri-ai-production-f980.up.railway.app/webhook/manychat?platform=whatsapp' -Method POST -ContentType 'application/json; charset=utf-8' -Body $bytes
    Write-Host "STATUS:" $response.StatusCode
    $json = $response.Content | ConvertFrom-Json
    
    Write-Host ""
    Write-Host "=== TEXT FIELD ==="
    if ($json.text) {
        Write-Host "TEXT MEVCUT:" $json.text.Substring(0, [Math]::Min(200, $json.text.Length))
    } else {
        Write-Host "TEXT ALANI YOK - Deploy henuz tamamlanmamis!"
    }
    
    Write-Host ""
    Write-Host "=== FULL RESPONSE ==="
    Write-Host $response.Content
} catch {
    Write-Host "HATA:" $_.Exception.Message
}
