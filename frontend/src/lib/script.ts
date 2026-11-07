// PowerShell export of a cleanup plan. The script is meant to be read before it is run: it is
// commented, works on Windows PowerShell 5.1, uses -LiteralPath everywhere, starts in dry-run
// mode, and keeps administrator steps in their own section.

import type { Mode } from "./types";

export interface ScriptItem {
  title: string;
  paths: string[];
  mode: Mode | "path";
  include?: string[];
  exclude?: string[];
  minAgeHours?: number | null;
  admin?: boolean;
  command?: string | null;
}

export interface ScriptOptions {
  recycle: boolean;
  generatedAt: Date;
  version: string;
}

/** Single-quoted PowerShell string literal. */
export function psQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function itemBlock(item: ScriptItem): string[] {
  const lines: string[] = [`# ${item.title.replace(/[\r\n]+/g, " ")}`];
  if (item.mode === "report") {
    if (item.command && !item.command.startsWith("api:")) {
      lines.push(`# Cleaned with its official tool instead of deleting files:`);
      lines.push(`if (-not $DryRun) { ${item.command} } else { Write-Host 'Would run: ${item.command.replace(/'/g, "''")}' }`);
    } else if (item.command?.startsWith("api:SHEmptyRecycleBin")) {
      lines.push(`if (-not $DryRun) { Clear-RecycleBin -Force -ErrorAction SilentlyContinue } else { Write-Host 'Would empty the Recycle Bin' }`);
    } else {
      lines.push(`# Report only: nothing is deleted.`);
    }
    return lines;
  }
  const age = item.minAgeHours ? ` -MinAgeHours ${Math.max(0, Math.floor(item.minAgeHours))}` : "";
  const exclude = item.exclude?.length ? ` -Exclude @(${item.exclude.map(psQuote).join(", ")})` : "";
  for (const p of item.paths) {
    const q = psQuote(p);
    if (item.mode === "contents") {
      lines.push(`Remove-Contents -Path ${q}${age}${exclude}`);
    } else if (item.mode === "files") {
      const inc = (item.include ?? []).map(psQuote).join(", ");
      lines.push(`Remove-MatchingFiles -Path ${q} -Include @(${inc})${age}`);
    } else {
      lines.push(`Remove-Target -Path ${q}`);
    }
  }
  return lines;
}

export function buildScript(items: ScriptItem[], opts: ScriptOptions): string {
  const user = items.filter((i) => !i.admin);
  const admin = items.filter((i) => i.admin);
  const out: string[] = [
    `# ReClaim Cleaner ${opts.version}: cleanup script`,
    `# Generated ${opts.generatedAt.toISOString()}`,
    `#`,
    `# Read it before running. It starts in dry-run mode and only lists what it would do.`,
    `# Set $DryRun = $false to delete. ${opts.recycle ? "Items go to the Recycle Bin." : "Items are deleted permanently."}`,
    `# Junctions and symbolic links are skipped, never followed.`,
    ``,
    `$DryRun = $true`,
    `$UseRecycleBin = $${opts.recycle ? "true" : "false"}`,
    `Add-Type -AssemblyName Microsoft.VisualBasic`,
    ``,
    `function Remove-One([System.IO.FileSystemInfo]$Item) {`,
    `  if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }`,
    `  if ($DryRun) { Write-Host "Would delete: $($Item.FullName)"; return }`,
    `  try {`,
    `    $mode = if ($UseRecycleBin) { 'SendToRecycleBin' } else { 'DeletePermanently' }`,
    `    if ($Item.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($Item.FullName, 'OnlyErrorDialogs', $mode) }`,
    `    else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Item.FullName, 'OnlyErrorDialogs', $mode) }`,
    `  } catch { Write-Warning "Skipped (in use or denied): $($Item.FullName)" }`,
    `}`,
    ``,
    `function Test-Excluded([string]$Name, [string[]]$Exclude) {`,
    `  foreach ($e in $Exclude) { if ($Name -like $e) { return $true } }`,
    `  return $false`,
    `}`,
    ``,
    `function Get-FilesSafe([string]$Path, [string[]]$Exclude = @()) {`,
    `  # Manual recursion: Windows PowerShell 5.1 follows junctions with -Recurse.`,
    `  Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }`,
    `    if (Test-Excluded $_.Name $Exclude) { return }`,
    `    if ($_.PSIsContainer) { Get-FilesSafe $_.FullName $Exclude } else { $_ }`,
    `  }`,
    `}`,
    ``,
    `function Remove-Contents([string]$Path, [int]$MinAgeHours = 0, [string[]]$Exclude = @()) {`,
    `  if (-not (Test-Path -LiteralPath $Path)) { return }`,
    `  if ($MinAgeHours -gt 0 -or $Exclude.Count -gt 0) {`,
    `    $cutoff = (Get-Date).AddHours(-$MinAgeHours)`,
    `    Get-FilesSafe $Path $Exclude | Where-Object { $MinAgeHours -eq 0 -or $_.LastWriteTime -lt $cutoff } | ForEach-Object { Remove-One $_ }`,
    `  } else {`,
    `    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-One $_ }`,
    `  }`,
    `}`,
    ``,
    `function Remove-MatchingFiles([string]$Path, [string[]]$Include, [int]$MinAgeHours = 0) {`,
    `  if (-not (Test-Path -LiteralPath $Path)) { return }`,
    `  $cutoff = (Get-Date).AddHours(-$MinAgeHours)`,
    `  Get-ChildItem -LiteralPath $Path -File -Force -ErrorAction SilentlyContinue |`,
    `    Where-Object { $n = $_.Name; ($Include | Where-Object { $n -like $_ }) -and ($MinAgeHours -eq 0 -or $_.LastWriteTime -lt $cutoff) } |`,
    `    ForEach-Object { Remove-One $_ }`,
    `}`,
    ``,
    `function Remove-Target([string]$Path) {`,
    `  if (Test-Path -LiteralPath $Path) { Remove-One (Get-Item -LiteralPath $Path -Force) }`,
    `}`,
    ``,
  ];
  if (user.length) {
    out.push(`# ---- Current user ----`, ``);
    for (const item of user) out.push(...itemBlock(item), ``);
  }
  if (admin.length) {
    out.push(
      `# ---- Needs administrator rights ----`,
      `$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
      `if (-not $isAdmin) {`,
      `  Write-Warning 'Skipping the administrator section. Run PowerShell as administrator to include it.'`,
      `} else {`,
    );
    for (const item of admin) out.push(...itemBlock(item).map((l) => "  " + l), ``);
    out.push(`}`, ``);
  }
  out.push(`Write-Host 'Done.'`);
  return out.join("\r\n");
}
