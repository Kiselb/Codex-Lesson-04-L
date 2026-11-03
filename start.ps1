$ErrorActionPreference = 'Stop'
$bundledNode = 'C:\Users\mvkiselev\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = Get-Command node -ErrorAction SilentlyContinue

if ($node) {
  & $node.Source (Join-Path $PSScriptRoot 'server.js')
} elseif (Test-Path -LiteralPath $bundledNode) {
  & $bundledNode (Join-Path $PSScriptRoot 'server.js')
} else {
  throw 'Node.js 22.5+ не найден. Установите Node.js и повторите запуск.'
}
