$ErrorActionPreference = 'Stop'
$bundledNode = 'C:\Users\mvkiselev\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($node) { $node.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { throw 'Node.js 22.5+ не найден.' }

$testFiles = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'test') -Filter '*.test.js' | Select-Object -ExpandProperty FullName
& $nodePath --test $testFiles
