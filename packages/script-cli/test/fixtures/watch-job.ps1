$ErrorActionPreference = 'Stop'

$jobHandle = [IntPtr]::Zero
$processHandle = [IntPtr]::Zero
$exitCode = 0

try {
    if ($args.Count -ne 1) {
        throw 'Expected exactly one argument: the paused root process ID.'
    }

    [uint32]$rootPid = 0
    if (-not [uint32]::TryParse($args[0], [ref]$rootPid) -or $rootPid -eq 0) {
        throw "Invalid root process ID: '$($args[0])'."
    }

    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class WatchJobNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref ExtendedLimitInformation information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryInformationJobObject(
        IntPtr job, int informationClass, IntPtr information, uint length, out uint returnedLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    public static void TerminateAndWait(IntPtr job)
    {
        if (!TerminateJobObject(job, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        int size = 65536;
        while (true)
        {
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                uint returned;
                if (!QueryInformationJobObject(job, 3, buffer, (uint)size, out returned))
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error != 234) throw new Win32Exception(error);
                    size = checked(size * 2);
                    continue;
                }
                int count = Marshal.ReadInt32(buffer, 4);
                for (int i = 0; i < count; i++)
                {
                    uint pid = unchecked((uint)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64());
                    IntPtr process = OpenProcess(0x00100000, false, pid); // SYNCHRONIZE
                    if (process == IntPtr.Zero)
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error != 87) throw new Win32Exception(error); // Already exited.
                        continue;
                    }
                    try
                    {
                        if (WaitForSingleObject(process, 0xffffffff) != 0)
                            throw new Win32Exception(Marshal.GetLastWin32Error());
                    }
                    finally { CloseHandle(process); }
                }
                return;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    public static int LastError()
    {
        return Marshal.GetLastWin32Error();
    }
}
'@

    $jobHandle = [WatchJobNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($jobHandle -eq [IntPtr]::Zero) {
        throw "CreateJobObject failed (Win32 error $([WatchJobNative]::LastError()))."
    }

    $limits = New-Object WatchJobNative+ExtendedLimitInformation
    $basicLimits = $limits.BasicLimitInformation
    $basicLimits.LimitFlags = 0x00002000
    $limits.BasicLimitInformation = $basicLimits
    $limitsSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($limits)
    if (-not [WatchJobNative]::SetInformationJobObject($jobHandle, 9, [ref]$limits, $limitsSize)) {
        throw "Setting JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE failed (Win32 error $([WatchJobNative]::LastError()))."
    }

    # PROCESS_TERMINATE | PROCESS_SET_QUOTA
    $processHandle = [WatchJobNative]::OpenProcess([uint32](0x0001 -bor 0x0100), $false, $rootPid)
    if ($processHandle -eq [IntPtr]::Zero) {
        throw "OpenProcess($rootPid) failed (Win32 error $([WatchJobNative]::LastError()))."
    }

    if (-not [WatchJobNative]::AssignProcessToJobObject($jobHandle, $processHandle)) {
        throw "AssignProcessToJobObject($rootPid) failed (Win32 error $([WatchJobNative]::LastError()))."
    }

    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    [void][Console]::In.ReadToEnd()
    [WatchJobNative]::TerminateAndWait($jobHandle)
}
catch {
    [Console]::Error.WriteLine("watch-job setup or wait failed: $($_.Exception.Message)")
    $exitCode = 1
}
finally {
    if ($jobHandle -ne [IntPtr]::Zero) {
        if (-not [WatchJobNative]::CloseHandle($jobHandle)) {
            [Console]::Error.WriteLine("CloseHandle(job) failed (Win32 error $([WatchJobNative]::LastError())).")
            $exitCode = 1
        }
        $jobHandle = [IntPtr]::Zero
    }

    if ($processHandle -ne [IntPtr]::Zero) {
        if (-not [WatchJobNative]::CloseHandle($processHandle)) {
            [Console]::Error.WriteLine("CloseHandle(process) failed (Win32 error $([WatchJobNative]::LastError())).")
            $exitCode = 1
        }
        $processHandle = [IntPtr]::Zero
    }
}

exit $exitCode
