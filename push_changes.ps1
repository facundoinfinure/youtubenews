cd "c:\Users\Usuario\Downloads\chimpnews - cursor"

$output = @()

$output += "=== Git Status ==="
$output += git status 2>&1 | Out-String

$output += "`n=== Current HEAD ==="
$output += git rev-parse --short HEAD 2>&1 | Out-String

$output += "`n=== Remote HEAD ==="
git fetch origin 2>&1 | Out-Null
$output += git rev-parse --short origin/main 2>&1 | Out-String

$output += "`n=== Uncommitted changes ==="
$output += git status --short 2>&1 | Out-String

$output += "`n=== Untracked files ==="
$output += git ls-files --others --exclude-standard 2>&1 | Out-String

$output += "`n=== Adding all changes ==="
git add -A 2>&1 | Out-Null
$output += git status --short 2>&1 | Out-String

$output += "`n=== Committing ==="
$commitOutput = git commit -m "feat: Add production versioning migration and update all related files" 2>&1 | Out-String
$output += $commitOutput

$output += "`n=== Pushing to origin/main ==="
$pushOutput = git push origin main 2>&1 | Out-String
$output += $pushOutput

$output += "`n=== Final status ==="
$output += git log --oneline -3 2>&1 | Out-String
$output += git status 2>&1 | Out-String

$output | Out-File -FilePath "push_output.txt" -Encoding utf8
$output
