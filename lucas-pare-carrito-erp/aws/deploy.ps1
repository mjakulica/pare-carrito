param(
  [Parameter(Mandatory = $true)]
  [string]$BucketName,

  [Parameter(Mandatory = $false)]
  [string]$DistributionId
)

$ErrorActionPreference = "Stop"
$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host "Uploading static files to s3://$BucketName"
aws s3 sync $AppRoot "s3://$BucketName" `
  --exclude "aws/*" `
  --exclude "README.md" `
  --exclude "local-server.js" `
  --cache-control "no-cache"

if ($DistributionId) {
  Write-Host "Creating CloudFront invalidation for $DistributionId"
  aws cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths "/*"
}

Write-Host "Deploy finished."
