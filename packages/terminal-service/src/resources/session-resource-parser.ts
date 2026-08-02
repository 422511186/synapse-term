import { Buffer } from 'node:buffer';

import type {
  CpuResource,
  DiskResource,
  HostResource,
  MemoryResource,
  NetworkResource,
  OperatingSystemResource,
  ResourceMetric,
  ResourceUnavailableReason,
  SessionResourceDialect,
  SessionResourceSnapshot,
  SwapResource,
  UptimeResource,
} from './session-resource-domain.js';

export const RESOURCE_PROTOCOL_PREFIX = '__TA_RESOURCE_V1__';
export const MAX_RESOURCE_COLLECTION_ITEMS = 32;
export const MAX_RESOURCE_OUTPUT_BYTES = 64 * 1024;

const MAX_RESOURCE_PROTOCOL_LINES = 256;
const MAX_ENCODED_TEXT_BYTES = 4 * 1024;

const RESOURCE_UNAVAILABLE_MESSAGES: Readonly<Record<ResourceUnavailableReason, string>> = {
  not_reported: '目标环境未返回该指标',
  command_unavailable: '目标环境不支持该指标的只读采集命令',
  invalid_output: '目标环境返回的指标格式无效',
};

export interface ParseSessionResourceOutputOptions {
  collectedAt: string;
}

interface MetricAccumulator<T> {
  value?: T;
  sawUnavailable: boolean;
  sawInvalid: boolean;
}

interface ParserState {
  host: MetricAccumulator<HostResource>;
  os: MetricAccumulator<OperatingSystemResource>;
  uptime: MetricAccumulator<UptimeResource>;
  cpu: MetricAccumulator<CpuResource>;
  memory: MetricAccumulator<MemoryResource>;
  swap: MetricAccumulator<SwapResource>;
  disks: MetricAccumulator<DiskResource[]>;
  network: MetricAccumulator<NetworkResource[]>;
}

type ResourceMetricName = keyof ParserState;
type ResourceProtocolMetricName = Exclude<ResourceMetricName, 'disks'> | 'disk';

const POSIX_RESOURCE_COMMANDS = [
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_host=$(hostname 2>/dev/null); if [ -n "$ta_host" ]; then printf '%s|host|ok|%s\\n' "$ta_prefix" "$(printf '%s' "$ta_host" | base64 | tr -d '\\r\\n')"; else printf '%s|host|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os_name=$(uname -s 2>/dev/null); ta_os_version=$(uname -r 2>/dev/null); ta_os_arch=$(uname -m 2>/dev/null); if [ -n "$ta_os_name" ]; then printf '%s|os|ok|%s|%s|%s\\n' "$ta_prefix" "$(printf '%s' "$ta_os_name" | base64 | tr -d '\\r\\n')" "$(printf '%s' "$ta_os_version" | base64 | tr -d '\\r\\n')" "$(printf '%s' "$ta_os_arch" | base64 | tr -d '\\r\\n')"; else printf '%s|os|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os=$(uname -s 2>/dev/null); ta_uptime=''; if [ "$ta_os" = Linux ] && [ -r /proc/uptime ]; then ta_uptime=$(awk 'NR == 1 { printf "%.0f", $1; exit }' /proc/uptime 2>/dev/null); elif [ "$ta_os" = Darwin ]; then ta_boot=$(sysctl -n kern.boottime 2>/dev/null | awk -F '[=,]' 'NR == 1 { gsub(/[[:space:]]/, "", $2); print $2; exit }'); ta_now=$(date +%s 2>/dev/null); if [ -n "$ta_boot" ] && [ -n "$ta_now" ]; then ta_uptime=$((ta_now-ta_boot)); fi; fi; if [ -n "$ta_uptime" ]; then printf '%s|uptime|ok|%s\\n' "$ta_prefix" "$ta_uptime"; else printf '%s|uptime|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os=$(uname -s 2>/dev/null); ta_cpu_count=''; ta_cpu_usage=''; ta_load=''; if [ "$ta_os" = Linux ]; then ta_cpu_count=$(getconf _NPROCESSORS_ONLN 2>/dev/null); if [ -r /proc/stat ]; then ta_cpu_first=$(awk 'NR == 1 { idle=$5+$6; total=0; for (field=2; field<=NF; field++) total+=$field; print total, idle; exit }' /proc/stat 2>/dev/null); sleep 0.1; ta_cpu_second=$(awk 'NR == 1 { idle=$5+$6; total=0; for (field=2; field<=NF; field++) total+=$field; print total, idle; exit }' /proc/stat 2>/dev/null); ta_cpu_usage=$(awk -v first="$ta_cpu_first" -v second="$ta_cpu_second" 'BEGIN { split(first,a," "); split(second,b," "); delta=b[1]-a[1]; idle=b[2]-a[2]; if (delta>0) printf "%.2f", 100*(delta-idle)/delta }'); fi; ta_load=$(awk 'NR == 1 { print $1 "|" $2 "|" $3; exit }' /proc/loadavg 2>/dev/null); elif [ "$ta_os" = Darwin ]; then ta_cpu_count=$(sysctl -n hw.ncpu 2>/dev/null); ta_load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{ count=0; for (field=1; field<=NF; field++) { value=$field; gsub(/[{}]/, "", value); if (value ~ /^[0-9]/) values[++count]=value } if (count>=3) printf "%s|%s|%s", values[1], values[2], values[3] }'); fi; if printf '%s' "$ta_cpu_count" | grep -Eq '^[0-9]+$'; then :; else ta_cpu_count=''; fi; if [ -n "$ta_cpu_count$ta_cpu_usage$ta_load" ]; then printf '%s|cpu|ok|%s|%s|%s\\n' "$ta_prefix" "$ta_cpu_count" "$ta_cpu_usage" "$ta_load"; else printf '%s|cpu|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os=$(uname -s 2>/dev/null); ta_memory=''; if [ "$ta_os" = Linux ]; then ta_memory=$(awk '/^MemTotal:/ { total=$2; seen_total=1 } /^MemAvailable:/ { available=$2; seen_available=1 } END { if (seen_total && seen_available && total>=available) printf "%.0f|%.0f|%.0f", total*1024, (total-available)*1024, available*1024 }' /proc/meminfo 2>/dev/null); elif [ "$ta_os" = Darwin ]; then ta_total=$(sysctl -n hw.memsize 2>/dev/null); ta_page_size=$(sysctl -n hw.pagesize 2>/dev/null); ta_pages=$(vm_stat 2>/dev/null | awk '/^Pages free:/ { gsub(/\\./, "", $3); free=$3 } /^Pages inactive:/ { gsub(/\\./, "", $3); inactive=$3 } /^Pages speculative:/ { gsub(/\\./, "", $3); speculative=$3 } /^Pages purgeable:/ { gsub(/\\./, "", $3); purgeable=$3 } END { if (length(free)>0 && length(inactive)>0) { if (length(speculative)==0) speculative=0; if (length(purgeable)==0) purgeable=0; print free "|" inactive "|" speculative "|" purgeable } }'); ta_memory=$(awk -v total="$ta_total" -v page="$ta_page_size" -v pages="$ta_pages" 'BEGIN { split(pages, values, "|"); available=(values[1]+values[2]+values[3]+values[4])*page; if (total>0 && total>=available) printf "%.0f|%.0f|%.0f", total, total-available, available }'); fi; if [ -n "$ta_memory" ]; then printf '%s|memory|ok|%s\\n' "$ta_prefix" "$ta_memory"; else printf '%s|memory|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os=$(uname -s 2>/dev/null); ta_swap=''; if [ "$ta_os" = Linux ]; then ta_swap=$(awk '/^SwapTotal:/ { total=$2; seen_total=1 } /^SwapFree:/ { free=$2; seen_free=1 } END { if (seen_total && seen_free && total>=free) printf "%.0f|%.0f|%.0f", total*1024, (total-free)*1024, free*1024 }' /proc/meminfo 2>/dev/null); elif [ "$ta_os" = Darwin ]; then ta_swap=$(sysctl -n vm.swapusage 2>/dev/null | awk 'function bytes(value, suffix, scale) { suffix=substr(value,length(value),1); if (suffix=="K") scale=1024; else if (suffix=="M") scale=1048576; else if (suffix=="G") scale=1073741824; else if (suffix=="T") scale=1099511627776; else scale=1; sub(/[KMGT]$/, "", value); return value*scale } { for (field=1; field<=NF; field++) { if ($field=="total") total=$(field+2); else if ($field=="used") used=$(field+2); else if ($field=="free") free=$(field+2) } } END { if (length(total)>0 && length(used)>0 && length(free)>0) printf "%.0f|%.0f|%.0f", bytes(total), bytes(used), bytes(free) }'); fi; if [ -n "$ta_swap" ]; then printf '%s|swap|ok|%s\\n' "$ta_prefix" "$ta_swap"; else printf '%s|swap|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_disk_limit=${MAX_RESOURCE_COLLECTION_ITEMS}; if command -v df >/dev/null 2>&1; then df -Pk 2>/dev/null | awk -v limit="$ta_disk_limit" 'NR > 1 && count < limit { column=0; for (field=2; field<=NF-4; field++) if ($field ~ /^[0-9]+$/ && $(field+1) ~ /^[0-9]+$/ && $(field+2) ~ /^[0-9]+$/ && $(field+3) ~ /^[0-9]+%$/) { column=field; break } if (column>0) { name=$1; for (field=2; field<column; field++) name=name " " $field; mount=$(column+4); for (field=column+5; field<=NF; field++) mount=mount " " $field; print name "|" $column "|" $(column+1) "|" $(column+2) "|" $(column+3) "|" mount; count++ } }' | while IFS="|" read -r ta_disk_name ta_disk_total ta_disk_used ta_disk_available ta_disk_percent ta_disk_mount; do ta_disk_total=$(awk -v value="$ta_disk_total" 'BEGIN { printf "%.0f", value*1024 }'); ta_disk_used=$(awk -v value="$ta_disk_used" 'BEGIN { printf "%.0f", value*1024 }'); ta_disk_available=$(awk -v value="$ta_disk_available" 'BEGIN { printf "%.0f", value*1024 }'); ta_disk_percent=$(printf '%s' "$ta_disk_percent" | tr -d '%'); printf '%s|disk|ok|%s|%s|%s|%s|%s|%s\\n' "$ta_prefix" "$(printf '%s' "$ta_disk_name" | base64 | tr -d '\\r\\n')" "$(printf '%s' "$ta_disk_mount" | base64 | tr -d '\\r\\n')" "$ta_disk_total" "$ta_disk_used" "$ta_disk_available" "$ta_disk_percent"; done; else printf '%s|disk|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
  `ta_prefix='${RESOURCE_PROTOCOL_PREFIX}'; ta_os=$(uname -s 2>/dev/null); ta_network_limit=${MAX_RESOURCE_COLLECTION_ITEMS}; if [ "$ta_os" = Linux ] && [ -r /proc/net/dev ]; then awk -F '[: ]+' -v limit="$ta_network_limit" 'NR > 2 && count < limit { print $1 "|" $2 "|" $10; count++ }' /proc/net/dev 2>/dev/null | while IFS="|" read -r ta_network_name ta_network_received ta_network_transmitted; do printf '%s|network|ok|%s|%s|%s\\n' "$ta_prefix" "$(printf '%s' "$ta_network_name" | base64 | tr -d '\\r\\n')" "$ta_network_received" "$ta_network_transmitted"; done; else printf '%s|network|unavailable|command_unavailable\\n' "$ta_prefix"; fi`,
] as const;

const POWERSHELL_RESOURCE_COMMANDS = [
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; [Console]::WriteLine($taPrefix + '|host|ok|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Environment]::MachineName))) } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|host|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; $taOs=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; [Console]::WriteLine($taPrefix + '|os|ok|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$taOs.Caption)) + '|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$taOs.Version)) + '|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$taOs.OSArchitecture))) } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|os|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; $taOs=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; $taUptime=[Math]::Floor(((Get-Date).ToUniversalTime()-$taOs.LastBootUpTime.ToUniversalTime()).TotalSeconds); [Console]::WriteLine($taPrefix + '|uptime|ok|' + ([decimal]$taUptime).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)) } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|uptime|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; $taComputer=Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop; $taLoad=(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop | Measure-Object -Property LoadPercentage -Average).Average; [Console]::WriteLine($taPrefix + '|cpu|ok|' + ([decimal]$taComputer.NumberOfLogicalProcessors).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ([decimal]$taLoad).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|||') } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|cpu|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; $taOs=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; $taMemoryTotal=([decimal]$taOs.TotalVisibleMemorySize)*1024; $taMemoryAvailable=([decimal]$taOs.FreePhysicalMemory)*1024; [Console]::WriteLine($taPrefix + '|memory|ok|' + $taMemoryTotal.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ($taMemoryTotal-$taMemoryAvailable).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + $taMemoryAvailable.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)) } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|memory|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; $taOs=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop; $taSwapTotal=(([decimal]$taOs.TotalVirtualMemorySize)-([decimal]$taOs.TotalVisibleMemorySize))*1024; $taSwapAvailable=(([decimal]$taOs.FreeVirtualMemory)-([decimal]$taOs.FreePhysicalMemory))*1024; [Console]::WriteLine($taPrefix + '|swap|ok|' + $taSwapTotal.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ($taSwapTotal-$taSwapAvailable).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + $taSwapAvailable.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)) } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|swap|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; @([IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | Sort-Object Name | Select-Object -First ${MAX_RESOURCE_COLLECTION_ITEMS}) | ForEach-Object { $taDiskTotal=[decimal]$_.TotalSize; $taDiskAvailable=[decimal]$_.AvailableFreeSpace; $taDiskPercent=if ($taDiskTotal -gt 0) { 100*($taDiskTotal-$taDiskAvailable)/$taDiskTotal } else { 0 }; [Console]::WriteLine($taPrefix + '|disk|ok|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Name.TrimEnd('\\'))) + '|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Name)) + '|' + $taDiskTotal.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ($taDiskTotal-$taDiskAvailable).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + $taDiskAvailable.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ([decimal]$taDiskPercent).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)) } } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|disk|unavailable|command_unavailable') }`,
  `try { $taPrefix='${RESOURCE_PROTOCOL_PREFIX}'; @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' } | Sort-Object Name | Select-Object -First ${MAX_RESOURCE_COLLECTION_ITEMS}) | ForEach-Object { try { $taNetworkStats=$_.GetIPv4Statistics(); [Console]::WriteLine($taPrefix + '|network|ok|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Name)) + '|' + ([decimal]$taNetworkStats.BytesReceived).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture) + '|' + ([decimal]$taNetworkStats.BytesSent).ToString('0.00',[Globalization.CultureInfo]::InvariantCulture)) } catch {} } } catch { [Console]::WriteLine('${RESOURCE_PROTOCOL_PREFIX}|network|unavailable|command_unavailable') }`,
] as const;

export function buildSessionResourceCommands(dialect: SessionResourceDialect): readonly string[] {
  return dialect === 'posix' ? POSIX_RESOURCE_COMMANDS : POWERSHELL_RESOURCE_COMMANDS;
}

export function parseSessionResourceOutput(
  dialect: SessionResourceDialect,
  output: string,
  options: ParseSessionResourceOutputOptions,
): SessionResourceSnapshot {
  const state = createParserState();
  const boundedOutput = takeUtf8Prefix(output, MAX_RESOURCE_OUTPUT_BYTES);
  const lines = boundedOutput.split(/\r?\n/, MAX_RESOURCE_PROTOCOL_LINES);

  for (const line of lines) parseProtocolLine(line, state);

  const host = finishMetric(state.host);
  const os = finishMetric(state.os);
  const uptime = finishMetric(state.uptime);
  const cpu = finishMetric(state.cpu);
  const memory = finishMetric(state.memory);
  const swap = finishMetric(state.swap);
  const disks = finishMetric(state.disks);
  if (disks.status === 'available') {
    disks.value.sort(
      (left, right) =>
        diskPriority(left) - diskPriority(right) ||
        (left.mountPoint ?? left.name).localeCompare(right.mountPoint ?? right.name),
    );
  }
  const network = finishMetric(state.network);
  const metrics = [host, os, uptime, cpu, memory, swap, disks, network];
  const availableCount = metrics.filter((metric) => metric.status === 'available').length;

  return {
    dialect,
    collectedAt: options.collectedAt,
    status:
      availableCount === metrics.length
        ? 'complete'
        : availableCount === 0
          ? 'unavailable'
          : 'partial',
    host,
    os,
    uptime,
    cpu,
    memory,
    swap,
    disks,
    network,
  };
}

function createParserState(): ParserState {
  return {
    host: accumulator(),
    os: accumulator(),
    uptime: accumulator(),
    cpu: accumulator(),
    memory: accumulator(),
    swap: accumulator(),
    disks: accumulator(),
    network: accumulator(),
  };
}

function accumulator<T>(): MetricAccumulator<T> {
  return { sawUnavailable: false, sawInvalid: false };
}

function parseProtocolLine(line: string, state: ParserState): void {
  const prefixIndex = line.indexOf(RESOURCE_PROTOCOL_PREFIX);
  if (prefixIndex < 0) return;
  const fields = line.slice(prefixIndex).trimEnd().split('|');
  if (fields[0] !== RESOURCE_PROTOCOL_PREFIX) return;
  const metric = fields[1];
  if (!isResourceProtocolMetricName(metric)) return;
  const normalizedMetric = metric === 'disk' ? 'disks' : metric;
  const accumulator = state[normalizedMetric];
  const status = fields[2];
  if (status === 'unavailable') {
    if (fields[3] === 'command_unavailable') accumulator.sawUnavailable = true;
    else accumulator.sawInvalid = true;
    return;
  }
  if (status !== 'ok') {
    accumulator.sawInvalid = true;
    return;
  }

  const values = fields.slice(3);
  switch (metric) {
    case 'host':
      recordSingle(state.host, parseHost(values));
      return;
    case 'os':
      recordSingle(state.os, parseOperatingSystem(values));
      return;
    case 'uptime':
      recordSingle(state.uptime, parseUptime(values));
      return;
    case 'cpu':
      recordSingle(state.cpu, parseCpu(values));
      return;
    case 'memory':
      recordSingle(state.memory, parseMemory(values));
      return;
    case 'swap':
      recordSingle(state.swap, parseSwap(values));
      return;
    case 'disk': {
      const disk = parseDisk(values);
      if (disk === undefined) state.disks.sawInvalid = true;
      else appendBounded(state.disks, disk);
      return;
    }
    case 'network': {
      const network = parseNetwork(values);
      if (network === undefined) state.network.sawInvalid = true;
      else appendBounded(state.network, network);
      return;
    }
  }
}

function isResourceProtocolMetricName(
  value: string | undefined,
): value is ResourceProtocolMetricName {
  return (
    value === 'host' ||
    value === 'os' ||
    value === 'uptime' ||
    value === 'cpu' ||
    value === 'memory' ||
    value === 'swap' ||
    value === 'network' ||
    value === 'disk'
  );
}

function recordSingle<T>(accumulator: MetricAccumulator<T>, value: T | undefined): void {
  if (value === undefined) accumulator.sawInvalid = true;
  else accumulator.value ??= value;
}

function appendBounded<T>(accumulator: MetricAccumulator<T[]>, value: T): void {
  accumulator.value ??= [];
  if (accumulator.value.length < MAX_RESOURCE_COLLECTION_ITEMS) accumulator.value.push(value);
}

function finishMetric<T>(accumulator: MetricAccumulator<T>): ResourceMetric<T> {
  if (accumulator.value !== undefined) return { status: 'available', value: accumulator.value };
  if (accumulator.sawInvalid) return unavailableMetric('invalid_output');
  if (accumulator.sawUnavailable) return unavailableMetric('command_unavailable');
  return unavailableMetric('not_reported');
}

function unavailableMetric(reason: ResourceUnavailableReason): ResourceMetric<never> {
  return { status: 'unavailable', reason, message: RESOURCE_UNAVAILABLE_MESSAGES[reason] };
}

function parseHost(fields: readonly string[]): HostResource | undefined {
  const name = decodeText(fields[0]);
  return name === undefined ? undefined : { name };
}

function parseOperatingSystem(fields: readonly string[]): OperatingSystemResource | undefined {
  const name = decodeText(fields[0]);
  if (name === undefined) return undefined;
  const version = decodeOptionalText(fields[1]);
  const architecture = decodeOptionalText(fields[2]);
  if (version === null || architecture === null) return undefined;
  return {
    name,
    ...(version === undefined ? {} : { version }),
    ...(architecture === undefined ? {} : { architecture }),
  };
}

function parseUptime(fields: readonly string[]): UptimeResource | undefined {
  const seconds = parseNonNegativeInteger(fields[0]);
  return seconds === undefined ? undefined : { seconds };
}

function parseCpu(fields: readonly string[]): CpuResource | undefined {
  const logicalProcessors = parseOptionalNumber(fields[0], parsePositiveInteger);
  const usagePercent = parseOptionalNumber(fields[1], parsePercent);
  const oneMinute = parseOptionalNumber(fields[2], parseNonNegativeNumber);
  const fiveMinutes = parseOptionalNumber(fields[3], parseNonNegativeNumber);
  const fifteenMinutes = parseOptionalNumber(fields[4], parseNonNegativeNumber);
  if (
    logicalProcessors === null ||
    usagePercent === null ||
    oneMinute === null ||
    fiveMinutes === null ||
    fifteenMinutes === null
  ) {
    return undefined;
  }

  const cpu: CpuResource = {};
  if (logicalProcessors !== undefined) cpu.logicalProcessors = logicalProcessors;
  if (usagePercent !== undefined) cpu.usagePercent = usagePercent;
  if (oneMinute !== undefined && fiveMinutes !== undefined && fifteenMinutes !== undefined) {
    cpu.loadAverage = { oneMinute, fiveMinutes, fifteenMinutes };
  }
  return Object.keys(cpu).length === 0 ? undefined : cpu;
}

function parseMemory(fields: readonly string[]): MemoryResource | undefined {
  const totalBytes = parseNonNegativeInteger(fields[0]);
  const usedBytes = parseNonNegativeInteger(fields[1]);
  const availableBytes = parseOptionalNumber(fields[2], parseNonNegativeInteger);
  if (
    totalBytes === undefined ||
    usedBytes === undefined ||
    availableBytes === null ||
    usedBytes > totalBytes
  ) {
    return undefined;
  }
  return {
    totalBytes,
    usedBytes,
    ...(availableBytes === undefined ? {} : { availableBytes }),
  };
}

function parseSwap(fields: readonly string[]): SwapResource | undefined {
  return parseMemory(fields);
}

function parseDisk(fields: readonly string[]): DiskResource | undefined {
  const name = decodeText(fields[0]);
  const mountPoint = decodeOptionalText(fields[1]);
  const totalBytes = parseNonNegativeInteger(fields[2]);
  const usedBytes = parseNonNegativeInteger(fields[3]);
  const availableBytes = parseOptionalNumber(fields[4], parseNonNegativeInteger);
  const usagePercent = parseOptionalNumber(fields[5], parsePercent);
  if (
    name === undefined ||
    mountPoint === null ||
    totalBytes === undefined ||
    usedBytes === undefined ||
    availableBytes === null ||
    usagePercent === null ||
    usedBytes > totalBytes
  ) {
    return undefined;
  }
  return {
    name,
    ...(mountPoint === undefined ? {} : { mountPoint }),
    totalBytes,
    usedBytes,
    ...(availableBytes === undefined ? {} : { availableBytes }),
    ...(usagePercent === undefined ? {} : { usagePercent }),
  };
}

function parseNetwork(fields: readonly string[]): NetworkResource | undefined {
  const name = decodeText(fields[0]);
  const receivedBytes = parseNonNegativeInteger(fields[1]);
  const transmittedBytes = parseNonNegativeInteger(fields[2]);
  if (name === undefined || receivedBytes === undefined || transmittedBytes === undefined) {
    return undefined;
  }
  return { name, receivedBytes, transmittedBytes };
}

function diskPriority(disk: DiskResource): number {
  if (disk.mountPoint === '/') return 0;
  return /^(?:tmpfs|devtmpfs|none|squashfs)$/i.test(disk.name) ? 2 : 1;
}

function decodeOptionalText(value: string | undefined): string | null | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return decodeText(value) ?? null;
}

function decodeText(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_ENCODED_TEXT_BYTES ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return undefined;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_ENCODED_TEXT_BYTES) return undefined;
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    return undefined;
  }
  if (decoded.length === 0 || containsControlCharacter(decoded)) return undefined;
  return decoded;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parseOptionalNumber(
  value: string | undefined,
  parser: (input: string | undefined) => number | undefined,
): number | null | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return parser(value) ?? null;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parsePercent(value: string | undefined): number | undefined {
  const parsed = parseNonNegativeNumber(value);
  return parsed !== undefined && parsed <= 100 ? parsed : undefined;
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}
